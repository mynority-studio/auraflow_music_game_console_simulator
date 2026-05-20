/**
 * PhraseContourPlanner — section 级旋律弧线注入器（Phase 6.4）
 *
 * 在 PCFG / MasterPhraseRenderer 与 ToplineEngine 之间运行。读取 SectionMetadata
 * 里的 contour 字段（或按 sectionType 查内部默认表），把"乐句弧线"翻译成对
 * TerminalSymbol.targetDegree / contourDir 的注入指令 — 让 ToplineEngine 在
 * 一条**全 section 视角**的轨迹上展开旋律，而不是只看一拍前瞻。
 *
 * 五种 archetype：
 *   - flat:    arc(p) = 0.5          — 横线，稳定锚定 (Verse / Break)
 *   - ascent:  arc(p) = p            — 0 → 1 (Intro / PreChorus / BuildUp)
 *   - descent: arc(p) = 1 - p        — 1 → 0 (Outro / PreOutro / Breakdown)
 *   - arch:    分段线性 + peakAt 形参 — 0 → 1 → 0，峰位可调 (Chorus / Bridge / Drop)
 *   - wave:    0.5 + 0.5·sin(2π·c·p) — 起伏波动 (强调 verse 的对话感时可选用)
 *
 * 注入决策（archetype → hint type）：
 *   - flat:           targetDegree（arc 桶映射）
 *   - arch:           接近峰 / 段末 → targetDegree；否则 contourDir（按导数符号）
 *   - ascent/descent: 段首 / 段末 → targetDegree（落锚）；中间 → contourDir
 *   - wave:           全程 contourDir（按导数符号），不抢轮廓中点
 *
 * arc 值 → targetDegree（5 桶映射）：
 *   bucket = floor(arc · 5)        — 0..4
 *   degree = [1, 3, 5, 5, 7][bucket]
 *   弱锚（arc≈0）→ 1 度（tonic）；峰（arc≈1）→ 7 度（leading tone）
 *
 * 注入门控（缺一不写）：
 *   1. kind ∈ {chordTone, colorTone}    — 不碰 rest / approachTone（approach 由 Topline Pass 2 决定）
 *   2. motifName === undefined          — 保护 Recall(Hook) 指纹，绝不破坏和声模进
 *   3. duration >= STRUCTURAL_THRESHOLD — 16th 音符透明，留 PCFG / 大师原始走向
 *   4. 对应字段 === undefined           — 不覆盖作者 / 大师字典里的硬 hint
 *   5. intensity stride credit 命中     — credit += intensity，>= 1 才注入并消耗
 *
 * 决策来源解析（resolvePlan，优先级 1 > 2 > 3）：
 *   1. section.contour 显式提供                          → 完全采用（含 intensity）
 *   2. section.sectionType 已知                          → 走 DEFAULT_CONTOUR_BY_SECTION 表
 *   3. 两者皆无                                          → 退化为 'flat'（实质 no-op）
 *   intensity 缺省 → section.energyLevel / 10（[0,1] 钳制）
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1 / D-5: **零 PRNG 消耗** — planner 是纯确定性后处理，保持黄金种子字节对齐
 *   D-3:       内部无非确定排序；线性扫一遍 terminals
 *   D-4 / C-1: duration / arc 浮点比较走 epsilon
 *   P-1:       无 Map/Set，全数组线性扫描；DEFAULT 表用 SectionType 数值作索引
 *   T-1:       ContourArchetype 走字面量 union 比较
 *   T-3:       无 any
 *   T-5:       motifName / hint 字段用 `=== undefined` 显式判定
 *   S-3 / S-4: 同步纯函数，输入 terminals 数组就地变异（与 PCFG / Master 输出契约一致）
 *   K-1 / K-2 / K-7: Pitch Space N/A — 本模块不接触 pitch，只写抽象 hint
 *   C-3 / C-4: 单次线性扫描，无热循环临时数组；输出长度 = 输入长度（无增减）
 *
 * @author AuraFlow Tap! Phase 6.4 — The Contour Planner
 */

import { TerminalSymbol } from './PCFGGrammarEngine';
import { SectionMetadata, ContourArchetype } from '../types';

const EPSILON = 1e-6;

/** 结构音阈值（拍）— 8 分及以上才被弧线注入，16ths 透明 */
const STRUCTURAL_THRESHOLD = 0.5;

/** arc 桶 → targetDegree 映射（低张力 → 高张力） */
const DEGREE_BY_BUCKET: readonly number[] = [1, 3, 5, 5, 7];

/** arch 判定为"近峰"的 arc 阈值 — 命中后改注入 targetDegree 而非 contourDir */
const ARCH_PEAK_BAND = 0.85;

/**
 * SectionType 数值 → 默认弧线形状。
 *
 * 数组下标 = SectionType 枚举值（types.ts:796 0..11）；扩展枚举时务必同步追加。
 * intensity 不在此表中 —— 由 SectionMetadata.energyLevel / 10 计算。
 */
interface DefaultContourEntry {
    archetype: ContourArchetype;
    peakAt: number;   // 仅 arch 用；其他 archetype 留 0
    cycles: number;   // 仅 wave 用；其他 archetype 留 0
}
const DEFAULT_CONTOUR_BY_SECTION: readonly DefaultContourEntry[] = [
    { archetype: 'ascent',  peakAt: 0,   cycles: 0 }, // 0  Intro
    { archetype: 'flat',    peakAt: 0,   cycles: 0 }, // 1  Verse
    { archetype: 'ascent',  peakAt: 0,   cycles: 0 }, // 2  PreChorus
    { archetype: 'arch',    peakAt: 0.6, cycles: 0 }, // 3  Chorus    — 峰偏后，让"最后一句拔高"成立
    { archetype: 'arch',    peakAt: 0.4, cycles: 0 }, // 4  Bridge    — 峰偏前，与 chorus 错峰
    { archetype: 'descent', peakAt: 0,   cycles: 0 }, // 5  Outro
    { archetype: 'flat',    peakAt: 0,   cycles: 0 }, // 6  Break
    { archetype: 'descent', peakAt: 0,   cycles: 0 }, // 7  Breakdown
    { archetype: 'ascent',  peakAt: 0,   cycles: 0 }, // 8  BuildUp
    { archetype: 'arch',    peakAt: 0.1, cycles: 0 }, // 9  Drop      — 峰立刻落地，整段下泻
    { archetype: 'descent', peakAt: 0,   cycles: 0 }, // 10 PreOutro
    { archetype: 'arch',    peakAt: 0.5, cycles: 0 }, // 11 Solo_Bridge
];

/** 解析后的弧线计划（block 级，包含全部展开所需常量） */
export interface ResolvedContourPlan {
    archetype: ContourArchetype;
    peakAt: number;
    cycles: number;
    intensity: number;
    blockStartInSection: number;
    blockDuration: number;
    sectionDuration: number;
}

export class PhraseContourPlanner {
    /**
     * 在 terminals 上就地注入弧线 hint。
     *
     * 零 PRNG 消耗 — 不影响下游 ToplineEngine 的 D-5 序列字节对齐。
     *
     * @param terminals           PCFG / Master 吐出的抽象 token 序列（in-place 变异）
     * @param section             所属 section 的元数据（contour / sectionType / energyLevel）
     * @param blockStartInSection 当前 block 相对 section 起拍的偏移
     * @param blockDuration       当前 block 拍数
     */
    public static shape(
        terminals: TerminalSymbol[],
        section: SectionMetadata,
        blockStartInSection: number,
        blockDuration: number,
    ): void {
        if (terminals.length === 0) return;
        const plan = PhraseContourPlanner.resolvePlan(section, blockStartInSection, blockDuration);
        if (plan.sectionDuration < EPSILON) return;       // 异常段（startBeat == endBeat）
        if (plan.intensity < EPSILON) return;             // intensity = 0 → 透明
        if (plan.archetype === 'flat' && plan.intensity < EPSILON) return;  // 双保险
        PhraseContourPlanner.inject(terminals, plan);
    }

    /**
     * 解析 SectionMetadata → ResolvedContourPlan。
     *
     * 决策优先级（高 → 低）：
     *   1. section.contour 显式提供
     *   2. section.sectionType 命中 DEFAULT_CONTOUR_BY_SECTION 表
     *   3. 退化为 'flat'
     * intensity 缺省走 energyLevel / 10，钳制到 [0, 1]。
     */
    public static resolvePlan(
        section: SectionMetadata,
        blockStartInSection: number,
        blockDuration: number,
    ): ResolvedContourPlan {
        const sectionDuration = section.endBeat - section.startBeat;

        // ── archetype / peakAt / cycles ──
        let archetype: ContourArchetype = 'flat';
        let peakAt = 0.5;
        let cycles = 1;
        const spec = section.contour;
        if (spec !== undefined) {
            archetype = spec.archetype;
            if (spec.peakAt !== undefined) peakAt = spec.peakAt;
            if (spec.cycles !== undefined) cycles = spec.cycles;
        } else if (
            section.sectionType !== undefined
            && section.sectionType >= 0
            && section.sectionType < DEFAULT_CONTOUR_BY_SECTION.length
        ) {
            const def = DEFAULT_CONTOUR_BY_SECTION[section.sectionType];
            archetype = def.archetype;
            if (def.peakAt > 0) peakAt = def.peakAt;
            if (def.cycles > 0) cycles = def.cycles;
        }

        // ── intensity ──
        let intensity: number;
        if (spec !== undefined && spec.intensity !== undefined) {
            intensity = spec.intensity;
        } else {
            intensity = section.energyLevel / 10;
        }
        if (intensity < 0) intensity = 0;
        else if (intensity > 1) intensity = 1;

        // peakAt / cycles 安全钳制
        if (peakAt < 0) peakAt = 0;
        else if (peakAt > 1) peakAt = 1;
        if (cycles < 1) cycles = 1;

        return {
            archetype, peakAt, cycles, intensity,
            blockStartInSection, blockDuration, sectionDuration,
        };
    }

    /**
     * arc(p) — 弧线函数，输出 ∈ [0, 1]。
     *
     * Pitch Space: N/A — 这是抽象张力 / 寄存器轨迹。
     *
     * 退化边界：
     *   arch peakAt → 0  → 行为等价 descent（峰瞬间到顶后只下降）
     *   arch peakAt → 1  → 行为等价 ascent（持续爬升到段末才到顶）
     */
    public static arc(p: number, archetype: ContourArchetype, peakAt: number, cycles: number): number {
        let pp = p;
        if (pp < 0) pp = 0;
        else if (pp > 1) pp = 1;
        switch (archetype) {
            case 'flat':    return 0.5;
            case 'ascent':  return pp;
            case 'descent': return 1 - pp;
            case 'arch': {
                if (peakAt < EPSILON) return 1 - pp;
                if (peakAt > 1 - EPSILON) return pp;
                if (pp <= peakAt) return pp / peakAt;
                return (1 - pp) / (1 - peakAt);
            }
            case 'wave': {
                const c = cycles >= 1 ? cycles : 1;
                return 0.5 + 0.5 * Math.sin(2 * Math.PI * c * pp);
            }
        }
    }

    /** arc 值 → targetDegree（5 桶映射，bucket 4 上限钳制） */
    private static degreeForArc(arcVal: number): number {
        let bucket = Math.floor(arcVal * 5);
        if (bucket < 0) bucket = 0;
        else if (bucket > 4) bucket = 4;
        return DEGREE_BY_BUCKET[bucket];
    }

    /**
     * 核心注入循环 — 单次线性扫 terminals，按 plan 改写 targetDegree / contourDir。
     *
     * 算法（每 slot）：
     *   1. 累加 blockCumDur，计算 onsetInSection
     *   2. 门控：rest / approach / motif / 短音 / intensity stride 任一不命中即跳过
     *   3. 算 arc(pCurr) 与 arc(pNext = pCurr + dur/sectionDur)，前向差分 dArc
     *   4. 按 archetype + (是否近峰 / 段首 / 段末) 决定注入 targetDegree 还是 contourDir
     *   5. 写入前检查字段为 undefined（不覆盖硬 hint）
     */
    private static inject(terminals: TerminalSymbol[], plan: ResolvedContourPlan): void {
        const N = terminals.length;
        const sectionDur = plan.sectionDuration;
        const archetype = plan.archetype;
        const peakAt = plan.peakAt;
        const cycles = plan.cycles;
        const intensity = plan.intensity;

        let blockCumDur = 0;
        let credit = 0;

        for (let i = 0; i < N; i++) {
            const slot = terminals[i];
            const onsetInSection = plan.blockStartInSection + blockCumDur;
            const slotDur = slot.duration;
            blockCumDur += slotDur;

            // ── 门控（① 类型 ② motif ③ 时长） ──
            if (slot.kind === 'rest' || slot.kind === 'approachTone') continue;
            if (slot.motifName !== undefined) continue;
            if (slotDur < STRUCTURAL_THRESHOLD - EPSILON) continue;

            // ── intensity stride（credit accumulator）──
            credit += intensity;
            if (credit + EPSILON < 1) continue;
            credit -= 1;

            // ── arc 值 + 前向差分 ──
            const pCurr = onsetInSection / sectionDur;
            const pNext = (onsetInSection + slotDur) / sectionDur;
            const arcCurr = PhraseContourPlanner.arc(pCurr, archetype, peakAt, cycles);
            const arcNext = PhraseContourPlanner.arc(pNext, archetype, peakAt, cycles);
            const dArc = arcNext - arcCurr;

            const isSectionFirst = onsetInSection < EPSILON;
            const isSectionLast = (onsetInSection + slotDur) > sectionDur - EPSILON;

            // ── 决定注入哪类 hint ──
            let injectTarget = false;
            let injectDir = false;
            switch (archetype) {
                case 'flat':
                    injectTarget = true;       // arc=0.5 → degree 5（稳态锚定）
                    break;
                case 'arch':
                    if (arcCurr > ARCH_PEAK_BAND || isSectionLast) injectTarget = true;
                    else injectDir = true;
                    break;
                case 'ascent':
                case 'descent':
                    if (isSectionFirst || isSectionLast) injectTarget = true;
                    else injectDir = true;
                    break;
                case 'wave':
                    injectDir = true;
                    break;
            }

            // ── 写入（尊重作者硬 hint：字段已设 → 不覆盖）──
            if (injectTarget && slot.targetDegree === undefined) {
                slot.targetDegree = PhraseContourPlanner.degreeForArc(arcCurr);
            }
            if (injectDir && slot.contourDir === undefined) {
                if (dArc > EPSILON)       slot.contourDir = 1;
                else if (dArc < -EPSILON) slot.contourDir = -1;
                // |dArc| < EPSILON → 不强求方向（保 nearest 抽样自由）
            }
        }
    }
}

