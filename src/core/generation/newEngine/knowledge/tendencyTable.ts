// ============================================================
// newEngine · knowledge · TendencyTable(和弦框架音级倾向,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts(TENDENCY_TABLE)。
//   按【和弦品质族 × T/S/D 功能】解析 scenario,再按【相对和弦根音的 pc】查 CT/T/A。
//   CT=chord tone(协和)· T=tension(可挂可解,gravity 决定急迫)· A=avoid(须解决)。
// 比 tensionModel(只按品质)更细:同 maj7 在 T(主)与 S(下属)avoid 集不同。
// 纯乐理事实。Auditor 用它判 chord-fit / acceptable-tension / avoid + 解决目标。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import type { ChordQuality } from './chords';
import type { HarmonicFunction } from '../harmony/HarmonicPlan';

export type ChordScenario = 'M7T' | 'M7S' | 'm7S' | 'm7T' | '7D' | 'SUS';
export type TendencyState = 'CT' | 'T' | 'A';

export interface TendencyEntry {
  state: TendencyState;
  gravity: number;            // 0..1 解决急迫度
  targets: readonly number[]; // 相对和弦根音的解决目标 pc
}

const e = (state: TendencyState, gravity: number, targets: readonly number[]): TendencyEntry => ({ state, gravity, targets });

// 每 scenario 一张 12 项表(索引 = pcFromChordRoot)。port 自 TENDENCY_TABLE,逐值忠实。
const TENDENCY_TABLE: Record<ChordScenario, readonly TendencyEntry[]> = {
  // maj 主功能
  M7T: [e('CT', 0, []), e('A', 1.0, [0]), e('T', 0.2, [0, 4]), e('A', 0.9, [4, 2]), e('CT', 0, []), e('A', 0.95, [4]), e('T', 0.5, [7, 4]), e('CT', 0, []), e('A', 0.9, [7]), e('T', 0.3, [7, 11]), e('A', 0.9, [11]), e('CT', 0, [])],
  // maj 下属功能
  M7S: [e('CT', 0, []), e('A', 1.0, [0]), e('T', 0.1, [0, 4]), e('A', 0.9, [4, 2]), e('CT', 0, []), e('A', 0.7, [4]), e('T', 0.2, [7, 4]), e('CT', 0, []), e('A', 0.9, [7]), e('T', 0.2, [7, 11]), e('A', 0.9, [11]), e('CT', 0, [])],
  // min 下属(Dorian,ii)
  m7S: [e('CT', 0, []), e('A', 0.95, [0]), e('T', 0.2, [0, 3]), e('CT', 0, []), e('A', 0.95, [3]), e('T', 0.3, [3, 7]), e('A', 0.8, [7]), e('CT', 0, []), e('A', 0.7, [7]), e('T', 0.4, [7, 10]), e('CT', 0, []), e('A', 0.85, [10])],
  // min 主(Aeolian,vi/i;b6 合法)
  m7T: [e('CT', 0, []), e('A', 1.0, [0]), e('T', 0.3, [0, 3]), e('CT', 0, []), e('A', 0.95, [3]), e('A', 0.8, [3]), e('A', 0.8, [7]), e('CT', 0, []), e('CT', 0.2, [7]), e('A', 0.8, [7]), e('CT', 0, []), e('A', 0.85, [10])],
  // dom 属功能(改变音是 T 非 A)
  '7D': [e('CT', 0, []), e('T', 0.7, [0, 4]), e('T', 0.2, [0, 4]), e('T', 0.75, [4]), e('CT', 0, []), e('A', 0.9, [4]), e('T', 0.55, [7, 4]), e('CT', 0, []), e('T', 0.65, [7, 10]), e('T', 0.3, [7, 10]), e('CT', 0, []), e('A', 0.95, [10, 0])],
  // sus(9/11 是和弦音,M3 是 avoid)
  SUS: [e('CT', 0, []), e('A', 0.95, [0]), e('CT', 0, []), e('T', 0.5, [2, 5]), e('A', 0.8, [5, 2]), e('CT', 0, []), e('T', 0.4, [7, 5]), e('CT', 0, []), e('T', 0.5, [7]), e('T', 0.3, [7, 0]), e('CT', 0.1, []), e('A', 0.85, [10, 0])],
};

// 我方 ChordQuality → 品质族
function baseQuality(quality: ChordQuality): 'maj' | 'min' | 'dom' | null {
  switch (quality) {
    case 'maj': case 'maj7': return 'maj';
    case 'min': case 'm7': return 'min';
    case '7': return 'dom';
    case 'm7b5': case 'dim7': return null; // 半减/减:无 scenario,退回 tensionModel
    default: return null;
  }
}

/** (品质 + T/S/D 功能) → scenario;null = 该和弦不在倾向表覆盖(退回基础 avoid 判据)。 */
export function resolveChordScenario(quality: ChordQuality, func: HarmonicFunction): ChordScenario | null {
  const base = baseQuality(quality);
  if (base === null) return null;
  if (base === 'dom') return '7D';
  if (base === 'maj') return func === 'S' ? 'M7S' : 'M7T';
  return func === 'S' ? 'm7S' : 'm7T'; // min
}

/** 旋律音相对和弦根音的倾向条目。 */
export function getMelodyTendency(melodyPc: PitchClass, chordRootPc: PitchClass, scenario: ChordScenario): TendencyEntry {
  return TENDENCY_TABLE[scenario][mod12(melodyPc - chordRootPc)];
}

/** 解决目标的绝对 pc(chordRoot + 相对目标)。 */
export function tendencyTargetPcs(entry: TendencyEntry, chordRootPc: PitchClass): PitchClass[] {
  return entry.targets.map((t) => mod12(chordRootPc + t));
}
