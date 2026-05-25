// ============================================================
// PassingToneSelector — chromatic passing tone gate + selector
// ============================================================
//
// 原 Af2MelodyGen.passingToneGate + pickBestPassingPc(2026-05-25 拆 plugin)。
//
// 两 method:
//   gate(...)  — deterministic hash 50% 概率触发(仅 slot duration < 1 beat 时)
//   pick(...)  — evaluator-driven 选 diatonic-aware 邻音(±1/±2 半音邻 4 候选)
//
// note-evaluator 打分:
//   - 最高 = diatonic ScaleTone(0.85 = 0.70 + 0.15 direction bias)
//   - 次高 = ChromaticPassing(0.65)
//   - 末尾 = Avoid 类非调音
// direction bias:候选 step 方向与 prev→next 一致时 +0.15 分,倾向"顺势"过渡。
// ============================================================

import type { GeneratedChord } from '../../../ir';
import { rankCandidatePcs } from '../../music-theory/note-evaluator';
import type { MelodyPluginMeta } from './types';

export const PassingToneSelector: MelodyPluginMeta & {
    /** Deterministic 50% gate;只在 slot duration < 1 beat 时由 orchestrator 调用 */
    gate(sectionIdx: number, chordIdxInSection: number, slotIdx: number): boolean;
    /** Evaluator-driven 选 diatonic-aware 邻音 */
    pick(
        prevPc: number,
        nextPc: number,
        chord: GeneratedChord,
        keyRootPc: number,
        isMinor: boolean,
    ): number;
} = {
    name: 'PassingToneSelector',
    version: '1.2',
    prngConsumption: 'zero',
    description: 'Chromatic passing tone hash gate(50%)+ evaluator-driven diatonic-aware 选音',

    gate(sectionIdx, chordIdxInSection, slotIdx) {
        const h = (sectionIdx * 13 + chordIdxInSection * 17 + slotIdx * 23) & 0xff;
        return (h % 100) < 50;
    },

    pick(prevPc, nextPc, chord, keyRootPc, isMinor) {
        if (((nextPc - prevPc + 12) % 12) === 0) return prevPc;
        const candidates = [
            (prevPc + 1) % 12,
            (prevPc - 1 + 12) % 12,
            (prevPc + 2) % 12,
            (prevPc - 2 + 12) % 12,
        ];
        const ranked = rankCandidatePcs(
            candidates, chord.root, chord.quality, keyRootPc, isMinor,
            { prevPc, nextPc },
        );
        return ranked[0].pc;
    },
};
