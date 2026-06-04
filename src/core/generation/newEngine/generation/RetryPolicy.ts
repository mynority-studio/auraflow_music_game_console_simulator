// ============================================================
// newEngine · generation · RetryPolicy(预算 + 收敛)
// ------------------------------------------------------------
// 架构定稿 Part 5 / 待拍#5:budget perBinding≤2 / perPhrase≤3 / wholeSong≤12。
// nextRetryContext:每次重跑必有变化(至少推进对应 stage 的 rng 子流)→ 收敛保证。
// ============================================================

import type { RandomContext, StageName } from '../foundation';
import type { AuditReport, ReturnPoint } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';
import { escalateOverride, type RetryLocator } from './retryMapping';

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
 * 有 locator → 撞音消解阶梯逐级升级(voicing→降锁→换hook→fallback,见 escalateOverride),
 *   returnPoint 跟当前 rung 走(voicing 回卷 accompaniment / 降锁·换hook 回卷 melody / fallback)。
 * 无 locator(或无 finding)→ 退回 finding.suggestedReturnPoint + 纯 rng 推进(兜底收敛)。
 */
export function nextRetryContext(
  prev: RetryContext | undefined,
  audit: AuditReport,
  seedRng: RandomContext,
  locator?: RetryLocator,
): RetryContext {
  const finding = audit.findings[0];
  let returnPoint: ReturnPoint = finding?.suggestedReturnPoint ?? 'rewind-melody';
  let patch: Partial<Pick<RetryContext, 'candidateSwap' | 'voicingSafer' | 'restatementOverride'>> = {};
  if (finding && locator) {
    const esc = escalateOverride(finding, locator, prev);
    patch = esc.patch;
    returnPoint = esc.returnPoint; // ★ 返回点跟 rung(回卷语义)
  }
  const stage = RETURN_STAGE[returnPoint];
  const baseRng = prev?.rng ?? seedRng;

  return {
    rng: baseRng.advance(stage), // ★ 每次必变:推进对应 stage 子流
    returnPoint,
    candidateIndex: prev?.candidateIndex ?? {},
    restatementOverride: { ...(prev?.restatementOverride ?? {}), ...(patch.restatementOverride ?? {}) }, // rung2 降锁
    candidateSwap: { ...(prev?.candidateSwap ?? {}), ...(patch.candidateSwap ?? {}) }, // rung3 换 hook
    tailRegenerate: prev?.tailRegenerate ?? {},
    voicingSafer: { ...(prev?.voicingSafer ?? {}), ...(patch.voicingSafer ?? {}) }, // rung1 voicing 支撑
    accompDensityReduction: prev?.accompDensityReduction ?? {},
  };
}
