/**
 * RhythmTopologyMutator — 节奏拓扑算子（Sub-Phase 2）
 *
 * 对 16-step 0/1 grid + voicing 数组做纯数学变换，专门用于在不打破 baseRecipe
 * 整体律动的前提下，给每个小节注入"微变化"，消灭"每小节伴奏一模一样"的机械感。
 *
 * 设计哲学（与 TopologyMutator 旋律拓扑模块对齐）：
 *   - 所有算子是 grid → grid 或 voicing → voicing 的纯函数
 *   - 零 PRNG（D-1）— 调度由 caller 按 (barInPhrase, mood) 等确定性参数决定
 *   - 输入不可变，输出新数组（不就地改写，避免 baseRecipe 表被污染）
 *   - applyChain 顺序应用算子，单算子失败不抛错（容错优先）
 *
 * 与上游模块的边界：
 *   - 不感知 chord / pitch 语义（不知道当前是几度音）
 *   - 不感知 mood / sectionType（剧本调度归 MoodRouter / PianoAccompIdiom）
 *   - 单纯做 "16 个布尔位 + 一组音高数组" 的几何变换
 *
 * 约束遵从（music_generation_pipeline_rule.md）：
 *   D-1：零 PRNG
 *   D-3：voicing 输出升序（sort 显式调用）
 *   P-1：number[] 输出，不返回 Map/Set
 *   T-1：算子种类用数值常量分类，非字符串
 *   T-3：无 any
 *   S-3：全同步纯函数
 *   C-3：热循环手写 for，无 map/filter/reduce
 *
 * Pitch Space: RELATIVE（voicing 算子仅做 ±12 / 重新排序，不偏移 keyOffset）
 *
 * @author AuraFlow Tap! Piano Texture Renaissance — Sub-Phase 2
 */

import { SyncopationEvaluator } from './SyncopationEvaluator';

// ============================================================
// 算子种类（T-1 数值常量分类）
// ============================================================

export const OP_ROTATE          = 0;  // 网格循环旋转
export const OP_MIRROR          = 1;  // 网格 16 步逆序
export const OP_DENSIFY         = 2;  // 在 metricWeight ≥ threshold 的空位加击点
export const OP_DECIMATE        = 3;  // 删除 metricWeight ≤ threshold 的击点（保留 step 0）
export const OP_VOICING_INVERT  = 4;  // 顶音 -12 → 重新排序（紧凑化）
export const OP_VOICING_OPEN    = 5;  // 顶音 +12 复制 → 重新排序（开放化）

export type TopologyOpKind = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * 单个算子。
 *
 * arg 字段含义：
 *   - OP_ROTATE     : 旋转步数（正数后移，负数前移）
 *   - OP_DENSIFY    : metricWeight 下限（≥ 此值的空位被填）
 *   - OP_DECIMATE   : metricWeight 上限（≤ 此值的击点被删；step 0 永不删）
 *   - 其他算子      : 忽略 arg
 */
export interface RhythmTopologyOp {
    kind: TopologyOpKind;
    arg?: number;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_STEPS_PER_BAR = 16;
const PITCH_LO = 0;
const PITCH_HI = 127;

// ============================================================
// 算子实现
// ============================================================

export class RhythmTopologyMutator {

    /**
     * 网格循环旋转：out[i] = grid[(i - steps + L) % L]。
     *
     * steps > 0 → 整体后移（hit 推后），steps < 0 → 整体前移（hit 提前）。
     * 击点数量不变。step 0 的 hit 可能被移走 — caller 需在 4-bar 剧本里
     * 谨慎选择是否对 bar 0 使用本算子（chord head 强位丢失会改变和弦切换感）。
     */
    public static rotate(grid: ReadonlyArray<number>, steps: number): number[] {
        const L = grid.length;
        const out = new Array<number>(L);
        if (L === 0) return out;

        const s = ((steps | 0) % L + L) % L;  // 归一化到 [0, L)
        for (let i = 0; i < L; i++) {
            const src = (i - s + L) % L;
            out[i] = grid[src];
        }
        return out;
    }

    /**
     * 网格逆序镜像：out[i] = grid[L - 1 - i]。
     *
     * 击点数量不变，但节奏形态被时间轴翻转。对 Pulse4thBlock 这种均匀网格
     * 无可闻效果；对 SyncopatedStab / BossaClave 等不对称网格会改变切分位置。
     */
    public static mirror(grid: ReadonlyArray<number>): number[] {
        const L = grid.length;
        const out = new Array<number>(L);
        if (L === 0) return out;

        for (let i = 0; i < L; i++) out[i] = grid[L - 1 - i];
        return out;
    }

    /**
     * 加密：在 metricWeight ≥ weightThreshold 且当前为 0 的位插入击点。
     *
     * 典型用法：
     *   densify(grid, 2) — 在小节强位（step 0, 4, 8, 12 对应 weight 4/2/3/2）的空缺加 hit
     *   densify(grid, 1) — 进一步在 8 分位（step 2, 6, 10, 14）加 hit，整体变 8 分 pulse
     */
    public static densify(
        grid: ReadonlyArray<number>,
        weightThreshold: number,
        stepsPerBar: number = DEFAULT_STEPS_PER_BAR,
    ): number[] {
        const L = grid.length;
        const out = new Array<number>(L);
        if (L === 0) return out;

        for (let i = 0; i < L; i++) {
            if (grid[i] === 1) {
                out[i] = 1;
                continue;
            }
            const w = SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
            out[i] = w >= weightThreshold ? 1 : 0;
        }
        return out;
    }

    /**
     * 减稀：删除 metricWeight ≤ weightThreshold 且当前为 1 的击点。
     *
     * 强约束：step 0 的 hit 永不删除（chord head 是和弦换音感锚点）。
     *
     * 典型用法：
     *   decimate(grid, 0) — 删除所有 16 分弱位击点（仅保留正拍 + 8 分位）
     *   decimate(grid, 1) — 删除所有 8 分位以下击点（仅保留正拍）
     */
    public static decimate(
        grid: ReadonlyArray<number>,
        weightThreshold: number,
        stepsPerBar: number = DEFAULT_STEPS_PER_BAR,
    ): number[] {
        const L = grid.length;
        const out = new Array<number>(L);
        if (L === 0) return out;

        for (let i = 0; i < L; i++) {
            if (grid[i] !== 1) {
                out[i] = 0;
                continue;
            }
            if (i === 0) {
                out[i] = 1;  // 保锚
                continue;
            }
            const w = SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
            out[i] = w <= weightThreshold ? 0 : 1;
        }
        return out;
    }

    /**
     * Voicing 紧凑化：顶音 -12，重新排序。
     *
     * 例：[E4=64, G4=67, B4=71, D5=74] → [D4=62, E4=64, G4=67, B4=71]
     * 听感：voicing 更紧凑、更暗。bar 1 的微变化用，节奏不变只换声部排列。
     *
     * 击点数量不变（恒等长度），不离开 [0, 127] 区间（硬 clamp）。
     */
    public static voicingInvert(voicing: ReadonlyArray<number>): number[] {
        const L = voicing.length;
        const out = new Array<number>(L);
        if (L === 0) return out;
        if (L === 1) { out[0] = voicing[0]; return out; }

        // 找顶音索引（数组应已升序，但保险起见线性扫一次）
        let topIdx = 0;
        for (let i = 1; i < L; i++) {
            if (voicing[i] > voicing[topIdx]) topIdx = i;
        }

        for (let i = 0; i < L; i++) out[i] = voicing[i];
        let lowered = out[topIdx] - 12;
        if (lowered < PITCH_LO) lowered = PITCH_LO;
        out[topIdx] = lowered;

        // 重新排序（升序），手写循环避开 sort 隐式开销
        out.sort((a, b) => a - b);
        return out;
    }

    /**
     * Voicing 开放化：顶音 +12 复制追加 → 声部数 +1。
     *
     * 例：[E4=64, G4=67, B4=71, D5=74] → [E4=64, G4=67, B4=71, D5=74, D6=86]
     * 听感：增加一个高音双音叠加，亮度提升。bar 3 句尾推用，制造"热度上升"感。
     *
     * 若顶音 +12 越界（>127），则跳过追加，原样返回（不抛错）。
     */
    public static voicingOpen(voicing: ReadonlyArray<number>): number[] {
        const L = voicing.length;
        if (L === 0) return [];

        let top = voicing[0];
        for (let i = 1; i < L; i++) {
            if (voicing[i] > top) top = voicing[i];
        }

        const doubled = top + 12;
        if (doubled > PITCH_HI) {
            // 越界 — 原样返回
            const out = new Array<number>(L);
            for (let i = 0; i < L; i++) out[i] = voicing[i];
            return out;
        }

        const out = new Array<number>(L + 1);
        for (let i = 0; i < L; i++) out[i] = voicing[i];
        out[L] = doubled;
        out.sort((a, b) => a - b);
        return out;
    }

    /**
     * 链式应用：按 chain 顺序逐个算子执行，grid 与 voicing 共流转。
     *
     * 单个算子失败不抛错（如 OP 不识别则跳过），保证调用方稳定。
     * 输入 grid / voicing 不被修改 — 每个算子都返回新数组。
     */
    public static applyChain(
        grid: ReadonlyArray<number>,
        voicing: ReadonlyArray<number>,
        chain: ReadonlyArray<RhythmTopologyOp>,
        stepsPerBar: number = DEFAULT_STEPS_PER_BAR,
    ): { grid: number[]; voicing: number[] } {
        // 拷贝输入到可变本地，避免误修改 baseRecipe 表
        let g: number[] = new Array<number>(grid.length);
        for (let i = 0; i < grid.length; i++) g[i] = grid[i];
        let v: number[] = new Array<number>(voicing.length);
        for (let i = 0; i < voicing.length; i++) v[i] = voicing[i];

        for (let k = 0; k < chain.length; k++) {
            const op = chain[k];
            switch (op.kind) {
                case OP_ROTATE:
                    g = RhythmTopologyMutator.rotate(g, op.arg ?? 0);
                    break;
                case OP_MIRROR:
                    g = RhythmTopologyMutator.mirror(g);
                    break;
                case OP_DENSIFY:
                    g = RhythmTopologyMutator.densify(g, op.arg ?? 2, stepsPerBar);
                    break;
                case OP_DECIMATE:
                    g = RhythmTopologyMutator.decimate(g, op.arg ?? 0, stepsPerBar);
                    break;
                case OP_VOICING_INVERT:
                    v = RhythmTopologyMutator.voicingInvert(v);
                    break;
                case OP_VOICING_OPEN:
                    v = RhythmTopologyMutator.voicingOpen(v);
                    break;
                default:
                    // 未知算子 — 跳过
                    break;
            }
        }

        return { grid: g, voicing: v };
    }
}

// ============================================================
// 4-bar 句法剧本（Sub-Phase 2 通用版，不感知 mood）
// ============================================================
//
// Sub-Phase 3 MoodRouter 上线后，本表将被 mood-specific 剧本表取代。
// 当前作为"通用 phrase 句法"使用，确保 Sub-Phase 2 即可听到小节间变化。
//
// 设计目标：每个 bar 都有可闻但不破坏整体律动的变化。
//   bar 0: 锚点 — 原型，phrase 重置参考
//   bar 1: 微变 — voicing 紧凑化（节奏不变，只换声部色彩）
//   bar 2: 加击 — 在 weight≥2 空位加 hit（强拍补满，推进感）
//   bar 3: 句尾推 — 在 weight≥1 空位加 hit + voicing 开放（亮度 + 密度同步抬升）
// ============================================================

const PHRASE_CHAIN_BAR_0: ReadonlyArray<RhythmTopologyOp> = Object.freeze([]);
const PHRASE_CHAIN_BAR_1: ReadonlyArray<RhythmTopologyOp> = Object.freeze([
    Object.freeze({ kind: OP_VOICING_INVERT as TopologyOpKind }),
]);
const PHRASE_CHAIN_BAR_2: ReadonlyArray<RhythmTopologyOp> = Object.freeze([
    Object.freeze({ kind: OP_DENSIFY as TopologyOpKind, arg: 2 }),
]);
const PHRASE_CHAIN_BAR_3: ReadonlyArray<RhythmTopologyOp> = Object.freeze([
    Object.freeze({ kind: OP_DENSIFY as TopologyOpKind, arg: 1 }),
    Object.freeze({ kind: OP_VOICING_OPEN as TopologyOpKind }),
]);

const UNIVERSAL_PHRASE_CHAIN_TABLE: ReadonlyArray<ReadonlyArray<RhythmTopologyOp>> = Object.freeze([
    PHRASE_CHAIN_BAR_0,
    PHRASE_CHAIN_BAR_1,
    PHRASE_CHAIN_BAR_2,
    PHRASE_CHAIN_BAR_3,
]);

/**
 * 取通用 4-bar 句法剧本对应当前 bar 的算子链。
 *
 * @param barInPhrase 0~3，超出范围自动模 4
 */
export function getUniversalPhraseChain(barInPhrase: number): ReadonlyArray<RhythmTopologyOp> {
    const idx = ((barInPhrase | 0) % 4 + 4) % 4;
    return UNIVERSAL_PHRASE_CHAIN_TABLE[idx];
}
