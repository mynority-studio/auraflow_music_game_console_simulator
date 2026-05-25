// ============================================================
// SparsityGate — per-slot deterministic 删音(persona.sparsityTendency)
// ============================================================
//
// 原 Af2MelodyGen 主循环内 `if (sparseH >= sparsity * 0.4) {...}` gate
// (2026-05-25 拆 plugin)。
//
// hash gate:`sparseH = ((sectionIdx*41 + chordIdxInSection*53 + slotIdx*67) & 0xff) / 255`
// 阈值:`sparseH >= sparsity * 0.4` → emit;低于阈值 → skip
//
// 注意:orchestrator 调用此 plugin 决定是否发声,但 prevPc / prevMidi /
// beatCursor 仍照常推进(空隙不影响后续 voice-leading / cycle)。
// ============================================================

import type { MelodyPluginMeta } from './types';

/** sparsity → 删音概率上限的系数(persona.sparsityTendency=1.0 时上限 40% 删音) */
const SPARSITY_GATE_FACTOR = 0.4;

export const SparsityGate: MelodyPluginMeta & {
    shouldEmit(
        sectionIdx: number,
        chordIdxInSection: number,
        slotIdx: number,
        sparsity: number,
    ): boolean;
} = {
    name: 'SparsityGate',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Per-slot deterministic 删音(高 sparsity 多空隙;上限 40%)',

    shouldEmit(sectionIdx, chordIdxInSection, slotIdx, sparsity) {
        const sparseH = ((sectionIdx * 41 + chordIdxInSection * 53 + slotIdx * 67) & 0xff) / 255;
        return sparseH >= sparsity * SPARSITY_GATE_FACTOR;
    },
};
