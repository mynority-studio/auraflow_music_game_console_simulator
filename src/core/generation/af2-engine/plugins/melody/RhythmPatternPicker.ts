// ============================================================
// RhythmPatternPicker — per-mgStyle rhythm 池 + persona 加权偏好
// ============================================================
//
// 原 Af2MelodyGen.pickRhythmPattern + RHYTHM_PATTERNS_BY_STYLE(2026-05-25 拆 plugin)。
//
// 每个池 4 个 pattern,index 语义跨风格一致:
//   idx 0 — 标准 baseline(直拍 / bebop 8th / 16th sync / shuffle)
//   idx 1 — 留白型(2 halfs)            ← persona.sparsityTendency 偏好
//   idx 2 — Dotted / anticipation       ← persona.syncopationAssault 偏好(h 偶数)
//   idx 3 — Sync / pocket               ← persona.syncopationAssault 偏好(h 奇数)
//
// QUANTIZED_DURATIONS 合法值:0.125 / 0.25 / 0.375 / 0.5 / 0.75 / 1.0
// sum 必须 = 1.0(占 chord 比例)
//
// POP   直拍 / dotted 经典      — radio 听感
// JAZZ  bebop 8th + comping 长留白 + anticipation — 摇摆律动
// RNB   16th syncopate / Dilla pocket / rest+flurry — neo-soul 神经质
// BLUES shuffle / call-response — 12-bar 律动
//
// 实现:基础 hash 抽 base index,再按 persona 概率"跳"到偏好 index。
// mgStyle 选哪个池;未传时走 POP fallback(orchestrator 默认 'POP')。
// ============================================================

import type { MgStyle } from '../../../../../state/EngineSelectionStore';
import type { MelodyPluginMeta } from './types';

const RHYTHM_PATTERNS_BY_STYLE: Record<MgStyle, ReadonlyArray<ReadonlyArray<number>>> = {
    POP: [
        Object.freeze([0.25, 0.25, 0.25, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.375, 0.125, 0.5]),
        Object.freeze([0.25, 0.125, 0.125, 0.5]),
    ],
    JAZZ: [
        Object.freeze([0.125, 0.125, 0.25, 0.125, 0.125, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.75, 0.25]),
        Object.freeze([0.125, 0.125, 0.25, 0.5]),
    ],
    RNB: [
        Object.freeze([0.125, 0.125, 0.25, 0.125, 0.125, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.375, 0.125, 0.25, 0.25]),
        Object.freeze([0.25, 0.125, 0.125, 0.5]),
    ],
    BLUES: [
        Object.freeze([0.375, 0.125, 0.375, 0.125]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.75, 0.25]),
        Object.freeze([0.25, 0.25, 0.5]),
    ],
};

export const RhythmPatternPicker: MelodyPluginMeta & {
    pick(
        sectionIdx: number,
        chordIdxInSection: number,
        mgStyle: MgStyle,
        sparsity?: number,
        syncopation?: number,
    ): ReadonlyArray<number>;
} = {
    name: 'RhythmPatternPicker',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Per-mgStyle rhythm pattern 池(4 个 / style)+ persona sparsity/syncopation 加权偏好',

    pick(sectionIdx, chordIdxInSection, mgStyle, sparsity = 0, syncopation = 0) {
        const pool = RHYTHM_PATTERNS_BY_STYLE[mgStyle];
        const h = (sectionIdx * 7 + chordIdxInSection * 11) & 0xff;
        let idx = h % pool.length;
        const h2 = (h * 31 + 17) & 0xff;
        const p2 = h2 / 255;
        if (p2 < sparsity * 0.7) idx = 1;                                        // → Half
        else if (p2 < sparsity * 0.7 + syncopation * 0.7) idx = (h % 2 ? 3 : 2);  // → Sync / Dotted
        return pool[idx];
    },
};
