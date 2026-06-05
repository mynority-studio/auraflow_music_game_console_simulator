// ============================================================
// newEngine · harmony · HarmonyEngine
// ------------------------------------------------------------
// 架构定稿 Part 3.3:把(级数进行 + 调)落成固定 HarmonicPlan + 逐和弦三分类张力表,
// 交付前 deepFreeze。两个入口:
//   buildHarmonicPlan            低层:显式 key+级数+品质(测试/桩用)
//   buildHarmonicPlanFromArrangement  高层:BandSpec + ArrangementPlan(连 Band→Arranger→Harmony)
// 高层落实 harmonicRhythmTarget 为 chord count/duration;按 rng 子流从 ProgressionLibrary 选进行(确定性)。
// ============================================================

import { beats, mod12, type PitchClass, type RandomContext, type Rng } from '../foundation';
import { tensionTableFor, tensionTableForChordType, type TensionTable } from '../knowledge/tensionModel';
import { degreeToSemitone, type DiatonicMode } from '../knowledge/scales';
import { realChordScale } from '../knowledge/chordScales';
import { modalVamp } from '../knowledge/modes';
import { diatonicQuality, pickProgressionDegrees, type SectionRole, type BorrowedSource, type BassRole, type TonicizationPlacement, type ProgressionSlot } from '../knowledge/progressions';
import { selectProgressionSlots, toHarmonyStyle } from './progressionSelector';
import { realizeProgressionSlots } from './progressionRealizer';
import { chordToneIntervals, type ChordQuality } from '../knowledge/chords';
import { evaluateHarmony, type CoherenceChord } from '../knowledge/harmonicCoherence';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  freezeHarmonicPlan,
  type BorrowInfo,
  type ChordSpan,
  type HarmonicFunction,
  type HarmonicPlan,
  type HarmonicPlanData,
  type ModulationInfo,
  type RomanChord,
} from './HarmonicPlan';

// 度数 → 功能(T-S-D 粗分,Slice 1 大小调共用)
const DEGREE_FUNCTION: Record<number, HarmonicFunction> = {
  1: 'T', 3: 'T', 6: 'T',
  2: 'S', 4: 'S',
  5: 'D', 7: 'D',
};

export interface ResolvedChord {
  roman: RomanChord;
  rootPc: PitchClass;
  quality: ChordQuality;
  durationBeats: number;
  sectionId: string;
  func: HarmonicFunction;
  borrowed?: BorrowInfo;
  sectionKeyPc?: PitchClass; // 转调段落的实际调中心(undefined = 主调);chord-scale 据此解析
  // —— Loop 2:prototype 携带的定义层字段(realizer 填,assemble 落到 ChordSpan)——
  chordType?: string;
  borrowedSource?: BorrowedSource;
  mustResolve?: boolean;
  forcedScale?: string;
  localTonalCenterPc?: PitchClass;
  bassRole?: BassRole;
  tonicizationPlacement?: TonicizationPlacement;
}

// 共享装配:已解析和弦序列 → 深不可变 HarmonicPlan(填三分类张力表 + 真 chord-scale)
//   modalScalePcs 给定(modal regime)→ 逐和弦约束放松:chord-scale = 全局 primaryScale,
//   avoid 清空(modal 静态 vamp 不设和弦内 avoid),acceptable = primaryScale 去和弦音。
function assemble(
  resolved: ResolvedChord[],
  keyPc: PitchClass,
  keyMode: DiatonicMode,
  modalScalePcs?: PitchClass[],
  modulationMap: Record<string, ModulationInfo> = {},
): HarmonicPlan {
  if (resolved.length === 0) throw new RangeError('assemble(): 空和弦序列');
  const modalSet = modalScalePcs ? new Set<number>(modalScalePcs) : undefined;

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
    // ★ Loop 6:prototype 携带宽 chordType → 张力按宽和弦算(stable=核心,9/13 进 color);
    //   degree-picker fallback(chordType undefined)→ 旧窄品质表。
    const tension = rc.chordType !== undefined
      ? tensionTableForChordType(rc.rootPc, rc.chordType, rc.quality)
      : tensionTableFor(rc.rootPc, rc.quality);
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
      // Loop 2 prototype 定义层字段(均可选;degree-picker 路径多为 undefined,chordType 回退 quality)
      chordType: rc.chordType ?? rc.quality,
      borrowedSource: rc.borrowedSource,
      mustResolve: rc.mustResolve,
      forcedScale: rc.forcedScale,
      localTonalCenterPc: rc.localTonalCenterPc,
      bassRole: rc.bassRole,
      tonicizationPlacement: rc.tonicizationPlacement,
    });
    chordFunctionTimeline.push(rc.func);
    if (modalSet) {
      // modal:约束放松 → chord-scale = primaryScale,avoid 清空,acceptable = 音阶去和弦音
      const stableSet = new Set<number>(tension.stable);
      const accept = [...modalSet].filter((p) => !stableSet.has(p)) as PitchClass[];
      tensionMap[id] = { stable: tension.stable, acceptable: accept, avoid: [] };
      stableToneMap[id] = tension.stable;
      colorToneMap[id] = accept;
      avoidNoteMap[id] = [];
      chordScaleMap[id] = [...modalSet].sort((a, b) => a - b) as PitchClass[];
    } else {
      tensionMap[id] = tension;
      stableToneMap[id] = tension.stable;
      colorToneMap[id] = tension.acceptable;
      avoidNoteMap[id] = tension.avoid;
      // ★ 真 chord-scale:调内→母调音阶(转调段落用该段实际调中心);属七/副属→根音 Mixolydian;借和弦→根音 Dorian。
      //   prototype 的 borrowedSource 也参与判定(secondary_* → 副属;modal_interchange/backdoor → 借)。
      const isSec = rc.roman.secondaryTarget !== undefined || rc.borrowedSource === 'secondary_dominant' || rc.borrowedSource === 'secondary_ii_v';
      const isBor = rc.borrowed !== undefined || rc.borrowedSource === 'modal_interchange' || rc.borrowedSource === 'backdoor_dominant';
      chordScaleMap[id] = realChordScale(rc.rootPc, rc.sectionKeyPc ?? keyPc, keyMode, {
        isSecondaryDominant: isSec,
        isBorrowed: isBor,
        isDominant: rc.quality === '7', // 小调 V7(及任何属七)→ 升导音进音阶
      });
    }
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
    modulationMap,
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

// —— modal regime:静态 vamp(和声宽松,不走功能)——
//   每小节循环 [主和弦 i, 特征和弦],全段同 → 静态;chord-scale = primaryScale,avoid 放松。
function buildModalHarmonicPlan(band: BandSpec, arrangement: ArrangementPlan): HarmonicPlan {
  const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
  const vamp = modalVamp(band.key, band.modalModeName ?? 'dorian');
  const resolved: ResolvedChord[] = [];
  for (const section of arrangement.sections) {
    for (let bar = 0; bar < section.bars; bar++) {
      const v = vamp[bar % vamp.length];
      resolved.push({
        roman: { degree: v.degree, accidental: v.accidental, quality: v.quality },
        rootPc: v.rootPc,
        quality: v.quality,
        durationBeats: beatsPerBar, // 静态:1 和弦/小节,慢和声节奏
        sectionId: section.id,
        func: 'T', // modal 无功能 T-S-D,统一标 T
      });
    }
  }
  return assemble(resolved, band.key, band.mode, band.primaryScale);
}

// —— 转调规划:可选下,末段 chorus 抬 +1 半音(经典"换挡升 key")——
//   单一调中心(默认)→ 空 map。仅 allowModulation 时启用,确定性(无 rng)。
function planModulation(band: BandSpec, arrangement: ArrangementPlan): {
  sectionKeyOf: (sectionId: string) => PitchClass;
  modulationMap: Record<string, ModulationInfo>;
} {
  const modulationMap: Record<string, ModulationInfo> = {};
  if (band.allowModulation) {
    const choruses = arrangement.sections.filter((s) => s.role === 'chorus');
    const lastChorus = choruses[choruses.length - 1];
    if (lastChorus) {
      const semitones = 1; // 升半音(最经典的末段 lift)
      modulationMap[lastChorus.id] = {
        fromKey: band.key,
        toKey: mod12(band.key + semitones),
        semitones,
        label: 'up-semitone',
      };
    }
  }
  return {
    sectionKeyOf: (sectionId) => modulationMap[sectionId]?.toKey ?? band.key,
    modulationMap,
  };
}

// —— 生成时候选择优(用户总纲:同源一次性生成 + 择优,KB=音乐性根源)——
//   产 N 候选进行 → coherence 打分 → 选最高分。harmony 阶段【还没 voicing】,只评进行逻辑
//   (终止/倾向解决/bass 动向);和弦字面喂满 → identity/guideTone 不作区分量。
//   ⚠️ 我方 BorrowInfo 只 parallel-minor/major → 副属/subV/backdoor 暂不映射(那几条不触发);
//      区分力目前主要来自终止式属解决 + 借和弦 localColor,随 harmony 做厚增强。
const NUM_HARMONY_CANDIDATES = 6;
const ROMAN_NUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function romanStr(rc: ResolvedChord): string {
  const base = ROMAN_NUM[rc.roman.degree] ?? 'I';
  const minorish = rc.quality === 'min' || rc.quality === 'm7' || rc.quality === 'm7b5' || rc.quality === 'dim7';
  return minorish ? base.toLowerCase() : base;
}

/** resolved 进行 → CoherenceChord[](harmony 阶段适配:rootMidi/notesMidi/bassMidi 用和弦字面)。 */
function resolvedToCoherenceChords(resolved: ResolvedChord[], keyPc: PitchClass): CoherenceChord[] {
  return resolved.map((rc) => {
    const rootPc = rc.rootPc as number;
    return {
      type: rc.quality,
      rootMidi: 60 + rootPc,
      notesMidi: chordToneIntervals(rc.quality).map((iv) => 60 + rootPc + iv),
      bassMidi: 36 + rootPc,
      roman: romanStr(rc),
      chordSymbol: romanStr(rc),
      duration: rc.durationBeats,
      effectiveFunc: rc.func,
      analysisKeyPc: (rc.sectionKeyPc ?? keyPc) as number,
      borrowedSource: rc.borrowed ? 'modal_interchange' : undefined,
      mustResolve: rc.func === 'D' && rc.quality === '7',
    };
  });
}

// —— 高层:BandSpec + ArrangementPlan → HarmonicPlan(连 Band→Arranger→Harmony) ——
export function buildHarmonicPlanFromArrangement(
  band: BandSpec,
  arrangement: ArrangementPlan,
  rng: RandomContext,
): HarmonicPlan {
  if (band.tonalityKind === 'modal') return buildModalHarmonicPlan(band, arrangement); // ★ modal 分支:静态 vamp(不走择优)

  const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
  const { sectionKeyOf, modulationMap } = planModulation(band, arrangement); // ★ 转调:段落调中心(确定性,候选间不变)
  const styleName = band.style.toUpperCase();

  // 产 N 候选 → coherence 择优。advance('harmony') → 每候选不同子流且确定性;
  // 候选0 = 原 substream(与旧行为同),严格 > 才换 → 单调改进(无更优候选即回旧)。
  let ctx = rng;
  let best: { resolved: ResolvedChord[]; score: number } | null = null;
  for (let k = 0; k < NUM_HARMONY_CANDIDATES; k++) {
    const cand = buildResolvedProgression(band, arrangement, ctx.substream('harmony'), sectionKeyOf, beatsPerBar);
    const report = evaluateHarmony(resolvedToCoherenceChords(cand, band.key), styleName, band.key as number);
    if (!best || report.score > best.score) best = { resolved: cand, score: report.score };
    ctx = ctx.advance('harmony');
  }

  return assemble(best!.resolved, band.key, band.mode, undefined, modulationMap);
}

/** 一条候选进行(给定 harmony 子流)→ resolved 序列(确定性)。 */
function buildResolvedProgression(
  band: BandSpec,
  arrangement: ArrangementPlan,
  hrng: Rng,
  sectionKeyOf: (sectionId: string) => PitchClass,
  beatsPerBar: number,
): ResolvedChord[] {
  const resolved: ResolvedChord[] = [];
  // ★ 铁律9:同 repeatGroup 共享同一进行(verse1≡verse2)→ 真排比 + 复现 hook 的 global 安全音一致
  const degreesByGroup = new Map<string, number[]>();
  const protoByGroup = new Map<string, ProgressionSlot[]>(); // prototype-first 复用(Loop 2)

  for (const section of arrangement.sections) {
    const sectionKey = sectionKeyOf(section.id); // 转调段落=新调中心,否则=主调
    const isModulated = sectionKey !== band.key;
    const group = section.repeatGroup;

    // ★ prototype-first(Loop 2):匹配到 prototype → 实化它(自带终止/borrow/副属),跳过 degree-picker。
    const protoSlots = selectProgressionSlots({ band, section, hrng, protoByGroup });
    if (protoSlots) {
      resolved.push(...realizeProgressionSlots({
        slots: protoSlots, section, sectionKey, isModulated, beatsPerBar,
        style: toHarmonyStyle(band.style), colorBudget: band.styleProfile.colorBudget, random: hrng,
      }));
      continue;
    }

    // —— fallback:旧 degree-picker(含终止式强制 + colorBudget 副属/借和弦)——
    const chordsPerBar = arrangement.harmonicRhythmTarget.chordsPerBarBySection[section.id] ?? 1;
    const totalChords = section.bars * chordsPerBar;
    const chordDurBeats = beatsPerBar / chordsPerBar;
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
      const rootPc = mod12(sectionKey + degreeToSemitone(degree, band.mode)); // 转调段落用新调中心
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
        sectionKeyPc: isModulated ? sectionKey : undefined, // 转调段落 chord-scale 按新调中心解析
      });
    }
  }

  return resolved;
}
