// ============================================================
// newEngine · render · Dynamics(energyCurve → 力度)
// ------------------------------------------------------------
// 架构定稿 Part 2.3 / 战线5:能量曲线落到力度。全轨按所在段落能量缩放 velocity
// (chorus 强 / intro·verse 弱 / 高潮峰)。音区已在 melody 弧线(2.4)消费;此处补力度。
// ============================================================

import type { TrackIR } from '../ir/MusicalIR';

export interface EnergyRange {
  lo: number; // 起拍
  hi: number; // 止拍
  energy: number; // 0..1
}

/** 全轨按所在段落能量缩放力度:scale = 0.6 + 0.5*energy(energy0→0.6x / 1→1.1x)。 */
export function applyDynamics(tracks: TrackIR[], ranges: EnergyRange[], ppq: number): TrackIR[] {
  const energyAt = (beat: number): number =>
    ranges.find((r) => beat >= r.lo && beat < r.hi)?.energy ?? 0.5;
  return tracks.map((t) => ({
    role: t.role,
    notes: t.notes.map((n) => {
      const e = energyAt((n.startTick as number) / ppq);
      const scale = 0.6 + 0.5 * e;
      return { ...n, velocity: Math.max(1, Math.min(127, Math.round(n.velocity * scale))) };
    }),
  }));
}
