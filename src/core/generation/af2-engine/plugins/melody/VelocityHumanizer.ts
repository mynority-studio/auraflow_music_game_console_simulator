// ============================================================
// VelocityHumanizer — per-slot deterministic velocity 浮动
// ============================================================
//
// 原 Af2MelodyGen 主循环内 velH 计算 + jitter 公式(2026-05-25 拆 plugin)。
//
// hash:`velH = ((sectionIdx*19 + chordIdxInSection*23 + slotIdx*29) & 0xff) / 255`
// 公式:`vel = velocityBase + (velH - 0.5) * (dynamicHi - dynamicLo) * 0.5`
// 范围 clamp 到 [0.1, 1.0]
//
// 注:PhraseEndingDecider 有自己专用的 velocity 计算(不带 slotIdx + 系数 0.3),
// 与本 plugin 隔离。
// ============================================================

import { clampVelocity } from '../../utils/velocity';
import type { MelodyPluginMeta } from './types';

/** 常规 slot velocity jitter 系数(dynamicRange 内 ±50%) */
const SLOT_JITTER_FACTOR = 0.5;

export const VelocityHumanizer: MelodyPluginMeta & {
    compute(
        sectionIdx: number,
        chordIdxInSection: number,
        slotIdx: number,
        velocityBase: number,
        dynamicLo: number,
        dynamicHi: number,
    ): number;
} = {
    name: 'VelocityHumanizer',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Per-slot deterministic velocity 浮动(dynamicRange 内 ±50%,clamp [0.1, 1])',

    compute(sectionIdx, chordIdxInSection, slotIdx, velocityBase, dynamicLo, dynamicHi) {
        const velH = ((sectionIdx * 19 + chordIdxInSection * 23 + slotIdx * 29) & 0xff) / 255;
        const vel = velocityBase + (velH - 0.5) * (dynamicHi - dynamicLo) * SLOT_JITTER_FACTOR;
        return clampVelocity(vel);
    },
};
