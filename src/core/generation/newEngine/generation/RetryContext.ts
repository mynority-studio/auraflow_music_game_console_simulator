// ============================================================
// newEngine · generation · RetryContext(重跑变化集)
// ------------------------------------------------------------
// 架构定稿 Part 2.11 / 附录 F:全 Record(可 freeze/序列化/replay,禁裸 Map/Set)。
// override 全按 MotifBindingId 粒度;candidateSwap 只在 Prepass 冻结候选池内 overlay 切。
// 每次重跑【必须】至少改变其一(收敛)——最少推进 rng 子流。
// ============================================================

import type { RandomContext } from '../foundation';
import type { MotifBindingId, SectionId } from '../arranger/ArrangementPlan';
import type { MotifCandidateId } from '../render/Motif';
import type { ChordSpanId } from '../harmony/HarmonicPlan';
import type { ReturnPoint } from '../ir/AuditReport';

export interface RetryContext {
  rng: RandomContext;                                      // 已 advance 某 stage 子流的新 context
  returnPoint: ReturnPoint;                                // 从哪个 stage 回卷重跑下游
  candidateIndex: Record<MotifBindingId, number>;
  restatementOverride: Record<MotifBindingId, number>;
  candidateSwap: Record<MotifBindingId, MotifCandidateId>;
  tailRegenerate: Record<MotifBindingId, true>;
  voicingSafer: Record<ChordSpanId, true>;
  accompDensityReduction: Record<SectionId, number>;
}
