// ============================================================
// newEngine · harmony · HarmonyEngine(Slice 0 最小实现)
// ------------------------------------------------------------
// 架构定稿 Part 3.3:把(级数进行 + 调)落成固定 HarmonicPlan + 逐和弦三分类张力表,
// 交付前 deepFreeze。Slice 0:tonal 大调,输入直接给 degree+quality(diatonic 质推导后续做);
// 上游 BandSpec/Arranger 尚未建,先用最小输入桩。和声节奏 = 目标已定,这里落实 chord 时长。
// ============================================================

import { beats, mod12, type PitchClass } from '../foundation';
import { tensionTableFor, type TensionTable } from '../knowledge/tensionModel';
import type { ChordQuality } from '../knowledge/chords';
import {
  freezeHarmonicPlan,
  type ChordSpan,
  type HarmonicFunction,
  type HarmonicPlan,
  type HarmonicPlanData,
  type RomanChord,
} from './HarmonicPlan';

// 大调音阶半音程(度数 1..7 → 半音)
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// 度数 → 功能(大调 T-S-D 粗分,Slice 0)
const DEGREE_FUNCTION: Record<number, HarmonicFunction> = {
  1: 'T', 3: 'T', 6: 'T',
  2: 'S', 4: 'S',
  5: 'D', 7: 'D',
};

export interface ProgressionItem {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  quality: ChordQuality;
  bars: number;
  func?: HarmonicFunction; // 可覆盖默认功能
}

export interface HarmonyEngineInput {
  key: PitchClass;         // 主音 pc
  beatsPerBar: number;
  progression: ProgressionItem[];
  sectionId?: string;
}

export function buildHarmonicPlan(input: HarmonyEngineInput): HarmonicPlan {
  const { key, beatsPerBar, progression } = input;
  if (progression.length === 0) {
    throw new RangeError('buildHarmonicPlan(): 空进行');
  }
  const sectionId = input.sectionId ?? 'S0';

  const romanProgression: RomanChord[] = [];
  const chordTimeline: ChordSpan[] = [];
  const chordFunctionTimeline: HarmonicFunction[] = [];
  const chordScaleMap: Record<string, PitchClass[]> = {};
  const tensionMap: Record<string, TensionTable> = {};
  const stableToneMap: Record<string, PitchClass[]> = {};
  const colorToneMap: Record<string, PitchClass[]> = {};
  const avoidNoteMap: Record<string, PitchClass[]> = {};

  let beat = 0;
  progression.forEach((item, i) => {
    const rootPc = mod12(key + MAJOR_SCALE[item.degree - 1]);
    const roman: RomanChord = { degree: item.degree, accidental: 'natural', quality: item.quality };
    const id = `c${i}`;
    const durationBeats = item.bars * beatsPerBar;
    const tension = tensionTableFor(rootPc, item.quality);
    const func = item.func ?? DEGREE_FUNCTION[item.degree] ?? 'T';

    romanProgression.push(roman);
    chordTimeline.push({
      id,
      roman,
      rootPc,
      quality: item.quality,
      startBeat: beats(beat),
      durationBeats: beats(durationBeats),
      sectionId,
    });
    chordFunctionTimeline.push(func);
    tensionMap[id] = tension;
    stableToneMap[id] = tension.stable;
    colorToneMap[id] = tension.acceptable;
    avoidNoteMap[id] = tension.avoid;
    // Slice 0 chordScale 暂用 stable ∪ acceptable 作"可用音"占位;proper chord-scale 后续做
    chordScaleMap[id] = [...new Set<number>([...tension.stable, ...tension.acceptable])]
      .sort((a, b) => a - b) as PitchClass[];

    beat += durationBeats;
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
