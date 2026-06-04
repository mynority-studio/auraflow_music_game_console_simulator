// ============================================================
// newEngine · harmony · HarmonyEngine
// ------------------------------------------------------------
// 架构定稿 Part 3.3:把(级数进行 + 调)落成固定 HarmonicPlan + 逐和弦三分类张力表,
// 交付前 deepFreeze。两个入口:
//   buildHarmonicPlan            低层:显式 key+级数+品质(测试/桩用)
//   buildHarmonicPlanFromArrangement  高层:BandSpec + ArrangementPlan(连 Band→Arranger→Harmony)
// 高层落实 harmonicRhythmTarget 为 chord count/duration;按 rng 子流从 ProgressionLibrary 选进行(确定性)。
// ============================================================

import { beats, mod12, type PitchClass, type RandomContext } from '../foundation';
import { tensionTableFor, type TensionTable } from '../knowledge/tensionModel';
import { degreeToSemitone } from '../knowledge/scales';
import { diatonicQuality, pickProgressionDegrees, type SectionRole } from '../knowledge/progressions';
import type { ChordQuality } from '../knowledge/chords';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  freezeHarmonicPlan,
  type ChordSpan,
  type HarmonicFunction,
  type HarmonicPlan,
  type HarmonicPlanData,
  type RomanChord,
} from './HarmonicPlan';

// 度数 → 功能(T-S-D 粗分,Slice 1 大小调共用)
const DEGREE_FUNCTION: Record<number, HarmonicFunction> = {
  1: 'T', 3: 'T', 6: 'T',
  2: 'S', 4: 'S',
  5: 'D', 7: 'D',
};

interface ResolvedChord {
  roman: RomanChord;
  rootPc: PitchClass;
  quality: ChordQuality;
  durationBeats: number;
  sectionId: string;
  func: HarmonicFunction;
}

// 共享装配:已解析和弦序列 → 深不可变 HarmonicPlan(填三分类张力表)
function assemble(resolved: ResolvedChord[]): HarmonicPlan {
  if (resolved.length === 0) throw new RangeError('assemble(): 空和弦序列');

  const romanProgression: RomanChord[] = [];
  const chordTimeline: ChordSpan[] = [];
  const chordFunctionTimeline: HarmonicFunction[] = [];
  const chordScaleMap: Record<string, PitchClass[]> = {};
  const tensionMap: Record<string, TensionTable> = {};
  const stableToneMap: Record<string, PitchClass[]> = {};
  const colorToneMap: Record<string, PitchClass[]> = {};
  const avoidNoteMap: Record<string, PitchClass[]> = {};

  let beat = 0;
  resolved.forEach((rc, i) => {
    const id = `c${i}`;
    const tension = tensionTableFor(rc.rootPc, rc.quality);
    romanProgression.push(rc.roman);
    chordTimeline.push({
      id,
      roman: rc.roman,
      rootPc: rc.rootPc,
      quality: rc.quality,
      startBeat: beats(beat),
      durationBeats: beats(rc.durationBeats),
      sectionId: rc.sectionId,
    });
    chordFunctionTimeline.push(rc.func);
    tensionMap[id] = tension;
    stableToneMap[id] = tension.stable;
    colorToneMap[id] = tension.acceptable;
    avoidNoteMap[id] = tension.avoid;
    chordScaleMap[id] = [...new Set<number>([...tension.stable, ...tension.acceptable])]
      .sort((a, b) => a - b) as PitchClass[];
    beat += rc.durationBeats;
  });

  const data: HarmonicPlanData = {
    romanProgression,
    chordTimeline,
    chordFunctionTimeline,
    chordScaleMap,
    tensionMap,
    stableToneMap,
    colorToneMap,
    avoidNoteMap,
  };
  return freezeHarmonicPlan(data);
}

// —— 低层:显式 key + 级数 + 品质(大调度数解析) ——
export interface ProgressionItem {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  quality: ChordQuality;
  bars: number;
  func?: HarmonicFunction;
}

export interface HarmonyEngineInput {
  key: PitchClass;
  beatsPerBar: number;
  progression: ProgressionItem[];
  sectionId?: string;
}

export function buildHarmonicPlan(input: HarmonyEngineInput): HarmonicPlan {
  if (input.progression.length === 0) throw new RangeError('buildHarmonicPlan(): 空进行');
  const sectionId = input.sectionId ?? 'S0';
  const resolved: ResolvedChord[] = input.progression.map((item) => ({
    roman: { degree: item.degree, accidental: 'natural', quality: item.quality },
    rootPc: mod12(input.key + degreeToSemitone(item.degree, 'major')),
    quality: item.quality,
    durationBeats: item.bars * input.beatsPerBar,
    sectionId,
    func: item.func ?? DEGREE_FUNCTION[item.degree] ?? 'T',
  }));
  return assemble(resolved);
}

// —— 高层:BandSpec + ArrangementPlan → HarmonicPlan(连 Band→Arranger→Harmony) ——
export function buildHarmonicPlanFromArrangement(
  band: BandSpec,
  arrangement: ArrangementPlan,
  rng: RandomContext,
): HarmonicPlan {
  const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
  const hrng = rng.substream('harmony');
  const resolved: ResolvedChord[] = [];
  // ★ 铁律9:同 repeatGroup 共享同一进行(verse1≡verse2)→ 真排比 + 复现 hook 的 global 安全音一致
  const degreesByGroup = new Map<string, number[]>();

  for (const section of arrangement.sections) {
    const chordsPerBar = arrangement.harmonicRhythmTarget.chordsPerBarBySection[section.id] ?? 1;
    const totalChords = section.bars * chordsPerBar;
    const chordDurBeats = beatsPerBar / chordsPerBar;
    const group = section.repeatGroup;
    let degrees: number[];
    if (group && degreesByGroup.has(group)) {
      degrees = degreesByGroup.get(group)!;
    } else {
      degrees = pickProgressionDegrees(section.role as SectionRole, hrng);
      if (group) degreesByGroup.set(group, degrees);
    }

    // ★ 终止式:段尾末乐句的 cadenceTarget 决定段尾和声落点
    //   authentic → 末两和弦 V7-I;half → 末和弦 V。(verse1≡verse2 同终止 → 排比不破)
    const secPhrases = arrangement.phrases.filter((p) => p.sectionId === section.id);
    const lastCad = secPhrases.length
      ? secPhrases.reduce((a, b) => (b.phraseSlot > a.phraseSlot ? b : a)).cadenceTarget
      : undefined;

    for (let j = 0; j < totalChords; j++) {
      let degree = degrees[j % degrees.length];
      let quality = diatonicQuality(degree, band.mode);
      const isLast = j === totalChords - 1;
      const isSecondLast = j === totalChords - 2;

      if (lastCad === 'authentic') {
        if (isLast) {
          degree = 1;
          quality = diatonicQuality(1, band.mode);
        } else if (isSecondLast && totalChords >= 2) {
          degree = 5;
          quality = '7'; // V7(小调也用属七 → 真终止解决)
        }
      } else if (lastCad === 'half' && isLast) {
        degree = 5;
        quality = '7';
      }

      resolved.push({
        roman: { degree: degree as RomanChord['degree'], accidental: 'natural', quality },
        rootPc: mod12(band.key + degreeToSemitone(degree, band.mode)),
        quality,
        durationBeats: chordDurBeats,
        sectionId: section.id,
        func: DEGREE_FUNCTION[degree] ?? 'T',
      });
    }
  }

  return assemble(resolved);
}
