// ============================================================
// Arranger ProgressionPlanner Protocol — layer-local convention
// ============================================================
//
// Af2Arranger 的 core = per-section 抽进行 + 拼接成 skeleton。
// L+K3+K4+L 阶段 4 Planner 是显式 plugin chain(2026-05-25 framework 化,
// 原已事实上是链,但散落在 Arranger orchestrator 内 if-else 块)。
//
// 链顺序(顺序敏感):
//   1. BorrowChordPlanner   — Modal interchange(7 rule × 3 source 锁定)
//   2. PicardyPlanner       — Minor only: phrase ending i→I picardy 3rd
//   3. MinorBorrowPlanner   — Minor only: iv→IV / bVI→VI(parallel-major borrow)
//   4. TonicizationPlanner  — Tonicization(4 placement × target mult × cooldown)
//
// 顺序原因:
//   - Borrow 先(给 Tonicize 看 borrow 输出决定是否 approach borrowed target)
//   - Picardy 早于 MinorBorrow(Picardy 锁 lockType=true 的 ending 不被 MinorBorrow
//     再次处理)
//   - Tonicize 最后(基于前 3 步的最终 skeleton 决定 secondary ii-V 插入点)
//
// PRNG:每 plugin 'forked'(各 planner 用 ${seed}::borrow / picardy / minor-borrow
// / tonicize 独立 sub-stream),不污染主流。拔某 plugin 不影响其他 plugin 的 PRNG。
// ============================================================

import type { Random } from '../../utils/Random';
import type { Af2AbstractStep } from '../../Af2Arranger';
import type { BorrowSource } from '../../BorrowChordPlanner';

export interface ProgressionPlannerMeta {
    readonly name: string;
    readonly version: string;
    /** Arranger 层 plugin 用 'forked'(独立 sub-stream,不污染主 PRNG) */
    readonly prngConsumption: 'forked';
    readonly description: string;
}

/**
 * Per-song plugin chain 共享上下文。各 plugin 按需消费字段:
 *   BorrowChord  → borrowRng / borrowSource / mode / motifInterval / beatsPerMeasure / style
 *   Picardy      → picardyRng / motifInterval / style(仅 Minor)
 *   MinorBorrow  → minorBorrowRng / motifInterval / style(仅 Minor)
 *   Tonicize     → tonicizeRng / songKeyRootPc / beatsPerMeasure / motifInterval / style
 */
export interface ProgressionPlannerContext {
    readonly motifInterval: number;
    readonly beatsPerMeasure: number;
    readonly songKeyRootPc: number;
    readonly mode: string;
    readonly isMinor: boolean;
    readonly borrowSource: BorrowSource;
    readonly borrowRng: Random;
    readonly tonicizeRng: Random;
    readonly picardyRng?: Random;
    readonly minorBorrowRng?: Random;
}

export interface ProgressionPlanner extends ProgressionPlannerMeta {
    /** 是否触发此 plugin(false → orchestrator 跳过,不消耗 plugin 自己的 PRNG)*/
    shouldApply(ctx: ProgressionPlannerContext): boolean;
    /** 返回新 skeleton 数组 */
    apply(skeleton: Af2AbstractStep[], ctx: ProgressionPlannerContext): Af2AbstractStep[];
}
