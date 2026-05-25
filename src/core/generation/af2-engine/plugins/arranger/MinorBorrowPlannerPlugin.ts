// ============================================================
// MinorBorrowPlannerPlugin — Minor 调 parallel-major borrow wrapper
// ============================================================
//
// Wraps planMinorBorrows(K4 阶段 2026-05-24)to ProgressionPlanner protocol。
//
// Minor 调非 ending 位置的 borrow:
//   M2:iv → IV(Dorian-flavor borrow)— Beatles / Pink Floyd / Radiohead idiom
//   M3:bVI → VI(chromatic mediant)— Coldplay / U2 verse-to-chorus 桥
//
// Per-mgStyle prob:POP 0.20+0.10 / JAZZ 0.30+0.20 / RNB 0.25+0.15 / BLUES 0+0。
// Per-song 上限:POP 2 / JAZZ 3 / RNB 3 / BLUES 0。
//
// 触发条件(shouldApply):isMinor === true && minorBorrowRng !== undefined。
//
// 顺序:在 Picardy 之后跑 — Picardy 锁的 lockType=true ending 被本 plugin 跳过
// (5 防呆之 lockType skip),不冲突。
//
// PRNG 子流:`${seed}::minor-borrow`(由 Facade fork,Minor only)。
// ============================================================

import { planMinorBorrows } from '../../MinorBorrowPlanner';
import type { ProgressionPlanner } from './types';

export const MinorBorrowPlannerPlugin: ProgressionPlanner = {
    name: 'MinorBorrowPlanner',
    version: 'v1.0 (K4 phase)',
    prngConsumption: 'forked',
    description: 'Minor 调 parallel-major borrow(iv→IV Dorian / bVI→VI chromatic mediant)',

    shouldApply(ctx) {
        return ctx.isMinor && ctx.minorBorrowRng !== undefined;
    },

    apply(skeleton, ctx) {
        return planMinorBorrows({
            skeleton,
            style: ctx.style,
            motifInterval: ctx.motifInterval,
            random: ctx.minorBorrowRng!,  // shouldApply 保证非空
        });
    },
};
