// ============================================================
// newEngine · generation · RetryMapping(finding → 精确返回点)
// ------------------------------------------------------------
// 把 Auditor finding 的 IRLocation(trackRole+startTick)映射到【具体】override:
//   lead 轨 avoid 暴露 → 命中该 tick 所在 binding → candidateSwap 切到候选池里的【另一候选】
//                        (在 Prepass 冻结池内 overlay,不重生成 → 收敛且不破不变量)。
//   comp/bass/pad 轨    → 命中该 tick 所在 ChordSpan → voicingSafer 标记(更安全 voicing)。
// 纯函数 + 不可变快照查询;无副作用。RetryPolicy 据此填 RetryContext(否则只能泛泛推 rng)。
// ============================================================

import { beats, type Timebase } from '../foundation';
import type { ArrangementPlan, MotifBindingId } from '../arranger/ArrangementPlan';
import { beatsPerBarOf, phraseStartBeats } from '../arranger/phraseTiming';
import type { MelodyAnchorPlan } from '../render/MelodyAnchorPlan';
import type { CandidateSwap, MotifStore } from '../render/MotifStore';
import type { MotifCandidateId } from '../render/Motif';
import type { ChordSpanId, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { AuditFinding } from '../ir/AuditReport';

export interface RetryLocator {
  /** lead 轨某 tick → 覆盖它的 MotifBindingId(其它轨返回 undefined)。 */
  bindingAtTick(trackRole: string, tick: number): MotifBindingId | undefined;
  /** binding 候选池里相对当前(swap 或主选)的【下一个】候选;池≤1 或无替代 → undefined。 */
  alternateCandidate(bindingId: MotifBindingId, swap: CandidateSwap): MotifCandidateId | undefined;
  /** 某 tick → 覆盖它的 ChordSpanId。 */
  spanAtTick(tick: number): ChordSpanId | undefined;
}

interface TickRange {
  id: string;
  lo: number;
  hi: number;
}

export function buildRetryLocator(
  arrangement: ArrangementPlan,
  anchorPlan: MelodyAnchorPlan,
  store: MotifStore,
  plan: HarmonicPlan,
  timebase: Timebase,
): RetryLocator {
  const starts = phraseStartBeats(arrangement);
  const bpb = beatsPerBarOf(arrangement.meter);
  const phraseById = new Map(arrangement.phrases.map((p) => [p.id, p]));

  const bindingRanges: TickRange[] = [];
  for (const e of anchorPlan.entries) {
    const ph = phraseById.get(e.phraseId);
    if (!ph) continue;
    const startBeat = starts[ph.id] ?? 0;
    const endBeat = startBeat + ph.bars * bpb;
    bindingRanges.push({
      id: e.bindingId,
      lo: timebase.beatToTick(beats(startBeat)) as number,
      hi: timebase.beatToTick(beats(endBeat)) as number,
    });
  }

  const spanRanges: TickRange[] = plan.chordTimeline.map((c) => {
    const lo = timebase.beatToTick(c.startBeat) as number;
    return { id: c.id, lo, hi: lo + (timebase.beatToTick(c.durationBeats) as number) };
  });

  return {
    bindingAtTick(trackRole, tick) {
      if (trackRole !== 'lead') return undefined;
      return bindingRanges.find((r) => tick >= r.lo && tick < r.hi)?.id;
    },
    alternateCandidate(bindingId, swap) {
      const pool = store.bindingCandidates[bindingId];
      if (!pool || pool.candidateOrder.length <= 1) return undefined;
      const current = swap[bindingId] ?? pool.selectedCandidateId;
      const order = pool.candidateOrder;
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length];
      return next === current ? undefined : next;
    },
    spanAtTick(tick) {
      return spanRanges.find((r) => tick >= r.lo && tick < r.hi)?.id;
    },
  };
}

export interface OverridePatch {
  candidateSwap?: Record<MotifBindingId, MotifCandidateId>;
  voicingSafer?: Record<ChordSpanId, true>;
}

/** finding + 上次 swap → 精确 override patch(空 = 该 finding 无可定位修复,退回纯 rng 推进)。 */
export function findingToOverride(
  finding: AuditFinding,
  locator: RetryLocator,
  prevSwap: CandidateSwap,
): OverridePatch {
  const { trackRole, startTick } = finding.location;
  if (trackRole === 'lead') {
    const binding = locator.bindingAtTick(trackRole, startTick);
    if (binding) {
      const alt = locator.alternateCandidate(binding, prevSwap);
      if (alt) return { candidateSwap: { [binding]: alt } };
    }
    return {};
  }
  if (trackRole === 'comp' || trackRole === 'bass' || trackRole === 'pad') {
    const span = locator.spanAtTick(startTick);
    if (span) return { voicingSafer: { [span]: true } };
  }
  return {};
}
