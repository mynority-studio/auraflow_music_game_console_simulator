import { describe, it, expect } from 'vitest';
import { applyDynamics, type EnergyRange } from './dynamics';
import { generateSong } from '../generation/GenerationController';
import type { TrackIR } from '../ir/MusicalIR';
import { midi, ticks } from '../foundation';

describe('render/dynamics (3.1)', () => {
  it('按段落能量缩放力度(高能量段更响)', () => {
    const ranges: EnergyRange[] = [
      { lo: 0, hi: 4, energy: 0.3 }, // 低
      { lo: 4, hi: 8, energy: 0.9 }, // 高
    ];
    const tracks: TrackIR[] = [{
      role: 'comp',
      notes: [
        { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 100 },    // 低能量段
        { pitch: midi(60), startTick: ticks(1920), durationTicks: ticks(240), velocity: 100 }, // 高能量段(beat 4)
      ],
    }];
    const out = applyDynamics(tracks, ranges, 480);
    const [lowVel, highVel] = out[0].notes.map((n) => n.velocity);
    expect(highVel).toBeGreaterThan(lowVel);
    expect(lowVel).toBe(Math.round(100 * (0.6 + 0.5 * 0.3))); // 75
    expect(highVel).toBe(Math.round(100 * (0.6 + 0.5 * 0.9))); // 105
  });

  it('velocity clamp [1,127]', () => {
    const tracks: TrackIR[] = [{ role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 127 }] }];
    const out = applyDynamics(tracks, [{ lo: 0, hi: 8, energy: 1 }], 480);
    expect(out[0].notes[0].velocity).toBeLessThanOrEqual(127);
  });

  it('★ 端到端:chorus 平均力度 > verse', () => {
    const r = generateSong({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    // 段落 beat 范围(intro4 + verse8 + chorus8 ...)→ tick
    const ppq = 480;
    const inRange = (lo: number, hi: number) =>
      r.ir!.tracks.flatMap((t) => t.notes).filter((n) => { const b = n.startTick / ppq; return b >= lo && b < hi; }).map((n) => n.velocity);
    const verseVel = inRange(16, 48);   // verse1: bar4..12 = beat 16..48
    const chorusVel = inRange(48, 80);  // chorus1: bar12..20 = beat 48..80
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(chorusVel)).toBeGreaterThan(avg(verseVel));
  });
});
