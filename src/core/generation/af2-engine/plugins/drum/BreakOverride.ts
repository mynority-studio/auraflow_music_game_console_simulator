// ============================================================
// BreakOverride(V2 阶段)— BuildUp→Drop transition 末 1/4 bar 静音
// ============================================================
//
// 原 DrumIdiom.renderSection isBreakStep 分支(2026-05-25 拆 plugin)。
//
// 触发条件:next section 是 SectionType.Drop + 当前 section 末 1/4 bar
//   (totalSteps - stepIdx <= floor(stepsPerBar / 4))
//
// 效果:全 3 hit(kick / snare / hihat)→ false
//
// 听感:Drop 起点的 Crash 冲击最大化 — silence 后击鼓 = "炸开"感。
// 优先级:Break > Crash > Fill(orchestrator if-else-if 链中最高)。
// ============================================================

import type { DrumOverride, DrumHitState, DrumOverrideContext } from './types';

export const BreakOverride: DrumOverride = {
    name: 'BreakOverride',
    version: 'v2.0',
    prngConsumption: 'zero',
    description: 'BuildUp→Drop transition 末 1/4 bar 全静音(让 Drop 起点 Crash 冲击最大化)',

    shouldApply(_state, ctx) {
        return ctx.nextIsDrop && (ctx.totalSteps - ctx.stepIdx <= Math.floor(ctx.stepsPerBar / 4));
    },

    apply(state, _ctx) {
        return {
            ...state,
            outKHit: false,
            outSHit: false,
            outHHit: false,
        };
    },
};
