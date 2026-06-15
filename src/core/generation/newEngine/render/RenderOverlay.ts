// ============================================================
// newEngine · render · RenderOverlay(RetryContext 的 render 侧切片)
// ------------------------------------------------------------
// render 不 import generation(避免循环)。Controller 把 RetryContext 映射成本类型传入。
// ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律侧 overlay(candidateSwap/
//   restatementOverride)实测触发率 0.5% 且非决定性 → 删。撞音消解只剩:
//   voicingSafer → 伴奏轨该 span 改瘦身 3+7 shell(voicing 支撑/瘦身 rung)。
// ============================================================

import type { ChordSpanId } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';

/** stage trace 回调（P2 C 移植对账用）：renderSongFull 在各 pass 后回传该阶段的轨道快照
 *  （深拷贝由调用方负责，回调只读）。仅 golden 导出注入；产品/retry 路径不传 → 零开销。 */
export type RenderTraceFn = (stage: string, tracks: readonly TrackIR[]) => void;

export interface RenderOverlay {
  voicingSafer?: Record<ChordSpanId, true>; // span → 瘦身 shell
  trace?: RenderTraceFn;                      // P2 stage trace（可选，仅 golden 导出用）
}
