/**
 * CastingEngine — 乐队编曲决策器(Phase 2 由 BandEngine 重命名而来)
 *
 * 凌驾于 MusicGenerationEngine 之上的"导演层"。消费用户编制 (BandRoster) + 段落表 +
 * 风格,输出每段每职能的演奏决策 (BandPlan),供 Stage5Layering 消费。
 *
 * 改名理由(Phase 2):
 *   - 旧名 BandEngine 暗示"渲染乐队声音",实际职责是"定角色 + 选织体 + 喂 idiom 参数",
 *     即音乐工程里的 Casting Director。Phase 3+ 加入 Realizer / RegisterMap 后,
 *     "导演"语义会被进一步加强。
 *   - 输出数据类型 BandPlan / BandRoster / BandRole 等保留原名:它们描述的是
 *     "乐队的计划",而非决策模块。
 *
 * 4 个 Pass(V1 只实现 A 和 C):
 *   Pass A — Roster 验证:检查每个 musician 的 role 是否在 eligibleRoles 内
 *   Pass B — 角色升降:跳过(V1 无 Vocal)
 *   Pass C — 段落决策:对每段输出 SectionPlan
 *   Pass D — 冲突解析:跳过(V1 无双钢琴/M5)
 *
 * Pitch Space: N/A(CastingEngine 不接触 pitch,仅做决策矩阵)
 * PRNG 消耗: 0(决策完全确定性,仅由 roster + sections + context 决定)
 *
 * Phase 2 重构:消除原 BandEngine 的 4 个 private static currentXxx 字段
 *   (swingRatio / styleId / bpm / tonality)。改为 PlanContext 显式参数沿调用链
 *   向下传,避免"伪装成类变量的临时上下文"——线程不安全 + 隐式状态。
 */

import {
    BandPlan,
    BandRole,
    BandRoster,
    ActiveMusician,
    SectionPlan,
    RoleAssignment,
    SectionMetadata,
    SectionType,
    Tonality,
    Musician,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import {
    PianoAccompParams,
    LHTexture,
    RHTexture,
    CoordMode,
} from '../primitives/PianoAccompIdiom';
import {
    TextureRecipeId,
    getPianoTextureRecipe,
} from '../data/PianoTextureRecipes';
import { MoodId, pickMood, moodToRecipe, pickWalkPattern } from './MoodRouter';
import { WalkPatternId } from '../data/BassWalkPatterns';

const EPSILON = 1e-6;
const ENERGY_MAX = 10;
const INTENSITY_MIN = 0.1;
const INTENSITY_MAX = 1.0;

/**
 * Phase 3 — 每风格的 anchor recipe(锚点乐器跨段锁定的"基因 DNA")。
 *
 * anchor musician(isAnchor=true,如 alex_piano)在所有段落使用本表对应的 recipe,
 * 跨段不重选。然后 RhythmMask 按各段 density 过滤 baseGrid,实现"basal pattern
 * 不变,density 浮动"的 PEAA Anchor Layer 效果。
 *
 * 选择标准:每风格挑一个"中高密度 + 风格签名"的 recipe 作为 anchor 锚定。
 * Phase 3 起点,听感后调:
 *   - Pop: AlbertiBass(L4 8 分琶音,BGM Pluck 感)
 *   - Jazz: SyncopatedStab(L5 经典爵士 comping)
 *   - NeoSoul: NeoSoulVamp(L6 拖拍 vamp + rootless voicing)
 *
 * 改 StyleId 枚举顺序需同步本表(cross_sync_rule.md §1.6)。
 */
const STYLE_ANCHOR_RECIPE: Readonly<Record<StyleId, TextureRecipeId>> = {
    [StyleId.ModernPop]: TextureRecipeId.AlbertiBass,
    [StyleId.ChillJazz]: TextureRecipeId.SyncopatedStab,
    [StyleId.NeoSoul]:   TextureRecipeId.NeoSoulVamp,
};

export interface CastingEngineInput {
    /** 用户配置或随机抽取的乐队阵容 */
    roster: BandRoster;
    /** Stage 1~2 输出的段落表 */
    sections: SectionMetadata[];
    /** 仅作上下文传递（V1 不消费；V2 PianoAccompIdiom 可能按风格选织体） */
    styleId: StyleId;
    /** 仅作上下文传递（V1 不消费） */
    tonality: Tonality;
    /** 仅作上下文传递（V1 不消费） */
    timeSignature: [number, number];
    /** V5.2 Swing 比例（0.5=直拍 / 0.55=微 swing / 0.6=中 swing / 0.67=triplet）
     *  来自 styleConfig.swingRatio，透传到 PianoAccompParams.swingRatio */
    swingRatio?: number;
    /**
     * Sub-Phase 3：全曲 BPM（MoodRouter 的关键决策维度之一）。
     *
     * 缺省回落到 100（中速），保证旧调用方（V1 smoke 等）继续可用。
     */
    bpm?: number;
}

/**
 * Phase 2 重构:决策上下文(原 BandEngine 的 4 个 private static currentXxx 替代品)。
 *
 * 在 plan() 入口一次性构造,沿调用链显式向下传到 planSection / pickPianoAccompParams。
 * 不再隐藏在 class static 字段里 —— 纯函数风格,可并发、可测试。
 */
interface PlanContext {
    /** V5.2 Swing 比例(0.5=直拍 / 0.55=微 swing / 0.6=中 swing / 0.67=triplet) */
    swingRatio: number;
    /** Sub-Phase 3 MoodRouter 决策维度 */
    styleId: StyleId;
    bpm: number;
    tonality: Tonality;
}

export class CastingEngine {
    /**
     * 生成 BandPlan:4 个 Pass 顺序执行。
     *
     * 输出:
     *   - sectionPlans: 长度 === sections.length,平行索引
     *   - activeMusicians: roster 里非 null 且通过 Pass A 验证的乐手
     */
    public static plan(input: CastingEngineInput): BandPlan {
        // Phase 2:决策上下文一次性构造,后续显式参数传递(无 class static)
        const ctx: PlanContext = {
            swingRatio: input.swingRatio ?? 0.5,
            styleId: input.styleId,
            bpm: input.bpm ?? 100,
            tonality: input.tonality,
        };

        // ----------------------------------------------------------------
        // Pass A: Roster 验证 — 收集合法乐手到 activeMusicians
        // ----------------------------------------------------------------
        const activeMusicians = CastingEngine.validateRoster(input.roster);

        // ----------------------------------------------------------------
        // Pass B: 角色升降 — V1 跳过
        // ----------------------------------------------------------------
        // (V2 TODO: 检查 roster.mainInst === null && roster.accomp !== null
        //  → 钢琴 Accomp 升格为 MainInst,设置 promotedFromAccomp = true)

        // ----------------------------------------------------------------
        // Pass C: 段落决策 — 为每段输出 SectionPlan
        // ----------------------------------------------------------------
        // bassActive 决定钢琴 LH 让位 (M4) 还是接管 (M1);全曲恒定,预计算一次
        const bassActive = activeMusicians.some(am => am.assignedRole === BandRole.Bass);

        const sectionPlans: SectionPlan[] = [];
        for (let i = 0; i < input.sections.length; i++) {
            sectionPlans.push(CastingEngine.planSection(i, input.sections[i], activeMusicians, bassActive, ctx));
        }

        // ----------------------------------------------------------------
        // Pass D: 冲突解析 — V1 跳过
        // ----------------------------------------------------------------
        // (V2 TODO: 双钢琴音区分配 / M5 + Bass 互斥)

        return { sectionPlans, activeMusicians };
    }

    // ================================================================
    // Pass A — Roster 验证
    // ================================================================

    private static validateRoster(roster: BandRoster): ActiveMusician[] {
        const out: ActiveMusician[] = [];
        CastingEngine.tryAdd(out, roster.vocal,      BandRole.Vocal);
        CastingEngine.tryAdd(out, roster.mainInst,   BandRole.MainInst);
        CastingEngine.tryAdd(out, roster.accomp,     BandRole.Accomp);
        CastingEngine.tryAdd(out, roster.bass,       BandRole.Bass);
        CastingEngine.tryAdd(out, roster.drums,      BandRole.Drums);
        CastingEngine.tryAdd(out, roster.atmosphere, BandRole.Atmosphere);
        return out;
    }

    private static tryAdd(
        out: ActiveMusician[],
        musician: Musician | null | undefined,
        slot: BandRole,
    ): void {
        if (musician === null || musician === undefined) return;

        // eligibleRoles 校验：乐手必须能胜任当前槽位
        let eligible = false;
        for (let i = 0; i < musician.eligibleRoles.length; i++) {
            if (musician.eligibleRoles[i] === slot) {
                eligible = true;
                break;
            }
        }
        if (!eligible) {
            throw new CastingEngineError(
                'musician not eligible for assigned role',
                { musicianId: musician.id, assignedRole: slot, eligibleRoles: musician.eligibleRoles },
            );
        }

        out.push({ card: musician, assignedRole: slot });
    }

    // ================================================================
    // Pass C — 单段决策
    // ================================================================

    private static planSection(
        sectionIdx: number,
        section: SectionMetadata,
        activeMusicians: ActiveMusician[],
        bassActive: boolean,
        ctx: PlanContext,
    ): SectionPlan {
        const intensityScale = CastingEngine.normalizeEnergy(section.energyLevel);

        const assignments: Partial<Record<BandRole, RoleAssignment>> = {};
        for (let i = 0; i < activeMusicians.length; i++) {
            const am = activeMusicians[i];
            const role = am.assignedRole;

            // 按角色填 instrumentSpecificParams(V1:仅 Accomp 实装钢琴 params,其他角色保持 undefined 走旧 fallback)
            let params: unknown = undefined;
            if (role === BandRole.Accomp) {
                params = CastingEngine.pickPianoAccompParams(section, am.card, bassActive, intensityScale, ctx);
            }

            assignments[role] = {
                musicianId: am.card.id,
                intensityScale,
                instrumentSpecificParams: params,
            };
        }

        return { sectionIdx, assignments };
    }

    // ================================================================
    // Pass C 子流程 — 钢琴伴奏织体选择
    // ================================================================
    //
    // 启发式映射（基于音乐物理 + bassActive 决定 Solo Piano vs Ensemble 模式）：
    //
    // RH 织体（按 sectionType）：
    //   - Verse / PreChorus       → R3 Stab（轻盈切分，给主旋律留空间）
    //   - Chorus / Drop / BuildUp → R1 Block（柱式齐砸，能量感）
    //   - Bridge / Intro / Outro / PreOutro / Solo_Bridge → R2 Broken（分解和弦，叙事铺垫）
    //   - 其他段落 → R3 Stab 兜底
    //
    // 协作模式：
    //   - bassActive=true  → M7 (ShellVoicing LH 弹 3+7 guide tone shell + RH 织体)
    //     A3a：原 M4_TacitWithComping 让钢琴左手整段静音不符合常理；改为 M7 让 LH 弹壳和弦
    //     bass 已锚定 root → LH 让出 root 区间，改弹 [E3, F4] guide tone shell。
    //     RH 通过 lhPcSet "listen" 协同避撞音。
    //   - bassActive=false (Solo Piano)：
    //     · groove section (Verse/PreChorus/Chorus/Drop/BuildUp) → M1 + L4 Walking Tenths
    //     · lush section   (Bridge/Intro/Outro/PreOutro/Solo_Bridge) → M5 Two-Handed Voicing（E.2 接入）
    //                                                                  V2 阶段未接入时回退 M1 + L1 Sustained
    private static pickPianoAccompParams(
        section: SectionMetadata,
        musician: Musician,
        bassActive: boolean,
        intensityScale: number,
        ctx: PlanContext,
    ): PianoAccompParams {
        const isGrooveSection = CastingEngine.isGrooveSection(section.sectionType);

        // Sub-Phase 3:MoodRouter 决策织体配方。
        //   1. pickMood(context) → MoodId(8 桶情绪)
        //   2. moodToRecipe(mood, styleId) → TextureRecipeId
        //   3. recipe.rhTexture → params.rhTexture(推荐渲染风格)
        //   4. mood 同时塞进 params → PianoAccompIdiom 取 mood-specific phrase chain
        const mood: MoodId = pickMood({
            styleId: ctx.styleId,
            tonality: ctx.tonality,
            bpm: ctx.bpm,
            sectionType: section.sectionType,
            energyLevel: section.energyLevel,
            persona: musician.persona,
        });
        // Phase 3 — anchor 锁定 STYLE_ANCHOR_RECIPE,非 anchor 走 mood 路由
        const isAnchor = musician.persona.isAnchor === true;
        const recipeId: TextureRecipeId = isAnchor
            ? STYLE_ANCHOR_RECIPE[ctx.styleId]
            : moodToRecipe(mood, ctx.styleId);
        const rhTexture: RHTexture = getPianoTextureRecipe(recipeId).rhTexture;

        // V4.1 Bounce 偏好检查（持票优先级最高，仅 Solo Piano 模式可用）
        const bouncePreference = musician.persona.bouncePreference ?? 0;

        let coordMode: CoordMode;
        let lhTexture: LHTexture;
        let walkPatternId: WalkPatternId | undefined;
        if (bassActive) {
            // A3a：bass 在编 → LH 不再 Tacit 整段静音，改弹 guide tone shell
            coordMode = CoordMode.M7_ShellWithComping;
            lhTexture = LHTexture.ShellVoicing;
        } else {
            // Solo Piano 模式：
            //   bouncePreference > 0.5 + groove → M6 Bounce（覆盖 Walking）
            //   groove section → M1 + L4 Walking Tenths (爵士 solo piano 标志)
            //   lush section   → M5 Two-Handed Voicing (Bill Evans 风 spread chord)
            if (isGrooveSection && bouncePreference > 0.5) {
                coordMode = CoordMode.M6_OomPahBounce;
                lhTexture = LHTexture.Tacit;  // M6 自己处理 LH
            } else if (isGrooveSection) {
                coordMode = CoordMode.M1_SustainedRoot;
                lhTexture = LHTexture.WalkingTenths;
                // 改动 B：按 mood × style 路由 walk pattern，让不同情绪的 walking 听感差异化
                walkPatternId = pickWalkPattern(mood, ctx.styleId);
            } else {
                coordMode = CoordMode.M5_TwoHandedVoicing;
                lhTexture = LHTexture.Tacit;  // M5 自己处理 LH
            }
        }

        // V3.3 Persona DNA mapping — 真正消费 sparsity/sync/colorBias，不再是数据壁纸
        //   voicingSpan      ← colorBias × (0.5 + intensity)（高色彩 + 高能量 → Drop-2 开放）
        //   anticipationProb ← syncopationAssault × (0.5 + intensity)（高 sync + 高能量 → 多 push）
        //   sparsity         ← sparsityTendency × intensity（高 sparsity + 高能量 → 删击点）
        //                       注：低能量段不删（已经稀薄了），靠 intensity 缓冲
        const persona = musician.persona;
        const voicingSpan = clamp01(persona.colorBias * (0.5 + intensityScale));
        const anticipationProb = clamp01(persona.syncopationAssault * (0.5 + intensityScale));
        const sparsity = clamp01(persona.sparsityTendency * intensityScale);
        // 改动 H — Intro / Outro / PreOutro 强制关 Signature Lick:
        //   原 lick 触发 hash 在 chord index 0 处恒命中,且 lick 选择 hash 在 chordIndex=0 恒返回 lick 0
        //   (Bebop II-V-I Run),导致每首歌开头都被一段从 8 分反拍起步的同形上行琶音替换。
        //   漂浮段不该被 bebop run 切断;真正需要 lick 的段落(Verse/Chorus)在下面照常允许。
        const allowLick = section.sectionType !== SectionType.Intro
            && section.sectionType !== SectionType.Outro
            && section.sectionType !== SectionType.PreOutro;
        const signatureLickProb = allowLick && persona.signatureLickProb !== undefined
            ? clamp01(persona.signatureLickProb)
            : 0;

        // V3.8 Solver 触发：高 syncopationAssault (>0.5) 切换到物理约束求解器
        const useSolver = persona.syncopationAssault > 0.5;

        // V5.2 Swing — 从 styleConfig 透传(CastingEngine 不感知 swingRatio 含义,只搬运)
        const swingRatio = ctx.swingRatio;

        // Phase 8a — 钢琴阻尼器踏板系数(从 persona 透传到 PianoAccompIdiom 后处理)
        // 缺省 1.0(自然踏板);persona 显式设 0 = 完全干(staccato 风格)
        const pianoPedalRatio = persona.pianoPedalRatio !== undefined
            ? persona.pianoPedalRatio : 1.0;

        return {
            lhTexture,
            rhTexture,
            coordMode,
            velocityRange: persona.dynamicRange,
            intensityScale,
            voicingSpan,
            anticipationProb,
            sparsity,
            signatureLickProb,
            useSolver,
            swingRatio,
            recipeId,
            mood,
            walkPatternId,
            pianoPedalRatio,
        };
    }

    /** sectionType → groove vs lush 二分类（驱动 Solo Piano 的 Walking vs Spread 选择） */
    private static isGrooveSection(sectionType: SectionType | undefined): boolean {
        switch (sectionType) {
            case SectionType.Verse:
            case SectionType.PreChorus:
            case SectionType.Chorus:
            case SectionType.Drop:
            case SectionType.BuildUp:
                return true;
            default:
                return false;
        }
    }

    // ================================================================
    // 工具
    // ================================================================

    /** energyLevel (整数 1~10) → intensityScale (浮点 0.1~1.0)，clamp 兜底 */
    private static normalizeEnergy(energyLevel: number): number {
        if (!Number.isFinite(energyLevel)) return INTENSITY_MIN;
        const raw = energyLevel / ENERGY_MAX;
        if (raw < INTENSITY_MIN + EPSILON) return INTENSITY_MIN;
        if (raw > INTENSITY_MAX - EPSILON) return INTENSITY_MAX;
        return raw;
    }
}

// ============================================================
// 工具
// ============================================================

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// ============================================================
// Error
// ============================================================

export class CastingEngineError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'CastingEngineError';
        this.context = context;
    }
}
