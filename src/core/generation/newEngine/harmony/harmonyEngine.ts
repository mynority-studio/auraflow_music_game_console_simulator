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
import { degreeToSemitone, type DiatonicMode } from '../knowledge/scales';
import { realChordScale } from '../knowledge/chordScales';
import { diatonicQuality, pickProgressionDegrees, type SectionRole } from '../knowledge/progressions';
import type { ChordQuality } from '../knowledge/chords';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  freezeHarmonicPlan,
  type BorrowInfo,
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
  borrowed?: BorrowInfo;
}

// 共享装配:已解析和弦序列 → 深不可变 HarmonicPlan(填三分类张力表 + 真 chord-scale)
function assemble(resolved: ResolvedChord[], keyPc: PitchClass, keyMode: DiatonicMode): HarmonicPlan {
  if (resolved.length === 0) throw new RangeError('assemble(): 空和弦序列');

  const romanProgression: RomanChord[] = [];
  const chordTimeline: ChordSpan[] = [];
  const chordFunctionTimeline: HarmonicFunction[] = [];
  const chordScaleMap: Record<string, PitchClass[]> = {};
  const tensionMap: Record<string, TensionTable> = {};
  const stableToneMap: Record<string, PitchClass[]> = {};
  const colorToneMap: Record<string, PitchClass[]> = {};
  const avoidNoteMap: Record<string, PitchClass[]> = {};
  const borrowedChordMap: Record<string, BorrowInfo> = {};

  let beat = 0;
  resolved.forEach((rc, i) => {
    const id = `c${i}`;
    const tension = tensionTableFor(rc.rootPc, rc.quality);
    if (rc.borrowed) borrowedChordMap[id] = rc.borrowed;
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
    // ★ 真 chord-scale:调内→母调音阶;副属→根音 Mixolydian;借和弦→根音 Dorian。
    chordScaleMap[id] = realChordScale(rc.rootPc, keyPc, keyMode, {
      isSecondaryDominant: rc.roman.secondaryTarget !== undefined,
      isBorrowed: rc.borrowed !== undefined,
    });
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
    borrowedChordMap,
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
  return assemble(resolved, input.key, 'major');
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

    // 先建逐位 slot(含终止式覆写),再做副属着色 → 最后落 resolved
    interface Slot { degree: number; quality: ChordQuality; rootPc: PitchClass; func: HarmonicFunction; roman: RomanChord; borrowed?: BorrowInfo; }
    const slots: Slot[] = [];
    for (let j = 0; j < totalChords; j++) {
      let degree = degrees[j % degrees.length];
      let quality = diatonicQuality(degree, band.mode);
      const isLast = j === totalChords - 1;
      const isSecondLast = j === totalChords - 2;
      if (lastCad === 'authentic') {
        if (isLast) { degree = 1; quality = diatonicQuality(1, band.mode); }
        else if (isSecondLast && totalChords >= 2) { degree = 5; quality = '7'; }
      } else if (lastCad === 'half' && isLast) { degree = 5; quality = '7'; }
      const rootPc = mod12(band.key + degreeToSemitone(degree, band.mode));
      slots.push({
        degree, quality, rootPc,
        func: DEGREE_FUNCTION[degree] ?? 'T',
        roman: { degree: degree as RomanChord['degree'], accidental: 'natural', quality },
      });
    }

    // ★ 副属(V7/X):colorBudget 够(jazz)才加;tonicize body 内 V/vi 目标前一和弦(D7→G 等)。
    //   确定性(无 rng)→ verse1≡verse2 排比不破;chromatic 色彩,melody 对其安全音重 snap。
    if (band.styleProfile.colorBudget >= 0.5) {
      for (let j = 0; j < totalChords - 2; j++) {
        const target = slots[j + 1];
        if ((target.degree === 5 || target.degree === 6) && slots[j].quality !== '7') {
          const sdRoot = mod12(target.rootPc + 7); // 目标的属(上方五度)
          slots[j] = {
            degree: 5, quality: '7', rootPc: sdRoot, func: 'D',
            roman: { degree: 5, accidental: 'natural', quality: '7', secondaryTarget: target.roman },
          };
        }
      }
    }

    // ★ 借和弦:大调向同名小调借 iv(IV→iv 小三和弦,Fm 在 C)。colorBudget≥0.3 才加,
    //   确定性=排比不破;Ab/Eb 离调色彩,melody 对其安全音重 snap。
    if (band.mode === 'major' && band.styleProfile.colorBudget >= 0.3) {
      for (let j = 0; j < totalChords - 2; j++) {
        const s = slots[j];
        if (s.degree === 4 && s.quality === 'maj7' && !s.borrowed) {
          slots[j] = {
            ...s,
            quality: 'm7', // 小调 iv
            roman: { degree: 4, accidental: 'natural', quality: 'm7' },
            borrowed: { from: 'parallel-minor', label: 'iv' },
          };
        }
      }
    }

    for (const s of slots) {
      resolved.push({
        roman: s.roman,
        rootPc: s.rootPc,
        quality: s.quality,
        durationBeats: chordDurBeats,
        sectionId: section.id,
        func: s.func,
        borrowed: s.borrowed,
      });
    }
  }

  return assemble(resolved, band.key, band.mode);
}
