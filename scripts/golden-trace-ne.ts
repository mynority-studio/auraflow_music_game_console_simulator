// ============================================================
// golden-trace-ne.ts — newEngine C 移植黄金对账导出器（L0 / L1 / L2 / L3）
// ------------------------------------------------------------
// 用法: npx tsx scripts/golden-trace-ne.ts <outDir>
//
// 范围（docs/transplant/esp32s3.md §9 P1a；GPL 决策已出 = 项目走整固件 GPLv3）:
//   L0/L1 = 四规划层（band/arranger/harmony/instrumental）+ RandomContext（与 GPL 解耦）。
//   L2/L3 = 产品路径 generateSong（含 audit + retry 环）→ MusicalIR + irToMidi 事件流；
//     经 renderSongFull/MG 链消费 GPLv2+ 语料 → 仅在整固件 GPLv3 决策后导出（见 §5#19-23）。
//
// L0: RandomContext raw uint32 序列（mulberry32 除法前状态，由
//     next()*2^32 精确恢复——u32/2^32 在 double 中可精确表示）。13 子流 × 多 seed × advance。
// L1: 四层规划产物关键字段摘要 + FNV-1a 哈希（L1-L4 对账）。
// L2: generateSong → {status,attempts,findings} + MusicalIR（tracks[] 可变 2-5，全字段）。
// L3: musicalIRToMidiEvents → 稳定序事件流（tick↑ → noteOff 优先 → 原 push seq）。
// ============================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRandomContext, type StageName } from '../src/core/generation/newEngine/foundation/randomContext';
import { buildBandSpec, type GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';
import { buildArrangementPlan } from '../src/core/generation/newEngine/arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../src/core/generation/newEngine/harmony/harmonyEngine';
import { buildInstrumentationPlan } from '../src/core/generation/newEngine/instrumental/instrumentalPlanner';
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import { musicalIRToMidiEvents } from '../src/core/generation/newEngine/sandbox/irToMidi';
import type { MusicalIR } from '../src/core/generation/newEngine/ir/MusicalIR';

const ALL_STAGES: StageName[] = [
  'band', 'time', 'arranger', 'harmony', 'instrumental', 'timbre',
  'prepass', 'accompaniment', 'compTexture', 'padStyle', 'melody', 'resolver', 'humanize',
];

// ---------- L0 ----------

const L0_PRIMARY_SEED = 12345;
const L0_PRIMARY_COUNT = 1000;
const L0_EXTRA_SEEDS = [1, 2, 999999937, 4294967295]; // 含 uint32 上界
const L0_EXTRA_COUNT = 100;
const L0_ADVANCE_STAGES: StageName[] = ['melody', 'accompaniment'];
const L0_ADVANCE_COUNT = 100;

interface L0Stream {
  key: string;        // 期望的子流 key（C 侧自建后字符串比对）
  seed: number;
  stage: StageName;
  adv: number;        // advance 次数
  values: number[];   // raw uint32 序列
}

function rawU32Stream(seed: number, stage: StageName, adv: number, count: number): L0Stream {
  let ctx = createRandomContext(seed);
  for (let i = 0; i < adv; i++) ctx = ctx.advance(stage);
  const rng = ctx.substream(stage);
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(rng.next() * 4294967296); // 精确恢复 raw u32
  return { key: `${seed}:${stage}:${adv}`, seed, stage, adv, values };
}

function buildL0(): L0Stream[] {
  const streams: L0Stream[] = [];
  for (const stage of ALL_STAGES) streams.push(rawU32Stream(L0_PRIMARY_SEED, stage, 0, L0_PRIMARY_COUNT));
  for (const seed of L0_EXTRA_SEEDS)
    for (const stage of ALL_STAGES) streams.push(rawU32Stream(seed, stage, 0, L0_EXTRA_COUNT));
  for (const stage of L0_ADVANCE_STAGES)
    for (const adv of [1, 2]) streams.push(rawU32Stream(L0_PRIMARY_SEED, stage, adv, L0_ADVANCE_COUNT));
  return streams;
}

// ---------- L1 ----------

const L1_SEEDS = [12345, 7, 42, 1001, 20260612, 31415926, 271828182, 999999937];
/* T1 复核扩充: +modal(modal regime 分支)/default(自身命中)/__unknown__(回退语义) */
const L1_STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'modal', 'default', '__unknown__'];

/** 键序稳定的 stringify（哈希输入必须与实现无关地确定） */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function buildL1Case(seed: number, styleHint: string) {
  // 严格镜像 GenerationController.generateSong 的前四步（含 NewEnginePanel 的请求参数）
  const request: GenerationRequest = { seed, styleHint, mood: 'calm-build', targetDuration: 120, allowModulation: true };
  const seedRng = createRandomContext(seed);
  const band = buildBandSpec(request);
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic);

  return {
    seed,
    styleHint,
    band: {
      style: band.style,
      tonalityKind: band.tonalityKind,
      key: band.key,
      mode: band.mode,
      modalModeName: band.modalModeName ?? null,
      primaryScale: band.primaryScale,
      instrumentPool: band.instrumentPool,
      roleProgram: band.roleProgram,
      hash: fnv1a(stableStringify(band)),
    },
    arrangement: {
      tempoBpm: arrangement.tempoBpm,
      meter: arrangement.meter,
      feel: arrangement.feel,
      endingStyle: arrangement.endingStyle,
      phraseBreathing: arrangement.phraseBreathing,
      sections: arrangement.sections.map((s) => ({
        id: s.id, role: s.role, bars: s.bars,
        repeatGroup: (s as { repeatGroup?: string }).repeatGroup ?? null,
        functionTag: (s as { functionTag?: string }).functionTag ?? null,
        harmonyRole: (s as { harmonyRole?: string }).harmonyRole ?? null,
        linkOut: (s as { linkOut?: string }).linkOut ?? null,
        hookPolicy: s.hookPolicy,
      })),
      phrases: arrangement.phrases.map((p) => ({
        id: p.id, sectionId: p.sectionId, bars: p.bars, phraseSlot: p.phraseSlot,
        role: p.role, cadenceTarget: p.cadenceTarget,
        repeatGroup: (p as { repeatGroup?: string }).repeatGroup ?? null,
        skeletonRole: p.skeletonRole,
      })),
      motifBindings: arrangement.motifBindings.map((m) => ({
        id: m.id, motifId: m.motifId, phraseId: m.phraseId,
        repeatGroup: (m as { repeatGroup?: string }).repeatGroup ?? null,
        requestedRestatementStrength: m.requestedRestatementStrength,
      })),
      phraseCount: arrangement.phrases.length,
      motifBindingCount: arrangement.motifBindings.length,
      energyBySection: arrangement.energyBySection,
      densityBySection: arrangement.densityBySection,
      climaxMap: arrangement.climaxMap,
      chordsPerBarBySection: arrangement.harmonicRhythmTarget.chordsPerBarBySection,
      grooveBySection: arrangement.grooveBySection,
      entryBySection: arrangement.entryBySection,
      hash: fnv1a(stableStringify(arrangement)),
    },
    harmonic: {
      chordCount: harmonic.chordTimeline.length,
      chords: harmonic.chordTimeline.map((c, i) => ({
        id: c.id,
        sectionId: c.sectionId,
        roman: {
          degree: c.roman.degree, accidental: c.roman.accidental, quality: c.roman.quality,
          secondaryTarget: c.roman.secondaryTarget
            ? { degree: c.roman.secondaryTarget.degree, accidental: c.roman.secondaryTarget.accidental, quality: c.roman.secondaryTarget.quality }
            : null,
        },
        rootPc: c.rootPc, quality: c.quality,
        startBeat: c.startBeat, durationBeats: c.durationBeats,
        chordType: c.chordType ?? null,
        borrowedSource: c.borrowedSource ?? null,
        mustResolve: c.mustResolve ?? false,
        forcedScale: c.forcedScale ?? null,
        localTonalCenterPc: c.localTonalCenterPc ?? null,
        bassRole: c.bassRole ?? null,
        bassPedalPc: c.bassPedalPc ?? null,
        tonicizationPlacement: c.tonicizationPlacement ?? null,
        borrowedFrom: c.borrowedFrom ?? null,
        effectiveFunc: c.effectiveFunc ?? null,
        analysisKeyPc: c.analysisKeyPc ?? null,
        localRoman: c.localRoman ?? null,
        func: harmonic.chordFunctionTimeline[i],
        scale: harmonic.chordScaleMap[c.id],
        stable: harmonic.stableToneMap[c.id],
        color: harmonic.colorToneMap[c.id],
        avoid: harmonic.avoidNoteMap[c.id],
        borrow: harmonic.borrowedChordMap[c.id] ?? null,
      })),
      modulationMap: harmonic.modulationMap,
      hash: fnv1a(stableStringify(harmonic)),
    },
    instrumentation: {
      world: instrumentation.orchestrationChain?.world ?? null,
      profileId: instrumentation.orchestrationChain?.profileId ?? null,
      roleProgram: instrumentation.roleProgram,
      timbreWorld: instrumentation.timbreWorld ?? null,
      sameInstrumentPairs: instrumentation.sameInstrumentPairs ?? null,
      spaceProfile: instrumentation.spaceProfile,
      activityBySection: instrumentation.activityBySection,
      activeRolesBySection: instrumentation.activeRolesBySection,
      textureBySection: instrumentation.textureBySection,
      richTextureBySection: instrumentation.richTextureBySection,
      richTextureSwitchBySection: instrumentation.richTextureSwitchBySection,
      programByRoleSection: instrumentation.programByRoleSection,
      mixByRoleSection: instrumentation.mixByRoleSection,
      drumPatternBySection: instrumentation.drumPatternBySection,
      needsDownbeatCompAnchorBySection: instrumentation.needsDownbeatCompAnchorBySection,
      melodyReservation: {
        densityCeiling: instrumentation.melodyReservationPlan.densityCeiling,
        hookAnchorSlots: instrumentation.melodyReservationPlan.hookAnchorSlots.map((h) => ({
          phraseId: h.phraseId, beatSlot: h.beatSlot,
          lowMidi: h.preferredRegister.lowMidi, highMidi: h.preferredRegister.highMidi,
          anchorRequired: h.anchorRequired, maxAccompanimentDensity: h.maxAccompanimentDensity,
        })),
      },
      endingPlan: instrumentation.endingPlan,
      transitionPlan: instrumentation.transitionPlan,
      hash: fnv1a(stableStringify(instrumentation)),
    },
  };
}

// ---------- L2 / L3（full render，产品路径 generateSong）----------

function serializeIR(ir: MusicalIR) {
  return {
    durationTicks: ir.durationTicks,
    timebase: {
      ppq: ir.timebase.ppq,
      meterNum: ir.timebase.meter.numerator,
      meterDen: ir.timebase.meter.denominator,
      tempoBpm: ir.timebase.tempoMap[0]?.bpm ?? 0,
    },
    // tracks 可变（2-5，lead 必有；顺序 = renderSongFull 条件序 bass→comp→pad→drum→lead）
    tracks: ir.tracks.map((t) => ({
      role: t.role,
      program: t.program ?? null,
      notes: t.notes.map((n) => ({
        pitch: n.pitch, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity,
      })),
      programChanges: (t.programChanges ?? []).map((p) => ({ atTick: p.atTick, program: p.program })),
      pedalEvents: (t.pedalEvents ?? []).map((p) => ({ atTick: p.atTick, down: p.down })),
      mix: t.mix
        ? { volume: t.mix.volume, pan: t.mix.pan, reverb: t.mix.reverb, chorus: t.mix.chorus, expression: t.mix.expression ?? null }
        : null,
      mixChanges: (t.mixChanges ?? []).map((mc) => ({
        atTick: mc.atTick,
        mix: { volume: mc.mix.volume, pan: mc.mix.pan, reverb: mc.mix.reverb, chorus: mc.mix.chorus, expression: mc.mix.expression ?? null },
      })),
      ccEvents: (t.ccEvents ?? []).map((c) => ({ atTick: c.atTick, controller: c.controller, value: c.value })),
    })),
  };
}

const L3_ROOM_WET = 50;
const noteOffRank = (type: string): number => (type === 'noteOff' ? 0 : 1);

function buildL2L3Case(seed: number, styleHint: string) {
  const request: GenerationRequest = { seed, styleHint, mood: 'calm-build', targetDuration: 120, allowModulation: true };
  const result = generateSong(request);
  const l2 = {
    seed, styleHint,
    status: result.status,
    attempts: result.attempts,
    // 控制环 metadata：非-lead 的 error/fatal 才 blocking（见 GenerationController），全 finding 入档
    // 字段对齐 AuditFinding（ir/AuditReport.ts）：severity/location{trackRole,startTick}/ruleId/reason/suggestedReturnPoint
    findings: result.report.findings.map((f) => ({
      severity: f.severity,
      trackRole: f.location.trackRole,
      startTick: f.location.startTick,
      ruleId: f.ruleId,
      suggestedReturnPoint: f.suggestedReturnPoint,
      reason: f.reason,
    })),
    ir: result.ir ? serializeIR(result.ir) : null, // failed 时无 ir
  };
  // L3：raw events 加递增 seq → 稳定排序 tick↑ → noteOff 优先 → seq（对齐 §1.4 调度序）
  let l3events: { seq: number; tick: number; type: string; channel: number; data1: number; data2: number }[] = [];
  if (result.ir) {
    const raw = musicalIRToMidiEvents(result.ir, L3_ROOM_WET).map((e, i) => ({ ...e, seq: i }));
    raw.sort((a, b) => (a.ticks - b.ticks) || (noteOffRank(a.type) - noteOffRank(b.type)) || (a.seq - b.seq));
    l3events = raw.map((e) => ({ seq: e.seq, tick: e.ticks, type: e.type, channel: e.channel, data1: e.data1, data2: e.data2 }));
  }
  const l3 = { seed, styleHint, roomWet: L3_ROOM_WET, hasIr: result.ir != null, events: l3events };
  return { l2, l3 };
}

// ---------- main ----------

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: npx tsx scripts/golden-trace-ne.ts <outDir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const meta = {
  generator: 'scripts/golden-trace-ne.ts',
  engineCommit: 'dd5e4eb7d6d0c308dd5fc4e04ba9e66ad82f7221',
  note: 'L0-L3 — L2/L3 = generateSong full render（整固件 GPLv3 决策后导出，见 docs/transplant/esp32s3.md §5#19-23 / §9）',
};

const l0 = { meta, streams: buildL0() };
writeFileSync(join(outDir, 'ne_golden_l0.json'), JSON.stringify(l0));
console.log(`L0: ${l0.streams.length} streams, ${l0.streams.reduce((n, s) => n + s.values.length, 0)} u32 values`);

const l1Cases: ReturnType<typeof buildL1Case>[] = [];
for (const seed of L1_SEEDS) for (const style of L1_STYLES) l1Cases.push(buildL1Case(seed, style));
const l1 = { meta, cases: l1Cases };
writeFileSync(join(outDir, 'ne_golden_l1.json'), JSON.stringify(l1, null, 1));
console.log(`L1: ${l1Cases.length} cases (${L1_SEEDS.length} seeds × ${L1_STYLES.length} styles)`);

// L2/L3：产品路径 generateSong。标准矩阵（与 L1 同 seed/style，8×7=56）+ 特征 case（扫描得，
// 覆盖标准矩阵不出现的 timbre-switch / retry 路径，见 scan-feature-seeds.ts）。全量入仓 = P1b（P1a 只 codegen 小样本子集）。
// 特征 seed 沿用 buildL2L3Case 同 request（mood/duration/allowModulation），仅变 seed/style，保持与标准例同生成路径。
const L2L3_FEATURE_CASES: { seed: number; style: string; note: string }[] = [
  { seed: 3, style: 'modal', note: 'timbre-switch pc=6/mc=6（跨段音色切换最多）' },
  { seed: 3, style: 'pop', note: 'timbre-switch pc=2/mc=2' },
  { seed: 4, style: 'lofi', note: 'retry attempts=12 → failed（ir=null，retry 环耗尽 wholeSong budget）' },
];
const l2Cases: ReturnType<typeof buildL2L3Case>['l2'][] = [];
const l3Cases: ReturnType<typeof buildL2L3Case>['l3'][] = [];
for (const seed of L1_SEEDS) for (const style of L1_STYLES) {
  const { l2, l3 } = buildL2L3Case(seed, style);
  l2Cases.push(l2);
  l3Cases.push(l3);
}
for (const fc of L2L3_FEATURE_CASES) {
  const { l2, l3 } = buildL2L3Case(fc.seed, fc.style);
  l2Cases.push(l2);
  l3Cases.push(l3);
}
writeFileSync(join(outDir, 'ne_golden_l2.json'), JSON.stringify({ meta, cases: l2Cases }, null, 1));
writeFileSync(join(outDir, 'ne_golden_l3.json'), JSON.stringify({ meta, cases: l3Cases }, null, 1));
const l3evTotal = l3Cases.reduce((n, c) => n + c.events.length, 0);
console.log(`L2/L3: ${l2Cases.length} cases (${L1_SEEDS.length}×${L1_STYLES.length} 标准 + ${L2L3_FEATURE_CASES.length} 特征); L3 events total ${l3evTotal}`);
