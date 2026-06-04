// ============================================================
// newEngine · harmony · HarmonicPlan 契约(🔒 深不可变)
// ------------------------------------------------------------
// 架构定稿 Part 2.4 / 附录 B2-B3:
//   - 结构化 RomanChord(不裸 string)
//   - *Map 用 Record(禁裸 Map)→ deepFreeze 才锁得住
//   - HarmonicPlan = DeepReadonly<HarmonicPlanData>;交付前 deepFreeze
// 进 render 后不可变,承重整条权威链(铁律1/3)。
// ============================================================

import { deepFreeze, type Beats, type DeepReadonly, type PitchClass } from '../foundation';
import type { ChordQuality } from '../knowledge/chords';
import type { TensionTable } from '../knowledge/tensionModel';

export type ChordSpanId = string;
export type SectionId = string;
export type HarmonicFunction = 'T' | 'S' | 'D';

export interface RomanChord {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  accidental: 'bb' | 'b' | 'natural' | '#' | 'x';
  quality: ChordQuality;
  secondaryTarget?: RomanChord; // V7/V 的 "/V"
  inversion?: 0 | 1 | 2 | 3;
}

export interface ChordSpan {
  id: ChordSpanId;
  roman: RomanChord;
  rootPc: PitchClass;
  quality: ChordQuality;
  startBeat: Beats;
  durationBeats: Beats;
  sectionId: SectionId;
}

export interface BorrowInfo {
  from: 'parallel-minor' | 'parallel-major';
  label: string; // 如 'iv' / 'bVII'
}

export interface HarmonicPlanData {
  romanProgression: RomanChord[];
  chordTimeline: ChordSpan[];
  chordFunctionTimeline: HarmonicFunction[];
  chordScaleMap: Record<ChordSpanId, PitchClass[]>;
  tensionMap: Record<ChordSpanId, TensionTable>;
  stableToneMap: Record<ChordSpanId, PitchClass[]>;
  colorToneMap: Record<ChordSpanId, PitchClass[]>;
  avoidNoteMap: Record<ChordSpanId, PitchClass[]>;
  borrowedChordMap: Record<ChordSpanId, BorrowInfo>; // 仅借和弦 span 在此
}

export type HarmonicPlan = DeepReadonly<HarmonicPlanData>;

/** 交付:递归冻结 → 进 render 后双重不可变(编译期 + 运行期)。 */
export function freezeHarmonicPlan(data: HarmonicPlanData): HarmonicPlan {
  return deepFreeze(data);
}
