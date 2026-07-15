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

/**
 * 全轨按所在段落能量缩放力度。伴奏使用 0.6 + 0.5*energy；lead 使用更克制的
 * 0.84 + 0.24*energy，保留 MG 原始表情，同时让 section lift 真正可听。
 */
export function applyDynamics(tracks: TrackIR[], ranges: EnergyRange[], ppq: number): TrackIR[] {
  const energyAt = (beat: number): number =>
    ranges.find((r) => beat >= r.lo && beat < r.hi)?.energy ?? 0.5;
  return tracks.map((t) => {
    return {
      ...t,
      notes: t.notes.map((n) => {
        const e = energyAt((n.startTick as number) / ppq);
        const scale = t.role === 'lead'
          ? 0.84 + 0.24 * e
          : 0.6 + 0.5 * e;
        return { ...n, velocity: Math.max(1, Math.min(127, Math.round(n.velocity * scale))) };
      }),
    };
  });
}
