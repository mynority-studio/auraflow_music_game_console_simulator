import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { acgDynamicsNoteKey, normalizeAcgDynamics, type AcgDynamicsTaggedTrack } from './acgDynamics';

const BAR_TICKS = 4 * 480;
const notes = (pitch: number, velocity: number) => Array.from({ length: 4 }, (_, bar) => ({
  pitch: midi(pitch), startTick: ticks(bar * BAR_TICKS), durationTicks: ticks(360), velocity,
}));

describe('render/acgDynamics', () => {
  it('ACG PIANOSONG 的三轨按同一乐句弧线推进并在句末回收', () => {
    const tracks: TrackIR[] = [
      { role: 'lead', notes: notes(72, 100) },
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

  it('does not reinterpret arbitrary simultaneous lead notes as a grammar dyad', () => {
    const tracks: TrackIR[] = [{
      role: 'lead',
      notes: [
        { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(360), velocity: 100 },
        { pitch: midi(81), startTick: ticks(0), durationTicks: ticks(360), velocity: 100 },
      ],
    }];
    const out = normalizeAcgDynamics(tracks, BAR_TICKS, 4)[0].notes;
    const low = out.find((note) => (note.pitch as number) === 72)!;
    const top = out.find((note) => (note.pitch as number) === 81)!;
    expect(low.startTick).toBe(top.startTick);
    expect(low.durationTicks).toBe(top.durationTicks);
    // Dyad hierarchy is authored in the realizer while the return token still
    // owns provenance. The dynamics pass only applies its bar curve and must
    // leave an arbitrary same-onset pair symmetric.
    expect(low.velocity).toBe(top.velocity);
  });

  it('keeps an explicitly grammar-tagged return dyad below the lead floor and strips the transient provenance', () => {
    const topline = { pitch: midi(81), startTick: ticks(0), durationTicks: ticks(360), velocity: 82 };
    const dyad = { pitch: midi(76), startTick: ticks(0), durationTicks: ticks(360), velocity: 34 };
    const tracks: AcgDynamicsTaggedTrack[] = [{
      role: 'lead',
      notes: [topline, dyad],
      __acgQuietDyadNoteKeys: [acgDynamicsNoteKey(dyad)],
    }];
    const out = normalizeAcgDynamics(tracks, BAR_TICKS, 4)[0]!;
    const outDyad = out.notes.find((note) => (note.pitch as number) === 76)!;
    const outTopline = out.notes.find((note) => (note.pitch as number) === 81)!;

    expect(outDyad.velocity, 'grammar dyad must not be lifted to the ordinary lead minimum').toBe(34);
    expect(outDyad.velocity).toBeLessThan(outTopline.velocity);
    expect('__acgQuietDyadNoteKeys' in out, 'transient authoring provenance must not escape into FinalIR').toBe(false);
  });

  it('can keep comp touch tied to a pre-gate external lead-presence contract', () => {
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        notes: [
          { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(360), velocity: 88 },
          { pitch: midi(74), startTick: ticks(BAR_TICKS), durationTicks: ticks(360), velocity: 88 },
        ],
      },
      {
        role: 'comp',
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(360), velocity: 50 },
          { pitch: midi(60), startTick: ticks(BAR_TICKS), durationTicks: ticks(360), velocity: 50 },
        ],
      },
    ];
    const inferred = normalizeAcgDynamics(tracks, BAR_TICKS, 4);
    const preGatePresence = normalizeAcgDynamics(tracks, BAR_TICKS, 4, new Set([0]));
    const inferredComp = inferred.find((track) => track.role === 'comp')!.notes;
    const preGateComp = preGatePresence.find((track) => track.role === 'comp')!.notes;

    expect(inferredComp[1]!.velocity, 'actual post-gate lead would normally make this a melody bar').toBe(52);
    expect(preGateComp[1]!.velocity, 'external lead contract controls comp touch even after its NoteIR is removed').toBe(55);
  });
});
