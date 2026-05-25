// ============================================================
// MargulisExpectancyShaper — 旋律期待感模型(Margulis 2005)
// ============================================================
//
// Phase 3 of Impro-Visor 移植(2026-05-25)。
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/lickgen/Expectancy.java`
// 论文:Margulis, E. H. (2005). A Model of Melodic Expectation. Music Perception.
//
// 核心公式(per candidate pitch):
//
//   E(pitch | prev, prevPrev, chord) =
//        stability(pitch, chord)
//      × proximity(pitch, prev)
//      × mobility(pitch, prev)
//      + direction(pitch, prev, prevPrev)
//
// 各项:
//   stability(p, c) ∈ {6 root / 5 chord tone / 4 color / 1 outside / 0 avoid}
//     - chord vocab 决定。root 最稳,color 中等,outside 不稳,avoid 0 分。
//   proximity(p, prev) = inverse-log table by interval semitones
//     - 距离 0 半音 = 24,距离 1 = 36(最高,期待 stepwise),5+ 半音骤降。
//   mobility(p, prev) = 0.67 if pitch == prev else 1.0
//     - 重复音"mobility 下降"(没动 = 期待打折)。
//   direction(p, prev, prevPrev)
//     - 小跳后(interval ≤ 4):倾向继续同方向 → 同方向 +value(6/20/12/6)
//     - 大跳后(interval > 4):倾向反向回收 → 反方向 +value(6/12/25/36/52/75)
//
// 关键洞察:
//   - 这是认知科学验证的模型 — 给 melody 加"听起来有期待感"的层
//   - 越高的 score = 听众心智预期越强烈的候选 pitch
//   - 用于在 placeNearAnchor 给的 nearest-octave 之外评估替代 octave 候选,
//     选 expectancy 分最高的(对于"想给听众心理预期顺势"场景效果好)
//
// AF2 集成现状(Phase 3 v0.1):
//   - 函数 expectancyScore() 独立可调用 — 任何 melody plugin 可消费
//   - Af2MelodyGen 主循环在 placeNearAnchor 后,可选启用 octave-rerank
//     (取 [midi-12, midi, midi+12] 三 octave 候选,按 expectancy score argmax)
//   - 默认 OFF(per-mgStyle gate 全 false),phase 完成后 review 听感再启
//
// PRNG 协议:'zero' — 纯打分,不消耗
// ============================================================

import type { GeneratedChord } from '../../../ir';
import { ChordQuality, ChordQualityName } from '../../../types';
import { getChordVocab, stability } from '../../music-theory/chord-vocab';
import type { MelodyPluginMeta } from './types';

// ------------------------------------------------------------------
// Margulis 表(直接来自 Impro-Visor Expectancy.java / 论文 §3-§5)
// ------------------------------------------------------------------

/** proximity[d] = 距离 d 半音时的 proximity score。d ∈ [0, 14],14+ → 0.01 */
const PROXIMITY_TABLE: readonly number[] = [
  24,   // 0 半音(同 pitch)
  36,   // 1 半音(stepwise — 最强期待)
  32,   // 2 半音
  25,   // 3 半音
  20,   // 4 半音
  14,   // 5 半音
  10,   // 6 半音
  6,    // 7 半音
  4,    // 8 半音
  2,    // 9 半音
  1,    // 10 半音
  0.5,  // 11 半音
  0.25, // 12 半音(octave)
  0.01, // 13+ 半音
];

/** direction(continue)— 小跳(interval ≤ 4)后倾向继续同方向。index = interval */
const DIRECTION_TABLE_SMALL: readonly number[] = [
  6,    // interval 0
  20,   // interval 1(最强期待继续)
  12,   // interval 2
  6,    // interval 3
  0,    // interval 4(border:不再期待继续)
];

/** direction(reverse)— 大跳(interval > 4)后倾向反向回收。index = interval - 5 */
const DIRECTION_TABLE_LARGE: readonly number[] = [
  6,    // interval 5
  12,   // interval 6
  25,   // interval 7
  36,   // interval 8
  52,   // interval 9
  75,   // interval 10+(强期待反向)
];

const MOBILITY_REPEAT = 0.67;
const MOBILITY_NORMAL = 1.0;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** 把 ChordQuality enum 映射到 CHORD_VOCAB key */
function qualityToVocabKey(q: ChordQuality): string {
  const name = ChordQualityName[q] ?? 'Major';
  const aliases: Record<string, string> = {
    'Major': 'maj',
    'Minor': 'min',
    'Diminished': 'dim',
    'Augmented': 'aug',
    'Major7': 'maj7',
    'Minor7': 'm7',
    'Dominant7': 'dom7',
    'HalfDiminished': 'm7b5',
    'Diminished7': 'dim7',
    'Sus4': 'sus4',
    'Dominant7Sus4': '7sus4',
    'Add9': 'add9',
    'Minor9': 'm9',
    'Major9': 'maj9',
    'Dominant9': '9',
    'Minor11': 'm11',
    'Dominant13': '13',
    'Major13': 'maj13',
    'Major7Sharp11': 'maj7#11',
    'Dom7Flat9': '7b9',
    'Dom7Sharp9': '7#9',
    'Dom7Sharp11': '7#11',
    'Dom7Flat13': '7b13',
    'Dom7Alt': '7alt',
    'Dominant11': '11',
  };
  return aliases[name] ?? 'maj';
}

function proximityFor(distance: number): number {
  const d = Math.min(Math.abs(distance), PROXIMITY_TABLE.length - 1);
  return PROXIMITY_TABLE[d]!;
}

function directionFor(pitch: number, prev: number, prevPrev: number): number {
  if (prev === prevPrev) return 0; // 无方向参考
  const prevInterval = Math.abs(prev - prevPrev);
  const prevDir = Math.sign(prev - prevPrev);
  const currDir = Math.sign(pitch - prev);

  if (prevInterval <= 4) {
    // 小跳:倾向继续同方向
    if (currDir === prevDir && prevInterval < DIRECTION_TABLE_SMALL.length) {
      return DIRECTION_TABLE_SMALL[prevInterval]!;
    }
    return 0;
  }
  // 大跳:倾向反向回收
  if (currDir !== prevDir) {
    const idx = Math.min(prevInterval - 5, DIRECTION_TABLE_LARGE.length - 1);
    return DIRECTION_TABLE_LARGE[idx]!;
  }
  return 0;
}

// ------------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------------

/**
 * Margulis 旋律期待感 score。
 *
 * @param candidateMidi  候选 MIDI pitch
 * @param prevMidi       上一音 MIDI(prevMidi < 0 时回退稳定度 only)
 * @param prevPrevMidi   上上音 MIDI(< 0 时跳过 direction 项)
 * @param chord          当前 chord(用 root + quality 查 vocab)
 *
 * @returns 期待感分数 — 越高 = 听众心智预期越强
 */
export function expectancyScore(
  candidateMidi: number,
  prevMidi: number,
  prevPrevMidi: number,
  chord: GeneratedChord,
): number {
  const pc = ((candidateMidi % 12) + 12) % 12;
  const vocab = getChordVocab(qualityToVocabKey(chord.quality));
  const rootPc = ((chord.root % 12) + 12) % 12;

  // stability:root 特判(stability 函数假设 spell[0]=root,我们直接看 pc==rootPc)
  let stab: number;
  if (pc === rootPc) stab = 6;
  else stab = stability(pc, vocab);

  if (prevMidi < 0) {
    // 第一音:只有稳定度
    return stab;
  }

  const prox = proximityFor(candidateMidi - prevMidi);
  const mob = candidateMidi === prevMidi ? MOBILITY_REPEAT : MOBILITY_NORMAL;
  const dir = prevPrevMidi >= 0
    ? directionFor(candidateMidi, prevMidi, prevPrevMidi)
    : 0;

  return stab * prox * mob + dir;
}

/**
 * 从多个 octave 候选中按 Margulis score argmax 选一个。
 *
 * @param candidates     候选 MIDI 数组(典型:[base-12, base, base+12])
 * @param prevMidi       上一音 MIDI
 * @param prevPrevMidi   上上音 MIDI
 * @param chord          当前 chord
 * @param loBound        MIDI 下界(out-of-range 候选直接淘汰)
 * @param hiBound        MIDI 上界
 *
 * @returns 最佳 MIDI;无 in-range 候选时返回 candidates[0](caller 兜底)
 */
export function pickByExpectancy(
  candidates: number[],
  prevMidi: number,
  prevPrevMidi: number,
  chord: GeneratedChord,
  loBound: number,
  hiBound: number,
): number {
  let bestMidi = candidates[0]!;
  let bestScore = -Infinity;
  let foundInRange = false;

  for (const c of candidates) {
    if (c < loBound || c > hiBound) continue;
    const s = expectancyScore(c, prevMidi, prevPrevMidi, chord);
    if (s > bestScore) {
      bestScore = s;
      bestMidi = c;
      foundInRange = true;
    }
  }
  if (!foundInRange) {
    // 所有候选超界 — clamp 第一候选
    return Math.max(loBound, Math.min(hiBound, candidates[0]!));
  }
  return bestMidi;
}

export const MargulisExpectancyShaper: MelodyPluginMeta & {
  score(
    candidateMidi: number,
    prevMidi: number,
    prevPrevMidi: number,
    chord: GeneratedChord,
  ): number;
  pickBest(
    candidates: number[],
    prevMidi: number,
    prevPrevMidi: number,
    chord: GeneratedChord,
    loBound: number,
    hiBound: number,
  ): number;
} = {
  name: 'MargulisExpectancyShaper',
  version: 'v0.1',
  prngConsumption: 'zero',
  description:
    'Phase 3 Impro-Visor 移植:Margulis 2005 melodic expectation(stability × proximity × mobility + direction)',
  score: expectancyScore,
  pickBest: pickByExpectancy,
};
