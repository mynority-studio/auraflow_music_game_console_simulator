// ============================================================
// golden-trace-ne.ts — newEngine C 移植黄金对账导出器（L0 / L1）
// ------------------------------------------------------------
// 用法: npx tsx scripts/golden-trace-ne.ts <outDir>
//
// 范围（docs/transplant/esp32s3.md §7 A0，GPL 隔离）:
//   只调四个规划层 build 函数 + RandomContext，【不调 renderSongFull】
//   —— slope 语料(GPL-2)只被 MG 旋律链消费，本导出与其完全解耦。
//   L2/3（MusicalIR/irToMidi 全量）等 GPL 决策通过后再补录。
//
// L0: RandomContext raw uint32 序列（mulberry32 除法前状态，由
//     next()*2^32 精确恢复——u32/2^32 在 double 中可精确表示）。
//     覆盖: 13 子流 × 多 seed × advance(0/1/2) 语义。
// L1: 四层规划产物关键字段摘要 + FNV-1a 哈希（供 L1-L4 C 移植期对账）。
// ============================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRandomContext, type StageName } from '../src/core/generation/newEngine/foundation/randomContext';
import { buildBandSpec, type GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';
import { buildArrangementPlan } from '../src/core/generation/newEngine/arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../src/core/generation/newEngine/harmony/harmonyEngine';
import { buildInstrumentationPlan } from '../src/core/generation/newEngine/instrumental/instrumentalPlanner';

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
      sections: arrangement.sections.map((s) => ({
        id: s.id, role: s.role, bars: s.bars,
        repeatGroup: (s as { repeatGroup?: string }).repeatGroup ?? null,
        functionTag: (s as { functionTag?: string }).functionTag ?? null,
      })),
      phraseCount: arrangement.phrases.length,
      motifBindingCount: arrangement.motifBindings.length,
      energyBySection: arrangement.energyBySection,
      grooveBySection: arrangement.grooveBySection,
      hash: fnv1a(stableStringify(arrangement)),
    },
    harmonic: {
      chordCount: harmonic.chordTimeline.length,
      chords: harmonic.chordTimeline.map((c: Record<string, unknown>) => ({
        roman: c.roman ?? null, startBeat: c.startBeat, durationBeats: c.durationBeats,
        rootPc: c.rootPc ?? null, type: c.type ?? c.chordType ?? null,
      })),
      hash: fnv1a(stableStringify(harmonic)),
    },
    instrumentation: {
      world: instrumentation.orchestrationChain?.world ?? null,
      profileId: instrumentation.orchestrationChain?.profileId ?? null,
      roleProgram: instrumentation.roleProgram,
      activeRolesBySection: instrumentation.activeRolesBySection,
      textureBySection: instrumentation.textureBySection,
      hash: fnv1a(stableStringify(instrumentation)),
    },
  };
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
  note: 'L0/L1 only — renderSongFull (MG/GPL corpus) intentionally NOT executed',
};

const l0 = { meta, streams: buildL0() };
writeFileSync(join(outDir, 'ne_golden_l0.json'), JSON.stringify(l0));
console.log(`L0: ${l0.streams.length} streams, ${l0.streams.reduce((n, s) => n + s.values.length, 0)} u32 values`);

const l1Cases: ReturnType<typeof buildL1Case>[] = [];
for (const seed of L1_SEEDS) for (const style of L1_STYLES) l1Cases.push(buildL1Case(seed, style));
const l1 = { meta, cases: l1Cases };
writeFileSync(join(outDir, 'ne_golden_l1.json'), JSON.stringify(l1, null, 1));
console.log(`L1: ${l1Cases.length} cases (${L1_SEEDS.length} seeds × ${L1_STYLES.length} styles)`);
