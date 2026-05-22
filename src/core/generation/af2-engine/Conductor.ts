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
import type { MgStyle } from '../../../state/EngineSelectionStore';

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
 * Conductor 接口 — 实现方决定具体调度策略。
 */
export interface Conductor {
    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment>;
}

// ============================================================
// StaticConductor — 默认实现:全曲沿用相同 band(= 当前 forcedBand 行为)
// ============================================================

/**
 * BandRole → ConductorRole 默认 1:1 映射(slot 身份 → 演奏功能)。
 * Vocal slot 暂未映射(AF2 未实装 vocal)。
 */
function defaultRoleFor(slot: BandRole): ConductorRole | null {
    switch (slot) {
        case BandRole.MainInst:   return 'melody';
        case BandRole.Accomp:     return 'accomp';
        case BandRole.Bass:       return 'bass';
        case BandRole.Drums:      return 'drums';
        case BandRole.Atmosphere: return 'pad';
        case BandRole.Vocal:      return null;  // Phase 后期
        default:                  return null;
    }
}

export class StaticConductor implements Conductor {
    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment> {
        const frozenByMusician = buildDefaultByMusician(band);
        // 全曲沿用同一份 assignment
        return score.sections.map((_, idx) => ({
            sectionIdx: idx,
            byMusician: frozenByMusician,
        }));
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
export const CONDUCTOR_TEMPLATES_BY_STYLE: Record<MgStyle, ConductorTemplate> = {
    POP: DEFAULT_CONDUCTOR_TEMPLATE,
    JAZZ: {
        ...DEFAULT_CONDUCTOR_TEMPLATE,
        [SectionType.Intro]:     new Set(['pad', 'accomp', 'bass']),       // jazz intro 加 walking bass
        [SectionType.Bridge]:    new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),  // bridge 保鼓
        [SectionType.Outro]:     new Set(['pad', 'accomp', 'bass']),       // jazz 收尾三件套
        [SectionType.PreOutro]:  new Set(['pad', 'accomp', 'bass', 'drums']),
    },
    BLUES: {
        ...DEFAULT_CONDUCTOR_TEMPLATE,
        [SectionType.Intro]:     new Set(['drums', 'bass']),               // blues intro rhythm only,无 pad
        [SectionType.Verse]:     new Set(['melody', 'accomp', 'bass', 'drums']),  // 无 pad(blues 不太用 pad)
        [SectionType.PreChorus]: new Set(['melody', 'accomp', 'bass', 'drums']),
        [SectionType.Chorus]:    new Set(['melody', 'accomp', 'bass', 'drums', 'pad']),  // chorus 才加 pad
        [SectionType.Bridge]:    new Set(['melody', 'accomp', 'bass', 'drums']),
        [SectionType.Outro]:     new Set(['drums', 'bass']),               // blues 收尾 rhythm only
        [SectionType.PreOutro]:  new Set(['accomp', 'bass', 'drums']),
    },
    RNB: {
        ...DEFAULT_CONDUCTOR_TEMPLATE,
        [SectionType.Intro]:     new Set(['pad', 'accomp', 'bass']),       // neo-soul intro 三件套
        [SectionType.Outro]:     new Set(['pad', 'accomp', 'bass']),       // 厚 outro
        [SectionType.PreOutro]:  new Set(['pad', 'accomp', 'bass', 'drums']),
    },
};

export class DynamicConductor implements Conductor {
    private readonly template: ConductorTemplate;

    constructor(template?: ConductorTemplate) {
        this.template = template ?? DEFAULT_CONDUCTOR_TEMPLATE;
    }

    dispatch(score: Score, band: Band): ReadonlyArray<SectionAssignment> {
        const fullByMusician = buildDefaultByMusician(band);
        return score.sections.map((section, idx) => {
            const allowedRoles = this.template[section.sectionType];
            if (!allowedRoles) {
                // 未注册的 sectionType → 全员上场
                return { sectionIdx: idx, byMusician: fullByMusician };
            }
            // 过滤每个 musician 的 roles,保留 allowedRoles 内的
            const filtered = new Map<string, ReadonlyArray<ConductorRole>>();
            for (const [id, roles] of fullByMusician) {
                const kept = roles.filter(r => allowedRoles.has(r));
                if (kept.length > 0) filtered.set(id, Object.freeze(kept));
                // kept 为空 → 该段该 musician silent(不进 map = 无 role)
            }
            return { sectionIdx: idx, byMusician: filtered };
        });
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
 */
export function findSectionIdxForBeat(
    beat: number,
    sections: ReadonlyArray<SectionMetadata>,
): number {
    for (let i = 0; i < sections.length; i++) {
        if (beat < sections[i].endBeat) return i;
    }
    return sections.length > 0 ? sections.length - 1 : -1;
}
