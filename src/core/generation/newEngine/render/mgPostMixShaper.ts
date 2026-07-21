// ============================================================
// newEngine · render · MgPostMixShaper(Loop 5,2026-06-09)
// ------------------------------------------------------------
// 端口 MG musicEngine.shapeLofiDenseMelodyComping(:4551):LOFI 旋律密集的【和弦区间】里,
//   伴奏让路给旋律 —— 删掉 comp(chord)击,bass 每区间最多留 1 个(时值 ≤1.6 拍、力度 ×0.72)。
//   ★ 只改 comp/bass,绝不碰 lead(strict parity)。在 RenderCoordinator lead/comp/bass 生成后、audit 前执行。
//   MG 的单流 part(melody/chord/bass)→ newEngine 分轨(lead/comp/bass);MG 的"bar"= 每个 chord(按 duration 累加)。
// ============================================================

import { ticks, type Timebase } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';

// 只读 tracks 视图(read-only 工具用;NoteIR/TrackIR 或 ir.tracks 的 DeepReadonly 都满足)。
type ReadonlyTracks = readonly { readonly role: string; readonly notes: readonly { readonly startTick: number; readonly durationTicks: number }[] }[];

const DENSE_DURATION_BEATS = 0.3; // 短音阈值(MG)
const BASS_DUR_CAP_BEATS = 1.6;   // dense bar bass 时值上限(MG)
const BASS_VEL_RATIO = 0.72;      // dense bar bass 力度比(MG)

const inSpanTick = (tick: number, lo: number, hi: number) => tick >= lo - 1 && tick < hi;

/** dense-melody 和弦区间 id(MG :4565):melody≥10 || 短音≥8 || (melody≥8 && chord≥12)。
 *  ★ 共享:dense 区间 comp 被有意删除 → comp-continuity 审计须从"comp 应在场区间"里排除这些区间。 */
export function denseMelodySpanIds(
  tracks: ReadonlyTracks,
  plan: HarmonicPlan,
  timebase: Timebase,
  includeAlreadyShapedCompGaps = false,
): Set<string> {
  const lead = tracks.find((t) => t.role === 'lead');
  const dense = new Set<string>();
  if (!lead) return dense;
  const ppq = timebase.ppq;
  const comp = tracks.find((t) => t.role === 'comp');
  for (const s of plan.chordTimeline) {
    const lo = timebase.beatToTick(s.startBeat) as number;
    const hi = lo + (timebase.beatToTick(s.durationBeats) as number);
    const mel = lead.notes.filter((n) => inSpanTick(n.startTick as number, lo, hi));
    const chordCount = comp ? comp.notes.filter((n) => inSpanTick(n.startTick as number, lo, hi)).length : 0;
    const shortCount = mel.filter((n) => (n.durationTicks as number) / ppq <= DENSE_DURATION_BEATS).length;
    const denseChordTexture = mel.length >= 8
      && (chordCount >= 12 || (includeAlreadyShapedCompGaps && chordCount === 0));
    if (mel.length >= 10 || shortCount >= 8 || denseChordTexture) dense.add(s.id);
  }
  return dense;
}

/** dense-melody 区间的 tick 窗口(comp 被有意删 → comp-continuity 审计排除这些区间)。 */
export function denseMelodySpanRanges(tracks: ReadonlyTracks, plan: HarmonicPlan, timebase: Timebase): { lo: number; hi: number }[] {
  // This helper is consumed after the LOFI shaper has intentionally removed
  // the dense span's comp notes. Preserve that authored exclusion instead of
  // asking the already-empty comp span to prove its former chord-note count.
  const dense = denseMelodySpanIds(tracks, plan, timebase, true);
  if (dense.size === 0) return [];
  return plan.chordTimeline
    .filter((s) => dense.has(s.id))
    .map((s) => { const lo = timebase.beatToTick(s.startBeat) as number; return { lo, hi: lo + (timebase.beatToTick(s.durationBeats) as number) }; });
}

/** LOFI dense melody comping:旋律密集的和弦区间删 comp、bass 减到 1 个并缩时值/力度。只动 comp/bass。 */
export function applyMgLofiDenseMelodyComping(tracks: TrackIR[], plan: HarmonicPlan, timebase: Timebase): TrackIR[] {
  const lead = tracks.find((t) => t.role === 'lead');
  if (!lead) return tracks;
  const ppq = timebase.ppq;

  // 每个 chord 区间的 tick 窗口
  const spans = plan.chordTimeline.map((s) => {
    const lo = timebase.beatToTick(s.startBeat) as number;
    return { id: s.id, lo, hi: lo + (timebase.beatToTick(s.durationBeats) as number) };
  });
  const spanAt = (tick: number) => spans.find((s) => inSpanTick(tick, s.lo, s.hi));

  const dense = denseMelodySpanIds(tracks, plan, timebase);
  if (dense.size === 0) return tracks;

  const cap = Math.round(BASS_DUR_CAP_BEATS * ppq);
  return tracks.map((t) => {
    if (t.role === 'lead') return t;                 // ★ 永不碰 lead
    if (t.role === 'comp') {
      return { role: 'comp', notes: t.notes.filter((n) => { const s = spanAt(n.startTick as number); return !s || !dense.has(s.id); }) };
    }
    if (t.role === 'bass') {
      const keptBass = new Set<string>();
      const notes = [...t.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number)).flatMap((n) => {
        const s = spanAt(n.startTick as number);
        if (!s || !dense.has(s.id)) return [n];        // 非 dense → 原样
        if (keptBass.has(s.id)) return [];             // dense 区间已留 1 个 → 删
        keptBass.add(s.id);
        return [{ ...n, durationTicks: ticks(Math.min(n.durationTicks as number, cap)), velocity: Math.max(1, Math.round(n.velocity * BASS_VEL_RATIO)) }];
      });
      return { role: 'bass', notes };
    }
    return t;
  });
}
