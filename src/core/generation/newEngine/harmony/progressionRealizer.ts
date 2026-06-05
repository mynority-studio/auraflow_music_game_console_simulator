// ============================================================
// newEngine · harmony · ProgressionRealizer(和声迁移 Loop 2)
// ------------------------------------------------------------
// 把 prototype slot 实化成 ResolvedChord(给 assemble → HarmonicPlan):
//   rootPc = sectionKey + rootOffset · durationBeats = slot.beats ?? beatsPerBar ·
//   function = effectiveFunc ?? 度数 TSD · 携带 chordType/borrowedSource/forcedScale 等定义层字段。
// ★ 当前 ChordSpan.quality 仍是窄 ChordQuality → narrowQuality 把宽 chordType 降级(兼容);
//   宽类型存 ResolvedChord.chordType(Loop 6 起 tension/chordScale 优先读它)。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import type { Section } from '../arranger/ArrangementPlan';
import type { ProgressionSlot } from '../knowledge/progressions';
import type { ChordQuality } from '../knowledge/chords';
import type { HarmonicFunction, RomanChord } from './HarmonicPlan';
import type { ResolvedChord } from './harmonyEngine';

const DEGREE_FUNCTION: Record<number, HarmonicFunction> = { 1: 'T', 3: 'T', 6: 'T', 2: 'S', 4: 'S', 5: 'D', 7: 'D' };

/** 宽 chord type → 窄 ChordQuality(兼容当前 ChordSpan;Loop 6 起 tension/chordScale 改读宽 chordType)。 */
export function narrowQuality(type: string): ChordQuality {
  if (type === 'm7b5' || type === 'm9b5' || type === 'm11b5') return 'm7b5';
  if (type === 'dim7' || type === 'dim') return 'dim7';
  if (type === 'add9' || type === '6' || type === '6/9' || type === 'maj' || type === 'sus2' || type === 'sus4') return 'maj'; // 大三和弦(无7)
  if (type === 'm' || type === 'min') return 'min';
  if (type.startsWith('maj')) return 'maj7';
  if (type.startsWith('m')) return 'm7'; // m7/m9/m11/m13
  return '7'; // dom + sus-dom(7sus4/9sus4/13sus4)+ altered + 纯数字
}

function accidentalOf(roman: string): RomanChord['accidental'] {
  if (roman.startsWith('bb')) return 'bb';
  if (roman.startsWith('b')) return 'b';
  if (roman.startsWith('#')) return '#';
  if (roman.startsWith('x')) return 'x';
  return 'natural';
}

/** prototype slots → ResolvedChord[](rootPc/durationBeats/窄品质 + 定义层字段)。 */
export function realizeProgressionSlots(args: {
  slots: ProgressionSlot[];
  section: Section;
  sectionKey: PitchClass;
  isModulated: boolean;
  beatsPerBar: number;
}): ResolvedChord[] {
  const { slots, section, sectionKey, isModulated, beatsPerBar } = args;
  return slots.map((slot): ResolvedChord => {
    const rootPc = mod12(sectionKey + slot.rootOffset);
    const quality = narrowQuality(slot.type);
    const roman: RomanChord = {
      degree: (Math.min(7, Math.max(1, slot.scaleDegree)) as RomanChord['degree']),
      accidental: accidentalOf(slot.roman),
      quality,
    };
    const func: HarmonicFunction = slot.effectiveFunc ?? DEGREE_FUNCTION[slot.scaleDegree] ?? 'T';
    return {
      roman,
      rootPc,
      quality,
      durationBeats: slot.beats ?? beatsPerBar,
      sectionId: section.id,
      func,
      chordType: slot.type,
      borrowedSource: slot.borrowedSource,
      mustResolve: slot.mustResolve,
      forcedScale: slot.forcedScale,
      localTonalCenterPc: slot.localTonalCenterPc !== undefined ? mod12(slot.localTonalCenterPc) : undefined,
      bassRole: slot.bassRole,
      tonicizationPlacement: slot.tonicizationPlacement,
      sectionKeyPc: isModulated ? sectionKey : undefined,
    };
  });
}
