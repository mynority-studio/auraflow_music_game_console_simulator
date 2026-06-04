// ============================================================
// newEngine · generation · RetryPolicy(预算 + 收敛)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 待拍#5:budget perBinding≤2 / perPhrase≤3 / wholeSong≤12。
// nextRetryContext:每次重跑必有变化(至少推进对应 stage 的 rng 子流)→ 收敛保证。
// ============================================================

import type { RandomContext, StageName } from '../foundation';
import type { AuditReport, ReturnPoint } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';
import { findingToOverride, type RetryLocator } from './retryMapping';

export interface RetryBudget {
  perBinding: number;
  perPhrase: number;
  wholeSong: number;
}

export const DEFAULT_BUDGET: RetryBudget = { perBinding: 2, perPhrase: 3, wholeSong: 12 };

const RETURN_STAGE: Record<ReturnPoint, StageName> = {
  'rewind-resolver': 'resolver',
  'rewind-melody': 'melody',
  'rewind-accompaniment': 'accompaniment',
  'render-fallback': 'melody',
};

/**
 * 由上次 context + 本轮 AuditReport 造出【已变化】的 RetryContext。
 * 有 locator → 把首 finding 映射到精确 override(lead→candidateSwap / 伴奏→voicingSafer);
 * 无论是否命中,都【至少】推进对应 stage 子流(收敛保证 + 兜底无可定位修复的 finding)。
 */
export function nextRetryContext(
  prev: RetryContext | undefined,
  audit: AuditReport,
  seedRng: RandomContext,
  locator?: RetryLocator,
): RetryContext {
  const finding = audit.findings[0];
  const returnPoint: ReturnPoint = finding?.suggestedReturnPoint ?? 'rewind-melody';
  const stage = RETURN_STAGE[returnPoint];
  const baseRng = prev?.rng ?? seedRng;

  const prevSwap = prev?.candidateSwap ?? {};
  const patch = finding && locator ? findingToOverride(finding, locator, prevSwap) : {};

  return {
    rng: baseRng.advance(stage), // ★ 每次必变:推进对应 stage 子流
    returnPoint,
    candidateIndex: prev?.candidateIndex ?? {},
    restatementOverride: prev?.restatementOverride ?? {},
    candidateSwap: { ...prevSwap, ...(patch.candidateSwap ?? {}) }, // ★ 精确切候选(命中 lead)
    tailRegenerate: prev?.tailRegenerate ?? {},
    voicingSafer: { ...(prev?.voicingSafer ?? {}), ...(patch.voicingSafer ?? {}) },
    accompDensityReduction: prev?.accompDensityReduction ?? {},
  };
}
