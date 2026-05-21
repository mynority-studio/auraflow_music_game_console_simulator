/**
 * Conductor — 总装协调器(Phase 6 由 Stage5Layering 重命名而来)
 *
 * 改名理由(Phase 6):
 *   - 旧名 Stage5Layering 仅描述管线位置(第 5 阶段),不描述实际职责。
 *   - 实际职责是"总装" —— 调度所有 InstrumentRealizer + Lead 渲染,合并 4 轨。
 *     这正是音乐工程里的 Conductor(指挥/总装)。
 *   - 注意:本模块与下游 AbsoluteTransposer.ts(仅做 RELATIVE→ABSOLUTE)职责互不重叠;
 *     Phase 7 计划把 AbsoluteTransposer 的转置函数下沉为 Conductor 的最后一步,
 *     彻底消除 "AbsoluteTransposer 不是 orchestrator" 的命名误导。当前阶段两者并存。
 *
 * 职责:消费 Stage 1~3 的输出(chords + voicings + sections + styleId),
 * 按 ConductorMask 决定每段哪些角色发声,输出 4 轨 NoteData[]:
 *
 *   melody         — Lead 主旋律(FractalStructureEngine + PCFGGrammarEngine 驱动)
 *   accompaniment  — Comping 伴奏(RhythmMutator + TextureMapper 驱动,PianoRealizer)
 *   bass           — 低音锚定(BassRealizer)
 *   drums          — 打击乐(DrumRealizer,16-step grid 驱动)
 *
 * 关键设计决策(与 .claude/rules/music_generation_pipeline_rule.md 对齐):
 *
 *   1. Pitch Space 三空间(K-1 / K-2 / K-7 / K-8):
 *      - melody / accompaniment / bass: RELATIVE — 由 AbsoluteTransposer.applyOffset 转 ABSOLUTE
 *      - drums:                          GM Drum Map (K-8 第三空间) — 全程透传不加 keyOffset
 *
 *   2. 确定性(D-1 / D-5):
 *      遍历顺序:sections ASC → role [Bass, AccompInst, Drums, Lead] → chordIdx ASC。
 *      Bass 零 PRNG 消耗;DrumIdiom 按 step 升序遍历,每 step 固定 3 次 gate PRNG。
 *
 *   3. AccompInst 掐头(混音物理约束):
 *      Comping 用 chord.voicing.slice(1),把 voicing[0](bass voice)让给 Bass 轨,
 *      避免低频堆叠(CLAUDE.md "Bass E1-B2 / PianoRH ≥ C3")。
 *
 *   4. **配置剥离**(Phase 5 早期已落地):
 *      Personas / Fractal / Grammar / Drum Grid 全部下沉到 config/styles/*.ts 的
 *      StyleStage5Bundle。本文件零硬编码风格参数,仅保留:
 *        - Pitch Space 锚(BASS_ANCHOR / ACCOMP_MIN / LEAD_ANCHOR)— 跨风格物理常量
 *        - ConductorMask(段落类型 → 角色启停)— 与风格无关的音乐物理
 *
 *   5. 错误处理(S-7):非法输入抛 ConductorError,runPipeline 入口统一 catch。
 */

import {
    GeneratedChord, MusicianPersona, NoteData,
    SectionMetadata, SectionType, Tonality,
    CHORD_SCALE_INTERVALS, SCALE_INTERVALS, // 🌟 新增
    BandPlan, BandRole, AtmosphereConfig, InstrumentFamily,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleStage5Bundle } from '../config/styles';
import {
    FractalStructureEngine, FractalBlock, FractalConfig,
} from '../primitives/FractalStructureEngine';
import {
    PCFGGrammarEngine, GrammarConfig,
} from '../primitives/PCFGGrammarEngine';
import { MasterPhraseRenderer } from '../primitives/MasterPhraseRenderer';
import { PhraseContourPlanner } from '../primitives/PhraseContourPlanner';
import { getMasterManifest } from '../data/MasterPersonas';
import { DrumRealizer } from '../realizers/DrumRealizer';
import { BassRealizer } from '../realizers/BassRealizer';
import { AtmosphereRealizer } from '../realizers/AtmosphereRealizer';
import { Reconciler, ReconcilerReport } from './Reconciler';
import type { PianoAccompConfig, PianoAccompModulation } from '../primitives/PianoAccompIdiom';
import { PianoRealizer } from '../realizers/PianoRealizer';
import { ToplineEngine } from './ToplineEngine';
import { TopologyMutator } from '../primitives/TopologyMutator';
import { SongHookEncoder, SongHookSkeleton } from '../primitives/SongHookEncoder';
import { PRNGManager } from '../../utils/PRNG';
import { RenderContext } from '../ir/RenderContext';
import { CurveWeatherSampler } from './CurveWeatherSampler';
import { attachVoicingMasks } from '../primitives/VoicingMask';
import { attachDensityPlan, attachSuppressionPlan } from './TextureContinuum';
import { attachDropStates, collectDropWindows, filterNotesByDropWindows } from './MarkovStateMachine';
import { attachWakeStates, deriveSongHash } from './WakeStateMachine';
import { humanizeTrack } from './GrooveHumanizer';
import { findPlateauRegions, pickSoloist, generateSoloNotes } from './ImprovisationStrategy';

const EPSILON = 1e-6;
const FRACTAL_ITERATIONS = 3;

// Pitch Space anchors — melody/accomp/bass 全 RELATIVE
// Phase 6 The Walker: BASS_ANCHOR 下移到 C1 (24)，配合 BassIdiom 单八度运行
// 与 MidiConverter MIX_BASS (volume 115 / reverb 0) 共同实现"沉到底层 + 干净 attack"。
const LEAD_ANCHOR_PITCH = 72;   // C5 — 主旋律高音区
const LEAD_RANGE_LO = 60;       // C4 — ToplineEngine 主旋律下界
const LEAD_RANGE_HI = 84;       // C6 — ToplineEngine 主旋律上界

// ============================================================
// Role 枚举（本地）— 与 BandRole 字符串无关，避免 T-1 字符串分类
// 索引必须与 config/styles/index.ts StyleStage5Bundle.personas 对齐
// ============================================================
const ROLE_BASS = 0;
const ROLE_ACCOMP = 1;
const ROLE_LEAD = 2;
const ROLE_DRUMS = 3;
const ROLE_ATMOSPHERE = 4;
const ROLE_COUNT = 5;

const MASK_BASS = 1 << ROLE_BASS;
const MASK_ACCOMP = 1 << ROLE_ACCOMP;
const MASK_LEAD = 1 << ROLE_LEAD;
const MASK_DRUMS = 1 << ROLE_DRUMS;
const MASK_ATMOSPHERE = 1 << ROLE_ATMOSPHERE;
const MASK_ALL = MASK_BASS | MASK_ACCOMP | MASK_LEAD | MASK_DRUMS | MASK_ATMOSPHERE;

// ============================================================
// Conductor Mask — sectionType → bit 掩码（与风格无关，音乐物理）
// ============================================================
//
// 设计：
//   - Intro / Outro / PreOutro: Bass + Accomp + Atmosphere（**不出鼓** — 渐入/淡出 + pad 铺底）
//   - Verse/PreChorus/Chorus/Bridge/Drop/Solo_Bridge: ALL（全开）
//   - BuildUp: Bass + Accomp + Drums + Atmosphere（积累张力，旋律未进，pad 增加 lift）
//   - Break / Breakdown: Bass + Drums（"Rhythm Section Breakdown" — 清空中高频，pad 也清空）
//
// 未列出的 sectionType 走 MASK_ALL 兜底。
// ============================================================

const CONDUCTOR_MASK_BY_SECTION_TYPE: number[] = (() => {
    const m: number[] = new Array(12);
    m[SectionType.Intro]       = MASK_BASS | MASK_ACCOMP | MASK_ATMOSPHERE;
    m[SectionType.Verse]       = MASK_ALL;
    m[SectionType.PreChorus]   = MASK_ALL;
    m[SectionType.Chorus]      = MASK_ALL;
    m[SectionType.Bridge]      = MASK_ALL;
    m[SectionType.Outro]       = MASK_BASS | MASK_ACCOMP | MASK_ATMOSPHERE;
    m[SectionType.Break]       = MASK_BASS | MASK_DRUMS;
    m[SectionType.Breakdown]   = MASK_BASS | MASK_DRUMS;
    m[SectionType.BuildUp]     = MASK_BASS | MASK_ACCOMP | MASK_DRUMS | MASK_ATMOSPHERE;
    m[SectionType.Drop]        = MASK_ALL;
    m[SectionType.PreOutro]    = MASK_BASS | MASK_ACCOMP | MASK_ATMOSPHERE;
    m[SectionType.Solo_Bridge] = MASK_ALL;
    return m;
})();

function getConductorMask(sectionType: SectionType | undefined): number {
    if (sectionType === undefined) return MASK_ALL;
    const m = CONDUCTOR_MASK_BY_SECTION_TYPE[sectionType];
    return m === undefined ? MASK_ALL : m;
}

function getPersona(personas: MusicianPersona[], role: number): MusicianPersona {
    const p = personas[role];
    if (p === undefined) {
        throw new ConductorError(
            'no Persona at role index',
            { role, personasLength: personas.length },
        );
    }
    return p;
}

// ============================================================
// 公开 API
// ============================================================

export interface ConductorInput {
    chords: GeneratedChord[];     // 已带 voicing（HarmonyCore 输出）
    sections: SectionMetadata[];
    styleId: StyleId;
    /** 调式 — 由 Stage 2 决定，ToplineEngine 用于色彩音/调内邻音判定（Phase 6 新增） */
    tonality: Tonality;
    /** 拍号 — 决定 RhythmMutator / TextureMapper 的 stepsPerBar */
    timeSignature: [number, number];
    /** Phase 2: 用户动机（RELATIVE pitch space），用于 Lead 的片段拼接（Direct Splice） */
    userMotif?: NoteData[];
    /**
     * BandEngine 输出（Phase 1 BandEngine MVP 新增）。
     * V1：仅用于决定 atmosphere 轨是否输出（roster.atmosphere 存在则上线）；
     *      其他角色仍走 getStyleStage5Bundle 的 personas（fallback 路径，行为兼容）。
     * V2+：personas 从 BandPlan.activeMusicians[].card.persona 取，逐步替换 styleId.personas。
     */
    bandPlan?: BandPlan;
}

export interface ConductorResult {
    melody: NoteData[];
    accompaniment: NoteData[];
    bass: NoteData[];
    /** Pitch Space: GM Drum Map (K-8 第三空间) — 不参与 AbsoluteTransposer.applyOffset */
    drums: NoteData[];
    /** Pitch Space: RELATIVE — Pad/Strings 长音铺底。V1 渲染器未实装时为空数组 */
    atmosphere: NoteData[];
    /** Phase 5:Reconciler 输出。v1 弱版本仅产 same-pitch collision damp + LIL 检测。
     *  上游可选消费 unresolvedIssues 做诊断。详见 Reconciler.ts 升级路径注释。 */
    reconcilerReport?: ReconcilerReport;
}

/**
 * Pitch Space:
 *   - melody / accompaniment / bass: RELATIVE
 *   - drums: GM Drum Map (ABSOLUTE 物理键位) — K-8 第三空间
 *
 * PRNG 消耗（按 role 拆分）：
 *   - Bass: 0
 *   - AccompInst: 每和弦 ≈ totalSteps - 1 (Phase A) + ≤ 40 (Phase B) + ≤ 2 × hits (Random contour)
 *   - Drums: 每段 ≈ 3 × totalSteps（无条件 gate PRNG）+ Σ hits（条件 velocity PRNG）
 *   - Lead: 每段 ≈ Fractal(树深度 × 3) + PCFG(每非终止符 1)
 *
 * 调用方应在调用前 recordSnapshot('D')，本函数不主动记 snapshot 以保接口纯净。
 */
export function conduct(input: ConductorInput): ConductorResult {
    validateInput(input);

    const melody: NoteData[] = [];
    const accompaniment: NoteData[] = [];
    const bass: NoteData[] = [];
    const atmosphere: NoteData[] = [];

    const bundle = getStyleStage5Bundle(input.styleId);

    // Atmosphere 乐手查找（V1：从 BandPlan.activeMusicians 取，整曲不变）
    //   - bandPlan === undefined → 跳过 atmosphere 渲染（向后兼容）
    //   - roster 未配 atmosphere → activeMusicians 不含 Atmosphere 角色 → 跳过
    //   - 找到则提取 personnel.atmosphereOverrides 作为 AtmosphereConfig 参数
    const atmosphereMusician = input.bandPlan?.activeMusicians.find(
        am => am.assignedRole === BandRole.Atmosphere,
    )?.card;
    const atmosphereIdiom: Partial<AtmosphereConfig> | undefined =
        atmosphereMusician?.personnel?.atmosphereOverrides;

    // MainInst 乐手查找 — 大师托管路径：若 roster.mainInst 提供了带 masterId 的 persona，
    // 整曲 Lead 改走该 persona（覆盖 bundle.personas[ROLE_LEAD]）。
    // 未配 MainInst → leadPersona 保持 bundle 默认（向后兼容，行为不变）。
    const mainInstMusician = input.bandPlan?.activeMusicians.find(
        am => am.assignedRole === BandRole.MainInst,
    )?.card;
    const leadPersona: MusicianPersona = mainInstMusician?.persona
        ?? getPersona(bundle.personas, ROLE_LEAD);
    // Pass 3 sustain 策略分派：MainInst 卡的族裔决定走 piano pedal 还是 monophonic legato。
    // 未配 MainInst → fallback 到 Piano（与 MVP 现状一致：所有 style 默认 lead persona 都是钢琴）。
    const leadInstrumentFamily: InstrumentFamily = mainInstMusician?.instrumentFamily
        ?? InstrumentFamily.Piano;

    // A1 / C2：Bass persona 路由 — roster.bass.persona 优先。
    //   C2：bassMusician 不存在（用户显式 ⊘ Empty / forcedBand.bass=null / bandPlan 缺失）
    //         → bassActive=false → 整曲 bass 轨不渲染（音轨为空）。
    //   旧的 bundle.personas[ROLE_BASS] 兜底已删 — V5.x 以前的"风格自带 bass 声部"行为不再支持。
    const bassMusician = input.bandPlan?.activeMusicians.find(
        am => am.assignedRole === BandRole.Bass,
    )?.card;
    const bassActive = bassMusician !== undefined;
    const bassPersona: MusicianPersona | undefined = bassMusician?.persona;

    // Drums 角色路由（C2 新增）— 与 Bass 同思路：
    //   drumsMusician 不存在 → 整曲 drums 轨不渲染。
    //   drumsMusician.persona.dynamicRange 暂未被 DrumIdiom 消费（DrumIdiom 走 grid + energyScale）；
    //   保留 musician 查找只为"是否上岗"判定。
    const drumsMusician = input.bandPlan?.activeMusicians.find(
        am => am.assignedRole === BandRole.Drums,
    )?.card;
    const drumsActive = drumsMusician !== undefined;

    // ────────────────────────────────────────────────────────────
    // Phase 9 — 严格 roster gate(完全以 BandEngine 传入的编制为准)
    //
    // 设计意图:roster 是音乐生成的唯一权威。某角色不在 roster → 对应轨道完全空。
    //   不再有"无 mainInst 用 bundle.personas[ROLE_LEAD] 兜底" / "Accomp 缺失
    //   走 renderAccompaniment fallback"等隐式 fallback —— 这些 fallback 让
    //   用户无法精准隔离单乐器问题(如"只听贝斯走得对不对" / "钢琴只做伴奏
    //   不要 topline")。
    //
    // rosterMask 在每段 mask 检查时 AND 进去,效果:
    //   - 默认 roster(5 槽位填满)→ rosterMask 全 bit set → 行为不变(bit-exact)
    //   - forcedBand 传 null → 对应 bit 清零 → 该角色全曲静音
    //   - 极端案例 forcedBand 全 null → 整曲静音(此时调用方应给个空响应)
    // ────────────────────────────────────────────────────────────
    let rosterMask = 0;
    const activeMusicians = input.bandPlan?.activeMusicians ?? [];
    for (let i = 0; i < activeMusicians.length; i++) {
        switch (activeMusicians[i].assignedRole) {
            case BandRole.MainInst:   rosterMask |= MASK_LEAD;       break;
            case BandRole.Bass:       rosterMask |= MASK_BASS;       break;
            case BandRole.Accomp:     rosterMask |= MASK_ACCOMP;     break;
            case BandRole.Drums:      rosterMask |= MASK_DRUMS;      break;
            case BandRole.Atmosphere: rosterMask |= MASK_ATMOSPHERE; break;
        }
    }

    // ────────────────────────────────────────────────────────────
    // Phase 2 — RenderContext 构造(5 维 CurveWeatherSampler 实装)
    //
    // 当前实装:CurveWeatherSampler(per-section anchor + 80/20 段间插值,5 维齐全)。
    // anchor = sectionType + styleId + activeMusicians.persona 加权和(零 PRNG)。
    //
    // 演进时间线(承前 Phase 0 接口锁定 / Phase 1b mask 实装):
    //   Phase 3:  hash-based wobble + Idiom 算法层全面消费 K/T/S/R/G
    //   Phase 5+: Live 模式 LiveAccompanist 构造 RollingWeatherSampler,本逻辑保留作离线路径
    // ────────────────────────────────────────────────────────────
    // 复用上方 rosterMask 构造时已取的 activeMusicians 局部变量
    const renderContext: RenderContext = {
        weather: new CurveWeatherSampler(input.sections, input.styleId, activeMusicians),
        lookaheadLimit: 9999,
        prevState: undefined,
    };

    // ────────────────────────────────────────────────────────────
    // Phase 1b — 按 sectionType + energyLevel 给每和弦附加 voicingMask
    //
    // mask 是"建议",不在此处过滤 chord.voicing/voicingTagged(保 unmasked 作 fallback 源)。
    // 各 Idiom 渲染时自行 applyVoicingMask + fallback:
    //   - AtmosphereRenderer:voiceCount ≥ 2 保底
    //   - PianoAccompIdiom tertian / rootless:Root 永驻,filtered 空时降级
    //   - Bass / Drum:不消费 mask
    // ────────────────────────────────────────────────────────────
    attachVoicingMasks(input.chords, input.sections, renderContext.weather);

    // ────────────────────────────────────────────────────────────
    // Phase 3 — Texture Morphing:给 bandPlan 注入每段每 role 的 densityLevel
    //
    // 算法:weather.k → 7 级 density 量化 + 跨段 ±1 平滑滑动 / R 驱动 staged 跳跃。
    // anchor 乐手(alex_piano / nina_pad)的 recipe 已在 CastingEngine.pickPianoAccompParams
    // 锁定到 STYLE_ANCHOR_RECIPE,本步骤只补 density(令 anchor 跨段 density 浮动)。
    //
    // 副作用:assignment.densityLevel 与 assignment.instrumentSpecificParams.densityLevel
    // 双写,Idiom 通过任一路径都可读到。
    // ────────────────────────────────────────────────────────────
    if (input.bandPlan !== undefined) {
        attachDensityPlan(
            input.bandPlan, input.sections, renderContext.weather, activeMusicians,
        );
        // Phase 4 — Apex Predator Suppression:apex 乐手在 K > 0.80 段触发,
        // 给 Accomp / Atmosphere assignment 写 apexActive + suppressionFactor
        attachSuppressionPlan(
            input.bandPlan, input.sections, renderContext.weather, activeMusicians,
        );
        // Phase 5 — Markov Drop State:BuildUp → Chorus 边界按概率激活 Drop,
        // BuildUp 末 4 拍 Bass + Drums 静默(Vacuum Blossom 真空绽放)
        attachDropStates(
            input.bandPlan, input.sections, renderContext.weather, activeMusicians,
        );
        // Phase 6a — Wake State:K < musician.wakeK 整段 sleeping;
        //   per-song hash mutation ±0.15 偏移 musician 阈值,防"听 10 次发现规律"
        //   songHash 由 styleId + tonality + sections + chords 派生(deterministic)
        const songHash = deriveSongHash(
            (input.styleId << 16) ^ (input.tonality << 8) ^
            (input.sections.length << 4) ^ input.chords.length,
        );
        attachWakeStates(
            input.bandPlan, input.sections, renderContext.weather,
            activeMusicians, songHash,
        );
    }

    // Phase 5 — 提前收集 Drop 窗口供 Bass / Drum 渲染后过滤
    const dropWindows = input.bandPlan !== undefined
        ? collectDropWindows(input.bandPlan, input.sections)
        : [];

    // Drums 按段落过滤后整体交给 DrumIdiom（PRNG 消耗在 sections 升序遍历内完成）
    //   C2：drumsActive=false 时直接产空轨，跳过 DrumIdiom（也跳过 PRNG 消耗 → D-5 不锁帧）
    //   Phase 9:drumsActive 与 rosterMask 等价,保留 drumsActive 是因 collectDrumSections
    //   还消费它做段落级 mask 检查,不需要重构 collectDrumSections 接口。
    //   Phase 6a:WakeStateMachine 标 sleeping 的段落从 drumSections 排除
    //   注意:DrumIdiom 内部按 sections 升序遍历消耗 PRNG;sleeping 段落整段不在
    //   sections 内,意味着该段不消耗 drum PRNG → 改动后 D-5 仍恒(因为 sleeping
    //   判定 deterministic from songHash + weather,且对所有 seed 一致)。
    let drumSections = drumsActive ? collectDrumSections(input.sections) : [];
    if (input.bandPlan !== undefined) {
        drumSections = drumSections.filter(s => {
            const sIdx = input.sections.indexOf(s);
            return !(input.bandPlan!.sectionPlans[sIdx]?.assignments[BandRole.Drums]?.sleeping === true);
        });
    }
    const drums: NoteData[] = drumSections.length > 0
        ? DrumRealizer.realize({ sections: drumSections, grid: bundle.drum, context: renderContext })
        : [];
    // Phase 5 — Drop 窗口内 drum notes 剔除(渲染后过滤,不破 D-5 PRNG 配额)
    filterNotesByDropWindows(drums, dropWindows);

    // Kick-Bass interlock: 提取所有 Kick (pitch===36) 落点，供 BassIdiom 对齐
    const kickAnchors: number[] = [];
    for (let d = 0; d < drums.length; d++) {
        if (drums[d].pitch === 36) kickAnchors.push(drums[d].onset);
    }

    // ----------------------------------------------------------------
    // Phase 7.1 — Song Hook 缓存（跨 Chorus section 保持同一句副歌主题）
    //
    // 首次 Chorus：渲染完后扫该段 lead notes 的 motifName 覆盖区间，整拍对齐 + clamp，
    //              encode 为度级骨架存入 songHook（不存绝对 pitch — 不同 Chorus 和弦可能不同）。
    // 后续 Chorus：照常完整渲染（保 D-5 PRNG 对齐），然后用骨架按当前段和弦序列 project
    //              得到新 NoteData[]，splice 进 melody 覆盖前 hook.totalBeats 区间。
    //
    // 零 PRNG 消耗 — 骨架编码/投影都是查表 + 算术，不动 PRNGManager，黄金种子序列不变。
    // ----------------------------------------------------------------
    let songHook: SongHookSkeleton | null = null;

    for (let sIdx = 0; sIdx < input.sections.length; sIdx++) {
        const section = input.sections[sIdx];
        // Phase 9 — 双重 mask:段落允许 AND roster 在编
        const mask = getConductorMask(section.sectionType) & rosterMask;

        const sectionChords = collectChordsInSection(input.chords, section);
        if (sectionChords.length === 0) continue;

        // 固定顺序：Bass → Accomp → Drums → Lead
        //   Drums 由 DrumIdiom 整体处理（已在循环外完成），此处仅 Bass/Accomp/Lead 三轨
        //   Bass 必须先于 Accomp/Lead — Phase 6 后 BassIdiom 在 Jazz/NeoSoul 消耗 PRNG，
        //   PRNG 顺序锁定为 Bass → Accomp → Lead（D-5）
        // Phase 6a — sleeping=true 的段落 skip 整 role realize 调用
        const bassAssign = input.bandPlan?.sectionPlans[sIdx]?.assignments[BandRole.Bass];
        const bassSleeping = bassAssign?.sleeping === true;
        if ((mask & MASK_BASS) !== 0 && bassActive && bassPersona !== undefined && !bassSleeping) {
            // C2：仅当 roster.bass 上岗时渲染；留空 → bass 轨纯空
            const bassNotes = BassRealizer.realize({
                chords: sectionChords,
                styleId: input.styleId,
                tonality: input.tonality,
                persona: bassPersona,
                kickAnchors,
                context: renderContext,
            });
            // Phase 5 — Drop 窗口内 bass notes 剔除(per-section bass 渲染后立即过滤)
            filterNotesByDropWindows(bassNotes, dropWindows);
            for (let k = 0; k < bassNotes.length; k++) bass.push(bassNotes[k]);
        }
        if ((mask & MASK_ACCOMP) !== 0) {
            // Phase 9 — 严格 roster gate 之后:走到这里时 Accomp 一定在 activeMusicians 内,
            //   CastingEngine 必然填了 pianoParams。原 fallback 到 renderAccompaniment 的
            //   else 分支(bundle.personas[ROLE_ACCOMP] 兜底)已删除 —— 严格 roster 语义。
            const accompAssign = input.bandPlan?.sectionPlans[sIdx]?.assignments[BandRole.Accomp];
            // Phase 7e — instrumentSpecificParams 现在是 { config, modulation } 嵌套
            const pianoData = accompAssign?.instrumentSpecificParams as
                { config: PianoAccompConfig; modulation: PianoAccompModulation } | undefined;
            // Phase 6a — sleeping=true skip Accomp realize
            const accompSleeping = accompAssign?.sleeping === true;
            if (pianoData !== undefined && !accompSleeping) {
                const pianoNotes = PianoRealizer.realize({
                    chords: sectionChords,
                    config: pianoData.config,
                    modulation: pianoData.modulation,
                    beatsPerBar: input.timeSignature[0],
                    context: renderContext,
                });
                for (let k = 0; k < pianoNotes.length; k++) accompaniment.push(pianoNotes[k]);
            }
            // pianoParams === undefined 时:CastingEngine 未填 params(意味着 Accomp 在
            // roster 但非钢琴乐器,例如未来的 guitar Accomp)。当前 MVP 不支持非钢琴
            // Accomp,直接静音处理 —— Phase 8+ 接入新乐器时,此处需扩展 dispatch。
        }
        if ((mask & MASK_LEAD) !== 0) {
            const leadStartIdx = melody.length;
            renderLead(
                melody, section, sectionChords,
                leadPersona, leadInstrumentFamily,
                bundle.fractal, bundle.grammar,
                input.tonality, bundle.approachDownProb,
                input.userMotif,
            );

            // Phase 7.1 — Chorus hook 编码/投影分支
            if (section.sectionType === SectionType.Chorus) {
                if (songHook === null) {
                    // 首次 Chorus：扫本段 lead notes 找 motif 区间 → encode
                    const sectionLead: NoteData[] = [];
                    for (let r = leadStartIdx; r < melody.length; r++) sectionLead.push(melody[r]);
                    const span = SongHookEncoder.computeHookSpan(
                        sectionLead, section.startBeat, section.endBeat,
                    );
                    if (span !== null) {
                        songHook = SongHookEncoder.encode(
                            sectionLead, sectionChords,
                            span.startBeat, span.endBeat,
                            LEAD_ANCHOR_PITCH,
                        );
                    }
                } else if (songHook.notes.length > 0) {
                    // 后续 Chorus：project 骨架 + splice 覆盖前 hook.totalBeats 区间
                    const projected = SongHookEncoder.project(
                        songHook, sectionChords, section.startBeat,
                        LEAD_ANCHOR_PITCH, LEAD_RANGE_LO, LEAD_RANGE_HI,
                    );
                    const hookEndBeat = section.startBeat + songHook.totalBeats;
                    // 原地删除 melody[leadStartIdx..] 中 onset ∈ [section.startBeat, hookEndBeat) 的 notes
                    let writeIdx = leadStartIdx;
                    for (let r = leadStartIdx; r < melody.length; r++) {
                        const n = melody[r];
                        if (n.onset >= section.startBeat - EPSILON
                            && n.onset < hookEndBeat - EPSILON) {
                            continue;  // 被 hook 覆盖
                        }
                        if (writeIdx !== r) melody[writeIdx] = n;
                        writeIdx++;
                    }
                    melody.length = writeIdx;
                    // append 投影出的 hook notes（最终全局 sortNotesInPlace 会按 onset 排好）
                    for (let p = 0; p < projected.length; p++) melody.push(projected[p]);
                }
            }
        }
        // Atmosphere 在最后渲染 — 零 PRNG 消耗，顺序不影响其他声部
        if ((mask & MASK_ATMOSPHERE) !== 0 && atmosphereMusician !== undefined) {
            const sectionPlan = input.bandPlan?.sectionPlans[sIdx];
            const atmoAssign = sectionPlan?.assignments[BandRole.Atmosphere];
            // Phase 6a — sleeping=true skip Atmosphere realize
            if (atmoAssign?.sleeping === true) continue;
            const intensityScale = atmoAssign?.intensityScale ?? 0.5;
            const atmoNotes = AtmosphereRealizer.realize({
                chords: sectionChords,
                idiom: atmosphereIdiom,
                intensityScale,
                context: renderContext,
                // Phase 4 — apex ducking 从 RoleAssignment 透传
                apexActive: atmoAssign?.apexActive,
                suppressionFactor: atmoAssign?.suppressionFactor,
            });
            for (let k = 0; k < atmoNotes.length; k++) atmosphere.push(atmoNotes[k]);
        }
    }

    // D-3：全局排序 — onset ASC, pitch ASC
    sortNotesInPlace(melody);
    sortNotesInPlace(accompaniment);
    sortNotesInPlace(bass);
    sortNotesInPlace(atmosphere);
    // drums 已在 DrumIdiom 内部排序，无需再排

    // Phase 6b — Solo 引擎:plateau detection + Lead 替换
    //   1. 扫 weather 找 K plateau ≥ 8 拍 / Solo_Bridge 段
    //   2. 选 Soloist(MainInst → Accomp fallback)
    //   3. 每 region 生成 NCT-aware solo notes(Tension + Landing Gear)
    //   4. melody 在 region 内剔除原 lead notes,注入 solo notes
    //
    // 时机:Reconciler 之前 — 让 Reconciler 处理 solo 与其他声部撞音。
    if (activeMusicians.length > 0) {
        const soloRegions = findPlateauRegions(input.sections, renderContext.weather);
        const soloist = pickSoloist(activeMusicians);
        for (let i = 0; i < soloRegions.length; i++) {
            const region = soloRegions[i];
            // 取 region 内 chords
            const regionChords = input.chords.filter(
                c => c.endBeat > region.fromBeat && c.startBeat < region.toBeat,
            );
            if (regionChords.length === 0) continue;
            // prevPitch:region 起点之前最后一个 melody note
            let prevPitch: number | undefined;
            for (let m = melody.length - 1; m >= 0; m--) {
                if (melody[m].onset < region.fromBeat) { prevPitch = melody[m].pitch; break; }
            }
            const soloNotes = generateSoloNotes(
                region, regionChords, renderContext.weather, soloist, prevPitch,
            );
            // 剔除 region 内原 lead notes(in-place 过滤)
            let writeIdx = 0;
            for (let m = 0; m < melody.length; m++) {
                const n = melody[m];
                if (n.onset >= region.fromBeat && n.onset < region.toBeat) continue;
                if (writeIdx !== m) melody[writeIdx] = n;
                writeIdx++;
            }
            melody.length = writeIdx;
            // 注入 solo notes
            for (let s = 0; s < soloNotes.length; s++) melody.push(soloNotes[s]);
        }
        // 重排 melody(onset ASC)
        if (soloRegions.length > 0) {
            melody.sort((a, b) => {
                const d = a.onset - b.onset;
                if (Math.abs(d) > EPSILON) return d;
                return a.pitch - b.pitch;
            });
        }
    }

    // Phase 5:跨乐器后置协调(v2 含 LIL lift)
    //   - 同 (pitch, onset) 重复音 → velocity damp(就地修改 4 轨)
    //   - Low Interval Limit dyads → v2 上声部 octave lift
    //   - drums 不参与(GM Drum Map 第三空间)
    const reconcilerReport = Reconciler.reconcile({ melody, accompaniment, bass, atmosphere });

    // Phase 6a — G 维度末端 humanization:onset / velocity 微扰打破机械感
    //   每 track 给独立 trackSalt 避免相同 pitch+onset 走同样扰动
    //   Reconciler 之后执行 → 不破 v1 damp / v2 LIL lift
    humanizeTrack(melody, renderContext.weather, 0x4D454C44);       // 'MELD'
    humanizeTrack(accompaniment, renderContext.weather, 0x41434350); // 'ACCP'
    humanizeTrack(bass, renderContext.weather, 0x42415353);         // 'BASS'
    humanizeTrack(drums, renderContext.weather, 0x4452554D, true);  // 'DRUM' + isDrums
    humanizeTrack(atmosphere, renderContext.weather, 0x41544D4F);   // 'ATMO'

    return { melody, accompaniment, bass, drums, atmosphere, reconcilerReport };
}

// ============================================================
// Drums section 过滤
// ============================================================
//
// Conductor mask 决定哪些段落出鼓；过滤后整段交给 DrumIdiom。
// 注意：DrumIdiom 内部按 startBeat ASC 遍历段落，PRNG 消耗顺序锁定。
//
// **关键确定性约束**：drum sections 收集必须发生在 Bass/Accomp/Lead 渲染**之前**，
// 因为 DrumIdiom 在 conduct() 入口立即消耗 PRNG（全曲段落遍历）。
// 后续 Bass/Accomp/Lead 渲染按 sections 升序消耗 PRNG，与 Drums 解耦。

function collectDrumSections(sections: SectionMetadata[]): SectionMetadata[] {
    const out: SectionMetadata[] = [];
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const mask = getConductorMask(s.sectionType);
        if ((mask & MASK_DRUMS) !== 0) {
            out.push(s);
        }
    }
    return out;
}

// ============================================================
// AccompInst 渲染（RhythmMutator + TextureMapper）
// ============================================================
// Bass 渲染已下沉到 primitives/BassIdiom.ts（Phase 6 The Walker）

// Phase 9 — renderAccompaniment 函数已删除(原本作为 bundle.personas[ROLE_ACCOMP]
// fallback,Phase 9 严格 roster gate 后变 dead code,清理)。

// ============================================================
// Lead 渲染（FractalStructureEngine + PCFGGrammarEngine + ToplineEngine）
// ============================================================
//
// Pitch Space: RELATIVE — 全程不加 keyOffset。
//
// Phase 6 重构：
//   - PCFG 吐出抽象 TerminalSymbol（kind + duration，不含 pitch）
//   - ToplineEngine 跟随和弦 + 调式做 pitch 实例化（chord/color 0 PRNG；approach ×1 PRNG）
//   - LEAD_ANCHOR_PITCH 作为 cursor 初值传给 ToplineEngine（72 = C5，RELATIVE 空间）
//
// PRNG 消耗（每段，按 block ASC）：
//   - FractalStructureEngine: 树深度 × 3
//   - PCFG.expand: 每非终止符 ×1
//   - ToplineEngine.render: 每 approach ×1（block 内 approach 个数依赖 grammar 抽样结果）

function renderLead(
    out: NoteData[],
    section: SectionMetadata,
    chords: GeneratedChord[],
    persona: MusicianPersona,
    instrumentFamily: InstrumentFamily,
    fractalCfg: FractalConfig,
    grammar: GrammarConfig,
    tonality: Tonality,
    approachDownProb: number,
    userMotif?: NoteData[],
): void {
    const sectionDur = section.endBeat - section.startBeat;
    if (sectionDur < EPSILON) return;
    if (chords.length === 0) return;

    const blocks: FractalBlock[] = FractalStructureEngine.expand(
        sectionDur, fractalCfg, FRACTAL_ITERATIONS,
    );

    for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        if (block.isRest) continue;
        if (block.duration < EPSILON) continue;

        const blockOnset = section.startBeat + block.startBeat;

        // ----------------------------------------------------------------
        // Grammar 来源路由：Master Takeover vs Style PCFG
        // ----------------------------------------------------------------
        //   - persona.masterId 命中 flash manifest **且** masterMode = 'takeover'（或缺省）
        //     → MasterPhraseRenderer（整段大师 grammar）
        //   - persona.masterId 设置但 masterMode = 'lick-only'
        //     → 走 PCFG（风格 grammar 作底色），大师 lick 通过 lickPool 在 splice 阶段拼接
        //   - 否则走 style 层的 PCFGGrammarEngine.expand（默认路径）
        //
        // 两条路径输出契约同形（TerminalSymbol[]），下游 ToplineEngine 无感知差异。
        // PRNG 消耗形态不同：takeover 路径每 root ×1，PCFG 路径每非终止符 ×1 —— 但由于
        // 路径选择是 persona 的固有属性（generation 启动前已定），同一 seed 同一 persona
        // 总是走同一条路径，确定性（D-5）不受影响。
        let terminals;
        const useMasterTakeover =
            persona.masterId !== undefined
            && (persona.masterMode === undefined || persona.masterMode === 'takeover');
        const masterManifest = useMasterTakeover
            ? getMasterManifest(persona.masterId!)
            : undefined;
        if (masterManifest !== undefined) {
            terminals = MasterPhraseRenderer.renderPhrase(
                block.duration,
                masterManifest,
                () => PRNGManager.next(),
            );
        } else {
            terminals = PCFGGrammarEngine.expand(block.duration, grammar);
        }
        if (terminals.length === 0) continue;

        // Phase 6.4 — Phrase Contour Planner：按 section.contour / sectionType 注入弧线 hint
        //   零 PRNG 消耗，对下游 ToplineEngine 的 D-5 字节对齐透明。
        //   block.startBeat 已是 section 内偏移（block.duration 同上）。
        PhraseContourPlanner.shape(terminals, section, block.startBeat, block.duration);

        // Ghost Rendering: 无论是否拼接 Lick，都先真实跑一遍 ToplineEngine，强制消耗随机数
        const generatedNotes = ToplineEngine.render({
            terminals, chords, startBeat: blockOnset, tonality,
            velocityRange: persona.dynamicRange, pitchRange: [LEAD_RANGE_LO, LEAD_RANGE_HI],
            anchorPitch: LEAD_ANCHOR_PITCH, approachDownProb,
            instrumentFamily,
            pianoPedalRatio: persona.pianoPedalRatio,
            legatoOverlap: persona.legatoOverlap,
        });

        // 恒定消耗判断拼接的 PRNG（无视条件，坚决放在 if 外部）
        const spliceRoll = PRNGManager.next();
        const lickIdxRoll = PRNGManager.next();
        const topoRolls = [PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next()];
        let topoIdx = 0;

        const lickProb = persona.signatureLickProb ?? 0.0;
        const hasLicks = persona.lickPool && persona.lickPool.length > 0;
        const useUserMotif = userMotif !== undefined && userMotif.length > 0;

        let spliced = false;

        // 仅在能量较高，且概率命中，并且 duration >= 1 时进行乐句替换
        if (section.energyLevel >= 6 && block.duration >= 1.0 && ((useUserMotif && spliceRoll < 0.5) || (hasLicks && spliceRoll < lickProb))) {

            let rawLick: NoteData[];
            if (useUserMotif && spliceRoll < 0.5) {
                rawLick = userMotif!;
            } else {
                const lickIdx = Math.floor(lickIdxRoll * persona.lickPool!.length);
                rawLick = persona.lickPool![lickIdx];
            }

            const mutatedLick = TopologyMutator.applyTopologyChain(
                rawLick,
                persona.topologyConfig ?? { probInvert: 0, probReverse: 0, probExpand: 0, probSideSlip: 0, sideSlipRange: 0, colorBias: 0 },
                () => topoRolls[topoIdx++ % topoRolls.length],
                (min, max) => {
                    const r = topoRolls[topoIdx++ % topoRolls.length];
                    return Math.floor(r * (max - min + 1)) + min;
                }
            );

            // 缩放 Lick 时长以适应 block.duration
            let maxOnset = 0;
            for (let k = 0; k < mutatedLick.length; k++) {
                const end = mutatedLick[k].onset + mutatedLick[k].duration;
                if (end > maxOnset) maxOnset = end;
            }
            const scale = maxOnset > EPSILON ? block.duration / maxOnset : 1.0;

            let scaledLick = mutatedLick;
            if (Math.abs(scale - 1.0) > EPSILON) {
                scaledLick = TopologyMutator.expand(mutatedLick, scale);
            }

            // 找寻当前时间段和弦，用作 K-2 相对平移基准
            let targetChord = chords[0];
            for (let c = 0; c < chords.length; c++) {
                if (chords[c].startBeat <= blockOnset && chords[c].endBeat > blockOnset) {
                    targetChord = chords[c];
                    break;
                }
            }
            const rootPc = targetChord ? ((targetChord.root % 12) + 12) % 12 : 0;

            // 🌟 修复跑调3：提取目标和弦的局部特征音阶，用于智能吸附
            const localScaleMask = targetChord ? ToplineEngine.buildLocalScaleMask(targetChord) : 0xFFF;
            const scalePcs: number[] = [];
            for (let i = 0; i < 12; i++) {
                if ((localScaleMask & (1 << i)) !== 0) scalePcs.push(i);
            }

            // scaledLick 已经过 TopologyMutator.expand 按 scale 缩放，此处不可再乘 scale（避免双重缩放越界）
            for (let k = 0; k < scaledLick.length; k++) {
                const n = scaledLick[k];
                let rawP = n.pitch + rootPc;

                // 🌟 智能音阶吸附 (Snap to Scale)
                const pc = ((rawP % 12) + 12) % 12;
                const octave = Math.floor(rawP / 12);
                let bestDist = 99;
                let bestPc = pc;
                for (let i = 0; i < scalePcs.length; i++) {
                    const dist = Math.min(Math.abs(pc - scalePcs[i]), 12 - Math.abs(pc - scalePcs[i]));
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestPc = scalePcs[i];
                    } else if (dist === bestDist && scalePcs[i] < bestPc) {
                        bestPc = scalePcs[i]; // tie-breaker 偏好低音
                    }
                }

                let p = bestPc + octave * 12;
                if (Math.abs(p - rawP) > Math.abs(p + 12 - rawP)) p += 12;
                if (Math.abs(p - rawP) > Math.abs(p - 12 - rawP)) p -= 12;

                // 防御性钳位，确保落在合理音域
                while (p < LEAD_RANGE_LO) p += 12;
                while (p > LEAD_RANGE_HI) p -= 12;

                out.push({
                    pitch: p,
                    onset: blockOnset + n.onset,
                    duration: n.duration,
                    velocity: n.velocity,
                    isUserMotif: true,
                    motifName: 'MasterSplice'
                });
            }
            spliced = true;
        }

        if (!spliced) {
            // 如果不拼接，则装载 Ghost Rendering 跑出来的原生音符
            for (let k = 0; k < generatedNotes.length; k++) {
                out.push(generatedNotes[k]);
            }
        }
    }
}

// ============================================================
// 辅助
// ============================================================

function collectChordsInSection(
    chords: GeneratedChord[],
    section: SectionMetadata,
): GeneratedChord[] {
    const out: GeneratedChord[] = [];
    const sStart = section.startBeat;
    const sEnd = section.endBeat;
    for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        if (c.startBeat >= sStart - EPSILON && c.endBeat <= sEnd + EPSILON) {
            out.push(c);
        }
    }
    return out;
}

function sortNotesInPlace(notes: NoteData[]): void {
    notes.sort((a, b) => {
        const d = a.onset - b.onset;
        if (Math.abs(d) > EPSILON) return d;
        return a.pitch - b.pitch;
    });
}

function validateInput(input: ConductorInput): void {
    if (!Array.isArray(input.chords)) {
        throw new ConductorError('chords must be an array', {
            actual: typeof input.chords,
        });
    }
    if (!Array.isArray(input.sections)) {
        throw new ConductorError('sections must be an array', {
            actual: typeof input.sections,
        });
    }
    // styleId 合法性由 getStyleStage5Bundle 兜底（未知 ID 回落到 Pop）
}

export class ConductorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'ConductorError';
        this.context = context;
    }
}
