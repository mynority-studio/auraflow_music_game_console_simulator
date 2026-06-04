import { describe, it, expect } from 'vitest';
import { applyDynamics, type EnergyRange } from './dynamics';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import type { TrackIR } from '../ir/MusicalIR';
import { createRandomContext, midi, ticks } from '../foundation';

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

  it('★ 端到端:同一轨 comp 在【真实 chorus 段】力度 > 【真实 verse 段】(从曲式取段,抗曲式多样)', () => {
    const req = { seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 };
    // 曲式随 seed 变(3.5)→ 不能硬编码 beat 范围,从 arrangement 取真实 verse/chorus 段
    const band = buildBandSpec(req);
    const arr = buildArrangementPlan(band, { rng: createRandomContext(req.seed) });
    const bpb = arr.meter.numerator * (4 / arr.meter.denominator);
    let beat = 0;
    const ranges = arr.sections.map((s) => { const r = { role: s.role, lo: beat, hi: beat + s.bars * bpb }; beat += s.bars * bpb; return r; });
    const verse = ranges.find((r) => r.role === 'verse')!;
    const chorus = ranges.find((r) => r.role === 'chorus')!;
    const g = generateSong(req);
    const comp = g.ir!.tracks.find((t) => t.role === 'comp')!.notes;
    const avgIn = (lo: number, hi: number) => {
      const v = comp.filter((n) => { const b = (n.startTick as number) / 480; return b >= lo && b < hi; }).map((n) => n.velocity);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(avgIn(chorus.lo, chorus.hi)).toBeGreaterThan(avgIn(verse.lo, verse.hi)); // chorus 能量 0.9 > verse 0.6
  });
});
