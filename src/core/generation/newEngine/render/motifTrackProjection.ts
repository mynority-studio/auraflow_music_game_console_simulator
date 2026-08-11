// ============================================================
// newEngine · render · motif 跨轨投射(墨盒任务书 P2 第一刀:comp 回声)
// ------------------------------------------------------------
// 目标:伴奏直接消费 motif(此前只经"和声按 motif 选择"间接响应)。
// 机制完全镜像 LOFI compRole='answer' 先例:每次 motif 乐句(陈述/再现)
// 结束后的下一小节 = lead 呼吸位,comp 在该小节用 motif 头部节奏 cell
// 敲和弦 shell —— 听感上是"伴奏在应答动机"。
// 工程约束:重音相位量化到八分网格(0.5),避开 snapCompLaidback 对
// .25/.75 弱位的吸回;只在 POP/RNB(perSectionPresence 风格)启用;
// 回声小节不得与任何 authored span 重叠(不与 motif 本尊抢话)。
// 纯函数、确定性,是 authored plan 的投影(retry 稳定)。
// ============================================================

import { authoredLeadSpans, type AuthoredUserMotifBrickPlan } from './userMotifBrick';
import { motifStyleIntegration } from './motifStyleIntegration';

export interface MotifEchoBar {
  accentBeats: readonly number[]; // bar 内相位(0.5 网格)
  durations: readonly number[];
}

const MAX_ECHO_ACCENTS = 3;
const quantizeHalf = (x: number): number => Math.round(x * 2) / 2;

/** motif 头部节奏 cell(≤3 音,相位 0.5 网格,去重)。 */
function headCellOf(plan: AuthoredUserMotifBrickPlan, beatsPerBar: number): MotifEchoBar | null {
  const sorted = [...plan.notes].sort((a, b) => a.onsetBeat - b.onsetBeat).slice(0, MAX_ECHO_ACCENTS);
  if (sorted.length < 2) return null;
  const base = sorted[0].onsetBeat;
  const accentBeats: number[] = [];
  const durations: number[] = [];
  for (const n of sorted) {
    const phase = quantizeHalf(n.onsetBeat - base);
    if (phase >= beatsPerBar - 0.25) break;
    if (accentBeats.length > 0 && phase <= accentBeats[accentBeats.length - 1] + 1e-6) continue; // 量化撞位去重
    accentBeats.push(phase);
    durations.push(Math.max(0.25, Math.min(0.75, quantizeHalf(n.durationBeat) || 0.5)));
  }
  return accentBeats.length >= 2 ? { accentBeats, durations } : null;
}

/** 每个 motif span 结束后的下一小节 → 回声 cell。与 authored span 重叠的小节跳过。 */
export function buildMotifCompEchoByBar(
  plan: AuthoredUserMotifBrickPlan | undefined,
  beatsPerBar: number,
  totalBeats: number,
  style?: string,
): Map<number, MotifEchoBar> {
  const out = new Map<number, MotifEchoBar>();
  if (!plan || !motifStyleIntegration(style).perSectionPresence) return out;
  const cell = headCellOf(plan, beatsPerBar);
  if (!cell) return out;
  const spans = authoredLeadSpans(plan);
  const totalBars = Math.floor(totalBeats / beatsPerBar);
  for (const span of spans) {
    const echoBar = Math.floor((span.endBeat + 1e-4) / beatsPerBar);
    if (echoBar >= totalBars) continue;
    const barStart = echoBar * beatsPerBar;
    const barEnd = barStart + beatsPerBar;
    const overlapsAuthored = spans.some((s) => barStart < s.endBeat - 1e-4 && barEnd > s.startBeat + 1e-4);
    if (overlapsAuthored) continue; // 不与 motif 本尊(含后续 occurrence)抢话
    out.set(echoBar, cell);
  }
  return out;
}
