// ============================================================
// newEngine · generation · RetryContext(重跑变化集)
// ------------------------------------------------------------
// 全 Record(可 freeze/序列化/replay,禁裸 Map/Set)。每次重跑【必须】至少改变其一(收敛)
//   ——最少推进 rng 子流(advance(stage))。
// ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律候选杠杆(candidateSwap/
//   restatementOverride/candidateIndex/tailRegenerate/accompDensityReduction)实测触发率 0.5%
//   且非决定性 → 删。撞音消解只剩 voicingSafer(comp 瘦身)+ 兜底重掷(advance melody 子流)。
// ============================================================

import type { RandomContext } from '../foundation';
import type { ChordSpanId } from '../harmony/HarmonicPlan';
import type { ReturnPoint } from '../ir/AuditReport';

export interface RetryContext {
  rng: RandomContext;                      // 已 advance 某 stage 子流的新 context
  returnPoint: ReturnPoint;                // 从哪个 stage 回卷重跑下游
  voicingSafer: Record<ChordSpanId, true>; // span → 瘦身 shell(rung1 voicing 支撑)
}
