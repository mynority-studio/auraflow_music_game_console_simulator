import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { JazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import type { TrackIR } from '../ir/MusicalIR';
import {
  assertJazzFiveFourProjectionIdentity,
  jazzFiveFourScoreEventSignature,
  jazzFiveFourTrackEventSignature,
  projectJazzFiveFourScoreTracks,
} from './jazzFiveFourScoreProjector';

const plan = {
  performance: {
    mode: 'reference-zero',
    events: [
      { eventId: 'b0', instrumentEventId: 'b0', role: 'bass', tick: 0, durationTicks: 1_170, velocity: 84, pitch: 39, program: 32 },
      { eventId: 'c0', instrumentEventId: 'c0', role: 'comp', tick: 305, durationTicks: 75, velocity: 90, pitch: 54, program: 0 },
      { eventId: 'd0', instrumentEventId: 'd0', role: 'drum', tick: 0, durationTicks: 10, velocity: 94, pitch: 35, program: 40 },
      { eventId: 'd1', instrumentEventId: 'd1', role: 'drum', tick: 0, durationTicks: 10, velocity: 92, pitch: 51, program: 40 },
      { eventId: 'l0', instrumentEventId: 'l0', role: 'lead', tick: 160, durationTicks: 240, velocity: 88, pitch: 67, program: 65 },
    ],
  },
} as unknown as JazzFiveFourScorePlan;

describe('Jazz 5/4 final score projector', () => {
  it('replaces score-owned notes without changing unrelated tracks or mix metadata', () => {
    const tracks: TrackIR[] = [
      { role: 'bass', program: 99, mix: { volume: 80, pan: 64, reverb: 0, chorus: 0 }, notes: [] },
      { role: 'comp', program: 99, notes: [] },
      { role: 'lead', program: 65, notes: [{ pitch: midi(70), startTick: ticks(80), durationTicks: ticks(120), velocity: 77 }] },
    ];
    const projected = projectJazzFiveFourScoreTracks(tracks, plan);

    expect(projected.find((track) => track.role === 'bass')).toMatchObject({
      program: 32,
      mix: { volume: 80, pan: 64, reverb: 0, chorus: 0 },
      notes: [{ pitch: 39, startTick: 0, durationTicks: 1_170, velocity: 84 }],
    });
    expect(projected.find((track) => track.role === 'drum')?.notes).toHaveLength(2);
    expect(projected.find((track) => track.role === 'lead')).toMatchObject({
      program: 65,
      notes: [{ pitch: 67, startTick: 160, durationTicks: 240, velocity: 88 }],
    });
    expect(jazzFiveFourTrackEventSignature(projected)).toEqual(jazzFiveFourScoreEventSignature(plan));
    expect(() => assertJazzFiveFourProjectionIdentity(projected, plan)).not.toThrow();
  });

  it('fails closed when a later stage changes a score-owned event', () => {
    const projected = projectJazzFiveFourScoreTracks([], plan);
    projected[0]!.notes[0]!.velocity -= 1;
    expect(() => assertJazzFiveFourProjectionIdentity(projected, plan)).toThrow('projection identity violated');
  });
});
