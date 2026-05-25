// ============================================================
// CrashOverride(O 阶段)— 段首 + crash section / high energy
// ============================================================
//
// 原 DrumIdiom.renderSection isCrashStep 分支(2026-05-25 拆 plugin)。
//
// 触发条件:stepIdx === 0(段首)+ (isCrashSection OR isHighEnergy)
//   crash section:Chorus / Drop / Bridge / BuildUp(此处用语等同 audit 表)
//   isHighEnergy = section.energyLevel >= 7
//
// 效果:
//   hihat hit 强制 → Crash(velocity = velScale * 1.2,上限 1.0)
//   kick hit 强制 → true(velocity = velScale * 1.1,上限 1.0)
//   snare 不动(保 grid 原决策)
//
// 听感:段落起点的 emphasis — chorus/drop 必有 Crash 加 kick boom。
// 优先级:Break > Crash > Fill。
// ============================================================

import type { DrumOverride, DrumHitState, DrumOverrideContext } from './types';
import { DRUM_CRASH } from './constants';

export const CrashOverride: DrumOverride = {
    name: 'CrashOverride',
    version: 'v1.0 (O phase)',
    prngConsumption: 'zero',
    description: '段首 + crash section / high energy → Crash + kick 加强',

    shouldApply(_state, ctx) {
        return ctx.stepIdx === 0 && (ctx.isCrashSection || ctx.isHighEnergy);
    },

    apply(state, ctx) {
        return {
            ...state,
            outHHit: true,
            outHPitch: DRUM_CRASH,
            outHVel: Math.min(1.0, ctx.velScale * 1.2),
            outKHit: true,
            outKVel: Math.min(1.0, ctx.velScale * 1.1),
        };
    },
};
