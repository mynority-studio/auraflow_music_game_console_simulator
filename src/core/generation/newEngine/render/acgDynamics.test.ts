import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { normalizeAcgDynamics } from './acgDynamics';

const BAR_TICKS = 4 * 480;
const notes = (pitch: number, velocity: number) => Array.from({ length: 4 }, (_, bar) => ({
  pitch: midi(pitch), startTick: ticks(bar * BAR_TICKS), durationTicks: ticks(360), velocity,
}));

describe('render/acgDynamics', () => {
  it('ACG PIANOSONG 的三轨按同一乐句弧线推进并在句末回收', () => {
    const tracks: TrackIR[] = [
      { role: 'lead', notes: notes(72, 80) },
      { role: 'comp', notes: notes(60, 50) },
      { role: 'bass', notes: notes(48, 45) },
    ];
    const out = normalizeAcgDynamics(tracks, BAR_TICKS, 4);
    const targetMean = { lead: 86, comp: 52, bass: 48 } as const;
    for (const role of ['lead', 'comp', 'bass'] as const) {
      const velocities = out.find((track) => track.role === role)!.notes.map((note) => note.velocity);
      expect(velocities[2], `${role} 第三小节到达`).toBeGreaterThan(velocities[0]);
      expect(velocities[2], `${role} 句尾回收`).toBeGreaterThan(velocities[3]);
      const mean = velocities.reduce((sum, velocity) => sum + velocity, 0) / velocities.length;
      expect(mean, `${role} 乐句弧不改变已校准目标均值`).toBeCloseTo(targetMean[role], 0);
    }
  });
});
