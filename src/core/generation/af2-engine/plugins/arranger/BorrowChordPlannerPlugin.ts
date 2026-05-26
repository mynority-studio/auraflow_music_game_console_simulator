// ============================================================
// BorrowChordPlannerPlugin — Modal Interchange wrapper
// ============================================================
//
// Wraps harmony/borrow-rules.ts(melodygenerative 完整 port:10 rule A1-G,
// 4 source Aeolian/Mixolydian/Phrygian/Dorian)to ProgressionPlanner protocol。
//
// 旧 af2-engine/BorrowChordPlanner.ts(7 rule POP-only 简化版)已删,本 plugin
// 与 ImproCore facade 共享 harmony/ 单源真理,改一处规则两边同步。
//
// POP-only 概率硬编(baseProb=0.45 / maxFires=3)— 沿用旧简化版语义。
// 后续若 ctx 加 mgStyle 字段可改 per-style 表。
//
// Af2AbstractStep ↔ BorrowChordInput 字段几乎全 superset,cast 透传,
// harmony 输出附加 analysisKeyPc 在 Af2AbstractStep 已有 optional 字段。
//
// PRNG 子流:`${seed}::borrow`(由 Facade fork)。
// ============================================================

import { planBorrowedChords, type BorrowChordInput } from '../../../harmony';
import type { ProgressionPlanner } from './types';
import type { Af2AbstractStep } from '../../Af2Arranger';

export const BorrowChordPlannerPlugin: ProgressionPlanner = {
    name: 'BorrowChordPlanner',
    version: 'v2.0 (harmony port)',
    prngConsumption: 'forked',
    description: 'Modal interchange via harmony/borrow-rules(10 rule A1-G × 4 source 锁定)',

    shouldApply(_ctx) {
        return true;  // harmony planner 内部 BLUES / modal home mode short-circuit
    },

    apply(skeleton, ctx) {
        const result = planBorrowedChords({
            skeleton: skeleton as BorrowChordInput[],
            baseProb: 0.45,        // POP default(STYLE_BORROW_PROB)
            maxFires: 3,           // POP default(STYLE_MAX_BORROWS_PER_SONG)
            motifInterval: ctx.motifInterval,
            random: ctx.borrowRng,
            beatsPerMeasure: ctx.beatsPerMeasure,
            mode: ctx.mode,
            borrowSource: ctx.borrowSource,
            isMinorKey: ctx.isMinor,
        });
        return result as Af2AbstractStep[];
    },
};
