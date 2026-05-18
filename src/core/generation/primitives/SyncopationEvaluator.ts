/**
 * SyncopationEvaluator — 节拍张力评估器
 *
 * 移植自 ImproVisor / Tension.java 的 Longuet-Higgins & Lee (1984) 算法，
 * 配合 Lerdahl & Jackendoff (1983) 的 metrical hierarchy 层级权重。
 *
 * 与 Java 原版的差异：
 *   - 权重符号翻转 — 我们用**正值**（4=whole, 3=half, 2=quarter, 1=8th, 0=16th），
 *     直觉上"越大越重"。Java 原版用负值（0/-1/-2/-3/-4），抽象但反直觉。
 *   - 算法核心一致：扫每个 step，若当前位静音且其权重高于其回溯到的最近"发声 step"
 *     的权重 → 该位贡献切分张力（强位被偷走 = 切分）。
 *   - 归一化：除以 numBars × maxSyncoPerBar，clamp 至 [0, 1]，对外行为友好。
 *
 * 约束遵从（music_generation_pipeline_rule.md）：
 *   D-3: 无排序；如有 tie 由 PRNG 在 caller 处破平局
 *   D-4: 无浮点等于比较
 *   P-1: 全 flat number[] / Int8Array，无 Map/Set
 *   T-3: 无 any
 *   S-3: 全同步纯函数
 *   S-6: 无外部状态捕获
 *   C-2: 不做累加 beat 循环（grid 索引天然是整数）
 *
 * Pitch Space: N/A（本模块不接触 pitch）
 *
 * @author AuraFlow Tap! Phase 2.6
 */

const EPSILON = 1e-6;
const PITCHES_PER_OCTAVE_GUARD = 12;  // 防御性常量，本文件未直接用，留作 grep 锚

// ============================================================
// 16-step metrical hierarchy（4/4 拍，stepsPerBeat=4 默认）
// ============================================================
//
// 段位说明（一小节 16 个 16 分槽位）：
//
//   step:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   level: W  s  e  s  Q  s  e  s  H  s  e  s  Q  s  e  s
//   weight:4  0  1  0  2  0  1  0  3  0  1  0  2  0  1  0
//
//   W = whole-note position（小节首）
//   H = half-note position（第 9 步）
//   Q = quarter-note positions（第 5、13 步）
//   e = 8th-note positions（第 3、7、11、15 步）
//   s = 16th-note positions（弱）
//
// 注：weight 越高 = 拍子越重。该表用于 §getMetricalWeight 查询。
const WEIGHT_16_PER_BAR: ReadonlyArray<number> = Object.freeze([
    4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0,
]);

// 3/4 拍, 16分网格 (12 steps)
const WEIGHT_12_PER_BAR: ReadonlyArray<number> = Object.freeze([
    4, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0
]);
// 6/8 或 12/8 拍 (24 steps)
const WEIGHT_24_PER_BAR: ReadonlyArray<number> = Object.freeze([
    4, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 3, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0
]);

// ============================================================
// 公开 API
// ============================================================

export interface SyncopationEvaluatorOptions {
    /** 每拍 step 数（默认 4，即 16 分网格）。当前仅支持 4。 */
    stepsPerBeat?: number;
}

export class SyncopationEvaluator {

    /**
     * 查询某 step 在小节内的 metrical weight。
     *
     * 默认 stepsPerBeat=4（即每小节 16 step）。stepIndex 模 stepsPerBar 自动跨小节循环。
     * 返回值 ≥ 0，0 表示最弱位（16 分弱拍），最大值出现在小节首（whole-note 位）。
     */
    public static getMetricalWeight(stepIndex: number, stepsPerBar: number = 16): number {
        const i = (stepIndex | 0) % stepsPerBar;
        const idx = i < 0 ? i + stepsPerBar : i;
        if (stepsPerBar === 16) return WEIGHT_16_PER_BAR[idx];
        if (stepsPerBar === 12) return WEIGHT_12_PER_BAR[idx];
        if (stepsPerBar === 24) return WEIGHT_24_PER_BAR[idx];

        // 动态兜底算法
        const stepsPerBeat = 4;
        const beat = Math.floor(idx / stepsPerBeat);
        const sub = idx % stepsPerBeat;
        if (sub !== 0) return 0; // 反拍
        if (beat === 0) return 4; // 首拍
        if (beat === Math.floor(stepsPerBar / stepsPerBeat / 2)) return 3; // 半小节
        return 2; // 其它正拍
    }

    /**
     * 计算切分张力，归一化至 [0, 1]。
     *
     * 算法（Longuet-Higgins 1984）：
     *   对每个 grid[i] === 0 的位，回溯找最近的 grid[nPos] === 1（nPos < i）。
     *   若 weight(i) > weight(nPos)，意味着"音符发生在弱拍 nPos，而紧随其后的强拍 i 被空过"
     *   —— 这是切分的物理定义。累加 (weight(i) - weight(nPos)) 到 raw syncopation。
     *
     *   归一化：除以 numBars × maxSyncoPerBar，其中 maxSyncoPerBar = sum of positive
     *   weights in [1..stepsPerBar-1]（理论上限：每个潜在切分点都被完全偷走）。
     *   最终 clamp 至 [0, 1]，跨小节边界效应可能超过 1.0（whole-note 位被偷），clamp 即可。
     *
     * @param grid 0/1 网格（Int8Array 或 number[]），长度必须是 stepsPerBar 的整数倍
     * @param stepsPerBar 每小节 step 数（默认 16）
     * @returns 归一化张力值 ∈ [0, 1]；空网格 / 全静音 → 0
     */
    public static calculateSyncopation(
        grid: Int8Array | number[],
        stepsPerBar: number = 16,
    ): number {
        const L = grid.length;
        if (L === 0) return 0;

        // 没有任何发声 → 没有切分（不是 NaN，是 0）
        let hasAnyHit = false;
        for (let i = 0; i < L; i++) {
            if (grid[i] === 1) { hasAnyHit = true; break; }
        }
        if (!hasAnyHit) return 0;

        // 累加 raw syncopation
        let raw = 0;
        for (let i = 0; i < L; i++) {
            if (grid[i] !== 0) continue;
            // 回溯找最近的发声位
            let nPos = i - 1;
            while (nPos >= 0 && grid[nPos] === 0) nPos--;
            if (nPos < 0) continue;  // 该静音位之前没有发声 → 不是切分

            const wHere = SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
            const wPrev = SyncopationEvaluator.getMetricalWeight(nPos, stepsPerBar);
            const diff = wHere - wPrev;
            if (diff > 0) raw += diff;
        }

        // 归一化：每小节理论上限 = sum of weights at index 1..stepsPerBar-1（排除 step 0
        // 因为 step 0 自身被空过时无法被本算法捕获 — 无 prior note）
        let maxPerBar = 0;
        for (let i = 1; i < stepsPerBar; i++) {
            maxPerBar += SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
        }
        const numBars = L / stepsPerBar;
        const denom = maxPerBar * numBars;
        if (denom < EPSILON) return 0;

        const normalized = raw / denom;
        return normalized > 1 ? 1 : (normalized < 0 ? 0 : normalized);
    }
}

// ============================================================
// Error
// ============================================================

export class SyncopationEvaluatorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'SyncopationEvaluatorError';
        this.context = context;
    }
}
