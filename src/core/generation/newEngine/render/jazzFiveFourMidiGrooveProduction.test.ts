import { describe, expect, it } from 'vitest';
import { buildSongBundle } from '../generation/GenerationController';
import { JAZZ_5_4_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { renderSongFull } from './renderCoordinator';
import { pc } from '../foundation';

const ROLES = new Set(['bass', 'comp', 'lead', 'drum'] as const);
const BAR_TICKS = 5 * 480;

function bundle() {
  return buildSongBundle({
    seed: 1662,
    styleHint: 'jazz',
    mood: 'modern cool piano',
    targetDuration: 57.5,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
    bandConstraint: {
      allowedRoles: ROLES,
      requiredRoles: ROLES,
    },
  });
}

function uniquePhases(notes: readonly { startTick: number }[], lo: number, hi: number): number[] {
  return [...new Set(notes
    .filter((note) => note.startTick >= lo && note.startTick < hi)
    .map((note) => note.startTick % BAR_TICKS))]
    .sort((a, b) => a - b);
}

function notesAtPhase(
  notes: readonly { startTick: number; durationTicks: number; velocity: number; pitch: number }[],
  barStart: number,
  phase: number,
) {
  return notes
    .filter((note) => note.startTick === barStart + phase)
    .sort((a, b) => a.pitch - b.pitch);
}

describe('Jazz 5/4 · supplied MIDI groove production path', () => {
  it('keeps the 3+2 harmonic boundary and one global 5/4 clock', () => {
    const b = bundle();
    expect(b.arrangement.meter).toEqual({ numerator: 5, denominator: 4 });
    expect(b.timebase.ppq).toBe(480);
    expect(b.arrangement.songGrooveContract.beatGrouping).toEqual([3, 2]);
    expect(b.arrangement.tempoBpm).toBeCloseTo(167.000203, 6);

    const firstBar = b.harmonic.chordTimeline.filter((span) => (span.startBeat as number) < 5);
    expect(firstBar.map((span) => [span.startBeat as number, span.durationBeats as number]))
      .toEqual([[0, 3], [3, 2]]);
    expect(((firstBar[1]!.rootPc as number) - (firstBar[0]!.rootPc as number) + 12) % 12).toBe(7);
  });

  it('projects the Arranger score with exact Bass/Comp cells and one song-global handoff', () => {
    const b = bundle();
    const rendered = renderSongFull(
      b.band,
      b.arrangement,
      b.harmonic,
      b.instrumentation,
      b.timebase,
      b.seedRng,
      undefined,
      undefined,
      deriveMusicIntentPlan(b.band.style, b.arrangement),
      undefined,
      b.acgPianoScorePlan,
      b.jazzFiveFourScorePlan,
    );
    const bass = rendered.ir.tracks.find((track) => track.role === 'bass')!;
    const comp = rendered.ir.tracks.find((track) => track.role === 'comp')!;
    const lead = rendered.ir.tracks.find((track) => track.role === 'lead')!;
    const handoffTick = 9 * BAR_TICKS;

    expect(uniquePhases(bass.notes as unknown as { startTick: number }[], 0, handoffTick))
      .toEqual([0, 785, 1440]);
    expect(bass.notes.every((note) => (note.startTick as number) < handoffTick)).toBe(true);

    const bassFirstBar = bass.notes as unknown as {
      startTick: number; durationTicks: number; velocity: number; pitch: number;
    }[];
    expect([0, 785, 1440].map((phase) =>
      notesAtPhase(bassFirstBar, 0, phase).map((note) => note.durationTicks)))
      .toEqual([[215], [150], [695]]);
    const bassVelocity = [0, 785, 1440].map((phase) => notesAtPhase(bassFirstBar, 0, phase)[0]!.velocity);
    expect(bassVelocity[1]).toBeGreaterThan(bassVelocity[2]);
    expect(bassVelocity[2]).toBeGreaterThan(bassVelocity[0]);

    expect(comp.notes.every((note) => (note.startTick as number) >= handoffTick)).toBe(true);
    expect(uniquePhases(comp.notes as unknown as { startTick: number }[], handoffTick, handoffTick + 7 * BAR_TICKS))
      .toEqual([0, 305, 785, 1440, 1920]);
    expect(uniquePhases(
      comp.notes as unknown as { startTick: number }[],
      handoffTick + 7 * BAR_TICKS,
      handoffTick + 8 * BAR_TICKS,
    )).toEqual([0, 305, 785, 960, 1440]);

    const compNotes = comp.notes as unknown as {
      startTick: number; durationTicks: number; velocity: number; pitch: number;
    }[];
    expect([0, 785, 1440].map((phase) =>
      notesAtPhase(compNotes, handoffTick, phase).map((note) => note.durationTicks)))
      .toEqual([[215], [150], [695]]);
    expect([305, 1920].map((phase) =>
      notesAtPhase(compNotes, handoffTick, phase).map((note) => note.durationTicks)))
      .toEqual([[75, 40, 80], [160, 160, 165]]);

    const compPhaseSet = new Set([0, 305, 785, 1440, 1920]);
    const leadPhases = new Set(lead.notes.map((note) => (note.startTick as number) % BAR_TICKS));
    expect([...leadPhases].some((phase) => !compPhaseSet.has(phase))).toBe(true);
  });

  it('locks all three writing roles to one acoustic piano and the authored registers', () => {
    const b = bundle();
    expect(b.instrumentation.roleProgram.bass).toBe(0);
    expect(b.instrumentation.roleProgram.comp).toBe(0);
    expect(b.instrumentation.roleProgram.lead).toBe(0);
    expect(b.instrumentation.strictRegisterByRole).toMatchObject({
      bass: { lowMidi: 40, highMidi: 52 },
      comp: { lowMidi: 40, highMidi: 66 },
      lead: { lowMidi: 55, highMidi: 78 },
    });
  });
});
