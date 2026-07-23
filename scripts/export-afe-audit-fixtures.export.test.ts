// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-audit-fixtures — P2-2a 阶段B-2 conformance/控制环 fixtures 生成器
// ------------------------------------------------------------
// synthetic 输入(审计器级读取闭包, timebaseSpec 重建 Timebase)→ 跑【真实审计器/控制环】
// 捕获 oracle → 写 core/tests/golden/audit/audit_conformance_v5.json + generation_control_v5.json。
// 只调 auditHarmony/auditMusicality/runGenerationControl（禁 buildSongBundle/generateSong/
// orchestration → palette-independent）。引擎源零触碰：只在 scripts/。
// 每 case 机器断言：trigger 含 targetRuleId / nontrigger 不含 / 非目标限 allowedIncidentalRuleIds。
// ★ D2：审计器级读取闭包全 typed 构造——emptyArrangement/emptyInstrumentation 全字段显式（含完整 typed
//   GESTURE_NONE 常量，复制 src NONE_GESTURE 值），经 freezeHarmonicPlan/freezeArrangementPlan/
//   freezeInstrumentationPlan 交审计器，【零 whole-Plan cast / 零 as-unknown】；仅保留 branded-number
//   值级转换。tsc 编译期真正保证读取闭包完整（漏读字段 → tsc 错 + trigger/nontrigger 断言失败双重锁）。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit-fixtures.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTimebase, createRandomContext, ticks, beats, type Meter } from '../src/core/generation/newEngine/foundation';
import { auditHarmony, type AuditKeyContext } from '../src/core/generation/newEngine/render/readOnlyHarmonyAuditor';
import { auditMusicality } from '../src/core/generation/newEngine/render/musicalityAuditor';
import { runGenerationControl, type RenderAttempt } from '../src/core/generation/newEngine/generation/GenerationController';
import { DEFAULT_BUDGET } from '../src/core/generation/newEngine/generation/RetryPolicy';
import type { RetryContext } from '../src/core/generation/newEngine/generation/RetryContext';
import type { RetryLocator } from '../src/core/generation/newEngine/generation/retryMapping';
import { GROOVE_CONTRACT_POOL } from '../src/core/generation/newEngine/knowledge/grooveContracts';
import { freezeMusicalIR, type MusicalIRData, type TrackIR, type InstrumentRole } from '../src/core/generation/newEngine/ir/MusicalIR';
import { freezeHarmonicPlan, type HarmonicPlanData, type ChordSpan, type RomanChord, type HarmonicFunction } from '../src/core/generation/newEngine/harmony/HarmonicPlan';
import { freezeArrangementPlan, type ArrangementPlanData, type OpeningGesturePlan, type Section } from '../src/core/generation/newEngine/arranger/ArrangementPlan';
import { freezeInstrumentationPlan, type InstrumentationPlanData, type EndingPlan, type TransitionPlan, type GestureExpressionPlan } from '../src/core/generation/newEngine/instrumental/InstrumentationPlan';
import type { AuditFinding, AuditReport, Severity } from '../src/core/generation/newEngine/ir/AuditReport';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'tests', 'golden', 'audit');
const SPEC_ANCHOR = 'Newengine_Demo-v5.0 (fb33e9eaa74cee6a1c882b3d710391e969e0462e)';

const PPQ = 480;
const M44: Meter = { numerator: 4, denominator: 4 };
const TB_SPEC = { ppq: PPQ, meter: M44, tempoMap: [{ atBeat: beats(0), bpm: 120 }] };
const tb = createTimebase({ ppq: TB_SPEC.ppq, meter: TB_SPEC.meter, tempoMap: TB_SPEC.tempoMap });
const BEAT = PPQ, BAR = PPQ * 4;
const note = (pitch: number, startTick: number, durationTicks: number, velocity = 80): NoteSpec => ({ pitch, startTick, durationTicks, velocity });
const allRoles = <T>(v: T): Record<InstrumentRole, T> => ({ bass: v, comp: v, pad: v, lead: v, drum: v });

// ============================================================
// 读取闭包紧凑规格
// ============================================================
interface NoteSpec { pitch: number; startTick: number; durationTicks: number; velocity: number }
interface TrackSpec { role: InstrumentRole; notes: NoteSpec[]; program?: number; programChanges?: { atTick: number; program: number; bank?: number }[] }

function specToIR(tracks: TrackSpec[], durationTicks: number): MusicalIRData {
  return {
    tracks: tracks.map((t): TrackIR => ({
      role: t.role,
      notes: t.notes.map((n) => ({ pitch: n.pitch as never, startTick: ticks(n.startTick), durationTicks: ticks(n.durationTicks), velocity: n.velocity })),
      program: t.program,
      programChanges: t.programChanges?.map((p) => ({ atTick: ticks(p.atTick), program: p.program, bank: p.bank })),
    })),
    timebase: tb,
    durationTicks: ticks(durationTicks),
  };
}

// ---------- 和声 adapter ----------
const DEFAULT_ROMAN: RomanChord = { degree: 1, accidental: 'natural', quality: 'maj' };
interface ChordSpec { id: string; rootPc: number; quality: ChordSpan['quality']; startBeat: number; durationBeats: number; sectionId: string; func: HarmonicFunction; scale: number[]; stable: number[]; color: number[]; avoid: number[]; chordType?: string; bassRole?: ChordSpan['bassRole']; bassPedalPc?: number; localTonalCenterPc?: number }
interface HarmonyInput { ir: { tracks: TrackSpec[]; durationTicks: number }; chords: ChordSpec[]; modulation?: Record<string, { fromKey: number; toKey: number; semitones: number; label: string }>; keyCtx?: AuditKeyContext }

function specToHarmonicPlan(chords: ChordSpec[], modulation?: HarmonyInput['modulation']): HarmonicPlanData {
  const rec = <T>(pick: (c: ChordSpec) => T): Record<string, T> => Object.fromEntries(chords.map((c) => [c.id, pick(c)]));
  return {
    romanProgression: [], tensionMap: {}, borrowedChordMap: {}, // 未读→显式空
    chordTimeline: chords.map((c): ChordSpan => ({ id: c.id, roman: DEFAULT_ROMAN, rootPc: c.rootPc as never, quality: c.quality, startBeat: beats(c.startBeat), durationBeats: beats(c.durationBeats), sectionId: c.sectionId, chordType: c.chordType, bassRole: c.bassRole, bassPedalPc: c.bassPedalPc as never, localTonalCenterPc: c.localTonalCenterPc as never })),
    chordFunctionTimeline: chords.map((c) => c.func),
    chordScaleMap: rec((c) => c.scale as never), stableToneMap: rec((c) => c.stable as never), colorToneMap: rec((c) => c.color as never), avoidNoteMap: rec((c) => c.avoid as never),
    modulationMap: (modulation ?? {}) as never,
  };
}
const runHarmony = (i: HarmonyInput): AuditFinding[] => auditHarmony(freezeMusicalIR(specToIR(i.ir.tracks, i.ir.durationTicks)), freezeHarmonicPlan(specToHarmonicPlan(i.chords, i.modulation)), tb, i.keyCtx).findings;

// ---------- 音乐性 adapter：EMPTY default(未读显式空/最小stub) + 读取闭包 override ----------
const DEFAULT_GC = GROOVE_CONTRACT_POOL[0]; // KB 常量(palette-independent)
const DEFAULT_OPENING: OpeningGesturePlan = { sectionId: '', mode: 'coldDownbeat', drumEntry: 'none', textureEntry: 'none', roleDelayBars: {}, pickupBars: 0, intensity: 'medium' };
const DEFAULT_ENDING: EndingPlan = { style: 'cold', outroSectionId: null, outroBars: 0, exitBarByRole: {}, holdFinalChord: false, fadeOut: false, coldStop: false };
const DEFAULT_TRANSITION: TransitionPlan = { boundaries: [], songEntry: { firstSectionId: '', hasIntro: true, mode: 'normal-intro', downbeatAnchorRoles: [], delayedRoles: [] } };
// 完整 typed GestureExpressionPlan 常量（复制 src NONE_GESTURE 值；零 cast，读取闭包完整由 tsc 保证）
const GESTURE_NONE: GestureExpressionPlan = {
  kind: 'none', family: 'none', ccControllers: [], continuity: 'none', articulationScope: 'none',
  articulationExclusionGroup: 'none', triggerPolicy: 'none', phrasePolicy: 'none', evidenceRefs: [],
  breathModel: 'none', noteShape: 'none', articulation: 'none', velocityCurve: 'none',
  pedalPolicy: 'none', rudimentPolicy: 'none', hiHatPolicy: 'none',
};

function emptyArrangement(): ArrangementPlanData {
  return {
    sections: [], phrases: [], motifBindings: [], tempoBpm: 120, meter: M44,
    feel: { kind: 'straight', swingRatio: 0.5 }, phraseBreathing: { phraseBars: 4, cadenceBreathBeats: 0 },
    energyBySection: {}, densityBySection: {}, climaxMap: [], harmonicRhythmTarget: { chordsPerBarBySection: {} },
    grooveBySection: {}, grooveScorePlan: { grooveContractId: '', bySection: {}, boundaries: [] },
    drumPerformanceBySection: {}, rolePerformanceBySection: allRoles({}), leadCompCollisionPolicy: 'allow',
    songGrooveContract: DEFAULT_GC, songGrooveContractId: DEFAULT_GC.id, grooveContractBySection: {},
    entryBySection: {}, openingGesture: DEFAULT_OPENING, endingStyle: 'cold',
  };
}
function emptyInstrumentation(): InstrumentationPlanData {
  return {
    activeRolesBySection: {}, registerByRole: allRoles({ lowMidi: 0 as never, highMidi: 127 as never }),
    textureBySection: {}, richTextureBySection: {}, richTextureSwitchBySection: {},
    textureYieldPolicy: { 'active-comp': 'active', arpeggio: 'active', pad: 'floating', 'sustained-block': 'floating', 'walking-bass': 'active' },
    programByRoleSection: allRoles({}), bankByRoleSection: allRoles({}), roleProgram: allRoles(0), roleBank: {},
    voiceNameByRole: {}, voiceNameByRoleSection: allRoles({}), voiceProfileByRole: {}, voiceProfileByRoleSection: allRoles({}),
    orchestrationChain: { world: 'acousticPianoBand', profileId: '', decisions: [] },
    hardwareVoiceWorld: { targetId: '', melodicVoiceCount: 0, drumKitCount: 0, excludedMt32CompatibilityVoiceCount: 0, familyCounts: {} },
    mixByRoleSection: allRoles({}), spaceProfile: 'dryFront', gestureExpressionByRole: allRoles(GESTURE_NONE),
    pedalPlanByRole: {}, controllerPlanByRole: {}, drumPatternBySection: {}, drumPatternBySectionBar: {},
    melodyReservationPlan: { reservedRegister: { lowMidi: 0 as never, highMidi: 127 as never }, densityCeiling: 0, hookAnchorSlots: [] },
    endingPlan: DEFAULT_ENDING, transitionPlan: DEFAULT_TRANSITION, needsDownbeatCompAnchorBySection: {},
  };
}
const section = (id: string, bars: number): Section => ({ id, role: 'verse', bars, hookPolicy: 'none' });

interface MusInput {
  tracks: TrackSpec[]; durationTicks: number; style: string;
  arr?: Partial<ArrangementPlanData>; ins?: Partial<InstrumentationPlanData>;
  compGapExclude?: { lo: number; hi: number }[]; scoreOwnedCompSilence?: { lo: number; hi: number }[]; scoreOwnsCompTiming?: boolean;
}
function runMusicality(m: MusInput): AuditFinding[] {
  const arrangement = { ...emptyArrangement(), ...m.arr };
  const instrumentation = { ...emptyInstrumentation(), ...m.ins };
  return auditMusicality(freezeMusicalIR(specToIR(m.tracks, m.durationTicks)), freezeArrangementPlan(arrangement), freezeInstrumentationPlan(instrumentation), tb, m.style, m.compGapExclude, m.scoreOwnedCompSilence, m.scoreOwnsCompTiming).findings;
}

// ============================================================
// conformance cases
// ============================================================
interface ConfCase { id: string; pairedCase: string; targetRuleId: string; expect: 'trigger' | 'nontrigger'; predicate: string; boundary: string; allowedIncidentalRuleIds: string[]; run: () => AuditFinding[]; emitInput: () => unknown; auditor: 'auditHarmony' | 'auditMusicality' }

// ---- 完整读取闭包投影（emit 进 JSON；P2-2b 凭此无歧义调用，不读 sim 脚本；Blocker1）----
const gcRead = (gc: typeof DEFAULT_GC) => ({ id: gc.id, grid: gc.grid, rhythmProfile: gc.rhythmProfile ?? null, rhythmSwingSource: gc.rhythmSwingSource ?? null, compSwingRatio: gc.compSwingRatio });
function emitHarmonyInput(i: HarmonyInput): unknown {
  const hp = specToHarmonicPlan(i.chords, i.modulation);
  return {
    auditor: 'auditHarmony', timebaseSpec: TB_SPEC, ir: { tracks: i.ir.tracks, durationTicks: i.ir.durationTicks },
    harmonicPlan: {
      chordTimeline: hp.chordTimeline.map((c) => ({ id: c.id, rootPc: c.rootPc as number, quality: c.quality, startBeat: c.startBeat as number, durationBeats: c.durationBeats as number, sectionId: c.sectionId, chordType: c.chordType ?? null, bassRole: c.bassRole ?? null, bassPedalPc: (c.bassPedalPc ?? null) as number | null, localTonalCenterPc: (c.localTonalCenterPc ?? null) as number | null })),
      chordFunctionTimeline: hp.chordFunctionTimeline,
      chordScaleMap: hp.chordScaleMap, stableToneMap: hp.stableToneMap, colorToneMap: hp.colorToneMap, avoidNoteMap: hp.avoidNoteMap, modulationMap: hp.modulationMap,
    },
    keyCtx: i.keyCtx ?? null,
  };
}
function emitMusicalityInput(m: MusInput): unknown {
  const arr = { ...emptyArrangement(), ...m.arr };
  const ins = { ...emptyInstrumentation(), ...m.ins };
  return {
    auditor: 'auditMusicality', timebaseSpec: TB_SPEC, ir: { tracks: m.tracks, durationTicks: m.durationTicks }, style: m.style,
    arrangementPlan: {
      sections: arr.sections, meter: arr.meter, openingGesture: arr.openingGesture, songGrooveContract: gcRead(arr.songGrooveContract),
      grooveContractBySection: Object.fromEntries(Object.entries(arr.grooveContractBySection).map(([k, v]) => [k, gcRead(v)])),
    },
    instrumentationPlan: {
      transitionPlan: ins.transitionPlan, endingPlan: ins.endingPlan, activeRolesBySection: ins.activeRolesBySection, textureBySection: ins.textureBySection,
      textureYieldPolicy: ins.textureYieldPolicy, richTextureBySection: ins.richTextureBySection, richTextureSwitchBySection: ins.richTextureSwitchBySection, needsDownbeatCompAnchorBySection: ins.needsDownbeatCompAnchorBySection,
    },
    params: { compGapExclude: m.compGapExclude ?? [], scoreOwnedCompSilence: m.scoreOwnedCompSilence ?? [], scoreOwnsCompTiming: m.scoreOwnsCompTiming ?? false },
  };
}

const CMAJ = [0, 2, 4, 5, 7, 9, 11];
const keyCtxC: AuditKeyContext = { keyRootPc: 0, globalMode: 'major', isModalContext: false, tonalCharacter: 'tonal' };
const baseChord = (o: Partial<ChordSpec> = {}): ChordSpec => ({ id: 'c0', rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 4, sectionId: 's0', func: 'T', scale: CMAJ, stable: [0, 4, 7], color: [], avoid: [], ...o });
const cid = (rid: string, exp: string) => `${rid}__${exp}`; // 稳定 case id
const hc = (targetRuleId: string, expect: 'trigger' | 'nontrigger', predicate: string, boundary: string, allowedIncidentalRuleIds: string[], input: HarmonyInput): ConfCase =>
  ({ id: cid(targetRuleId, expect), pairedCase: cid(targetRuleId, expect === 'trigger' ? 'nontrigger' : 'trigger'), targetRuleId, expect, predicate, boundary, allowedIncidentalRuleIds, auditor: 'auditHarmony', run: () => runHarmony(input), emitInput: () => emitHarmonyInput(input) });
const mc = (targetRuleId: string, expect: 'trigger' | 'nontrigger', predicate: string, boundary: string, allowedIncidentalRuleIds: string[], input: MusInput): ConfCase =>
  ({ id: cid(targetRuleId, expect), pairedCase: cid(targetRuleId, expect === 'trigger' ? 'nontrigger' : 'trigger'), targetRuleId, expect, predicate, boundary, allowedIncidentalRuleIds, auditor: 'auditMusicality', run: () => runMusicality(input), emitInput: () => emitMusicalityInput(input) });

// ---------- 音乐性隔离 fixture：clean base 零 findings，每 case 最小扰动单规则 ----------
// clean 抑制策略：单段(无 boundary→无 transition/section-downbeat) / coldStop(无 outro) /
//   texture floating(无 comp-continuity) / needsAnchor=false / normal-intro(无 song-start) / style=pop(无 groove/clock)。
const CLEAN_END: EndingPlan = { ...DEFAULT_ENDING, coldStop: true };
const trk = (o: { drum?: NoteSpec[]; comp?: NoteSpec[]; bass?: NoteSpec[]; pad?: NoteSpec[]; lead?: NoteSpec[] }): TrackSpec[] => [
  ...(o.drum ? [{ role: 'drum' as InstrumentRole, notes: o.drum }] : []), ...(o.comp ? [{ role: 'comp' as InstrumentRole, notes: o.comp }] : []),
  ...(o.bass ? [{ role: 'bass' as InstrumentRole, notes: o.bass }] : []), ...(o.pad ? [{ role: 'pad' as InstrumentRole, notes: o.pad }] : []), ...(o.lead ? [{ role: 'lead' as InstrumentRole, notes: o.lead }] : []),
];
// 单段 clean（verse1 4bar）
const arr1 = (o: Partial<ArrangementPlanData> = {}): Partial<ArrangementPlanData> => ({ sections: [section('verse1', 4)], meter: M44, openingGesture: { ...DEFAULT_OPENING, sectionId: '' }, ...o });
const ins1 = (o: Partial<InstrumentationPlanData> = {}): Partial<InstrumentationPlanData> => ({
  transitionPlan: { boundaries: [], songEntry: { firstSectionId: 'verse1', hasIntro: true, mode: 'normal-intro', downbeatAnchorRoles: [], delayedRoles: [] } },
  endingPlan: CLEAN_END, activeRolesBySection: { verse1: ['bass', 'lead'] }, textureBySection: { verse1: 'pad' }, needsDownbeatCompAnchorBySection: { verse1: false }, ...o,
});
// 双段 clean（intro 2bar + verse1 4bar）+ 1 boundary（entry 可调）
const arr2 = (o: Partial<ArrangementPlanData> = {}): Partial<ArrangementPlanData> => ({ sections: [section('intro', 2), section('verse1', 4)], meter: M44, openingGesture: { ...DEFAULT_OPENING, sectionId: '' }, ...o });
const ins2 = (boundary: Partial<InstrumentationPlanData['transitionPlan']['boundaries'][number]>, o: Partial<InstrumentationPlanData> = {}): Partial<InstrumentationPlanData> => ({
  transitionPlan: { boundaries: [{ fromSectionId: 'intro', toSectionId: 'verse1', boundaryBar: 2, prepBar: 1, entry: 'downbeat', pickupRoles: [], releaseRoles: [], downbeatAnchorRoles: [], protectPickupFromGate: false, ...boundary }], songEntry: { firstSectionId: 'intro', hasIntro: true, mode: 'normal-intro', downbeatAnchorRoles: [], delayedRoles: [] } },
  endingPlan: CLEAN_END, activeRolesBySection: { intro: ['bass', 'lead'], verse1: ['bass', 'lead'] }, textureBySection: { intro: 'pad', verse1: 'pad' }, needsDownbeatCompAnchorBySection: { intro: false, verse1: false }, ...o,
});
// comp 覆盖末2小节(2..4bar)避免 outro；drum 在 s2 下拍避免 section-downbeat(当 anchor 含 drum 时不用)
const compFull = [note(60, 0, BAR), note(60, BAR, BAR), note(60, BAR * 2, BAR), note(60, BAR * 3, BAR)];

const CASES: ConfCase[] = [
  // ---- 和声 5 规则 ----
  hc('avoid-long-exposure', 'trigger', 'comp pc∈avoidNoteMap 暴露≥1拍', 'dur=1.0拍(oneBeat门槛)', [], { ir: { tracks: [{ role: 'comp', notes: [note(65, 0, BEAT)] }], durationTicks: BAR }, chords: [baseChord({ avoid: [5] })] }),
  hc('avoid-long-exposure', 'nontrigger', 'bass-pedal 本音豁免', 'bassRole=pedal 且 pc==bassPedalPc==avoid', [], { ir: { tracks: [{ role: 'bass', notes: [note(65, 0, BEAT)] }], durationTicks: BAR }, chords: [baseChord({ avoid: [5], bassRole: 'pedal', bassPedalPc: 5 })] }),
  hc('structural-tone-outside-intersection', 'trigger', 'lead 结构落点∉(stable∪color)∩scale−avoid', 'dur=0.75拍(structural门槛)', [], { ir: { tracks: [{ role: 'lead', notes: [note(62, 0, Math.round(0.75 * BEAT))] }], durationTicks: BAR }, chords: [baseChord()] }),
  hc('structural-tone-outside-intersection', 'nontrigger', 'lead 落点∈legal', 'pc=0∈{0,4,7}', [], { ir: { tracks: [{ role: 'lead', notes: [note(60, 0, Math.round(0.75 * BEAT))] }], durationTicks: BAR }, chords: [baseChord()] }),
  hc('chromatic-exposure', 'trigger', 'comp pc∉chordScale 暴露≥2拍', 'dur=2.0拍(twoBeat门槛)', [], { ir: { tracks: [{ role: 'comp', notes: [note(61, 0, 2 * BEAT)] }], durationTicks: BAR }, chords: [baseChord()] }),
  hc('chromatic-exposure', 'nontrigger', 'pc∈scale', 'pc=2∈Cmaj', [], { ir: { tracks: [{ role: 'comp', notes: [note(62, 0, 2 * BEAT)] }], durationTicks: BAR }, chords: [baseChord()] }),
  hc('note-context-avoid', 'trigger', 'lead scale 内音评判器判 avoid urgency≥0.9', 'dur≥2拍+urgency门0.9', ['chromatic-exposure', 'structural-tone-outside-intersection'], { ir: { tracks: [{ role: 'lead', notes: [note(65, 0, 2 * BEAT)] }], durationTicks: BAR }, chords: [baseChord({ color: [5] })], keyCtx: keyCtxC }),
  hc('note-context-avoid', 'nontrigger', 'chord tone 不判 avoid', 'pc=0 root', [], { ir: { tracks: [{ role: 'lead', notes: [note(60, 0, 2 * BEAT)] }], durationTicks: BAR }, chords: [baseChord()], keyCtx: keyCtxC }),
  hc('dissonant-vertical-clash', 'trigger', 'lead 与 comp |Δ|=1 重叠≥0.5拍', 'overlap=0.5拍(halfBeat门槛)', [], { ir: { tracks: [{ role: 'lead', notes: [note(60, 0, BEAT)] }, { role: 'comp', notes: [note(61, 0, BEAT)] }], durationTicks: BAR }, chords: [baseChord()] }),
  hc('dissonant-vertical-clash', 'nontrigger', '|Δ|≠1,13', 'Δ=2 大二度', [], { ir: { tracks: [{ role: 'lead', notes: [note(60, 0, BEAT)] }, { role: 'comp', notes: [note(62, 0, BEAT)] }], durationTicks: BAR }, chords: [baseChord()] }),
  // ---- 音乐性 8 规则（隔离干净）----
  // transition-pickup：双段 lead-in boundary，pickupRoles=[drum]，无 anchor（避 section-downbeat）
  mc('transition-pickup-missing', 'trigger', 'lead-in prepBar 无 pickup 起音', 'pickupRoles=[drum] prepBar(bar1) 无 drum', [], { tracks: trk({ bass: [note(60, 0, 240), note(60, BAR * 2, 240)] }), durationTicks: BAR * 6, style: 'pop', arr: arr2(), ins: ins2({ entry: 'lead-in', pickupRoles: ['drum'] }) }),
  mc('transition-pickup-missing', 'nontrigger', 'prepBar 有 pickup', 'drum onset∈prepBar(bar1)', [], { tracks: trk({ bass: [note(60, 0, 240), note(60, BAR * 2, 240)], drum: [note(38, BAR + 240, 120)] }), durationTicks: BAR * 6, style: 'pop', arr: arr2(), ins: ins2({ entry: 'lead-in', pickupRoles: ['drum'] }) }),
  // section-downbeat：双段 entry=downbeat（避 transition-pickup），downbeatAnchorRoles=[bass]
  mc('section-downbeat-anchor-missing', 'trigger', '新段下拍无 anchor 起音/延留', 'anchor=[bass] verse1 下拍(bar2)无 bass', [], { tracks: trk({ bass: [note(60, 0, 240)] }), durationTicks: BAR * 6, style: 'pop', arr: arr2(), ins: ins2({ entry: 'downbeat', downbeatAnchorRoles: ['bass'] }) }),
  mc('section-downbeat-anchor-missing', 'nontrigger', '下拍有 anchor', 'bass 在 verse1 下拍(bar2)', [], { tracks: trk({ bass: [note(60, 0, 240), note(60, BAR * 2, 240)] }), durationTicks: BAR * 6, style: 'pop', arr: arr2(), ins: ins2({ entry: 'downbeat', downbeatAnchorRoles: ['bass'] }) }),
  // song-start：单段 staged-first-bar + ≥3 非lead角色 tick<0.1ppq vel≥96
  mc('song-start-abrupt', 'trigger', 'staged-first-bar 且≥3 非lead角色<0.1ppq vel≥96 硬切', '3 角色 tick=0 vel=100', [], { tracks: trk({ drum: [note(38, 0, 120, 100)], comp: [note(60, 0, 240, 100)], bass: [note(48, 0, 240, 100)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ transitionPlan: { boundaries: [], songEntry: { firstSectionId: 'verse1', hasIntro: false, mode: 'staged-first-bar', downbeatAnchorRoles: [], delayedRoles: [] } } }) }),
  mc('song-start-abrupt', 'nontrigger', '<3 角色硬切', '仅 1 角色', [], { tracks: trk({ drum: [note(38, 0, 120, 100)], bass: [note(48, 0, 240, 60)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ transitionPlan: { boundaries: [], songEntry: { firstSectionId: 'verse1', hasIntro: false, mode: 'staged-first-bar', downbeatAnchorRoles: [], delayedRoles: [] } } }) }),
  // outro：单段 !coldStop，末2小节(bar2-4)无 comp/pad
  mc('outro-harmonic-support-missing', 'trigger', '末2小节无 comp/pad 且非 coldStop', 'verse1 末2bar 无 comp/pad', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, 0, 240)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ endingPlan: { ...DEFAULT_ENDING, coldStop: false } }) }),
  mc('outro-harmonic-support-missing', 'nontrigger', '末2小节有 comp 支撑', 'comp sounding 末段', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, BAR * 2, BAR * 2)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ endingPlan: { ...DEFAULT_ENDING, coldStop: false } }) }),
  // comp-continuity：单段 comp active(texture active-comp)，中段空洞，末2小节有 comp(避 outro)
  mc('comp-continuity-gap', 'trigger', 'comp active 段大空洞>阈值(pop 1.5拍)', 'comp 早+末有音，中段 >1.5拍空', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, 0, 240), note(60, BAR * 3, BAR)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ activeRolesBySection: { verse1: ['bass', 'comp', 'lead'] }, textureBySection: { verse1: 'active-comp' } }) }),
  mc('comp-continuity-gap', 'nontrigger', 'score-owned tacet 不算缺口', 'scoreOwnedCompSilence 覆盖空洞', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, 0, 240), note(60, BAR * 3, BAR)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ activeRolesBySection: { verse1: ['bass', 'comp', 'lead'] }, textureBySection: { verse1: 'active-comp' } }), scoreOwnedCompSilence: [{ lo: 240, hi: BAR * 3 }] }),
  // structural-comp-anchor：单段 needsAnchor，comp present 非下拍，texture floating(避 comp-continuity)
  mc('structural-comp-anchor-late', 'trigger', 'needsDownbeatCompAnchor 段下拍±0.08拍无 comp', 'verse1 needs anchor，comp 仅在 bar2+', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, BAR, 240)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ needsDownbeatCompAnchorBySection: { verse1: true } }) }),
  mc('structural-comp-anchor-late', 'nontrigger', '下拍有 comp anchor', 'comp 在 verse1 下拍(0)±0.08', [], { tracks: trk({ bass: [note(60, 0, 240)], comp: [note(60, 0, 240)] }), durationTicks: BAR * 4, style: 'pop', arr: arr1(), ins: ins1({ needsDownbeatCompAnchorBySection: { verse1: true } }) }),
  // lead-groove-desync：单段 jazz，comp 落 swung 0.66，lead 落直拍
  mc('lead-groove-desync', 'trigger', 'jazz lead 几乎不摆(<0.03)而 comp 摆(>0.15)', 'comp onset 落 0.66 位, lead 落直拍', [], { tracks: trk({ lead: [note(60, 0, 240), note(72, BEAT, 240), note(60, BEAT * 2, 240), note(72, BEAT * 3, 240)], comp: Array.from({ length: 8 }, (_, i) => note(60, Math.round((i + 0.66) * BEAT), 120)) }), durationTicks: BAR * 2, style: 'jazz', arr: arr1(), ins: ins1() }),
  mc('lead-groove-desync', 'nontrigger', 'pop 风格不判此规则', 'style=pop', [], { tracks: trk({ lead: [note(60, 0, 240)], comp: [note(60, Math.round(0.66 * BEAT), 120)] }), durationTicks: BAR, style: 'pop', arr: arr1(), ins: ins1() }),
  // texture-clock-drift：单段 lofi，comp 柱式块偏 grid，texture floating(避 comp-continuity)
  mc('texture-clock-drift', 'trigger', 'lofi comp 柱式块系统性偏 groove 网格>0.055', '≥4 块且>15% off-grid(0.3 相位)', [], { tracks: trk({ comp: Array.from({ length: 6 }, (_, i) => [note(60, Math.round((i + 0.3) * BEAT), 120), note(64, Math.round((i + 0.3) * BEAT), 120)]).flat() }), durationTicks: BAR * 2, style: 'lofi', arr: arr1({ songGrooveContract: { ...DEFAULT_GC, grid: 'straight', compSwingRatio: 0.5 } }), ins: ins1() }),
  mc('texture-clock-drift', 'nontrigger', 'pop 风格不判此规则', 'style=pop', [], { tracks: trk({ comp: [note(60, 0, 120), note(64, 0, 120)] }), durationTicks: BAR, style: 'pop', arr: arr1(), ins: ins1() }),
];

// ============================================================
// 控制环 fixtures：mock render 喂脚本 audit → 真实 runGenerationControl → 捕获 status/attempts/hasIr/retrySeq
// changedStages 由【实测 RNG 子流指纹】对比得出(非查表)；locatorSpec 序列化(tick→span 可重放)。
// ============================================================
const F = (severity: Severity, trackRole: string, ruleId = 'x', startTick = 0, suggestedReturnPoint: AuditFinding['suggestedReturnPoint'] = 'rewind-melody'): AuditFinding => ({ severity, location: { trackRole, startTick }, ruleId, reason: 'synthetic', suggestedReturnPoint });
const emptyIR = () => freezeMusicalIR({ tracks: [], timebase: tb, durationTicks: ticks(0) });
const RETURN_STAGE: Record<string, string> = { 'rewind-resolver': 'resolver', 'rewind-melody': 'melody', 'rewind-accompaniment': 'accompaniment', 'render-fallback': 'melody' };
const PROBE_STAGES = ['melody', 'accompaniment', 'resolver'] as const;
const fingerprint = (rng: ReturnType<typeof createRandomContext>): Record<string, number> => Object.fromEntries(PROBE_STAGES.map((s) => [s, rng.substream(s).next()]));
const changedStages = (a: Record<string, number>, b: Record<string, number>): string[] => PROBE_STAGES.filter((s) => a[s] !== b[s]);
interface LocatorSpec { hits: { tick: number; spanId: string }[] }
const buildLocator = (spec: LocatorSpec): RetryLocator => ({ spanAtTick: (t) => spec.hits.find((h) => h.tick === t)?.spanId });

interface ControlScenario { id: string; scriptedFindings: AuditFinding[][]; acceptLeadErrors?: boolean; acceptNonLeadErrors?: boolean; locatorSpec?: LocatorSpec; note: string }
function runControl(sc: ControlScenario) {
  const seedRng = createRandomContext(12345);
  let prevFp = fingerprint(seedRng); // 基线 = seedRng 指纹
  const retrySeq: { returnPoint: string; voicingSaferSpans: string[]; impliedStage: string; changedStages: string[] }[] = [];
  let call = 0;
  const render = (retry: RetryContext | undefined): RenderAttempt => {
    if (retry) {
      const fp = fingerprint(retry.rng);
      retrySeq.push({ returnPoint: retry.returnPoint, voicingSaferSpans: Object.keys(retry.voicingSafer), impliedStage: RETURN_STAGE[retry.returnPoint], changedStages: changedStages(prevFp, fp) });
      prevFp = fp;
    }
    const findings = sc.scriptedFindings[Math.min(call, sc.scriptedFindings.length - 1)];
    call += 1;
    return { ir: emptyIR(), audit: { findings } as AuditReport };
  };
  const res = runGenerationControl(render, seedRng, DEFAULT_BUDGET, sc.locatorSpec ? buildLocator(sc.locatorSpec) : undefined, sc.acceptNonLeadErrors ?? false, sc.acceptLeadErrors ?? false);
  return { status: res.status, attempts: res.attempts, hasIr: res.ir != null, retrySeq };
}

// 顺序向量用【不同 suggestedReturnPoint】(warning=rewind-resolver / error=rewind-accompaniment)使输出可区分 findings[0]
const CONTROL: ControlScenario[] = [
  { id: 'pass', scriptedFindings: [[]], note: 'findings 空 → pass/attempts1/hasIr' },
  { id: 'warning', scriptedFindings: [[F('warning', 'comp')]], note: 'warning 不阻断 → warning/attempts1/hasIr' },
  { id: 'lead-error-immediate-failed', scriptedFindings: [[F('error', 'lead')]], note: 'lead error 立即 failed/无 IR' },
  { id: 'nonlead-error-retry-converge', scriptedFindings: [[F('error', 'comp')], []], note: 'non-lead error 重试收敛 pass/attempts2' },
  { id: 'budget-exhausted', scriptedFindings: [[F('error', 'comp')]], note: 'wholeSong=12 耗尽 → failed/attempts12/11retry/无 IR' },
  { id: 'lead-fatal-accept-still-failed', scriptedFindings: [[F('fatal', 'lead')]], acceptLeadErrors: true, note: 'lead fatal 即使 accept 也立即 failed' },
  { id: 'nonlead-fatal-retry', scriptedFindings: [[F('fatal', 'comp')], []], acceptNonLeadErrors: true, note: 'non-lead fatal accept 不接受但可重试收敛' },
  { id: 'accept-lead-error-warning', scriptedFindings: [[F('error', 'lead')]], acceptLeadErrors: true, note: '接受 lead error → warning 非 pass/hasIr' },
  { id: 'accept-nonlead-error-warning', scriptedFindings: [[F('error', 'comp')]], acceptNonLeadErrors: true, note: '接受 non-lead error → warning' },
  { id: 'order-warning-error', scriptedFindings: [[F('warning', 'comp', 'w', 0, 'rewind-resolver'), F('error', 'comp', 'e', 0, 'rewind-accompaniment')], []], note: '[warning,error]：blocking 查全数组(error 阻断)，retry 消费 findings[0]=warning → returnPoint=rewind-resolver(证 findings[0])' },
  { id: 'order-error-warning', scriptedFindings: [[F('error', 'comp', 'e', 0, 'rewind-accompaniment'), F('warning', 'comp', 'w', 0, 'rewind-resolver')], []], note: '[error,warning]：retry 消费 findings[0]=error → returnPoint=rewind-accompaniment' },
  { id: 'locator-hit-rung1-then-rung4', scriptedFindings: [[F('error', 'comp', 'e', 100)], [F('error', 'comp', 'e', 100)], []], locatorSpec: { hits: [{ tick: 100, spanId: 'span0' }] }, note: 'locator 命中：首轮 rung1(rewind-accompaniment+voicingSafer)，同 span 复现 rung4(render-fallback)' },
  { id: 'locator-miss-fallback', scriptedFindings: [[F('error', 'comp', 'e', 999)], []], locatorSpec: { hits: [{ tick: 100, spanId: 'span0' }] }, note: 'locator 不命中(spanAtTick 999→undefined) → render-fallback(非 suggestedReturnPoint)' },
  { id: 'no-locator-suggested-returnpoint', scriptedFindings: [[F('error', 'comp', 'e', 0, 'rewind-accompaniment')], []], note: '无 locator → finding.suggestedReturnPoint(用非默认 rewind-accompaniment 证读取了 suggestedReturnPoint 非默认 rewind-melody)' },
];

// JSON 递归 diff → 叶子级差异 [{path, from, to, fromPresent, toPresent}]（数组增删致 undefined 从 JSON 消失，故记 present）
function jsonDiffPaths(a: unknown, b: unknown, path: string): { path: string; from: unknown; to: unknown; fromPresent: boolean; toPresent: boolean }[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [{ path: path || '$', from: a ?? null, to: b ?? null, fromPresent: a !== undefined, toPresent: b !== undefined }];
  const out: { path: string; from: unknown; to: unknown; fromPresent: boolean; toPresent: boolean }[] = [];
  for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
    const kp = Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
    out.push(...jsonDiffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], kp));
  }
  return out;
}
const normLeaf = (p: string) => p.replace(/\[\d+\]/g, '[*]');
// 每规则 trigger↔nontrigger 叶子级扰动合同：allowed=实际 diff 归一化叶子全集(any 未列→红，防无关扰动)；
//   required=关键判据叶子(≥1 须现，证扰动就是 predicate 定义的那个)。
const MUTATION_CONTRACT: Record<string, { allowed: string[]; required: string[] }> = {
  'avoid-long-exposure': { allowed: ['ir.tracks[*].role', 'harmonicPlan.chordTimeline[*].bassRole', 'harmonicPlan.chordTimeline[*].bassPedalPc'], required: ['harmonicPlan.chordTimeline[*].bassRole'] },
  'structural-tone-outside-intersection': { allowed: ['ir.tracks[*].notes[*].pitch'], required: ['ir.tracks[*].notes[*].pitch'] },
  'chromatic-exposure': { allowed: ['ir.tracks[*].notes[*].pitch'], required: ['ir.tracks[*].notes[*].pitch'] },
  'note-context-avoid': { allowed: ['ir.tracks[*].notes[*].pitch', 'harmonicPlan.colorToneMap.c0[*]'], required: ['ir.tracks[*].notes[*].pitch'] },
  'dissonant-vertical-clash': { allowed: ['ir.tracks[*].notes[*].pitch'], required: ['ir.tracks[*].notes[*].pitch'] },
  'transition-pickup-missing': { allowed: ['ir.tracks[*].role', 'ir.tracks[*].notes[*].pitch', 'ir.tracks[*].notes[*].startTick', 'ir.tracks[*].notes[*].durationTicks', 'ir.tracks[*].notes[*]', 'ir.tracks[*]'], required: ['ir.tracks[*]'] },
  'section-downbeat-anchor-missing': { allowed: ['ir.tracks[*].notes[*]'], required: ['ir.tracks[*].notes[*]'] },
  'song-start-abrupt': { allowed: ['ir.tracks[*].role', 'ir.tracks[*].notes[*].pitch', 'ir.tracks[*].notes[*].velocity', 'ir.tracks[*]'], required: ['ir.tracks[*]'] },
  'outro-harmonic-support-missing': { allowed: ['ir.tracks[*].notes[*].startTick', 'ir.tracks[*].notes[*].durationTicks'], required: ['ir.tracks[*].notes[*].startTick'] },
  'comp-continuity-gap': { allowed: ['params.scoreOwnedCompSilence[*]'], required: ['params.scoreOwnedCompSilence[*]'] },
  'structural-comp-anchor-late': { allowed: ['ir.tracks[*].notes[*].startTick'], required: ['ir.tracks[*].notes[*].startTick'] },
  'lead-groove-desync': { allowed: ['ir.tracks[*].notes[*]', 'ir.durationTicks', 'style'], required: ['style'] },
  'texture-clock-drift': { allowed: ['ir.tracks[*].notes[*].startTick', 'ir.tracks[*].notes[*]', 'ir.durationTicks', 'style'], required: ['style'] },
};

// ============================================================
// 生成 + 机器断言 + emit
// ============================================================
describe('export afe audit fixtures (conformance + control)', () => {
  it('constructs synthetic inputs, runs real auditors/controller, asserts, emits', () => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ---- conformance（恒 fail-closed 断言；无旁路。trigger+nontrigger 均查 allowlist；Blocker1 emit 完整读取闭包）----
    const confResults = CASES.map((c) => {
      const findings = c.run();
      const ruleIds = findings.map((f) => f.ruleId);
      if (c.expect === 'trigger') expect(ruleIds, `${c.id}/trigger 须含目标`).toContain(c.targetRuleId);
      else expect(ruleIds, `${c.id}/nontrigger 不得含目标`).not.toContain(c.targetRuleId);
      for (const r of ruleIds.filter((x) => x !== c.targetRuleId)) expect(c.allowedIncidentalRuleIds, `${c.id} 非目标 finding ${r} 须在 allowlist`).toContain(r); // 双分支 allowlist
      return { id: c.id, pairedCase: c.pairedCase, targetRuleId: c.targetRuleId, expect: c.expect, auditor: c.auditor, predicate: c.predicate, boundary: c.boundary, allowedIncidentalRuleIds: c.allowedIncidentalRuleIds, input: c.emitInput(), expectedFindings: findings };
    });
    // 覆盖矩阵：13 规则各 ≥1 trigger + ≥1 nontrigger
    const ALL_13 = ['avoid-long-exposure', 'structural-tone-outside-intersection', 'chromatic-exposure', 'note-context-avoid', 'dissonant-vertical-clash', 'transition-pickup-missing', 'section-downbeat-anchor-missing', 'song-start-abrupt', 'outro-harmonic-support-missing', 'comp-continuity-gap', 'structural-comp-anchor-late', 'lead-groove-desync', 'texture-clock-drift'];
    for (const r of ALL_13) {
      expect(confResults.some((x) => x.targetRuleId === r && x.expect === 'trigger'), `${r} 缺 trigger`).toBe(true);
      expect(confResults.some((x) => x.targetRuleId === r && x.expect === 'nontrigger'), `${r} 缺 nontrigger`).toBe(true);
    }
    // D5 成对结构化 mutations：计算 trigger↔nontrigger 实际 JSON diff，存 mutations[{path,from,to}]，
    //   断言 diff 非空 + 每条 diff 路径 ⊆ 该规则【声明前缀】(证关键差异与 predicate 一致、无无关扰动)
    const byCaseId = Object.fromEntries(confResults.map((x) => [x.id, x]));
    for (const x of confResults) {
      expect(byCaseId[x.pairedCase], `${x.id}: pairedCase ${x.pairedCase} 不存在`).toBeTruthy();
      if (x.expect !== 'trigger') continue;
      const muts = jsonDiffPaths(byCaseId[x.pairedCase].input, x.input, '');
      (x as { mutations?: unknown }).mutations = muts;
      expect(muts.length, `${x.id}: trigger/nontrigger 无扰动(diff 空)`).toBeGreaterThan(0);
      const contract = MUTATION_CONTRACT[x.targetRuleId] ?? { allowed: [], required: [] };
      const leaves = new Set(muts.map((mm) => normLeaf(mm.path)));
      // ① 每条实际叶子 ∈ allowed（any 无关叶子 → 红）
      for (const leaf of leaves) expect(contract.allowed, `${x.id}: 扰动叶子 ${leaf} 不在 allowed [${contract.allowed.join(',')}](无关字段扰动?)`).toContain(leaf);
      // ② 每个 required 判据叶子须现（证扰动=predicate 定义的关键差异）
      for (const req of contract.required) expect(leaves.has(req), `${x.id}: 缺关键判据扰动 ${req}`).toBe(true);
    }

    // ---- control（全 14 场景 exact 断言）----
    const ctrlResults = CONTROL.map((sc) => ({ id: sc.id, note: sc.note, acceptLeadErrors: sc.acceptLeadErrors ?? false, acceptNonLeadErrors: sc.acceptNonLeadErrors ?? false, locatorSpec: sc.locatorSpec ?? null, scriptedFindings: sc.scriptedFindings, ...runControl(sc) }));
    const byId = Object.fromEntries(ctrlResults.map((r) => [r.id, r]));
    const rp = (id: string, i: number) => byId[id].retrySeq[i]?.returnPoint;
    const cs = (id: string, i: number) => JSON.stringify(byId[id].retrySeq[i]?.changedStages);
    const EXP: Record<string, { status: string; attempts: number; hasIr: boolean }> = {
      pass: { status: 'pass', attempts: 1, hasIr: true }, warning: { status: 'warning', attempts: 1, hasIr: true },
      'lead-error-immediate-failed': { status: 'failed', attempts: 1, hasIr: false }, 'nonlead-error-retry-converge': { status: 'pass', attempts: 2, hasIr: true },
      'budget-exhausted': { status: 'failed', attempts: 12, hasIr: false }, 'lead-fatal-accept-still-failed': { status: 'failed', attempts: 1, hasIr: false },
      'nonlead-fatal-retry': { status: 'pass', attempts: 2, hasIr: true }, 'accept-lead-error-warning': { status: 'warning', attempts: 1, hasIr: true },
      'accept-nonlead-error-warning': { status: 'warning', attempts: 1, hasIr: true }, 'order-warning-error': { status: 'pass', attempts: 2, hasIr: true },
      'order-error-warning': { status: 'pass', attempts: 2, hasIr: true }, 'locator-hit-rung1-then-rung4': { status: 'pass', attempts: 3, hasIr: true },
      'locator-miss-fallback': { status: 'pass', attempts: 2, hasIr: true }, 'no-locator-suggested-returnpoint': { status: 'pass', attempts: 2, hasIr: true },
    };
    for (const [id, e] of Object.entries(EXP)) {
      expect(byId[id].status, `${id} status`).toBe(e.status);
      expect(byId[id].attempts, `${id} attempts`).toBe(e.attempts);
      expect(byId[id].hasIr, `${id} hasIr`).toBe(e.hasIr);
    }
    expect(byId['budget-exhausted'].retrySeq.length, 'budget 11 retry').toBe(11);
    // findings[0] 选取（不同 returnPoint 区分）+ RNG 实测变化(changedStages)
    expect(rp('order-warning-error', 0), 'findings[0]=warning→rewind-resolver').toBe('rewind-resolver');
    expect(cs('order-warning-error', 0)).toBe(JSON.stringify(['resolver']));
    expect(rp('order-error-warning', 0), 'findings[0]=error→rewind-accompaniment').toBe('rewind-accompaniment');
    expect(cs('order-error-warning', 0)).toBe(JSON.stringify(['accompaniment']));
    expect(rp('locator-hit-rung1-then-rung4', 0), 'rung1').toBe('rewind-accompaniment');
    expect(byId['locator-hit-rung1-then-rung4'].retrySeq[0].voicingSaferSpans).toEqual(['span0']);
    expect(cs('locator-hit-rung1-then-rung4', 0)).toBe(JSON.stringify(['accompaniment']));
    expect(rp('locator-hit-rung1-then-rung4', 1), 'rung4').toBe('render-fallback');
    expect(cs('locator-hit-rung1-then-rung4', 1)).toBe(JSON.stringify(['melody']));
    expect(rp('locator-miss-fallback', 0), 'miss→fallback').toBe('render-fallback');
    expect(rp('no-locator-suggested-returnpoint', 0), '无locator→suggestedReturnPoint(非默认)').toBe('rewind-accompaniment');

    const provenance = { specAnchor: SPEC_ANCHOR, generator: 'scripts/export-afe-audit-fixtures.export.test.ts', method: 'synthetic 完整读取闭包输入 → 真实 auditHarmony/auditMusicality/runGenerationControl → oracle + 写前 fail-closed 机器断言', note: 'palette-independent(不调 orchestration)；pin/零触碰见 g6_spec_anchor.md；changedStages 由实测 RNG 子流指纹对比得出' };
    writeFileSync(join(OUT_DIR, 'audit_conformance_v5.json'), JSON.stringify({ schemaVersion: 'audit_conformance_v5', sourceFormat: 'synthetic', scope: 'P2-2a 13 规则 conformance(trigger/nontrigger 边界；input=完整读取闭包)', provenance, coverage: { rules: ALL_13.length, cases: confResults.length }, cases: confResults }, null, 1) + '\n');
    writeFileSync(join(OUT_DIR, 'generation_control_v5.json'), JSON.stringify({ schemaVersion: 'generation_control_v5', scope: 'P2-2a 控制环消费向量', provenance, budget: DEFAULT_BUDGET, scenarios: ctrlResults }, null, 1) + '\n');
    console.error(`CONFORMANCE ${confResults.length} cases (13 rules) / CONTROL ${ctrlResults.length} scenarios`);
  });
});
