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

/** V3-P0 stage trace 序列单一真源（raw 单列；以下为 raw 之后的后处理 stage）。
 *  导出器 emit + ne_json2c 解析 + 验收共用此序列；写进 ne_golden_post.json.meta。
 *  v3 相对 v1 新增：snapcomp / groovepocket / articulate。
 *  ★ V4-P1 新增（v4 渲染链新 pass，非 ACG/无手势 case 为 pass-through 快照）：
 *    acgshape（ACG late shaping 链全程 + 二次 legato+sanitize 后）/ gesture（program·mix·pedal
 *    投影 + gestureExpression 应用后）/ mixbalance（applyRenderMixBalance 重标 mix 后，notes 不变）。 */
export const POST_STAGES = [
  'postmix', 'gated', 'resolved', 'ducked', 'dynamics', 'ending', 'leadins',
  'gapfill', 'replay', 'snapcomp', 'humanvel', 'swing', 'humantime', 'groovepocket', 'articulate',
  'acgshape', 'gesture', 'mixbalance',
] as const;

export type PostStage = typeof POST_STAGES[number];

/** stage trace 回调（V3-P0 C 移植对账用）：renderSongFull 在各 pass 后回传该阶段轨道快照
 *  （回调只读，深拷贝/序列化由调用方负责）。仅 golden 导出注入；产品/retry 路径不传 → 零开销。
 *  ★ stage 类型收窄到 'raw' | PostStage → renderCoordinator 拼错/漏插被 TS 提前抓。 */
export type RenderTraceFn = (stage: 'raw' | PostStage, tracks: readonly TrackIR[]) => void;

export interface RenderOverlay {
  voicingSafer?: Record<ChordSpanId, true>; // span → 瘦身 shell
  trace?: RenderTraceFn;                      // V3-P0 stage trace（可选，仅 golden 导出用）
}
