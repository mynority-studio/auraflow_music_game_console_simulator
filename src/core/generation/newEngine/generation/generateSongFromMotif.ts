// ============================================================
// newEngine · generation · generateSongFromMotif(走 A 并行入口)
// ------------------------------------------------------------
// Q+R sandbox 的【权威 lead + 权威和声】喂进 Q+N 成曲生产链:Q+N 负责 arranger / instrumentation /
//   bass / comp / pad / drum / mix / render / audit/retry,但【和声】用 sandbox 的 HarmonicPlan、
//   【lead】用 sandbox 的 TrackIR(跳过 renderMgMelody)。
// ★ 边界:① 不改 generateSong(默认链字节不变,这是【并行】入口)② override 缺省 → 行为 == generateSong
//   ③ HarmonicPlan/lead override 走两个【additive 注入点】(generateSong 端镜像 + renderSongFull 端可选参数);
//   ④ retry 碰不到 override(harmonic 深冻、lead 不在 voicingSafer 范围)。
// 合同(MotifSongOverride)= MotifHarmonyOverride(harmony)+ MotifLeadOverride(lead);两者均可选。
//   PR1 scaffold:转换器(sandbox→HarmonicPlan / sandbox→lead TrackIR)留后续 PR,本入口先把【接缝】立住。
// ============================================================

import { beats, createRandomContext, createTimebase } from '../foundation';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { DEFAULT_BUDGET, type RetryBudget } from './RetryPolicy';
import { buildRetryLocator } from './retryMapping';
import { runGenerationControl, type GenerationResult, type RenderFn } from './GenerationController';

/** 走 A 注入合同:sandbox 权威和声 + 权威 lead。两者均可选;缺省 → 退回 Q+N 默认生成(== generateSong)。 */
export interface MotifSongOverride {
  /** MotifHarmonyOverride:整曲权威和声(Q+R selectedProgression/RoadMap → HarmonicPlan)。下游 bass/comp/pad/drum/lead 自动跟随。 */
  harmony?: HarmonicPlan;
  /** MotifLeadOverride:整曲权威 lead 轨(Q+R motif slot weaver → TrackIR),跳过 renderMgMelody。 */
  lead?: TrackIR;
}

/** 走 A 并行入口:Q+R 产物注入 Q+N 成曲生产链。override 缺省时行为与 generateSong 完全一致。 */
export function generateSongFromMotif(
  request: GenerationRequest,
  override: MotifSongOverride = {},
  budget: RetryBudget = DEFAULT_BUDGET,
): GenerationResult {
  const seedRng = createRandomContext(request.seed);
  const band = buildBandSpec(request);
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  // 注入点 A:和声权威 = sandbox 提供则用它,否则 Q+N 默认(与 generateSong 同子流名,确定性一致)。
  const harmonic = override.harmony ?? buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });

  // 注入点 B:lead override 经 renderSongFull 末参数透传(默认 undefined → 走 MG 链)。
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { voicingSafer: retry.voicingSafer }, override.lead);

  const locator = buildRetryLocator(harmonic, timebase);
  return runGenerationControl(render, seedRng, budget, locator);
}
