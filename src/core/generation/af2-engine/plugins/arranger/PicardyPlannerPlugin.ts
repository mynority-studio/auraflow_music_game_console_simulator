// ============================================================
// PicardyPlannerPlugin — Minor phrase ending i→I lift wrapper
// ============================================================
//
// Wraps planPicardyEndings(K3 阶段 2026-05-24)to ProgressionPlanner protocol。
//
// Minor 调 phrase ending(cadence / ending 两 phraseRole)minor i → major I
// (Bach 经典手法)。Per-mgStyle prob:POP 0.30 / JAZZ 0.20 / RNB 0.25 / BLUES 0.10。
//
// 触发条件(shouldApply):isMinor === true && picardyRng !== undefined。
// Major 调直接跳过,picardyRng 未消费(prob short-circuit)。
//
// PRNG 子流:`${seed}::picardy`(由 Facade fork,Minor only)。
// ============================================================

import { planPicardyEndings } from '../../PicardyPlanner';
import type { ProgressionPlanner } from './types';

export const PicardyPlannerPlugin: ProgressionPlanner = {
    name: 'PicardyPlanner',
    version: 'v1.0 (K3 phase)',
    prngConsumption: 'forked',
    description: 'Minor 调 phrase ending i→I picardy 3rd lift(Bach 手法;Coldplay/Adele 用)',

    shouldApply(ctx) {
        return ctx.isMinor && ctx.picardyRng !== undefined;
    },

    apply(skeleton, ctx) {
        return planPicardyEndings({
            skeleton,
            motifInterval: ctx.motifInterval,
            random: ctx.picardyRng!,  // shouldApply 保证非空
        });
    },
};
