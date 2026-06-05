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
import { degreeToSemitone, getScalePitchClasses, isKnownScaleType, type DiatonicMode } from '../knowledge/scales';
import { realChordScale } from '../knowledge/chordScales';
import { modalVamp } from '../knowledge/modes';
import { diatonicQuality, pickProgressionDegrees, type SectionRole, type BorrowedSource, type BassRole, type TonicizationPlacement, type ProgressionSlot } from '../knowledge/progressions';
import { selectProgressionSlots, toHarmonyStyle, type SelectedProgression } from './progressionSelector';
import { realizeProgressionSlots } from './progressionRealizer';
import { planTonicization } from './tonicizationPlanner';
import { STYLE_TONICIZE_MAX_PER_SONG, STYLE_BORROW_SOURCE, type TonicizeStyle } from '../knowledge/tonicizationPolicies';
import { chordToneIntervals, alignChordTypeToMgStyle, type ChordQuality } from '../knowledge/chords';
import { evaluateHarmony, type CoherenceChord } from '../knowledge/harmonicCoherence';
import { evaluateVoiceLeading, type LedgerChord } from '../knowledge/voiceLeadingLedger';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan, HarmonyLinkKind } from '../arranger/ArrangementPlan';
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
  bassPedalPc?: PitchClass;
  tonicizationPlacement?: TonicizationPlacement;
  preserveType?: boolean; // ★ 跳过 alignChordTypeToMgStyle 折叠(JPOP ii-V 精确品质)
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
      bassPedalPc: rc.bassPedalPc,
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
      // ★ 真 chord-scale:forcedScale(离调 V/ii 显式音阶)优先;否则调内→母调音阶(转调段落用该段实际调中心);
      //   属七/副属→根音 Mixolydian;借和弦→根音 Dorian。prototype 的 borrowedSource 也参与判定。
      if (rc.forcedScale && isKnownScaleType(rc.forcedScale)) {
        chordScaleMap[id] = [...getScalePitchClasses(rc.rootPc, rc.forcedScale)].sort((a, b) => a - b) as PitchClass[];
      } else {
        const isSec = rc.roman.secondaryTarget !== undefined || rc.borrowedSource === 'secondary_dominant' || rc.borrowedSource === 'secondary_ii_v';
        const isBor = rc.borrowed !== undefined || rc.borrowedSource === 'modal_interchange' || rc.borrowedSource === 'backdoor_dominant';
        chordScaleMap[id] = realChordScale(rc.rootPc, rc.sectionKeyPc ?? keyPc, keyMode, {
          isSecondaryDominant: isSec,
          isBorrowed: isBor,
          isDominant: rc.quality === '7', // 小调 V7(及任何属七)→ 升导音进音阶
        });
      }
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

/** resolved 进行 → CoherenceChord[](harmony 阶段适配)。Loop 8:用宽 chordType + borrowedSource
 *  (prototype 的副属/backdoor 现在能被 coherence 检测,补上旧"只 parallel-minor/major"的盲点)。 */
function resolvedToCoherenceChords(resolved: ResolvedChord[], keyPc: PitchClass): CoherenceChord[] {
  return resolved.map((rc) => {
    const rootPc = rc.rootPc as number;
    return {
      type: rc.chordType ?? rc.quality, // 宽类型 → coherence chordQuality 分族更准
      rootMidi: 60 + rootPc,
      notesMidi: chordToneIntervals(rc.quality).map((iv) => 60 + rootPc + iv), // 窄字面(进行逻辑评分够用)
      bassMidi: 36 + rootPc,
      roman: romanStr(rc),
      chordSymbol: romanStr(rc),
      duration: rc.durationBeats,
      effectiveFunc: rc.func,
      analysisKeyPc: (rc.localTonalCenterPc ?? rc.sectionKeyPc ?? keyPc) as number,
      localTonalCenterPc: rc.localTonalCenterPc as number | undefined,
      borrowedSource: rc.borrowedSource ?? (rc.borrowed ? 'modal_interchange' : undefined),
      mustResolve: rc.mustResolve ?? (rc.func === 'D' && rc.quality === '7'),
    };
  });
}

/** resolved 进行 → LedgerChord[](harmony 阶段适配:单八度字面,voice-leading 取最近 voice 评分)。 */
function resolvedToLedgerChords(resolved: ResolvedChord[]): LedgerChord[] {
  return resolved.map((rc) => {
    const rootPc = rc.rootPc as number;
    return {
      type: rc.chordType ?? rc.quality,
      rootMidi: 60 + rootPc,
      notesMidi: chordToneIntervals(rc.quality).map((iv) => 60 + mod12(rootPc + iv)),
      bassMidi: 36 + rootPc,
      borrowedFrom: rc.borrowedSource,
    };
  });
}

// ============================================================
// linkOut 段尾骨架链接(CODEX V4.2 T6):按 section.linkOut 改写【当前段尾 1-2 和弦】,
//   形成 verse/preHook → chorus 的功能推进。只改尾、不动段体(repeatGroup 段体不变,配对段同 link → 仍一致);
//   next-start 守卫:secondaryToRelativeMinor 需下一段起 vi、major 调,否则降级 dominantLift;backdoor 首版降级。
//   确定性,无 rng。chord-scale 由 assemble 据新和弦重算(清空旧 forcedScale/bassRole 等)。
// ============================================================
interface TailOpts { borrowed?: BorrowInfo; borrowedSource?: BorrowedSource; secondaryTarget?: RomanChord; mustResolve?: boolean; }
function overwriteChord(c: ResolvedChord, degree: number, quality: ChordQuality, func: HarmonicFunction, secKey: number, mode: DiatonicMode, opts: TailOpts = {}): void {
  c.rootPc = mod12(secKey + degreeToSemitone(degree, mode)) as PitchClass;
  c.quality = quality;
  c.chordType = quality;
  c.func = func;
  c.roman = { degree: degree as RomanChord['degree'], accidental: 'natural', quality, secondaryTarget: opts.secondaryTarget };
  c.borrowed = opts.borrowed;
  c.borrowedSource = opts.borrowedSource;
  c.mustResolve = opts.mustResolve;
  // 清空旧 prototype 携带的派生字段(避免与新和弦矛盾;chord-scale 在 assemble 重算)
  c.forcedScale = undefined; c.bassRole = undefined; c.bassPedalPc = undefined;
  c.tonicizationPlacement = undefined; c.localTonalCenterPc = undefined;
}

function applyTailLinks(resolved: ResolvedChord[], arrangement: ArrangementPlan, keyPc: PitchClass, mode: DiatonicMode): ResolvedChord[] {
  const out = resolved.map((c) => ({ ...c }));
  const idxBySection = new Map<string, { first: number; last: number }>();
  out.forEach((c, i) => {
    const r = idxBySection.get(c.sectionId);
    if (!r) idxBySection.set(c.sectionId, { first: i, last: i }); else r.last = i;
  });
  const sections = arrangement.sections;
  for (let s = 0; s < sections.length - 1; s++) {
    const link = sections[s].linkOut as HarmonyLinkKind | undefined;
    if (!link || link === 'none') continue;
    const range = idxBySection.get(sections[s].id);
    if (!range) continue;
    const nextRange = idxBySection.get(sections[s + 1].id);
    const nextStartDeg = nextRange ? (out[nextRange.first].roman.degree as number) : 1;
    const secKey = (out[range.last].sectionKeyPc ?? keyPc) as number;
    const has2 = range.last > range.first; // 段内 ≥2 和弦 → 可做双和弦尾

    // 守卫降级
    let kind: HarmonyLinkKind = link;
    if (kind === 'secondaryToRelativeMinor' && (mode !== 'major' || nextStartDeg !== 6)) kind = 'dominantLift';
    if (kind === 'backdoorToSubdominant') kind = 'dominantLift'; // 首版未实现 backdoor → 降级

    switch (kind) {
      case 'dominantLift': // IV -> V(入 I/vi)
        if (has2) overwriteChord(out[range.last - 1], 4, diatonicQuality(4, mode), 'S', secKey, mode);
        overwriteChord(out[range.last], 5, '7', 'D', secKey, mode, { mustResolve: true });
        break;
      case 'stopOnDominant': // V(停顿,落 hook 冲击)
        overwriteChord(out[range.last], 5, '7', 'D', secKey, mode, { mustResolve: true });
        break;
      case 'minorIvHold': // iv hold(悬色入 hook)
        overwriteChord(out[range.last], 4, 'm7', 'S', secKey, mode, { borrowed: { from: 'parallel-minor', label: 'iv' }, borrowedSource: 'modal_interchange' });
        break;
      case 'secondaryToRelativeMinor': // IV -> III7(V7/vi,入 vi)
        if (has2) overwriteChord(out[range.last - 1], 4, diatonicQuality(4, mode), 'S', secKey, mode);
        overwriteChord(out[range.last], 3, '7', 'D', secKey, mode, { borrowedSource: 'secondary_dominant', secondaryTarget: { degree: 6, accidental: 'natural', quality: 'min' }, mustResolve: true });
        break;
    }
  }
  return out;
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
  // Loop 8:择优分 = coherence(进行逻辑)0.75 + voice-leading(导音/属解决)0.25。
  let best: { resolved: ResolvedChord[]; score: number } | null = null;
  for (let k = 0; k < NUM_HARMONY_CANDIDATES; k++) {
    const cand = buildResolvedProgression(band, arrangement, ctx.substream('harmony'), sectionKeyOf, beatsPerBar);
    const coh = evaluateHarmony(resolvedToCoherenceChords(cand, band.key), styleName, band.key as number).score;
    const vl = evaluateVoiceLeading(resolvedToLedgerChords(cand)).overallScore;
    const combined = 0.75 * coh + 0.25 * vl;
    if (!best || combined > best.score) best = { resolved: cand, score: combined };
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
  const protoByGroup = new Map<string, SelectedProgression>(); // prototype-first 复用(Loop 2)
  // ★ 离调(tonicizationPlanner):per-song 预算 + per-group 缓存(repeatGroup 复用不重复消耗)
  const tonStyle = toHarmonyStyle(band.style) as TonicizeStyle;
  const tonMaxSong = STYLE_TONICIZE_MAX_PER_SONG[tonStyle] ?? 0;
  const tonSource = STYLE_BORROW_SOURCE[tonStyle];
  const tonByGroup = new Map<string, ResolvedChord[]>();
  let tonFiresUsed = 0;

  for (const section of arrangement.sections) {
    const sectionKey = sectionKeyOf(section.id); // 转调段落=新调中心,否则=主调
    const isModulated = sectionKey !== band.key;
    const group = section.repeatGroup;

    // ★ prototype-first(Loop 2):匹配到 prototype → 实化它(自带终止/borrow/副属),跳过 degree-picker。
    const picked = selectProgressionSlots({ band, section, hrng, protoByGroup });
    if (picked) {
      let protoChords = realizeProgressionSlots({
        slots: picked.slots, section, sectionKey, isModulated, beatsPerBar,
        style: toHarmonyStyle(band.style), colorBudget: band.styleProfile.colorBudget, random: hrng,
      });
      // ★ 卡农变体(JPOP):prototype 显式 transformPolicy.allowTonicization → 在已实化和弦上叠加 secondary ii-V/V
      //   (per-song 预算 + per-group 缓存,repeatGroup 复用不重复消耗;planner 给离调和弦 forcedScale 守不变量)。
      if (picked.transformPolicy?.allowTonicization && tonMaxSong > 0) {
        if (group && tonByGroup.has(group)) {
          protoChords = tonByGroup.get(group)!.map((c) => ({ ...c, sectionId: section.id, sectionKeyPc: isModulated ? sectionKey : undefined }));
        } else if (tonFiresUsed < tonMaxSong) {
          const budget = Math.min(tonStyle === 'JAZZ' ? 2 : 1, tonMaxSong - tonFiresUsed);
          const { chords: ton, fires } = planTonicization({ chords: protoChords, style: tonStyle, borrowSource: tonSource, maxFires: budget });
          tonFiresUsed += fires;
          protoChords = ton;
          if (group) tonByGroup.set(group, ton);
        }
      }
      resolved.push(...protoChords);
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

    // ★ 副属/离调改由 tonicizationPlanner 统一处理(下方,resolved 序列上)。这里只留借和弦。

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

    const secResolved: ResolvedChord[] = slots.map((s) => ({
      roman: s.roman,
      rootPc: s.rootPc,
      quality: s.quality,
      durationBeats: chordDurBeats as ResolvedChord['durationBeats'],
      sectionId: section.id,
      func: s.func,
      borrowed: s.borrowed,
      sectionKeyPc: isModulated ? sectionKey : undefined, // 转调段落 chord-scale 按新调中心解析
    }));

    // ★ 离调:在 diatonic fallback 段上注入 secondary ii-V / V(确定性,repeatGroup 复用不重复消耗预算)。
    //   prototype 段不经此(上面 continue 了)。LOFI/BLUES tonMaxSong=0 → 跳过。
    let finalSec = secResolved;
    if (group && tonByGroup.has(group)) {
      finalSec = tonByGroup.get(group)!.map((c) => ({ ...c, sectionId: section.id, sectionKeyPc: isModulated ? sectionKey : undefined }));
    } else if (tonMaxSong > 0 && tonFiresUsed < tonMaxSong) {
      const budget = Math.min(tonStyle === 'JAZZ' ? 2 : 1, tonMaxSong - tonFiresUsed);
      const { chords: ton, fires } = planTonicization({ chords: secResolved, style: tonStyle, borrowSource: tonSource, maxFires: budget });
      tonFiresUsed += fires;
      finalSec = ton;
      if (group) tonByGroup.set(group, ton);
    }
    resolved.push(...finalSec);
  }

  // ★ T6:段尾 linkOut 链接(每候选都链接 → coherence/voice-leading 择优看到真实段衔接)。
  const linked = applyTailLinks(resolved, arrangement, band.key, band.mode);
  // ★ MG 风格和弦词汇对齐(POP 折回三和弦纯度等)→ chordType/quality 一并改,propagate 到张力/chord-scale/voicing。
  return linked.map((rc) => {
    if (rc.preserveType) return rc; // ★ preserveType:保留作者品质(JPOP ii-V 依赖精确 m7b5/m7/7),跳过 POP 折叠
    const a = alignChordTypeToMgStyle(rc.chordType ?? rc.quality, rc.quality, band.style);
    return { ...rc, chordType: a.chordType, quality: a.quality };
  });
}
