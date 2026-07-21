// ============================================================
// newEngine · render · ACG dynamics(忠实 port MG normalizeAcgDynamics,musicEngine.ts:7583-7608)
// ------------------------------------------------------------
// ACG 的第一原则 = melody-first:lead 亮、comp 是空气(pp)、bass 温暖托底。MG 每【bar】把三轨力度
// 归一到目标均值(lead 86 / comp 29-32 / bass 37),scale 夹 [0.48,1.22] 防极端重标。
// SIM 此前 comp velocity 被 accompanimentRenderer 抬到 ~54(为"听得到伴奏"),正好反了 MG 的 pp-comp 秩序
// → 空灵/浮在软垫上的 ACG 招牌感丢失。此 pass 恢复 MG 的响度秩序(只 ACG,只改 velocity,不碰音符/时值)。
// ============================================================

import type { TrackIR, NoteIR } from '../ir/MusicalIR';

/**
 * Transient provenance carried from the grammar realizer to this one allowed
 * output-touch pass.  It is stripped by `normalizeAcgDynamics` before FinalIR
 * is produced, so arbitrary same-onset lead notes never acquire dyad semantics.
 */
export interface AcgDynamicsTaggedTrack extends TrackIR {
  __acgQuietDyadNoteKeys?: readonly string[];
}

export function acgDynamicsNoteKey(note: Pick<NoteIR, 'pitch' | 'startTick' | 'durationTicks'>): string {
  return `${note.pitch as number}:${note.startTick as number}:${note.durationTicks as number}`;
}

interface VelTarget { avg: number; max: number; min: number }
// 目标(0-127)。★ 2026-07-02(用户:lead/comp 是一台钢琴,声音大小/音色要齐平):MG 原值 comp29/lead86 在采样钢琴
//   上,velocity 决定【力度层音色】—— comp pp(29)触发暗/闷的采样层,和 lead f(86)的亮层像两台琴,
//   CC7 补不回音色差。改:comp 抬到 mf(≈52,和 lead 同亮层区 → 音色齐平),仍比 lead 软(melody-first 靠 velocity 差 +
//   CC7,不靠 pp 闷层);bass 保温暖托底,最终电平由 gmMixProfile 按 SF2 实测压住。lead 保 f。
const LEAD_T: VelTarget = { avg: 86, max: 96, min: 60 };
const BASS_T: VelTarget = { avg: 48, max: 68, min: 30 };
const COMP_MEL_T: VelTarget = { avg: 52, max: 66, min: 36 };
const COMP_NOMEL_T: VelTarget = { avg: 55, max: 70, min: 38 };
// 每句先呼吸、再推进、在第三小节抵达、末小节回收；所有手在同一曲线内，避免各轨各自抖动。
// 平均值保持 1.0：乐句弧只重分配四小节力度，不能暗中把既有 mf/f 目标整体压低。
const PHRASE_ENERGY = [0.96, 1.00, 1.07, 0.97] as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** 按 bar 把某轨 velocity 归一到目标。`maxScale` lets authored quiet lead
 * responses remain quiet instead of being amplified back into a peak. */
function rescaleByBar(
  notes: readonly NoteIR[],
  barTicks: number,
  targetFor: (bar: number) => VelTarget,
  maxScale = 1.22,
  floorExemptNoteKeys?: ReadonlySet<string>,
): NoteIR[] {
  const byBar = new Map<number, NoteIR[]>();
  for (const n of notes) {
    const bar = Math.floor((n.startTick as number) / barTicks);
    const g = byBar.get(bar); if (g) g.push(n); else byBar.set(bar, [n]);
  }
  const scaleByBar = new Map<number, { scale: number; t: VelTarget }>();
  for (const [bar, g] of byBar) {
    const avg = g.reduce((s, x) => s + x.velocity, 0) / Math.max(1, g.length);
    const t = targetFor(bar);
    scaleByBar.set(bar, { scale: clamp(t.avg / Math.max(1, avg), 0.48, maxScale), t });
  }
  return notes.map((n) => {
    const bar = Math.floor((n.startTick as number) / barTicks);
    const s = scaleByBar.get(bar)!;
    const min = floorExemptNoteKeys?.has(acgDynamicsNoteKey(n)) ? 1 : s.t.min;
    return { ...n, velocity: Math.round(clamp(n.velocity * s.scale, min, s.t.max)) };
  });
}

function phraseTarget(base: VelTarget, bar: number, phraseBars: number): VelTarget {
  const shape = PHRASE_ENERGY[bar % Math.max(1, phraseBars) % PHRASE_ENERGY.length] ?? 1;
  return {
    avg: base.avg * shape,
    min: base.min * Math.min(1, shape + 0.04),
    max: base.max * Math.max(1, shape),
  };
}

/** ACG 每句共享的微型力度弧：lead/comp/bass 同步呼吸，保留 melody-first 的相对层次。
 *
 * `leadPresenceBars` is a pre-score/output presence contract for the comp
 * touch curve.  It lets an externally supplied lead keep its original
 * arrangement relationship even if a later legacy gate removes that lead's
 * NoteIR; score-owned comp must never have its velocities retroactively
 * changed by such a gate.
 */
export function normalizeAcgDynamics(
  tracks: readonly TrackIR[],
  barTicks: number,
  phraseBars = 4,
  leadPresenceBars?: ReadonlySet<number>,
): TrackIR[] {
  const lead = tracks.find((t) => t.role === 'lead');
  const barHasLead = leadPresenceBars
    ? new Set(leadPresenceBars)
    : new Set((lead?.notes ?? []).map((n) => Math.floor((n.startTick as number) / barTicks)));
  return tracks.map((t) => {
    const taggedTrack = t as AcgDynamicsTaggedTrack;
    const { __acgQuietDyadNoteKeys: quietDyadKeys, ...track } = taggedTrack;
    const floorExemptNoteKeys = quietDyadKeys?.length ? new Set(quietDyadKeys) : undefined;
    if (t.role === 'lead') {
      // Return dyads and re-entry answers are deliberately softer at their
      // source. Their explicit grammar provenance bypasses only the minimum
      // floor; the phrase curve may still make them quieter, never louder.
      const rescaled = rescaleByBar(t.notes, barTicks, (bar) => phraseTarget(LEAD_T, bar, phraseBars), 1, floorExemptNoteKeys);
      return { ...track, notes: rescaled };
    }
    if (t.role === 'bass') return { ...track, notes: rescaleByBar(t.notes, barTicks, (bar) => phraseTarget(BASS_T, bar, phraseBars)) };
    if (t.role === 'comp') return { ...track, notes: rescaleByBar(t.notes, barTicks, (bar) => phraseTarget(barHasLead.has(bar) ? COMP_MEL_T : COMP_NOMEL_T, bar, phraseBars)) };
    return track;
  });
}
