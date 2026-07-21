import { describe, expect, it } from 'vitest';
import { buildChordPart, getCurrentChordAtBeat, type ChordPart, type MgChordDef } from './mgChordPart';
import { scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { realizeTokens } from './mgMelodyRealizer';
import type { BrickMatch } from './mgRoadMapParser';
import type { ScheduledToken } from './mgTokenScheduler';
import { buildSongBundle } from '../generation/GenerationController';
import { pc } from '../foundation';
import { renderMgMelody } from './mgLeadRenderer';
import { renderSongFull } from './renderCoordinator';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';

const chord = (
  root: string,
  rootMidi: number,
  type: string,
  effectiveFunc: 'T' | 'S' | 'D',
  stableTonePcs: number[],
  chordScalePcs: number[],
): MgChordDef => ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4, effectiveFunc, stableTonePcs, chordScalePcs });

// D(0–4) → i(4–8) lets the test assert that a D-labelled return lands in
// the *next* tonic block rather than being left on the dominant.
const PART = buildChordPart([
  chord('G', 55, '7', 'D', [7, 11, 2, 5], [7, 9, 11, 0, 2, 4, 5]),
  chord('C', 60, 'm9', 'T', [0, 3, 7, 10, 2], [0, 2, 3, 5, 7, 8, 10]),
  chord('F', 53, 'm9', 'S', [5, 8, 0, 3, 7], [5, 7, 8, 10, 0, 1, 3]),
  chord('C', 60, 'm9', 'T', [0, 3, 7, 10, 2], [0, 2, 3, 5, 7, 8, 10]),
]);

const ROADMAP_BRICK: BrickMatch = {
  name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16,
  chordIndices: [0, 1, 2, 3], cost: 0,
};

function scheduled() {
  return scheduleAcgCycleCadencePhrases([{
    brickIndex: 0,
    brick: ROADMAP_BRICK,
    // R → audible is the only place the scheduler may form a return brick.
    // Spreading places the first one exactly at the D→T boundary (beat 4).
    tokens: [
      { kind: 'C', duration: 1 }, { kind: 'R', duration: 1.5 }, { kind: 'C', duration: 1 },
      { kind: 'R', duration: 1.5 }, { kind: 'C', duration: 1 }, { kind: 'R', duration: 1.5 }, { kind: 'C', duration: 1 },
    ],
  }], PART);
}

/** Mirrors the auditor's structural grid: passing pre-arrivals must not be
 * scheduled as a strong-beat/chord-entry anchor, and must not leak across a
 * harmony boundary. */
function expectReturnPreArrivalsSafe(entries: ScheduledToken[], part: ChordPart) {
  const beatsPerBar = part.meter[0] * (4 / part.meter[1]);
  for (const entry of entries) {
    if (!entry.acgReturn || entry.acgReturn.role === 'arrival') continue;
    const active = getCurrentChordAtBeat(part, entry.startBeat);
    expect(active, `return ${entry.acgReturn.gestureId} has an onset chord`).not.toBeNull();
    if (!active) continue;
    expect(
      entry.startBeat + entry.token.duration,
      `return ${entry.acgReturn.gestureId} ${entry.acgReturn.role} stays inside chord ${active.index}`,
    ).toBeLessThanOrEqual(active.endBeat + 1e-6);
    const phase = ((entry.startBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const strongDistance = Math.min(
      Math.abs(phase),
      Math.abs(phase - beatsPerBar / 2),
      Math.abs(phase - beatsPerBar),
    );
    expect(strongDistance, `return ${entry.acgReturn.gestureId} ${entry.acgReturn.role} is off the structural grid`).toBeGreaterThan(0.08);
    expect(
      Math.abs(entry.startBeat - active.startBeat),
      `return ${entry.acgReturn.gestureId} ${entry.acgReturn.role} is not a chord entry`,
    ).toBeGreaterThan(0.08);
  }
}

describe('render/mgAcgReturnMainChain · one-pass ACG PIANOSONG return bricks', () => {
  it('binds every generated return to the actual RoadMap brick and HarmonicPlan stable/scale contract', () => {
    const entries = scheduled();
    const returns = entries.filter((entry) => entry.acgReturn);
    expect(returns.length).toBeGreaterThan(0);

    for (const entry of returns) {
      const intent = entry.acgReturn!;
      const targetChord = PART.blocks[intent.targetChordIndex];
      expect(intent.brickIndex).toBe(0);
      expect(intent.brickName).toBe('Perfect-Cadence');
      expect(intent.chordIndex).toBe(intent.targetChordIndex);
      expect(targetChord.stableTonePcs).toContain(intent.targetPc);
      expect(targetChord.chordScalePcs).toContain(intent.targetPc);
      expect(intent.stableRoles).toContain(intent.targetRole);
      if (intent.dyad) {
        expect(targetChord.stableTonePcs).toContain(intent.dyad.partnerPc);
        expect(targetChord.chordScalePcs).toContain(intent.dyad.partnerPc);
        expect(intent.stableRoles).toContain(intent.dyad.partnerRole);
      }
    }

    const dominantResolution = returns.find((entry) => entry.acgReturn?.function === 'D' && entry.acgReturn.role === 'arrival');
    expect(dominantResolution).toBeDefined();
    expect(dominantResolution!.startBeat).toBe(PART.blocks[1].startBeat);
    expect(dominantResolution!.acgReturn!.harmonicScope).toBe('next-chord');
    expect(PART.blocks[dominantResolution!.acgReturn!.targetChordIndex].functionHint).toBe('T');
    expect(PART.blocks[dominantResolution!.acgReturn!.targetChordIndex - 1].functionHint).toBe('D');

    const subdominantArrival = returns.find((entry) => entry.acgReturn?.function === 'S' && entry.acgReturn.role === 'arrival');
    expect(subdominantArrival).toBeDefined();
    expect(subdominantArrival!.acgReturn!.harmonicScope).toBe('current-chord');
    expect(subdominantArrival!.acgReturn!.targetRole).not.toBe('root');
  });

  it('realizes pickup/approach/arrival as a locked short phrase, never a random isolated filler note', () => {
    const entries = scheduled();
    const events = realizeTokens({ scheduledTokens: entries, chordPart: PART, registerCenter: 74 });
    const arrivals = events.filter((event) => event.acgReturnRole === 'arrival' && event.acgReturnVoice !== 'dyad');
    expect(arrivals.length).toBeGreaterThan(0);

    for (const arrival of arrivals) {
      const intentEntry = entries.find((entry) => entry.acgReturn?.gestureId === arrival.acgReturnGestureId && entry.acgReturn.role === 'arrival');
      expect(intentEntry).toBeDefined();
      expect(((arrival.noteNumber % 12) + 12) % 12).toBe(intentEntry!.acgReturn!.targetPc);
      expect(arrival.noteNumber).toBeGreaterThanOrEqual(69);
      expect(arrival.noteNumber).toBeLessThanOrEqual(86);
    }

    // A grammar-declared dyad is materialized alongside (not instead of) its
    // locked topline arrival. Both voices share the same return identity.
    for (const dyad of events.filter((event) => event.acgReturnVoice === 'dyad')) {
      const top = events.find((event) => event.acgReturnGestureId === dyad.acgReturnGestureId
        && event.acgReturnRole === 'arrival'
        && event.acgReturnVoice !== 'dyad');
      expect(top).toBeDefined();
      expect(dyad.time).toBe(top!.time);
      expect(dyad.duration).toBe(top!.duration);
      expect(dyad.noteNumber).toBeLessThan(top!.noteNumber);
    }

    const approaches = events.filter((event) => event.acgReturnRole === 'approach');
    for (const approach of approaches) {
      const arrival = events.find((event) => event.acgReturnGestureId === approach.acgReturnGestureId && event.acgReturnRole === 'arrival');
      const intentEntry = entries.find((entry) => entry.acgReturn?.gestureId === approach.acgReturnGestureId && entry.acgReturn.role === 'approach');
      expect(arrival).toBeDefined();
      expect(intentEntry).toBeDefined();
      expect(Math.abs(arrival!.noteNumber - approach.noteNumber)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(arrival!.noteNumber - approach.noteNumber)).toBeLessThanOrEqual(intentEntry!.acgReturn!.approachSemitones ?? 2);
    }
  });

  it('does not turn a non-boundary dominant rest into a falsely current-chord D return', () => {
    const entries = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: ROADMAP_BRICK,
      // The first audible slot remains inside the dominant (not at D→T).
      // `next-chord` is a hard contract, so it must not be reinterpreted as
      // a D-chord arrival merely to keep a lift-riff alive.
      tokens: [
        { kind: 'R', duration: 1 }, { kind: 'C', duration: 1 }, { kind: 'C', duration: 1 },
        { kind: 'C', duration: 1 }, { kind: 'R', duration: 3.086 },
      ],
    }], PART);
    expect(entries.some((entry) => entry.acgReturn?.function === 'D')).toBe(false);
    expectReturnPreArrivalsSafe(entries, PART);
  });

  it('never reintroduces a cross-chord passing note when a return is inserted after boundary clipping', () => {
    const entries = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: ROADMAP_BRICK,
      // The old D lift-riff began its L pickup at 3.96875 and crossed the
      // 4-beat chord boundary after `clipAcgTokensToChordBoundaries` had run.
      tokens: [
        { kind: 'C', duration: 2.1458333333333335 }, { kind: 'R', duration: 1 },
        { kind: 'C', duration: 0.5 }, { kind: 'C', duration: 0.5 },
        { kind: 'C', duration: 0.5 }, { kind: 'R', duration: 5.6875 },
      ],
    }], PART);
    expect(entries.some((entry) => entry.acgReturn?.role === 'arrival')).toBe(true);
    expectReturnPreArrivalsSafe(entries, PART);
  });

  it('does not manufacture a return where grammar has no preceding R token', () => {
    const noRest = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: ROADMAP_BRICK,
      tokens: [{ kind: 'C', duration: 1 }, { kind: 'S', duration: 1 }, { kind: 'G', duration: 1 }],
    }], PART);
    expect(noRest.some((entry) => entry.acgReturn)).toBe(false);
  });

  it('turns a stretched authored rest into RoadMap-bound return releases before it becomes dead air', () => {
    const entries = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: ROADMAP_BRICK,
      // Stretching this source into a 16-beat cycle would otherwise leave a
      // multi-bar silence between the first and last C.
      tokens: [{ kind: 'C', duration: 1 }, { kind: 'R', duration: 8 }, { kind: 'C', duration: 1 }],
    }], PART);
    expect(entries.some((entry) => entry.acgReturn?.role === 'arrival')).toBe(true);

    const audible = entries
      .filter((entry) => !['R', 'SlopeEnter', 'SlopeExit'].includes(entry.token.kind))
      .sort((a, b) => a.startBeat - b.startBeat);
    let maxGap = 0;
    for (let index = 1; index < audible.length; index++) {
      const previousEnd = audible[index - 1].startBeat + audible[index - 1].token.duration;
      maxGap = Math.max(maxGap, audible[index].startBeat - previousEnd);
    }
    expect(maxGap).toBeLessThanOrEqual(6.25);
  });

  it('does not leave a cycle-stretched generic A as a long hanging chromatic note', () => {
    const entries = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: ROADMAP_BRICK,
      tokens: [{ kind: 'C', duration: 1 }, { kind: 'A', duration: 1 }, { kind: 'C', duration: 1 }],
    }], PART);
    // A spans much longer than a short approach after cycle spreading; it
    // must become a stable C carrier before pitch realization.
    expect(entries.some((entry) => entry.token.kind === 'A')).toBe(false);
  });

  it('keeps a slope-constrained ACG anchor in stable∩scale when no exact slope pitch is legal', () => {
    const constrained = buildChordPart([
      chord('D#', 51, 'add9', 'T', [3, 7, 10], [0, 2, 4, 5, 7, 9, 11]),
    ]);
    const entries: ScheduledToken[] = [
      { token: { kind: 'SlopeEnter', dirMin: 5, dirMax: 5, duration: 0 }, startBeat: 0 },
      {
        token: {
          kind: 'C',
          duration: 1,
          acg: { harmonicScope: 'current-chord', stableRoles: ['root', 'third', 'fifth', 'seventh'] },
        },
        startBeat: 0,
      },
    ];
    const events = realizeTokens({
      scheduledTokens: entries,
      chordPart: constrained,
      initialPrevMidi: 79,
      registerCenter: 74,
      localScaleContext: { style: 'ACG', key: 'C', mode: 'Ionian' },
    });
    // D# add9's declared stable∩scale set is only G(pc 7). The generic
    // IV empty-window fallback used to emit a random chromatic pitch here.
    expect(events).toHaveLength(1);
    expect(events[0].noteNumber % 12).toBe(7);
  });

  it('does not let a late instrument gesture extend ACG lead events across their planned harmony', () => {
    const bundle = buildSongBundle({
      seed: 27, styleHint: 'acg', mood: 'build', targetDuration: 90, key: pc(0), mode: 'major',
    });
    const source = renderMgMelody(
      bundle.harmonic,
      bundle.band,
      bundle.timebase,
      27,
      bundle.instrumentation.roleProgram.lead,
      bundle.arrangement.songGrooveContract,
      bundle.acgPianoScorePlan?.leadPresencePlan,
      bundle.acgPianoScorePlan,
    );
    const rendered = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      bundle.acgPianoScorePlan,
    );
    const sourceEvents = new Set(source.notes.map((note) =>
      `${note.pitch as number}@${note.startTick as number}:${note.durationTicks as number}`,
    ));
    const finalLead = rendered.ir.tracks.find((track) => track.role === 'lead')!;
    // The coordinator no longer gates generated ACG lead after NoteIR exists:
    // its arrangement presence plan is already part of the scheduler source.
    // Thus every retained event must be exactly one from that source plan.
    for (const note of finalLead.notes) {
      expect(sourceEvents.has(`${note.pitch as number}@${note.startTick as number}:${note.durationTicks as number}`)).toBe(true);
    }
    expect(rendered.audit.findings.some((finding) => finding.severity === 'error' && finding.location.trackRole === 'lead')).toBe(false);
  });
});
