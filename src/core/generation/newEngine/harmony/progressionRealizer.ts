// ============================================================
// newEngine · harmony · ProgressionRealizer(和声迁移 Loop 2)
// ------------------------------------------------------------
// 把 prototype slot 实化成 ResolvedChord(给 assemble → HarmonicPlan):
//   rootPc = sectionKey + rootOffset · durationBeats = slot.beats ?? beatsPerBar ·
//   function = effectiveFunc ?? 度数 TSD · 携带 chordType/borrowedSource/forcedScale 等定义层字段。
// ★ 当前 ChordSpan.quality 仍是窄 ChordQuality → narrowQuality 把宽 chordType 降级(兼容);
//   宽类型存 ResolvedChord.chordType(Loop 6 起 tension/chordScale 优先读它)。
// ============================================================

import { mod12, type PitchClass, type Rng } from '../foundation';
import type { Section } from '../arranger/ArrangementPlan';
import type { ProgressionSlot, HarmonyStyleName } from '../knowledge/progressions';
import type { ChordQuality } from '../knowledge/chords';
import type { TSD_Func } from '../knowledge/dynamicTsdDictionary';
import type { HarmonicFunction, RomanChord } from './HarmonicPlan';
import type { ResolvedChord } from './harmonyEngine';
import { decorateChordType } from './dynamicHarmonyDecorator';

const DEGREE_FUNCTION: Record<number, HarmonicFunction> = { 1: 'T', 3: 'T', 6: 'T', 2: 'S', 4: 'S', 5: 'D', 7: 'D' };
const funcOf = (slot: ProgressionSlot): HarmonicFunction => slot.effectiveFunc ?? DEGREE_FUNCTION[slot.scaleDegree] ?? 'T';

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

/** prototype slots → ResolvedChord[](rootPc/durationBeats/窄品质 + 定义层字段)。
 *  Loop 3:对【非锁定】槽按动态 TSD 字典装饰 chordType(锁定槽=作者类型不动=不消耗 rng)。 */
export function realizeProgressionSlots(args: {
  slots: ProgressionSlot[];
  section: Section;
  sectionKey: PitchClass;
  isModulated: boolean;
  beatsPerBar: number;
  style: HarmonyStyleName;   // Loop 3:动态 TSD 装饰
  colorBudget: number;
  random: Rng;
}): ResolvedChord[] {
  const { slots, section, sectionKey, isModulated, beatsPerBar, style, colorBudget, random } = args;
  return slots.map((slot, i): ResolvedChord => {
    const func = funcOf(slot);
    const next = slots[i + 1];
    // Loop 3:非锁定槽 → 动态字典选 chordType;锁定槽(prototype 作者类型)原样返回。
    const chordType = decorateChordType({
      style, slotFunc: func as TSD_Func, slotType: slot.type, slotLockType: slot.lockType ?? false,
      nextFunc: (next ? funcOf(next) : 'T') as TSD_Func, nextRoman: next?.roman ?? '', nextType: next?.type ?? '',
      colorBudget, random,
    });
    const rootPc = mod12(sectionKey + slot.rootOffset);
    const quality = narrowQuality(chordType);
    const roman: RomanChord = {
      degree: (Math.min(7, Math.max(1, slot.scaleDegree)) as RomanChord['degree']),
      accidental: accidentalOf(slot.roman),
      quality,
    };
    return {
      roman,
      rootPc,
      quality,
      durationBeats: slot.beats ?? beatsPerBar,
      sectionId: section.id,
      func,
      chordType,
      borrowedSource: slot.borrowedSource,
      mustResolve: slot.mustResolve,
      forcedScale: slot.forcedScale,
      localTonalCenterPc: slot.localTonalCenterPc !== undefined ? mod12(slot.localTonalCenterPc) : undefined,
      bassRole: slot.bassRole,
      bassPedalPc: slot.bassPedalPc !== undefined ? mod12(slot.bassPedalPc) : undefined,
      tonicizationPlacement: slot.tonicizationPlacement,
      preserveType: slot.preserveType,
      // ★ Gap A:slot 作者语义标签透传(borrowedFrom='soft V/vi'/'Dorian IV (raised 6)' 等精确保留)。
      borrowedFrom: slot.borrowedFrom,
      effectiveFunc: slot.effectiveFunc,
      analysisKeyPc: slot.analysisKeyPc !== undefined ? mod12(slot.analysisKeyPc) : undefined,
      localRoman: slot.localRoman,
      sectionKeyPc: isModulated ? sectionKey : undefined,
    };
  });
}
