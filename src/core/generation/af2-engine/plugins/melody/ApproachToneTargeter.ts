// ============================================================
// ApproachToneTargeter — chord 变换前 ±1 半音强进入下一 chord target
// ============================================================
//
// Phase 4 of Impro-Visor 移植(2026-05-25)。
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/lickgen/LickGen.java`
//        slope + A(approach)terminal 的 special case(line 2038-2142)。
//
// 与 PassingToneSelector 的差异:
//   - PassingToneSelector(已有):chromatic passing 50% gate + diatonic 选音(±1/±2 邻 4 候选)
//   - ApproachToneTargeter(新加):**在 chord 切换点的前一拍**,强制选 ±1 半音
//     进入下一 chord 的 root/3/5(jazz 经典手法 — leading tone resolution)
//
// 算法:
//   1. 检测条件:slot 是 chord 的最后一 slot(progress >= 0.7),next chord 存在
//   2. 选 target:next chord 的 root / 3rd / 5th(chord vocab.priority 前 3)
//   3. 决定方向:up(target - 1)或 down(target + 1)— 看 prevMidi 距离
//   4. clamp 到 pitch range,返回 approach MIDI
//
// AF2 集成(Phase 4 v0.1):
//   - approachPitch() 独立可调用 — Af2MelodyGen 主循环在最后 slot 时启用
//   - 默认 OFF gate(APPROACH_TONE_ENABLED const,per-mgStyle 后续 review)
//   - 启用时:替代 nextCyclePc 选音,把当前 pitch 设为下一 chord target ±1 半音
//
// PRNG 协议:'zero'
// ============================================================

import type { GeneratedChord } from '../../../ir';
import { ChordQuality, ChordQualityName } from '../../../types';
import { getChordVocab, approachOptionsForTarget } from '../../music-theory/chord-vocab';
import { placeNearAnchor } from '../../utils/voice-leading';
import type { MelodyPluginMeta } from './types';

function qualityToVocabKey(q: ChordQuality): string {
  const name = ChordQualityName[q] ?? 'Major';
  const aliases: Record<string, string> = {
    'Major': 'maj', 'Minor': 'min', 'Diminished': 'dim', 'Augmented': 'aug',
    'Major7': 'maj7', 'Minor7': 'm7', 'Dominant7': 'dom7',
    'HalfDiminished': 'm7b5', 'Diminished7': 'dim7',
    'Sus4': 'sus4', 'Dominant7Sus4': '7sus4',
    'Add9': 'add9', 'Minor9': 'm9', 'Major9': 'maj9',
    'Dominant9': '9', 'Minor11': 'm11', 'Dominant13': '13',
    'Major13': 'maj13', 'Major7Sharp11': 'maj7#11',
    'Dom7Flat9': '7b9', 'Dom7Sharp9': '7#9', 'Dom7Sharp11': '7#11',
    'Dom7Flat13': '7b13', 'Dom7Alt': '7alt', 'Dominant11': '11',
  };
  return aliases[name] ?? 'maj';
}

/**
 * 选 approach pitch — chord 末尾强制 ±1 半音进入下一 chord target。
 *
 * @param nextChord    下一 chord(决定 target chord tones)
 * @param prevMidi     上一音 MIDI(决定 approach direction + octave)
 * @param targetRankIdx  target 选第几个 chord tone(0=root, 1=top priority, 2=second)
 *                       默认 0(root)— jazz V→I 经典走 b2→1 / 7→1 leading
 * @param melodyLo     pitch range 下界
 * @param melodyHi     pitch range 上界
 *
 * @returns approach MIDI(即 target ±1)
 */
export function approachPitch(
  nextChord: GeneratedChord,
  prevMidi: number,
  targetRankIdx: number,
  melodyLo: number,
  melodyHi: number,
): number {
  const vocab = getChordVocab(qualityToVocabKey(nextChord.quality));
  const targetPcRelativeToRoot = vocab.priority[targetRankIdx]
    ?? vocab.priority[0]
    ?? 0;
  const nextRootPc = ((nextChord.root % 12) + 12) % 12;
  const targetPc = ((nextRootPc + targetPcRelativeToRoot) % 12 + 12) % 12;

  // 选 approach 方向:用 vocab.approach 的第一候选(opt[1] 通常是 leading tone)
  const approachOpts = approachOptionsForTarget(targetPc, vocab);
  // 第一 option 偏好(leading tone — 通常下方半音)
  let approachPc = approachOpts.length > 0 ? approachOpts[0]! : ((targetPc + 11) % 12);

  // 如果 prev 离 +1 半音方向更近,改成上方半音
  const targetMidi = placeNearAnchor(targetPc, prevMidi, melodyLo, melodyHi);
  const approachBelow = ((targetPc + 11) % 12);
  const approachAbove = ((targetPc + 1) % 12);
  if (approachOpts.includes(approachAbove)) {
    // 两个方向都可用 — 看 prev 在哪边
    const distBelow = Math.abs(prevMidi - (targetMidi - 1));
    const distAbove = Math.abs(prevMidi - (targetMidi + 1));
    approachPc = distAbove < distBelow ? approachAbove : approachBelow;
  }

  // 落实 octave:approach pitch 应在 prevMidi 附近(平滑过渡)
  return placeNearAnchor(approachPc, prevMidi, melodyLo, melodyHi);
}

/**
 * 判断当前是否在 "approach 触发点"(chord 最后 ~30% slots + next chord 存在)。
 */
export function shouldApproach(
  slotProgressInChord: number,
  hasNextChord: boolean,
): boolean {
  return hasNextChord && slotProgressInChord >= 0.7;
}

export const ApproachToneTargeter: MelodyPluginMeta & {
  pick(
    nextChord: GeneratedChord,
    prevMidi: number,
    targetRankIdx: number,
    melodyLo: number,
    melodyHi: number,
  ): number;
  shouldFire(slotProgressInChord: number, hasNextChord: boolean): boolean;
} = {
  name: 'ApproachToneTargeter',
  version: 'v0.1',
  prngConsumption: 'zero',
  description:
    'Phase 4 Impro-Visor 移植:chord 变换前 ±1 半音强进入下一 chord target(jazz leading tone)',
  pick: approachPitch,
  shouldFire: shouldApproach,
};
