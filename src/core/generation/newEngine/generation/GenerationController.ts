// ============================================================
// newEngine · generation · GenerationController(控制环 owner)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 铁律21-22:跑管线 · 读 AuditReport · 选 return point ·
// 造 changed RetryContext · 守 budget · 耗尽 fallback · 判 pass/warning/fail。
// 重跑只动 render 层(碰不到 Harmony/Arranger/Band/Prepass 候选池);回卷语义由 render 实现。
//   warning → 带 warning 通过;error/fatal → 回卷重跑;budget 耗尽 → failed report(绝不静默输出非法)。
// generateSong = 顶层 Request→FinalIR 编排(聚合所有 stage)。
// ============================================================

import { beats, createRandomContext, createTimebase, type RandomContext, type Timebase } from '../foundation';
import { buildBandSpec, withBandMode, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { activeAcgPianoSectionIds, buildAcgPianoScorePlan, type AcgPianoScorePlan } from '../arranger/acgPianoScorePlan';
import { buildJazzFiveFourScorePlan, type JazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import {
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
} from '../arranger/jazzArchetypePlanner';
import { compileJazzFiveFourEnsembleScore } from './jazzFiveFourEnsembleScoreCompiler';
import { compileJazzFiveFourLeadScore } from './jazzFiveFourLeadScoreCompiler';
import { planAcgLeadPresence } from '../render/acgLeadPresencePlan';
import { harmonicPlanToMgChordDefs } from '../render/mgChordDefAdapter';
import { buildChordPart } from '../render/mgChordPart';
import { parseFunctionalRoadMap } from '../render/mgFunctionalRoadMap';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import { DEFAULT_BUDGET, nextRetryContext, type RetryBudget } from './RetryPolicy';
import { buildRetryLocator, type RetryLocator } from './retryMapping';
import type { RetryContext } from './RetryContext';

export interface RenderAttempt {
  ir: MusicalIR;
  audit: AuditReport;
}

export type RenderFn = (retry: RetryContext | undefined) => RenderAttempt;

export type GenerationStatus = 'pass' | 'warning' | 'failed';

export interface GenerationResult {
  status: GenerationStatus;
  ir?: MusicalIR;
  report: AuditReport;
  attempts: number;
}

/** 控制环:跑 render → 审 → 收敛重跑 → pass/warning/failed。render 由调用方注入(可测)。 */
export function runGenerationControl(
  render: RenderFn,
  seedRng: RandomContext,
  budget: RetryBudget = DEFAULT_BUDGET,
  locator?: RetryLocator,
  acceptNonLeadErrors = false, // 用户覆盖和声时可接受不可重写的非 lead error。
  acceptLeadErrors = false, // 仅用户直接提供权威 lead 时可接受；保留 audit，不由渲染层事后改写。
): GenerationResult {
  let retry: RetryContext | undefined;
  let current = render(undefined);
  let attempts = 1;

  for (;;) {
    const findings = current.audit.findings;
    // 默认最终旋律合同 fail-closed：当前 retry 只会改变伴奏子流，无法改变 lead，
    // 因而 lead 违规直接失败，不浪费 whole-song budget 重跑同一旋律。
    // 但用户直接提供的权威 lead 不应被渲染层事后投影/修正；调用方可显式保留其
    // error audit 并以 warning 交付。fatal 永不降级。
    const blocking = findings.filter((f) => {
      if (f.severity === 'fatal') return true;
      if (f.severity !== 'error') return false;
      return f.location.trackRole === 'lead' ? !acceptLeadErrors : !acceptNonLeadErrors;
    });

    if (blocking.length === 0) {
      return {
        status: findings.length === 0 ? 'pass' : 'warning', // 仅 warning → 接受
        ir: current.ir,
        report: current.audit,
        attempts,
      };
    }

    if (blocking.some((f) => f.location.trackRole === 'lead')) {
      return { status: 'failed', report: current.audit, attempts };
    }

    if (attempts >= budget.wholeSong) {
      // budget 耗尽 → failed report,绝不静默输出非法结果
      return { status: 'failed', report: current.audit, attempts };
    }

    retry = nextRetryContext(retry, current.audit, seedRng, locator); // 每次必变 + finding 精确返回点
    current = render(retry);
    attempts += 1;
  }
}

/**
 * ★ 共享结构化 bundle(qn_main_engine_takeover §4.3):生成的全部中间结构(band/arrangement/harmonic/
 *   instrumentation/timebase + seedRng)。generateSong / trace / 生产 service 共用此函数构建,不复制平行生成逻辑。
 *   seedRng 是不可变 RandomContext(substream 派生不 mutate)→ 线程同一对象给 render 与原 generateSong byte-identical。
 */
export interface SongBundle {
  band: BandSpec;
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  /** ACG only: immutable post-harmony phrase score, built once before render/retry. */
  acgPianoScorePlan?: AcgPianoScorePlan;
  /** Jazz 5/4 reference quartet only: immutable post-harmony performed score. */
  jazzFiveFourScorePlan?: JazzFiveFourScorePlan;
  timebase: Timebase;
  seedRng: RandomContext;
}

/**
 * ACG's phrase score needs harmony, instrumentation and the factual RoadMap,
 * so it is deliberately built after those arranger stages and before render.
 * Retry never rebuilds it: renderer retries may alter voicing safety, not the
 * authored arrangement.
 */
export function buildAcgPianoScoreForBundle(args: {
  band: BandSpec;
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  seed: number;
}): AcgPianoScorePlan | undefined {
  if (args.band.style.toLowerCase() !== 'acg') return undefined;
  const part = buildChordPart(
    harmonicPlanToMgChordDefs(args.harmonic),
    [args.arrangement.meter.numerator, args.arrangement.meter.denominator],
  );
  const roadMap = parseFunctionalRoadMap({
    part,
    songKeyPc: ((args.band.key as number) % 12 + 12) % 12,
    style: args.band.style.toUpperCase(),
  });
  const leadPresencePlan = planAcgLeadPresence(args.arrangement, args.instrumentation);
  return buildAcgPianoScorePlan({
    seed: args.seed,
    arrangement: args.arrangement,
    harmonic: args.harmonic,
    activeSectionIds: activeAcgPianoSectionIds(args.instrumentation),
    grooveContract: args.arrangement.songGrooveContract,
    roadMap,
    leadPresencePlan,
  });
}

/**
 * Both 5/4 archetypes are explicit, never hidden meter/style switches. The
 * reference quartet uses the frozen Gate-G compiler; the product archetype
 * compiles Arranger-selected whole textures/phrases. Both reuse one immutable
 * post-harmony score across every render retry.
 */
export function buildJazzFiveFourScoreForBundle(args: {
  band: BandSpec;
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  seed: number;
}): JazzFiveFourScorePlan | undefined {
  const archetypeId = args.arrangement.arrangementArchetypeId;
  const rhythmSectionScore = archetypeId === JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID
    ? buildJazzFiveFourScorePlan({
      arrangement: args.arrangement,
      harmonic: args.harmonic,
      instrumentation: args.instrumentation,
      options: {
        enabled: true,
        mode: 'canonical-reference',
        performanceMode: 'reference-zero',
        foundationMode: 'acoustic-bass+full-piano',
      },
    })
    : archetypeId === JAZZ_5_4_ARCHETYPE_ID
      ? compileJazzFiveFourEnsembleScore({
        arrangement: args.arrangement,
        harmonic: args.harmonic,
        instrumentation: args.instrumentation,
      })
      : undefined;
  return rhythmSectionScore
    ? compileJazzFiveFourLeadScore({
      score: rhythmSectionScore,
      band: args.band,
      arrangement: args.arrangement,
      harmonic: args.harmonic,
      instrumentation: args.instrumentation,
      seed: args.seed,
    })
    : undefined;
}

/** Request → 全部中间结构(不渲染)。供 generateSong + UI 投影 + trace 复用。 */
export function buildSongBundle(request: GenerationRequest): SongBundle {
  const seedRng = createRandomContext(request.seed);
  const requestedBand = buildBandSpec(request);
  const arrangement = buildArrangementPlan(requestedBand, {
    rng: seedRng,
    mood: request.mood,
    targetDuration: request.targetDuration,
    jazzArchetypeId: request.jazzArchetypeId,
  });
  const authoredMode = arrangement.resolvedArchetype?.tonalityMode;
  const band = request.mode === undefined && authoredMode
    ? withBandMode(requestedBand, authoredMode)
    : requestedBand;
  // ★ #6(2026-06-10):harmony 先于 instrumental(各用独立命名子流 'harmony'/'timbre' → 重排不改确定性);
  //   器配层吃 HarmonicPlan → 段级 rich texture 选择用真 dominant-chain。
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic, seedRng.substream('acgPianoVoice'));
  const acgPianoScorePlan = buildAcgPianoScoreForBundle({ band, arrangement, harmonic, instrumentation, seed: seedRng.seed });
  const jazzFiveFourScorePlan = buildJazzFiveFourScoreForBundle({
    band, arrangement, harmonic, instrumentation, seed: seedRng.seed,
  });
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  return { band, arrangement, harmonic, instrumentation, acgPianoScorePlan, jazzFiveFourScorePlan, timebase, seedRng };
}

/** bundle → FinalIR(render + 控制环)。与原 generateSong 渲染段 byte-identical。 */
export function generateSongFromBundle(bundle: SongBundle, budget: RetryBudget = DEFAULT_BUDGET): GenerationResult {
  const { band, arrangement, harmonic, instrumentation, acgPianoScorePlan, jazzFiveFourScorePlan, timebase, seedRng } = bundle;
  // ★ Phase 2:上游派生 musical intent(纯函数,不抽 RNG)传入 render —— intent 所有权在 arranger,render 只消费(bass enforce)。
  const intentPlan = deriveMusicIntentPlan(band.style, arrangement);
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { voicingSafer: retry.voicingSafer }, undefined, intentPlan, undefined, acgPianoScorePlan, jazzFiveFourScorePlan);
  const locator = buildRetryLocator(harmonic, timebase);
  return runGenerationControl(render, seedRng, budget, locator);
}

/** 顶层:Request → FinalIR(Slice 1 端到端;Resolver/OccupationMap 让位后续接)。 */
export function generateSong(request: GenerationRequest, budget: RetryBudget = DEFAULT_BUDGET): GenerationResult {
  return generateSongFromBundle(buildSongBundle(request), budget);
}
