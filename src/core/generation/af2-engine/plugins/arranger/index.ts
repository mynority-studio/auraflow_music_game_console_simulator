// ============================================================
// Arranger plugins — public API barrel + DEFAULT chain
// ============================================================

import { BorrowChordPlannerPlugin } from './BorrowChordPlannerPlugin';
import { PicardyPlannerPlugin } from './PicardyPlannerPlugin';
import { MinorBorrowPlannerPlugin } from './MinorBorrowPlannerPlugin';
import { TonicizationPlannerPlugin } from './TonicizationPlannerPlugin';
import type { ProgressionPlanner } from './types';

export {
    BorrowChordPlannerPlugin,
    PicardyPlannerPlugin,
    MinorBorrowPlannerPlugin,
    TonicizationPlannerPlugin,
};
export type {
    ProgressionPlanner,
    ProgressionPlannerMeta,
    ProgressionPlannerContext,
} from './types';

/**
 * Arranger ProgressionPlanner 默认链(顺序敏感,可拔可换):
 *   1. BorrowChordPlanner   — Modal interchange(给 Tonicize 看 borrow 后 target)
 *   2. PicardyPlanner       — Minor only(锁 lockType=true,优先于 MinorBorrow)
 *   3. MinorBorrowPlanner   — Minor only(parallel-major borrow,跳 Picardy 已锁)
 *   4. TonicizationPlanner  — 链末尾(看最终 skeleton 决定 ii-V 插入点)
 *
 * 改 plugin 顺序 / 加新 plugin / 禁某 plugin 全是改本数组一行。
 *
 * 各 plugin shouldApply 自决是否消费 PRNG fork stream:
 *   - 跳过的 plugin 不消耗任何 PRNG(skipped 流仍可被复用)
 *   - 仅 Minor 调 Picardy / MinorBorrow 触发;Major 调静默跳过
 */
export const DEFAULT_PROGRESSION_PLANNERS: ReadonlyArray<ProgressionPlanner> = [
    BorrowChordPlannerPlugin,
    PicardyPlannerPlugin,
    MinorBorrowPlannerPlugin,
    TonicizationPlannerPlugin,
];
