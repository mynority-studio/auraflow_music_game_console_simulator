import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { GrooveBarScore, GrooveScorePlan } from '../arranger/ArrangementPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { applyGrooveScoreProjection, grooveScoreVelocityScale } from './grooveScoreProjection';

const score = (overrides: Partial<GrooveBarScore> = {}): GrooveBarScore => ({
  sectionId: 's1',
  barInSection: 0,
  absoluteBar: 0,
  phraseIndex: 0,
  phraseBarIndex: 0,
  role: 'base',
  beatStrength: [1, 1, 1, 1],
  subdivision: 'sixteenth',
  subdivisionAccent: [1, 1, 1, 1],
  phraseAccent: 1,
  energy: 0.5,
  trajectory: 'settled',
  ...overrides,
});

const plan = (bar: GrooveBarScore): GrooveScorePlan => ({
  grooveContractId: 'test',
  bySection: {
    s1: { sectionId: 's1', grooveContractId: 'test', bars: [bar] },
  },
  boundaries: [],
});

const note = (tick: number, pitch: number, velocity = 80) => ({
  pitch: midi(pitch),
  startTick: ticks(tick),
  durationTicks: ticks(240),
  velocity,
});

describe('render/grooveScoreProjection', () => {
  it('consumes every shared bar-score dimension instead of only drums reading it', () => {
    const base = score();
    const at = 0.25;
    const baseline = grooveScoreVelocityScale('comp', at, base);
    const variants = [
      score({ beatStrength: [1.2, 1, 1, 1] }),
      score({ subdivisionAccent: [1, 0.5, 1, 1] }),
      score({ phraseAccent: 1.1 }),
      score({ energy: 1 }),
      score({ trajectory: 'arrival' }),
    ];
    for (const variant of variants) {
      expect(grooveScoreVelocityScale('comp', at, variant)).not.toBeCloseTo(baseline, 6);
    }
  });

  it('projects one score into Bass, Comp and Lead while leaving Pad/Drum untouched', () => {
    const tracks: TrackIR[] = [
      { role: 'bass', notes: [note(0, 36)] },
      { role: 'comp', notes: [note(0, 60), note(0, 64)] },
      { role: 'lead', notes: [note(0, 72)] },
      { role: 'pad', notes: [note(0, 55)] },
      { role: 'drum', notes: [note(0, 36)] },
    ];
    const bar = score({
      beatStrength: [1.2, 0.82, 1.08, 0.82],
      phraseAccent: 1.1,
      energy: 1,
      trajectory: 'arrival',
    });
    const out = applyGrooveScoreProjection(tracks, plan(bar), 480, 4);
    for (const role of ['bass', 'comp', 'lead']) {
      expect(out.find((track) => track.role === role)!.notes[0].velocity, role).toBeGreaterThan(80);
    }
    expect(out.find((track) => track.role === 'comp')!.notes.map((entry) => entry.velocity))
      .toEqual([out.find((track) => track.role === 'comp')!.notes[0].velocity, out.find((track) => track.role === 'comp')!.notes[0].velocity]);
    expect(out.find((track) => track.role === 'pad')!.notes[0].velocity).toBe(80);
    expect(out.find((track) => track.role === 'drum')!.notes[0].velocity).toBe(80);
  });

  it('can preserve a score-owned role while the rhythm section still consumes the bar score', () => {
    const tracks: TrackIR[] = [
      { role: 'bass', notes: [note(0, 36)] },
      { role: 'lead', notes: [note(0, 72)] },
    ];
    const bar = score({ beatStrength: [1.2, 1, 1, 1], phraseAccent: 1.1, trajectory: 'arrival' });
    const out = applyGrooveScoreProjection(tracks, plan(bar), 480, 4, new Set(['lead']));

    expect(out[0].notes[0].velocity).toBeGreaterThan(80);
    expect(out[1].notes[0].velocity).toBe(80);
  });
});
