// ============================================================
// TonicizationPlannerPlugin — secondary ii-V wrapper
// ============================================================
//
// Wraps harmony/tonicization-rules.ts(melodygenerative 完整 port:4 placement
// × V_TYPE_BY_SOURCE_TARGET / II_TYPE_BY_SOURCE_TARGET 表 × repeated-target
// cooldown × Mixolydian/Phrygian Dominant scale 切换)to ProgressionPlanner。
//
// 旧 af2-engine/TonicizationPlanner.ts(固定 VType='7b9' 简化版)已删,
// 与 ImproCore facade 共享 harmony/ 单源真理。
//
// 4 placement 同 melodygenerative:
//   light       curr bar → V/X
//   approach    curr 半 + V/X 半
//   iiv_split   ii/X 半 + V/X 半
//   full_2bar   prev→ii/X, curr→V/X
//
// POP-only style 硬编 — 沿用旧简化版语义(harmony 内 STYLE_TONICIZE_PROB /
// STYLE_TONICIZE_MAX_PER_SONG / STYLE_PLACEMENT_WEIGHTS 完整表;'POP' 取
// 0.30 / 2 / 4-way placement)。后续 ctx 加 mgStyle 可走 per-style。
//
// 顺序:链末尾 — 看 Borrow + Picardy + MinorBorrow 完成后的最终 skeleton。
//
// PRNG 子流:`${seed}::tonicize`(由 Facade fork)。
// ============================================================

import { planTonicization, type TonicizationChordInput } from '../../../harmony';
import type { ProgressionPlanner } from './types';
import type { Af2AbstractStep } from '../../Af2Arranger';

export const TonicizationPlannerPlugin: ProgressionPlanner = {
    name: 'TonicizationPlanner',
    version: 'v2.0 (harmony port)',
    prngConsumption: 'forked',
    description: 'Tonicization via harmony/tonicization-rules(4 placement × V_TYPE 表)',

    shouldApply(_ctx) {
        return true;
    },

    apply(skeleton, ctx) {
        const result = planTonicization({
            skeleton: skeleton as TonicizationChordInput[],
            style: 'POP',           // POP default(sync with ImproCore facade)
            motifInterval: ctx.motifInterval,
            random: ctx.tonicizeRng,
            beatsPerMeasure: ctx.beatsPerMeasure,
            songKeyRootPc: ctx.songKeyRootPc,
            borrowSource: ctx.borrowSource,
        });
        return result as Af2AbstractStep[];
    },
};
