// ============================================================
// newEngine · knowledge · VoicingLibrary / slimming(B-port)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.6 E3:为锁死 hook 让位时的瘦身次序。
//   可丢弃度从高到低:5 音 → 根 → 7 音;3 音永不丢(定大小调身份)。
//   保底:3+7 guide-tone shell。
// ============================================================

import { chordToneIntervals, type ChordQuality } from './chords';

export const SLIMMING_DROP_ORDER = ['fifth', 'root', 'seventh'] as const;

/** guide-tone shell:3 音 + 7 音相对根音的半音(三和弦无 7 → 只留 3 音)。瘦身保底目标。 */
export function guideToneShell(quality: ChordQuality): number[] {
  const t = chordToneIntervals(quality); // [root, 3rd, 5th, (7th)]
  const third = t[1];
  const seventh = t.length >= 4 ? t[3] : undefined;
  return seventh !== undefined ? [third, seventh] : [third];
}
