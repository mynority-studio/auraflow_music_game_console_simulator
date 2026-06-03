// ============================================================
// newEngine · knowledge · ChordLibrary(B-port 乐理事实)
// ------------------------------------------------------------
// 架构定稿 Part 4:和弦音 = 相对根音的半音程集合(纯乐理事实,可搬)。
// Slice 0 覆盖 tonal 常用 7 种品质;后续按需扩。
// ============================================================

import { mod12, type PitchClass } from '../foundation';

export type ChordQuality = 'maj' | 'min' | 'maj7' | 'm7' | '7' | 'm7b5' | 'dim7';

// 和弦音相对根音的半音程
const CHORD_TONE_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

export function chordToneIntervals(quality: ChordQuality): number[] {
  const t = CHORD_TONE_INTERVALS[quality];
  if (!t) throw new RangeError(`chordToneIntervals(): 未知 quality "${quality}"`);
  return t.slice();
}

/** 某根音 + 品质的全部和弦音(pc)。 */
export function chordTones(rootPc: PitchClass, quality: ChordQuality): PitchClass[] {
  return chordToneIntervals(quality).map((iv) => mod12(rootPc + iv));
}
