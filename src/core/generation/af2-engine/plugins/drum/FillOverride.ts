// ============================================================
// FillOverride(O + Z2 阶段)— section transition 末 1 bar fill
// ============================================================
//
// 原 DrumIdiom.renderSection isFillBar 分支(2026-05-25 拆 plugin)。
//
// 触发条件:isSectionTransition + 末 1 bar(totalSteps - stepIdx <= stepsPerBar)
//   且不在 Break step 内(BreakOverride 优先级更高,本 plugin 由 orchestrator
//   在 if-else 链中保证不冲突)。
//
// Per-mgStyle FILL_STYLES_BY_STYLE pool(per-section startBeat hash 选,0 PRNG):
//   POP   ['tom', 'snare_roll']
//   JAZZ  ['ride_drift', 'snare_roll']
//   BLUES ['shuffle_fill', 'snare_roll']
//   RNB   ['ghost_flam', 'snare_roll']
//
// 5 fill style:
//   tom         — POP Tom 阶梯(snare → tom-hi/mid/lo)
//   snare_roll  — 纯 Snare 16th roll velocity 渐升(POP 通用)
//   ride_drift  — Ride 渐升 + bar 末 Crash(JAZZ idiom)
//   shuffle_fill — snare/kick 交替 shuffle pattern(BLUES idiom)
//   ghost_flam   — 主拍 snare + 16th ghost snare + kick(RNB idiom)
// ============================================================

import type { MgStyle } from '../../../../../state/EngineSelectionStore';
import type { DrumOverride, DrumHitState, DrumOverrideContext, FillStyle } from './types';
import { DRUM_TOM_HI, DRUM_TOM_MID, DRUM_TOM_LO, DRUM_CRASH, DRUM_RIDE } from './constants';

export const FILL_STYLES_BY_STYLE: Record<MgStyle, ReadonlyArray<FillStyle>> = {
    POP:   ['tom', 'snare_roll'],
    JAZZ:  ['ride_drift', 'snare_roll'],
    BLUES: ['shuffle_fill', 'snare_roll'],
    RNB:   ['ghost_flam', 'snare_roll'],
};

/** Per-section deterministic fill style 选(orchestrator 调用一次,传给 ctx) */
export function pickFillStyle(mgStyle: MgStyle, sectionStartBeat: number): FillStyle {
    const pool = FILL_STYLES_BY_STYLE[mgStyle] ?? ['tom', 'snare_roll'];
    return pool[Math.floor(sectionStartBeat) % pool.length];
}

export const FillOverride: DrumOverride = {
    name: 'FillOverride',
    version: 'v1.1 (O + Z2)',
    prngConsumption: 'zero',
    description: 'Section transition 末 1 bar fill(5 fill style per-mgStyle)',

    shouldApply(_state, ctx) {
        return ctx.isSectionTransition && (ctx.totalSteps - ctx.stepIdx <= ctx.stepsPerBar);
    },

    apply(state, ctx) {
        const fillProgression = 1 - (ctx.totalSteps - ctx.stepIdx) / ctx.stepsPerBar;
        const subBeat = ctx.stepIdx % ctx.stepsPerBeat;
        const stepInBar = ctx.stepIdx % ctx.stepsPerBar;
        let { outKPitch, outKHit, outKVel, outSPitch, outSHit, outSVel, outHPitch, outHHit, outHVel } = state;

        if (ctx.fillStyle === 'tom') {
            outHHit = false;
            outSHit = true;
            outSVel = 0.5 + 0.5 * fillProgression;
            if (subBeat === 3) outSPitch = DRUM_TOM_HI;
            else if (subBeat === 2 && fillProgression > 0.5) outSPitch = DRUM_TOM_MID;
            else if (subBeat === 1 && fillProgression > 0.8) outSPitch = DRUM_TOM_LO;
        } else if (ctx.fillStyle === 'snare_roll') {
            outHHit = false;
            outSHit = true;
            outSVel = 0.5 + 0.5 * fillProgression;
        } else if (ctx.fillStyle === 'ride_drift') {
            outSHit = false;
            outHHit = true;
            outHPitch = DRUM_RIDE;
            outHVel = 0.5 + 0.4 * fillProgression;
            if (stepInBar >= ctx.stepsPerBar - 2) {
                outHPitch = DRUM_CRASH;
                outHVel = Math.min(1.0, ctx.velScale * 1.1);
                outKHit = true;
                outKVel = Math.min(1.0, ctx.velScale * 1.0);
            }
        } else if (ctx.fillStyle === 'shuffle_fill') {
            outHHit = false;
            if (subBeat === 0 || subBeat === 2) {
                outSHit = true;
                outSVel = 0.55 + 0.35 * fillProgression;
            } else {
                outSHit = false;
                outKHit = true;
                outKVel = 0.45 + 0.35 * fillProgression;
            }
        } else if (ctx.fillStyle === 'ghost_flam') {
            outHHit = false;
            outSHit = true;
            if (subBeat === 0) {
                outSVel = 0.6 + 0.3 * fillProgression;
            } else {
                outSVel = 0.25 + 0.15 * fillProgression;
            }
            if (subBeat === 0) {
                outKHit = true;
                outKVel = 0.7 + 0.2 * fillProgression;
            }
        }

        return {
            outKPitch, outKHit, outKVel,
            outSPitch, outSHit, outSVel,
            outHPitch, outHHit, outHVel,
        };
    },
};
