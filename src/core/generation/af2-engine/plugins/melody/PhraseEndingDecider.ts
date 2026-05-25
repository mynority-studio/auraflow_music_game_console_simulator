// ============================================================
// PhraseEndingDecider — section 末 chord 改写为"短 pickup + 长 tonic 收音"
// ============================================================
//
// 原 Af2MelodyGen 主循环内 `if (progress >= 0.95) {...}` 分支(2026-05-25 拆 plugin)。
//
// 触发:chord 是 section 最后一个(progress >= 0.95)
// 行为:emit 单个长音:
//   pitch  = root,anchor 偏低 -2(回归感)
//   onset  = chord.startBeat + chordBeats * 0.15(短 pickup 间隔)
//   dur    = chordBeats * 0.80(长收音)
//   vel    = velocityBase + jitter(范围 ±0.3 × dynamicSpan,比常规 slot 收紧)
//
// Velocity hash 不消费 slotIdx(只 sectionIdx + chordIdxInSection),与
// 主循环每 slot 的 hash 隔离 — orchestrator 调用后跳过本 chord 余下逻辑。
// ============================================================

import type { GeneratedChord, NoteData } from '../../../ir';
import { placeNearAnchor } from '../../utils/voice-leading';
import type { MelodyPluginMeta } from './types';

/** Phrase ending velocity jitter 系数(比常规 slot 的 0.5 收紧) */
const ENDING_JITTER_FACTOR = 0.3;
/** Phrase ending anchor 偏移(相对 melody 区中点,负值 = 回归低) */
const ENDING_ANCHOR_OFFSET = -2;

export const PhraseEndingDecider: MelodyPluginMeta & {
    /** 是否触发 phrase ending(orchestrator 用此值短路本 chord 主循环) */
    shouldApply(progress: number): boolean;
    /** 生成 phrase ending 单长音 */
    generate(
        chord: GeneratedChord,
        melodyLo: number,
        melodyHi: number,
        sectionIdx: number,
        chordIdxInSection: number,
        velocityBase: number,
        dynamicLo: number,
        dynamicHi: number,
    ): NoteData;
} = {
    name: 'PhraseEndingDecider',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Section 末 chord(progress >= 0.95)改写为短 pickup + 长 tonic 收音',

    shouldApply(progress) {
        return progress >= 0.95;
    },

    generate(chord, melodyLo, melodyHi, sectionIdx, chordIdxInSection, velocityBase, dynamicLo, dynamicHi) {
        const chordBeats = chord.endBeat - chord.startBeat;
        const targetPc = chord.root;
        const endingAnchor = Math.floor((melodyLo + melodyHi) / 2) + ENDING_ANCHOR_OFFSET;
        const midi = placeNearAnchor(targetPc, endingAnchor, melodyLo, melodyHi);
        const velH = ((sectionIdx * 19 + chordIdxInSection * 23) & 0xff) / 255;
        const vel = velocityBase + (velH - 0.5) * (dynamicHi - dynamicLo) * ENDING_JITTER_FACTOR;
        return {
            pitch: midi,
            onset: chord.startBeat + chordBeats * 0.15,
            duration: chordBeats * 0.80,
            velocity: Math.max(0.1, Math.min(1, vel)),
        };
    },
};
