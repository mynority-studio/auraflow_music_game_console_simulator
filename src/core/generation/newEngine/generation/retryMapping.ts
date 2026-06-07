// ============================================================
// newEngine · generation · RetryMapping(finding → 精确返回点)
// ------------------------------------------------------------
// 把 Auditor finding 的 IRLocation(startTick)映射到该 tick 所在 ChordSpan → voicingSafer 标记
//   (该和弦 voicing 瘦身,回卷 accompaniment)。纯函数 + 不可变快照查询;无副作用。
// ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律候选/换 hook/降锁 rung 实测触发率
//   0.5% 且非决定性 → 删。撞音消解只剩 rung1 voicingSafer + rung4 兜底重掷(advance melody 子流)。
// ============================================================

import { type Timebase } from '../foundation';
import type { ChordSpanId, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { AuditFinding, ReturnPoint } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';

export interface RetryLocator {
  /** 某 tick → 覆盖它的 ChordSpanId。 */
  spanAtTick(tick: number): ChordSpanId | undefined;
}

interface TickRange {
  id: string;
  lo: number;
  hi: number;
}

export function buildRetryLocator(plan: HarmonicPlan, timebase: Timebase): RetryLocator {
  const spanRanges: TickRange[] = plan.chordTimeline.map((c) => {
    const lo = timebase.beatToTick(c.startBeat) as number;
    return { id: c.id, lo, hi: lo + (timebase.beatToTick(c.durationBeats) as number) };
  });
  return {
    spanAtTick(tick) {
      return spanRanges.find((r) => tick >= r.lo && tick < r.hi)?.id;
    },
  };
}

export interface OverridePatch {
  voicingSafer?: Record<ChordSpanId, true>;
}

/** finding → 单步精确 override patch(空 = 无可定位修复)。任何 finding 命中 span → 瘦该 span voicing。 */
export function findingToOverride(finding: AuditFinding, locator: RetryLocator): OverridePatch {
  const span = locator.spanAtTick(finding.location.startTick);
  if (span) return { voicingSafer: { [span]: true } };
  return {};
}

export interface Escalation {
  patch: OverridePatch;
  returnPoint: ReturnPoint;
  rung: 'voicing' | 'fallback';
}

/**
 * 撞音消解阶梯(退役旋律候选后剩 2 级,单调前进 → 收敛):
 *   rung1 voicing 支撑:该 span 还没瘦身 → voicingSafer(回卷 accompaniment,最不伤身份)
 *   rung4 fallback:    该 span 已瘦身仍撞 → render-fallback(回卷,advance melody 子流 = 重掷 MG 旋律)
 * 每 rung 必有变化(voicingSafer 新增,或 rng 子流推进),budget 兜尽头。
 */
export function escalateOverride(
  finding: AuditFinding,
  locator: RetryLocator,
  prev: RetryContext | undefined,
): Escalation {
  const span = locator.spanAtTick(finding.location.startTick);
  const prevVoicing = prev?.voicingSafer ?? {};

  // rung1:voicing 支撑(瘦身该和弦 voicing)
  if (span && !prevVoicing[span]) {
    return { patch: { voicingSafer: { [span]: true } }, returnPoint: 'rewind-accompaniment', rung: 'voicing' };
  }
  // rung4:兜底重跑(advance melody 子流 → MG 旋律重掷)
  return { patch: {}, returnPoint: 'render-fallback', rung: 'fallback' };
}
