// ============================================================
// newEngine · knowledge · tensionModel(三分类判据)
// ------------------------------------------------------------
// 架构定稿 Part 4.1 / 附录 E5:stable / acceptable / avoid 三分类。
// 三处共用(选音 commonSafeToneSet · Resolver · Auditor)。
//   stable     = 和弦音(B-port 事实)
//   acceptable = 按品质允许的张力(9/#11/13/改变音…)
//   avoid      = 该品质下不应暴露的音(如 maj7/属 的自然 11)
// 三集互斥:acceptable 去掉 stable;avoid 去掉 stable+acceptable。
// Slice 0 用一套可辩护的默认表;风格加权(new)后续叠加。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import { chordToneIntervals, type ChordQuality } from './chords';

export interface TensionTable {
  stable: PitchClass[];
  acceptable: PitchClass[];
  avoid: PitchClass[];
}

// 相对根音的【可接受张力】半音程
const ACCEPTABLE_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [2, 9, 11], // 9, 13, maj7 色彩
  min: [2, 5, 9, 10], // 9, 11, 13, b7
  maj7: [2, 6, 9], // 9, #11, 13
  m7: [2, 5, 9], // 9, 11, 13
  '7': [1, 2, 3, 6, 8, 9], // b9 9 #9 #11 b13 13(属和弦容纳改变音)
  m7b5: [5, 8], // 11, b13
  dim7: [2, 5, 8, 11], // 各和弦音上方全音
};

// 相对根音的【avoid】半音程
const AVOID_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [5], // 自然 11 与 3 音半音冲突
  min: [],
  maj7: [5], // 自然 11
  m7: [],
  '7': [5], // 自然 11
  m7b5: [1], // b9
  dim7: [],
};

export function tensionTableFor(rootPc: PitchClass, quality: ChordQuality): TensionTable {
  const stable = chordToneIntervals(quality).map((iv) => mod12(rootPc + iv));
  const stableSet = new Set<number>(stable);

  const acceptable = ACCEPTABLE_INTERVALS[quality]
    .map((iv) => mod12(rootPc + iv))
    .filter((p) => !stableSet.has(p)); // 互斥:去掉落在和弦音上的
  const acceptableSet = new Set<number>(acceptable);

  const avoid = AVOID_INTERVALS[quality]
    .map((iv) => mod12(rootPc + iv))
    .filter((p) => !stableSet.has(p) && !acceptableSet.has(p)); // 互斥

  return { stable, acceptable, avoid };
}
