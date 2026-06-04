// ============================================================
// newEngine · render · RenderOverlay(RetryContext 的 render 侧切片)
// ------------------------------------------------------------
// render 不 import generation(避免循环)。Controller 把 RetryContext 映射成本类型传入。
// 撞音消解阶梯的三类 overlay(均在 Prepass 冻结数据上叠加,不重生成):
//   voicingSafer       → 伴奏轨该 span 改瘦身 3+7 shell(voicing 支撑/瘦身 rung)
//   restatementOverride→ 旋律该 binding 降锁深度(强→弱,放开复述刚性 rung)
//   candidateSwap      → 旋律该 binding 池内换候选(换 hook rung)
// ============================================================

import type { MotifBindingId } from '../arranger/ArrangementPlan';
import type { ChordSpanId } from '../harmony/HarmonicPlan';
import type { CandidateSwap } from './MotifStore';

export interface RenderOverlay {
  candidateSwap?: CandidateSwap;
  restatementOverride?: Record<MotifBindingId, number>; // binding → 上限锁档(≤ 即降锁)
  voicingSafer?: Record<ChordSpanId, true>; // span → 瘦身 shell
}
