// ============================================================
// Conductor — 指挥家:Score + Band → per-section role 分配(C.2)
// ============================================================
//
// 用户 8 层架构里 #2 "指挥家"层。职责:看可用乐手(Band)+ 总谱(Score),
// 决定每段每位乐手演什么角色(melody / accomp / bass / pad / drums / silent /
// 多角色兼任)。
//
// 当前阶段(C.2):
//   StaticConductor 默认实现 — 全曲沿用相同的 band 分配,1 musician → 1 role,
//   等价于当前 forcedBand 行为(0 听感差异)。
//
// 后续阶段:
//   - C.3+:musicians 改造为 plan(score, role, peers) 协议,实际消费
//     SectionAssignment
//   - C.4+:DynamicConductor 支持 per-section 动态编排(如 "Verse 1 钢琴独奏,
//     Verse 2 全队进入"),同一乐手可在不同 section 切换 role
// ============================================================

import { BandRole, SectionType } from '../types';
import type { Musician, NoteData, SectionMetadata } from '../types';
import type { Score } from './Score';
import {
    DEFAULT_ROLE_FILTERS,
    buildSectionContext,
    buildRoleFilterContext,
} from './plugins/conductor';

/**
 * Conductor 用的 role(乐手在某 section 的"功能角色")。
 *
 * 与 BandRole 区分:
 *   - BandRole:乐队槽位身份(钢琴手 / 鼓手 / 等,长期不变)
 *   - ConductorRole:这首歌/这一段的演奏功能(melody / accomp / 等,可变 + 可兼任)
 *
 * 一个乐手(BandRole.MainInst 的 alex_piano)在第 1 段可以是 'melody',
 * 在第 2 段可以兼 'melody' + 'bass'(如 stride 钢琴独奏段)。
 */
export type ConductorRole =
    | 'melody'      // 主旋律
    | 'accomp'      // 伴奏(原 chord)
    | 'bass'        // 低音线
    | 'pad'         // 氛围铺垫
    | 'drums'       // 鼓组
    | 'silent';     // 这段不演奏

/**
 * Band — Conductor 决策时看到的可用乐手集。
 * Key = BandRole slot,Value = 该 slot 的 Musician(null = 空槽 = 无人)。
 */
export type Band = Partial<Record<BandRole, Musician | null>>;

/**
 * Conductor 输出:per-section 的 role 分配。
 *
 * `byMusician`: musicianId → 该乐手在此 section 演的角色列表
 * (可多角色,如 stride 钢琴独奏时 ['melody', 'bass'])。
 * 空 Map 表示该 section 无人演奏。
 */
export interface SectionAssignment {
    readonly sectionIdx: number;
    readonly byMusician: ReadonlyMap<string, ReadonlyArray<ConductorRole>>;
}

/**
 * BandRole → ConductorRole 默认 1:1 映射(slot 身份 → 演奏功能)。
 * DynamicConductor 默认 fallback 用。
 */
function defaultRoleFor(slot: BandRole): ConductorRole | null {
    switch (slot) {
        case BandRole.MainInst:   return 'melody';
        case BandRole.Accomp:     return 'accomp';
        case BandRole.Bass:       return 'bass';
        case BandRole.Drums:      return 'drums';
        case BandRole.Atmosphere: return 'pad';
        case BandRole.Vocal:      return null;
        default:                  return null;
    }
}

/** Helper:band → musicianId → roles 默认表(全员上场,1 musician → 1 role) */
function buildDefaultByMusician(band: Band): ReadonlyMap<string, ReadonlyArray<ConductorRole>> {
    const byMusician = new Map<string, ConductorRole[]>();
    for (const slot of Object.keys(band) as ReadonlyArray<BandRole>) {
        const musician = band[slot];
        if (!musician) continue;
        const role = defaultRoleFor(slot);
        if (!role) continue;
        const existing = byMusician.get(musician.id);
        if (existing) existing.push(role);
        else byMusician.set(musician.id, [role]);
    }
    const frozen = new Map<string, ReadonlyArray<ConductorRole>>();
    for (const [id, roles] of byMusician) frozen.set(id, Object.freeze([...roles]));
    return frozen;
}

// ============================================================
// DynamicConductor — per-section 动态编排(C.4)
// ============================================================
//
// 默认策略:section-type 模板驱动。例如:
//   Intro:pad + accomp 进入(无 melody / drums,营造氛围)
//   Verse / PreChorus / Chorus:全员
//   Bridge:无 drums(更柔)
//   Break / Breakdown:仅 drums + bass(rhythm section only)
//   Outro / PreOutro:pad / accomp / bass(收尾减员)
//   Solo_Bridge / BuildUp / Drop:默认全员(Phase 后续可细化)
//
// 后续可扩展:
//   - 自定义模板(从 styleDictionary 读)
//   - musician 卡的"在某 section 出不出场"覆盖
//   - 概率门(每 section 50% 概率某乐手 silent,增加变化)
// ============================================================

/**
 * ConductorTemplate:section-type → 该段允许的 ConductorRole 集。
 * 不在集内的 musician 该段 silent。未注册 sectionType → 全员 fallback。
 */
export type ConductorTemplate = Partial<Record<SectionType, ReadonlySet<ConductorRole>>>;

/** 默认模板(POP-flavored,所有 musicians 标准配置)。 */
export const DEFAULT_CONDUCTOR_TEMPLATE: ConductorTemplate = {
    [SectionType.Intro]:     new Set(['pad', 'accomp']),
    [SectionType.Verse]:     new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.PreChorus]: new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.Chorus]:    new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.Bridge]:    new Set(['melody', 'accomp', 'bass', 'pad']),         // 无 drums
    [SectionType.Break]:     new Set(['drums', 'bass']),                           // rhythm only
    [SectionType.Breakdown]: new Set(['drums', 'bass']),
    [SectionType.BuildUp]:   new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.Drop]:      new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.Outro]:     new Set(['pad', 'bass']),
    [SectionType.PreOutro]:  new Set(['pad', 'accomp', 'bass']),
    [SectionType.Solo_Bridge]: new Set(['melody', 'accomp', 'bass', 'pad']),
};

/**
 * Per-mgStyle 模板覆盖:不同风格的编排习惯。
 * 与 DEFAULT_CONDUCTOR_TEMPLATE 合并(per-section key 覆盖)。
 *
 * 初版编排习惯(可调):
 *   POP:   等同 default(标准 pop 编曲)
 *   JAZZ:  Intro/Outro 加 bass(walking bass 习惯)+ Bridge 保留 drums(jazz
 *          bridge 鼓不退场)+ Outro pad+bass+accomp 三件套(jazz 收尾)
 *   BLUES: pad 整体减少(blues 偏 rhythm 主导)+ Intro / Outro 只用 bass+drums
 *          → 也减 pad
 *   RNB:   Intro pad+accomp+bass(neo-soul 三件套 intro)+ Outro pad+bass+accomp
 *          (neo-soul 厚 outro)
 */
/**
 * POP-only 模板(JAZZ/BLUES/RNB 已退役)。
 */
export const CONDUCTOR_TEMPLATE: ConductorTemplate = DEFAULT_CONDUCTOR_TEMPLATE;

// ============================================================
// Conductor 模板自家化(2026-05-24 加):per-mgStyle 多 variants
// ============================================================
//
// 设计动机:同 mgStyle 不同 seed 给不同 variant template,让编曲多样性更高。
// Pop seed 1 可能走 "standard"(满编)Pop seed 2 可能走 "minimal"(Verse 无 drums)
// 用 seed hash deterministic 抽 variant,**零额外 PRNG 消耗**。
//
// Variant 结构:{ name, template }。template 是完整 ConductorTemplate(不是覆盖)。
// ============================================================

export interface ConductorTemplateVariant {
    name: string;
    template: ConductorTemplate;
}

/** POP-only 变种(JAZZ/BLUES/RNB 已退役) */
const POP_MINIMAL: ConductorTemplate = {
    ...DEFAULT_CONDUCTOR_TEMPLATE,
    [SectionType.Verse]:     new Set(['accomp', 'bass', 'pad']),                    // verse 无 drums + 无 melody
    [SectionType.Chorus]:    new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),
    [SectionType.PreChorus]: new Set(['accomp', 'bass', 'drums']),
};
const POP_DENSE: ConductorTemplate = {
    ...DEFAULT_CONDUCTOR_TEMPLATE,
    [SectionType.Intro]:     new Set(['melody', 'accomp', 'bass', 'pad']),          // 满编 intro
    [SectionType.Outro]:     new Set(['melody', 'accomp', 'bass', 'pad']),          // 满编 outro
    [SectionType.Bridge]:    new Set(['melody', 'accomp', 'bass', 'drums', 'pad']), // bridge 加鼓
};

export const CONDUCTOR_TEMPLATE_VARIANTS: ReadonlyArray<ConductorTemplateVariant> = [
    { name: 'standard', template: CONDUCTOR_TEMPLATE },
    { name: 'minimal',  template: POP_MINIMAL },
    { name: 'dense',    template: POP_DENSE },
];

/**
 * 用 seed deterministic 抽 variant(零 PRNG 消耗 — 仅 hash on number).
 * Facade 在构造 DynamicConductor 之前调用,选好 variant 传入 constructor。
 */
export function pickConductorTemplate(seed: number): {
    name: string;
    template: ConductorTemplate;
} {
    const variants = CONDUCTOR_TEMPLATE_VARIANTS;
    if (!variants || variants.length === 0) {
        return { name: 'fallback', template: DEFAULT_CONDUCTOR_TEMPLATE };
    }
    const idx = (seed >>> 0) % variants.length;
    return variants[idx];
}

export class DynamicConductor {
    private readonly template: ConductorTemplate;

    constructor(template?: ConductorTemplate) {
        this.template = template ?? DEFAULT_CONDUCTOR_TEMPLATE;
    }

    /**
     * Core:buildDefaultByMusician(全员上岗 1:1)→ per-section per-musician 过
     * DEFAULT_ROLE_FILTERS 链(5 plugin 顺序叠加)→ 留下非空 roles 入 assignment。
     *
     * 5 filter 详见 plugins/conductor/{WakeKGate,PeakKGate,StyleTemplateFilter,
     * EnergyFilter,MusicianPrefFilter}.ts。
     *
     * Z3 continuity 通过 prevAssignment 跟踪 prev section 上岗状态,filter 链
     * 内部消费(WakeK / PeakK gate)。
     */
    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment> {
        const fullByMusician = buildDefaultByMusician(band);
        const musicianById = new Map<string, Musician>();
        for (const slot of Object.keys(band) as ReadonlyArray<BandRole>) {
            const m = band[slot];
            if (m) musicianById.set(m.id, m);
        }

        const prevAssignment = new Map<string, ReadonlyArray<ConductorRole>>();
        const out: SectionAssignment[] = [];
        for (let idx = 0; idx < score.sections.length; idx++) {
            const section = score.sections[idx];
            const sectionCtx = buildSectionContext(section, this.template);
            const filtered = new Map<string, ReadonlyArray<ConductorRole>>();

            for (const [musicianId, roles] of fullByMusician) {
                const musician = musicianById.get(musicianId);
                const prevRoles = prevAssignment.get(musicianId);
                const filterCtx = buildRoleFilterContext(section, sectionCtx, musician, prevRoles);

                const kept = DEFAULT_ROLE_FILTERS.reduce<ConductorRole[]>(
                    (acc, filter) => filter.apply(acc, filterCtx),
                    [...roles],
                );

                if (kept.length > 0) filtered.set(musicianId, Object.freeze(kept));
            }
            out.push({ sectionIdx: idx, byMusician: filtered });
            prevAssignment.clear();
            for (const [k, v] of filtered) prevAssignment.set(k, v);
        }
        return out;
    }
}

// ============================================================
// Musician plan() 协议输入(C.3 起共享签名)
// ============================================================
//
// 所有 musicians 改造为 plan() 后,接收同一形状的输入。Musician 自查 own role
// per section,自查 peers(其他 musicians 已 emit 的 notes,cross-track 协调用)。
// ============================================================

export interface MusicianPlanInput {
    /** 总谱(只读) */
    readonly score: Score;
    /** 本 musician 在 Band 里的 id(用于在 assignments 中自查 own role) */
    readonly musicianId: string;
    /** Conductor 的 per-section role 分配(全曲所有 sections) */
    readonly assignments: ReadonlyArray<SectionAssignment>;
    /** 其他 musicians 已 emit notes(musicianId 也可能是 key,自查时 dedup)*/
    readonly peers: ReadonlyMap<string, ReadonlyArray<NoteData>>;
    /**
     * mg-derived 输入流(可选)。
     *
     * - **AF2-native musicians**(Pad / Drum):忽略此字段,纯从 Score 生成
     * - **mg-derived musicians**(Piano / Bass):此处是 SlotRouter 给本 musician
     *   的 mg 原料 events,musician 做 per-section role gate + 演绎转换
     *
     * 用 Partial<Record<ConductorRole, ...>> 而非单一 array:让 musician 可
     * 同时拿 melody / accomp / bass 多流(若 musician 兼任多 role)。
     */
    readonly notes?: Partial<Record<ConductorRole, ReadonlyArray<NoteData>>>;
    /**
     * Musician 卡(可选,musician 卡参数化用):
     *   musician.af2Overrides.regions     → 覆盖 PIANO_REGIONS
     *   musician.af2Overrides.escapeProbability   → 覆盖 Phase B 5%
     *   musician.af2Overrides.add11GateProbability → 覆盖 Phase C 60%
     *
     * Layer 3 sectionRolePreference 已在 Conductor.dispatch 阶段消费,这里
     * musician.af2Overrides 主要给 PianoIdiom / BassIdiom 读 Layer 1/2 overrides。
     */
    readonly musician?: Musician;
    /**
     * N6 阶段:cross-track melody peer notes(已 emit 的 mainMusician notes)。
     * 由 Facade 在 accomp closure 内从 input.peers.get(mainMusicianId) 注入。
     * AccompGen → ChordTextureEngine → CallAndResponse family 用于 melody 占用
     * 窗口检测。其他 idiom 可忽略。
     *
     * 前提:Dispatcher steps 顺序为 melody → bass → accomp → ...,确保 accomp
     * 跑时 melody peers 已存在。Major 调里 cross-track 用 textureType 'Call_And_Response'
     * 触发(per-mgStyle pool 决定),其他 textureType 忽略此字段。
     */
    readonly melodyPeerNotes?: ReadonlyArray<NoteData>;
    /**
     * P 阶段:per-song sub-style(SUB_STYLES_BY_MG 内某值)。
     * 由 Facade 从 options.generation.detectedSubStyle 或 PRNG fork 解析后注入。
     * AccompGen pickTextureType 优先 sub-style primaryTextures,缺则
     * fallback 到 STYLE_TEXTURE_POOL[mgStyle][sectionType]。
     * 其他 idiom 可忽略。
     */
    readonly subStyle?: string;
    /**
     * S 阶段:per-song songBase textureType — 整曲贯穿的"律动外壳"。
     * 由 Facade 从 sub-style primaryTextures 抽 medium-density textureType 注入。
     * AccompGen 用它 + energyLevel 决定每 chord 实际 textureType:
     *   energy 4-6 → 直接用 songBase(整曲基调统一)
     *   energy >= 7 → TEXTURE_VARIATIONS[songBase].dense 升级
     *   energy <= 3 → TEXTURE_VARIATIONS[songBase].sparse 降级
     * 其他 idiom 可忽略。
     */
    readonly songBase?: string;
}

/**
 * Helper:从 MusicianPlanInput 查"本 musician 在某 section 的角色列表"。
 * 未注册 / silent → 返回空数组。
 */
export function getMyRolesInSection(
    input: MusicianPlanInput,
    sectionIdx: number,
): ReadonlyArray<ConductorRole> {
    return input.assignments[sectionIdx]?.byMusician.get(input.musicianId) ?? [];
}

/**
 * Helper:beat 落在哪个 section index(sections 应 startBeat 升序)。
 * 找不到 → 返回 -1。
 *
 * 2026-05-24 优化:binary search,从 O(n) 线性扫描 → O(log n)。
 * Idiom 每 chord 重复调用,优化后从 200~500 次 × O(n) → O(log n) 显著降本。
 */
export function findSectionIdxForBeat(
    beat: number,
    sections: ReadonlyArray<SectionMetadata>,
): number {
    if (sections.length === 0) return -1;
    let lo = 0, hi = sections.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beat < sections[mid].endBeat) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}
