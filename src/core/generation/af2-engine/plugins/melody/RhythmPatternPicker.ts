// ============================================================
// RhythmPatternPicker — POP-only rhythm 池 + persona 加权偏好
// ============================================================
//
// 4 个 pattern,index 语义:
//   idx 0 — 标准 baseline(直拍)
//   idx 1 — 留白型(2 halfs)            ← persona.sparsityTendency 偏好
//   idx 2 — Dotted / anticipation       ← persona.syncopationAssault 偏好(h 偶数)
//   idx 3 — Sync / pocket               ← persona.syncopationAssault 偏好(h 奇数)
//
// QUANTIZED_DURATIONS 合法值:0.125 / 0.25 / 0.375 / 0.5 / 0.75 / 1.0
// sum 必须 = 1.0(占 chord 比例)
//
// JAZZ / BLUES / RNB rhythm 池已退役。
// ============================================================

import { hashApplyPersonaPass } from '../../utils/hash-utils';
import type { MelodyPluginMeta } from './types';

const RHYTHM_PATTERNS_POP: ReadonlyArray<ReadonlyArray<number>> = [
    Object.freeze([0.25, 0.25, 0.25, 0.25]),
    Object.freeze([0.5, 0.5]),
    Object.freeze([0.375, 0.125, 0.5]),
    Object.freeze([0.25, 0.125, 0.125, 0.5]),
];

export const RhythmPatternPicker: MelodyPluginMeta & {
    pick(
        sectionIdx: number,
        chordIdxInSection: number,
        sparsity?: number,
        syncopation?: number,
    ): ReadonlyArray<number>;
} = {
    name: 'RhythmPatternPicker',
    version: '1.1 (POP-only)',
    prngConsumption: 'zero',
    description: 'POP rhythm pattern 池(4 个)+ persona sparsity/syncopation 加权偏好',

    pick(sectionIdx, chordIdxInSection, sparsity = 0, syncopation = 0) {
        const pool = RHYTHM_PATTERNS_POP;
        const h = (sectionIdx * 7 + chordIdxInSection * 11) & 0xff;
        let idx = h % pool.length;
        const p2 = hashApplyPersonaPass(h);
        if (p2 < sparsity * 0.7) idx = 1;                                        // → Half
        else if (p2 < sparsity * 0.7 + syncopation * 0.7) idx = (h % 2 ? 3 : 2);  // → Sync / Dotted
        return pool[idx];
    },
};
