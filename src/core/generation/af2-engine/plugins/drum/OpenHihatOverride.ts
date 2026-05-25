// ============================================================
// OpenHihatOverride(V1 阶段)— 高能段 and-of-4 → Open Hihat 替代
// ============================================================
//
// 原 DrumIdiom.renderSection isHighEnergy && outHHit && stepIdx%stepsPerBar==14
// 分支(2026-05-25 拆 plugin)。
//
// 触发条件:isHighEnergy(energyLevel >= 7)+ hihat 命中 + 每 bar 第 14 step
//   (即 and-of-4,bar 内最后一个 8th-and 位置)
//
// 效果:outHPitch → Open Hihat(velocity × 1.1,上限 1.0)
//
// 优先级:独立 layer — 在 Break/Crash/Fill/Ride 之后跑,可与 Ride 叠加
// (orchestrator 在 if-else-if 之外单独 if 调用)。
//
// 听感:POP/RNB 副歌每 bar 末"ts-ts-ts-tssss"开镲点,过渡到 next bar。
// ============================================================

import type { DrumOverride, DrumHitState, DrumOverrideContext } from './types';

const DRUM_OPEN_HIHAT = 46;
const AND_OF_4_STEP = 14;
const OPEN_HIHAT_VEL_BOOST = 1.1;

export const OpenHihatOverride: DrumOverride = {
    name: 'OpenHihatOverride',
    version: 'v1.0 (V phase)',
    prngConsumption: 'zero',
    description: '高能段(>=7)+ hihat 命中 + bar 第 14 step(and-of-4)→ Open Hihat ×1.1 velocity',

    shouldApply(state, ctx) {
        return ctx.isHighEnergy
            && state.outHHit
            && (ctx.stepIdx % ctx.stepsPerBar) === AND_OF_4_STEP;
    },

    apply(state, _ctx) {
        return {
            ...state,
            outHPitch: DRUM_OPEN_HIHAT,
            outHVel: Math.min(1.0, state.outHVel * OPEN_HIHAT_VEL_BOOST),
        };
    },
};
