// ============================================================
// TonicizationPlannerPlugin — secondary ii-V wrapper
// ============================================================
//
// Wraps planTonicization(L 阶段 2026-05-24)to ProgressionPlanner protocol。
//
// 4 placement × per-target mult × chain cooldown:
//   light       curr bar → V/X            (POP 0.45)
//   approach    curr 半 + V/X 半         (POP 0.35)
//   iiv_split   ii/X 半 + V/X 半         (JAZZ 0.45)
//   full_2bar   prev→ii/X, curr→V/X      (JAZZ 0.30)
//
// Per-mgStyle prob:POP 0.30 / JAZZ 0.65 / RNB 0.40 / BLUES 0。
// Per-song 上限:POP 2 / JAZZ 4 / RNB 3 / BLUES 0。
//
// Minor-aware:Phrygian Dominant(minor target)/ Mixolydian(major target)
// scale 切换 + m7b5 / 7b9 chord type 选择(planner 内自处理)。
//
// 顺序:链末尾 — 基于 Borrow + Picardy + MinorBorrow 完成后的最终 skeleton
// 决定 secondary ii-V 插入点(包括 approach borrowed mediant 的能力)。
//
// PRNG 子流:`${seed}::tonicize`(由 Facade fork)。
// ============================================================

import { planTonicization } from '../../TonicizationPlanner';
import type { ProgressionPlanner } from './types';

export const TonicizationPlannerPlugin: ProgressionPlanner = {
    name: 'TonicizationPlanner',
    version: 'v1.0 (L phase)',
    prngConsumption: 'forked',
    description: 'Tonicization 4 placement × target mult × chain cooldown(secondary ii-V)',

    shouldApply(_ctx) {
        return true;  // BLUES 0 prob,planner 内部自处理
    },

    apply(skeleton, ctx) {
        return planTonicization({
            skeleton,
            motifInterval: ctx.motifInterval,
            random: ctx.tonicizeRng,
            beatsPerMeasure: ctx.beatsPerMeasure,
            songKeyRootPc: ctx.songKeyRootPc,
        });
    },
};
