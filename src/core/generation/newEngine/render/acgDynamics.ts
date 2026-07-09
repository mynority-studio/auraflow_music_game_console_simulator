// ============================================================
// newEngine · render · ACG dynamics(忠实 port MG normalizeAcgDynamics,musicEngine.ts:7583-7608)
// ------------------------------------------------------------
// ACG 的第一原则 = melody-first:lead 亮、comp 是空气(pp)、bass 温暖托底。MG 每【bar】把三轨力度
// 归一到目标均值(lead 86 / comp 29-32 / bass 37),scale 夹 [0.48,1.22] 防极端重标。
// SIM 此前 comp velocity 被 accompanimentRenderer 抬到 ~54(为"听得到伴奏"),正好反了 MG 的 pp-comp 秩序
// → 空灵/浮在软垫上的 ACG 招牌感丢失。此 pass 恢复 MG 的响度秩序(只 ACG,只改 velocity,不碰音符/时值)。
// ============================================================

import type { TrackIR, NoteIR } from '../ir/MusicalIR';

interface VelTarget { avg: number; max: number; min: number }
// 目标(0-127)。★ 2026-07-02(用户:lead/comp 是一台钢琴,声音大小/音色要齐平):MG 原值 comp29/lead86 在采样钢琴
//   (SpessaSynth)上,velocity 决定【力度层音色】—— comp pp(29)触发暗/闷的采样层,和 lead f(86)的亮层像两台琴,
//   CC7 补不回音色差。改:comp 抬到 mf(≈52,和 lead 同亮层区 → 音色齐平),仍比 lead 软(melody-first 靠 velocity 差 +
//   CC7,不靠 pp 闷层);bass 保温暖托底,最终电平由 gmMixProfile 按 SF2 实测压住。lead 保 f。
const LEAD_T: VelTarget = { avg: 86, max: 96, min: 60 };
const BASS_T: VelTarget = { avg: 48, max: 68, min: 30 };
const COMP_MEL_T: VelTarget = { avg: 52, max: 66, min: 36 };
const COMP_NOMEL_T: VelTarget = { avg: 55, max: 70, min: 38 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** 按 bar 把某轨 velocity 归一到目标(scale = target/avg,夹 [0.48,1.22]),逐音 clamp[min,max]。 */
function rescaleByBar(notes: readonly NoteIR[], barTicks: number, targetFor: (bar: number) => VelTarget): NoteIR[] {
  const byBar = new Map<number, NoteIR[]>();
  for (const n of notes) {
    const bar = Math.floor((n.startTick as number) / barTicks);
    const g = byBar.get(bar); if (g) g.push(n); else byBar.set(bar, [n]);
  }
  const scaleByBar = new Map<number, { scale: number; t: VelTarget }>();
  for (const [bar, g] of byBar) {
    const avg = g.reduce((s, x) => s + x.velocity, 0) / Math.max(1, g.length);
    const t = targetFor(bar);
    scaleByBar.set(bar, { scale: clamp(t.avg / Math.max(1, avg), 0.48, 1.22), t });
  }
  return notes.map((n) => {
    const bar = Math.floor((n.startTick as number) / barTicks);
    const s = scaleByBar.get(bar)!;
    return { ...n, velocity: Math.round(clamp(n.velocity * s.scale, s.t.min, s.t.max)) };
  });
}

/** ACG 每-bar 三轨力度归一(lead 86 / comp 29-32 / bass 37)。只 ACG 调用;非 ACG 不动。 */
export function normalizeAcgDynamics(tracks: readonly TrackIR[], barTicks: number): TrackIR[] {
  const lead = tracks.find((t) => t.role === 'lead');
  const barHasLead = new Set<number>();
  for (const n of lead?.notes ?? []) barHasLead.add(Math.floor((n.startTick as number) / barTicks));
  return tracks.map((t) => {
    if (t.role === 'lead') return { ...t, notes: rescaleByBar(t.notes, barTicks, () => LEAD_T) };
    if (t.role === 'bass') return { ...t, notes: rescaleByBar(t.notes, barTicks, () => BASS_T) };
    if (t.role === 'comp') return { ...t, notes: rescaleByBar(t.notes, barTicks, (bar) => (barHasLead.has(bar) ? COMP_MEL_T : COMP_NOMEL_T)) };
    return t;
  });
}
