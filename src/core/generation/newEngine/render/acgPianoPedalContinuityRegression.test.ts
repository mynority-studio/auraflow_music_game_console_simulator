import { describe, expect, it } from 'vitest';
import { hashSeedToInt } from '../../../../state/MusicGenerationSeedStore';
import { buildSongBundle, generateSongFromBundle, type SongBundle } from '../generation/GenerationController';
import type { MusicalIR, NoteIR, TrackIR } from '../ir/MusicalIR';

const UI_20161102_SEED = hashSeedToInt('20161102');
const PIANO_ROLES = new Set<TrackIR['role']>(['lead', 'comp', 'bass']);
const SWEEP_SEEDS = [0, 1, 2, 3, 7, 11, 27, 42, 75, 99] as const;

type PedalEvent = { atTick: unknown; down: boolean };

type Onset = {
  tick: number;
  notes: readonly NoteIR[];
};

function generateAcg(seed: number): { bundle: SongBundle; ir: MusicalIR } {
  const bundle = buildSongBundle({
    seed,
    styleHint: 'acg',
    mood: 'build',
    targetDuration: 120,
  });
  const result = generateSongFromBundle(bundle);
  expect(result.status, `ACG seed ${seed} generation`).not.toBe('failed');
  expect(result.ir, `ACG seed ${seed} final IR`).toBeDefined();
  return { bundle, ir: result.ir! };
}

function trackFor(ir: MusicalIR, role: TrackIR['role']): MusicalIR['tracks'][number] {
  const track = ir.tracks.find((candidate) => candidate.role === role);
  if (!track) throw new Error(`Expected final IR to contain ${role}.`);
  return track;
}

function onsets(notes: readonly NoteIR[]): Onset[] {
  const byTick = new Map<number, NoteIR[]>();
  for (const note of notes) {
    const tick = Number(note.startTick);
    const group = byTick.get(tick) ?? [];
    group.push(note as NoteIR);
    byTick.set(tick, group);
  }
  return [...byTick.entries()]
    .sort(([left], [right]) => left - right)
    .map(([tick, groupedNotes]) => ({ tick, notes: groupedNotes }));
}

/** CC64 is a latched state: a note does not need a fresh controller event. */
function pedalDownAt(events: readonly PedalEvent[] | undefined, tick: number): boolean {
  let down = false;
  for (const event of events ?? []) {
    if (Number(event.atTick) > tick) break;
    down = event.down;
  }
  return down;
}

function isContinuousFastRun(onsetIndex: number, attacks: readonly Onset[], ppq: number): boolean {
  const sixteenthTicks = ppq / 4;
  const tolerance = 1;
  const tick = attacks[onsetIndex]!.tick;
  const previous = attacks[onsetIndex - 1];
  const next = attacks[onsetIndex + 1];
  const touchesPrevious = !!previous && tick - previous.tick <= sixteenthTicks + tolerance;
  const touchesNext = !!next && next.tick - tick <= sixteenthTicks + tolerance;
  // A lone short pickup/ornament before air is not a run.  It needs at least
  // one fast neighbour on each side, or two continuing fast steps on one side.
  const hasPreviousPair = onsetIndex >= 2
    && previous !== undefined
    && previous.tick - attacks[onsetIndex - 2]!.tick <= sixteenthTicks + tolerance;
  const hasNextPair = onsetIndex + 2 < attacks.length
    && next !== undefined
    && attacks[onsetIndex + 2]!.tick - next.tick <= sixteenthTicks + tolerance;
  return (touchesPrevious && touchesNext)
    || (touchesPrevious && hasPreviousPair)
    || (touchesNext && hasNextPair);
}

function exposedCompAttacks(ir: MusicalIR): Array<{ onset: Onset; fastRun: boolean }> {
  const comp = trackFor(ir, 'comp');
  const attacks = onsets(comp.notes as readonly NoteIR[]);
  const ppq = Number(ir.timebase.ppq);
  return attacks.map((onset, index) => ({
    onset,
    fastRun: isContinuousFastRun(index, attacks, ppq),
  }));
}

function sameTickRepedals(events: readonly PedalEvent[] | undefined): number[] {
  const byTick = new Map<number, boolean[]>();
  for (const event of events ?? []) {
    const tick = Number(event.atTick);
    const values = byTick.get(tick) ?? [];
    values.push(event.down);
    byTick.set(tick, values);
  }
  return [...byTick.entries()]
    .filter(([, values]) => values.some((down) => !down) && values.some((down) => down))
    .map(([tick]) => tick)
    .sort((left, right) => left - right);
}

function physicalPianoAttackTicks(ir: MusicalIR): Set<number> {
  return new Set(ir.tracks
    .filter((track) => PIANO_ROLES.has(track.role))
    .flatMap((track) => track.notes.map((note) => Number(note.startTick))));
}

function nextPhysicalAttackAfter(sortedAttackTicks: readonly number[], tick: number): number | undefined {
  return sortedAttackTicks.find((candidate) => candidate > tick);
}

function pedalDownImmediatelyBefore(events: readonly PedalEvent[] | undefined, tick: number): boolean {
  return pedalDownAt(events, Math.max(0, tick - 1));
}

function pedalContinuityFindings(ir: MusicalIR, range?: { startTick: number; endTick: number }): {
  unsupportedAttacks: Array<{ beat: number; pitches: number[] }>;
  exposedCarrierReleases: Array<{ carrierBeat: number; nextPianoAttackBeat: number }>;
  blindRepedals: number[];
  redundantStateEvents: number[];
  sharedLaneMismatch: TrackIR['role'][];
} {
  const comp = trackFor(ir, 'comp');
  const ppq = Number(ir.timebase.ppq);
  const attacks = exposedCompAttacks(ir).filter(({ onset }) =>
    onset.tick >= (range?.startTick ?? 0) && onset.tick < (range?.endTick ?? Number.POSITIVE_INFINITY));
  const unsupportedAttacks = attacks
    .filter(({ fastRun }) => !fastRun)
    .filter(({ onset }) => !pedalDownAt(comp.pedalEvents, onset.tick))
    .map(({ onset }) => ({ beat: onset.tick / ppq, pitches: onset.notes.map((note) => Number(note.pitch)) }));
  const pianoAttackTicks = physicalPianoAttackTicks(ir);
  const sortedPianoAttackTicks = [...pianoAttackTicks].sort((left, right) => left - right);
  const exposedCarrierReleases = attacks
    .filter(({ fastRun }) => !fastRun)
    .flatMap(({ onset }) => {
      const nextAttackTick = nextPhysicalAttackAfter(sortedPianoAttackTicks, onset.tick);
      // Very close attacks belong to a roll/ornament, not a written rest.
      if (nextAttackTick === undefined || nextAttackTick - onset.tick <= ppq / 4 + 1) return [];
      return pedalDownImmediatelyBefore(comp.pedalEvents, nextAttackTick)
        ? []
        : [{ carrierBeat: onset.tick / ppq, nextPianoAttackBeat: nextAttackTick / ppq }];
    });
  const blindRepedals = sameTickRepedals(comp.pedalEvents)
    .filter((tick) => tick >= (range?.startTick ?? 0) && tick < (range?.endTick ?? Number.POSITIVE_INFINITY))
    .filter((tick) => {
      if (pianoAttackTicks.has(tick)) return false;
      // A quick re-pedal immediately after a new attack is an authored
      // delayed-repedal technique.  A pair emitted early from a harmonic
      // boundary, with no recent attack, is the blind behaviour under test.
      const previousAttack = [...sortedPianoAttackTicks].reverse().find((attackTick) => attackTick < tick);
      return previousAttack === undefined || tick - previousAttack > ppq / 16 + 1;
    })
    .map((tick) => tick / ppq);
  const relevantPedalEvents = (comp.pedalEvents ?? []).filter((event) =>
    Number(event.atTick) >= (range?.startTick ?? 0)
      && Number(event.atTick) < (range?.endTick ?? Number.POSITIVE_INFINITY));
  const redundantStateEvents = relevantPedalEvents
    .flatMap((event, index) => index > 0 && relevantPedalEvents[index - 1]!.down === event.down
      ? [Number(event.atTick) / ppq]
      : []);
  const sharedLaneMismatch = (['lead', 'bass'] as const).filter((role) =>
    JSON.stringify(trackFor(ir, role).pedalEvents ?? []) !== JSON.stringify(comp.pedalEvents ?? []));
  return {
    unsupportedAttacks,
    exposedCarrierReleases,
    blindRepedals,
    redundantStateEvents,
    sharedLaneMismatch,
  };
}

function assertPedalContinuity(seed: number, ir: MusicalIR, range?: { startTick: number; endTick: number }): void {
  expect(pedalContinuityFindings(ir, range), `seed ${seed}: score-owned ACG damper continuity`).toEqual({
    unsupportedAttacks: [],
    exposedCarrierReleases: [],
    blindRepedals: [],
    redundantStateEvents: [],
    sharedLaneMismatch: [],
  });
}

describe('render/acgPianoPedalContinuityRegression · score-owned shared damper', () => {
  it('interprets the UI string seed deterministically', () => {
    expect(UI_20161102_SEED).toBe(2345881477);
  });

  it('20161102 INTRO keeps its exposed COMP dyad/rolled carrier under the latched pedal state', () => {
    const { bundle, ir } = generateAcg(UI_20161102_SEED);
    const firstSection = bundle.arrangement.sections[0];
    expect(firstSection?.role).toBe('intro');
    const beatsPerBar = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
    const introEndTick = firstSection!.bars * beatsPerBar * Number(ir.timebase.ppq);
    const comp = trackFor(ir, 'comp');
    const introAttacks = onsets(comp.notes as readonly NoteIR[]).filter((onset) => onset.tick < introEndTick);
    const finalPolyphonicCarrier = [...introAttacks].reverse().find((onset) => onset.notes.length >= 2);

    expect(finalPolyphonicCarrier, 'fixture must retain the reported INTRO COMP dyad').toBeDefined();
    expect(finalPolyphonicCarrier!.tick / Number(ir.timebase.ppq)).toBeCloseTo(10.75, 6);
    expect(pedalDownAt(comp.pedalEvents, finalPolyphonicCarrier!.tick), 'CC64 is stateful; carrier must attack while down').toBe(true);
    assertPedalContinuity(UI_20161102_SEED, ir, { startTick: 0, endTick: introEndTick });
  });

  it('20161102 has no later COMP attack inside an unplanned long dry pedal window', () => {
    const { ir } = generateAcg(UI_20161102_SEED);
    assertPedalContinuity(UI_20161102_SEED, ir);
  });

  it('keeps score-owned pedal continuity across representative ACG arrangements', () => {
    for (const seed of SWEEP_SEEDS) {
      const { ir } = generateAcg(seed);
      assertPedalContinuity(seed, ir);
    }
  });
});
