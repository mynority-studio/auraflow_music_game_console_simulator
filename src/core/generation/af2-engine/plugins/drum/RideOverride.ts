// ============================================================
// RideOverride — very high energy + 偶数 step + hihat 命中 → Ride 替代
// ============================================================
//
// 原 DrumIdiom.renderSection isVeryHigh && outHHit && stepIdx % 2 === 0 分支
// (2026-05-25 拆 plugin)。
//
// 触发条件:isVeryHigh(section.energyLevel >= 8)+ stepIdx 偶数 + hihat 命中
//
// 效果:outHPitch → Ride(velocity 不变)
//
// 优先级:仅在 Break/Crash/Fill 都未触发时跑(orchestrator if-else-if 链
// 最后一档)。
// ============================================================

import type { DrumOverride, DrumHitState, DrumOverrideContext } from './types';

const DRUM_RIDE = 51;

export const RideOverride: DrumOverride = {
    name: 'RideOverride',
    version: 'v1.0',
    prngConsumption: 'zero',
    description: 'Very high energy(>=8)+ 偶数 step + hihat 命中 → Ride 替代',

    shouldApply(state, ctx) {
        return ctx.isVeryHigh && state.outHHit && (ctx.stepIdx % 2 === 0);
    },

    apply(state, _ctx) {
        return {
            ...state,
            outHPitch: DRUM_RIDE,
        };
    },
};
