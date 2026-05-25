// ============================================================
// BorrowChordPlannerPlugin — Modal Interchange wrapper
// ============================================================
//
// Wraps planBorrowedChords(L 阶段 2026-05-24)to ProgressionPlanner protocol。
//
// 7 rule × 3 source(Aeolian 80% / Mixolydian 12% / Phrygian 8%)锁定 + 5 防呆。
// Per-mgStyle 概率 + 上限:POP 0.45/3 / JAZZ 0.35/4 / RNB 0.55/5 / BLUES 0/0。
//
// Minor 调 short-circuit(MODAL_HOME_MODES skip)— planner 自己处理,本 plugin
// 总是 shouldApply=true(让 planner 内部 gate 自主决策)。
//
// PRNG 子流:`${seed}::borrow`(由 Facade fork)。
// ============================================================

import { planBorrowedChords } from '../../BorrowChordPlanner';
import type { ProgressionPlanner } from './types';

export const BorrowChordPlannerPlugin: ProgressionPlanner = {
    name: 'BorrowChordPlanner',
    version: 'v1.0 (L phase)',
    prngConsumption: 'forked',
    description: 'Modal interchange via positional rules(7 rule × 3 source 锁定 × 5 防呆)',

    shouldApply(_ctx) {
        return true;  // planner 内部 BLUES / Minor short-circuit 自主处理
    },

    apply(skeleton, ctx) {
        return planBorrowedChords({
            skeleton,
            motifInterval: ctx.motifInterval,
            random: ctx.borrowRng,
            beatsPerMeasure: ctx.beatsPerMeasure,
            mode: ctx.mode,
            borrowSource: ctx.borrowSource,
        });
    },
};
