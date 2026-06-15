// ============================================================
// newEngine · generation · GenerationController(控制环 owner)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 铁律21-22:跑管线 · 读 AuditReport · 选 return point ·
// 造 changed RetryContext · 守 budget · 耗尽 fallback · 判 pass/warning/fail。
// 重跑只动 render 层(碰不到 Harmony/Arranger/Band/Prepass 候选池);回卷语义由 render 实现。
//   warning → 带 warning 通过;error/fatal → 回卷重跑;budget 耗尽 → failed report(绝不静默输出非法)。
// generateSong = 顶层 Request→FinalIR 编排(聚合所有 stage)。
// ============================================================

import { beats, createRandomContext, createTimebase, type RandomContext } from '../foundation';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import type { RenderTraceFn } from '../render/RenderOverlay';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
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
): GenerationResult {
  let retry: RetryContext | undefined;
  let current = render(undefined);
  let attempts = 1;

  for (;;) {
    const findings = current.audit.findings;
    // ★ Loop 3(strict parity):lead = MG 真源,不可被 newEngine 改 → lead 的 error/fatal 不驱动重跑
    //   (retry 只能调 comp voicing/texture,改不了 lead;否则只会耗 budget 到 failed)。lead finding 仍在
    //   report 里(降级为 warning 语义,§1.5/§9:audit 只报告 lead、不改);非-lead 的 error/fatal 才 blocking。
    const blocking = findings.filter((f) => (f.severity === 'error' || f.severity === 'fatal') && f.location.trackRole !== 'lead');

    if (blocking.length === 0) {
      return {
        status: findings.length === 0 ? 'pass' : 'warning', // 仅 warning → 接受
        ir: current.ir,
        report: current.audit,
        attempts,
      };
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

/** 顶层:Request → FinalIR(Slice 1 端到端;Resolver/OccupationMap 让位后续接)。 */
export function generateSong(request: GenerationRequest, budget: RetryBudget = DEFAULT_BUDGET, trace?: RenderTraceFn): GenerationResult {
  const seedRng = createRandomContext(request.seed);
  const band = buildBandSpec(request);
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  // ★ #6(2026-06-10):harmony 先于 instrumental(各用独立命名子流 'harmony'/'timbre' → 重排不改确定性);
  //   器配层吃 HarmonicPlan → 段级 rich texture 选择用真 dominant-chain。
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });

  // P2 stage trace 仅首轮（retry===undefined）注入；retry 轮不 trace（避免多轮快照覆盖）。
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry ? { voicingSafer: retry.voicingSafer } : (trace ? { trace } : undefined));

  // finding→精确返回点定位器:tick→ChordSpan(voicingSafer 瘦身目标)。
  const locator = buildRetryLocator(harmonic, timebase);

  return runGenerationControl(render, seedRng, budget, locator);
}
