// ============================================================
// newEngine · render · lead 空拍补全(2026-06-11)
// ------------------------------------------------------------
// 用户诉求:lead 末音后若有【很大时值的空拍】(没填 brick/grammar 旋律)→ 把该末音(前一 grammar 的最后一个音符)
//   延长时值【到当前 bar 的四拍全部结束】,即不要在【和弦未完成】时戛然而止。
// 规则:某 lead 音之后的空拍 ≥ minGapBeats(默认 2 拍)、且该音【结束在 bar 内(非 bar 线)】、且【本 bar 余下全空】
//   (下一音在更后的 bar)→ 延长该音到 bar 末。★ 安全钳位:不越过【当前和弦】边界(避免持续音撞下一和弦)。
// 只动 lead 时值,不改 onset、不碰其它轨。纯函数、确定性、深不可变。
// ⚠️ 打破 strict MG lead parity(改 lead 时值):契约 = 首次==重放(raw MG)再经【空拍补全】。
// ============================================================

import { ticks, type Timebase } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';

export interface LeadGapFillOptions {
  minGapBeats?: number; // "很大空拍"阈值(拍),默认 2
}

export interface GapFillRecord {
  startTick: number;
  oldEnd: number;
  newEnd: number;
  barEnd: number;
  chordClamped: boolean;
}

/** 计算空拍补全记录(纯计算;trace/测试复用)。 */
export function planLeadGapFills(
  notes: readonly NoteIR[],
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
  beatsPerBar: number,
  opts: LeadGapFillOptions = {},
): GapFillRecord[] {
  const ppq = timebase.ppq;
  const barTicks = ppq * beatsPerBar;
  const minGap = Math.round((opts.minGapBeats ?? 2) * ppq);
  const spans = chordTimeline
    .map((c) => { const lo = timebase.beatToTick(c.startBeat) as number; return { lo, hi: lo + (timebase.beatToTick(c.durationBeats) as number) }; })
    .sort((a, b) => a.lo - b.lo);
  const chordEndContaining = (tick: number): number => {
    for (const s of spans) if (tick >= s.lo && tick < s.hi) return s.hi;
    return Infinity;
  };
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  const out: GapFillRecord[] = [];
  for (let i = 0; i < sorted.length - 1; i++) { // ★ 末音无后续 phrase(收尾交 ending/outro)→ 不补
    const start = sorted[i].startTick as number;
    const end = start + (sorted[i].durationTicks as number);
    const nextStart = sorted[i + 1].startTick as number;
    if (nextStart - end < minGap) continue;       // 不是"很大"空拍
    if (end % barTicks === 0) continue;           // 已落 bar 线 → 不算戛然而止(完整完成了上一 bar)
    const barEnd = (Math.floor(end / barTicks) + 1) * barTicks;
    if (nextStart < barEnd) continue;             // 本 bar 余下还有后续音 → 旋律未断,不补
    const chordEnd = chordEndContaining(start);
    const target = Math.min(barEnd, chordEnd);    // 补到 bar 末,但不越当前和弦
    if (target <= end) continue;                  // 已经够长(已跨到和弦末/bar 末)
    out.push({ startTick: start, oldEnd: end, newEnd: target, barEnd, chordClamped: target < barEnd });
  }
  return out;
}

/** 应用 lead 空拍补全:延长末音到 bar 末(钳位当前和弦)。无可补 → 原样返回。 */
export function fillLeadBarGaps(
  tracks: readonly TrackIR[],
  chordTimeline: readonly ChordSpan[],
  timebase: Timebase,
  beatsPerBar: number,
  opts: LeadGapFillOptions = {},
): TrackIR[] {
  return tracks.map((t) => {
    if (t.role !== 'lead') return t;
    const fills = planLeadGapFills(t.notes, chordTimeline, timebase, beatsPerBar, opts);
    if (fills.length === 0) return t;
    const newEndByStart = new Map<number, number>();
    for (const f of fills) newEndByStart.set(f.startTick, f.newEnd);
    return {
      ...t,
      notes: t.notes.map((n) => {
        const ne = newEndByStart.get(n.startTick as number);
        return ne !== undefined ? { ...n, durationTicks: ticks(ne - (n.startTick as number)) } : n;
      }),
    };
  });
}
