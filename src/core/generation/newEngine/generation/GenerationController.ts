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
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { DEFAULT_BUDGET, nextRetryContext, type RetryBudget } from './RetryPolicy';
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
): GenerationResult {
  let retry: RetryContext | undefined;
  let current = render(undefined);
  let attempts = 1;

  for (;;) {
    const findings = current.audit.findings;
    const blocking = findings.filter((f) => f.severity === 'error' || f.severity === 'fatal');

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

    retry = nextRetryContext(retry, current.audit, seedRng); // 每次必变
    current = render(retry);
    attempts += 1;
  }
}

/** 顶层:Request → FinalIR(Slice 1 端到端;Resolver/OccupationMap 让位后续接)。 */
export function generateSong(request: GenerationRequest, budget: RetryBudget = DEFAULT_BUDGET): GenerationResult {
  const seedRng = createRandomContext(request.seed);
  const band = buildBandSpec(request);
  const arrangement = buildArrangementPlan(band);
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });

  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, timebase, retry?.rng ?? seedRng, retry?.candidateSwap);

  return runGenerationControl(render, seedRng, budget);
}
