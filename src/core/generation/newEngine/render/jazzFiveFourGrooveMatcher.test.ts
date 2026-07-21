import { describe, expect, it } from 'vitest';
import { beats, createTimebase, pc, ticks } from '../foundation';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  buildJazzFiveFourScorePlan,
  type JazzFiveFourScorePlan,
  type JazzFiveFourScorePlanData,
} from '../arranger/jazzFiveFourScorePlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import { freezeMusicalIR, type TrackIR } from '../ir/MusicalIR';
import { projectJazzFiveFourScoreTracks } from './jazzFiveFourScoreProjector';
import {
  assertJazzFiveFourGrooveMatch,
  JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM,
  matchJazzFiveFourGroove,
} from './jazzFiveFourGrooveMatcher';

function fixtureArrangement(): ArrangementPlan {
  return {
    meter: { numerator: 5, denominator: 4 },
    sections: [
      { id: 'head-a', role: 'verse', functionTag: 'head', bars: 1, hookPolicy: 'main' },
      { id: 'head-b', role: 'chorus', functionTag: 'headOut', bars: 1, hookPolicy: 'main' },
    ],
  } as unknown as ArrangementPlan;
}

function fixtureHarmony(): HarmonicPlan {
  const spans = [
    { id: 'em-a', sectionId: 'head-a', startBeat: 0, durationBeats: 3, rootPc: 4 },
    { id: 'bm-a', sectionId: 'head-a', startBeat: 3, durationBeats: 2, rootPc: 11 },
    { id: 'em-b', sectionId: 'head-b', startBeat: 5, durationBeats: 3, rootPc: 4 },
    { id: 'bm-b', sectionId: 'head-b', startBeat: 8, durationBeats: 2, rootPc: 11 },
  ];
  return {
    chordTimeline: spans.map((span) => ({
      ...span,
      startBeat: beats(span.startBeat),
      durationBeats: beats(span.durationBeats),
      rootPc: pc(span.rootPc),
      roman: { degree: span.rootPc === 4 ? 1 : 5, accidental: 'natural', quality: 'm7' },
      quality: 'm7',
    })),
    stableToneMap: {
      'em-a': [4, 7, 11, 2].map(pc),
      'bm-a': [11, 2, 6, 9].map(pc),
      'em-b': [4, 7, 11, 2].map(pc),
      'bm-b': [11, 2, 6, 9].map(pc),
    },
  } as unknown as HarmonicPlan;
}

function fixtureInstrumentation(
  sectionIds: readonly string[] = ['head-a', 'head-b'],
): InstrumentationPlan {
  const active = ['bass', 'comp', 'lead', 'drum'];
  const activeRolesBySection = Object.fromEntries(sectionIds.map((sectionId) => [sectionId, active]));
  const roleSectionPrograms = (program: number) =>
    Object.fromEntries(sectionIds.map((sectionId) => [sectionId, program]));
  return {
    activeRolesBySection,
    registerByRole: {
      bass: { lowMidi: 34, highMidi: 52 },
      comp: { lowMidi: 52, highMidi: 76 },
    },
    strictRegisterByRole: {
      bass: { lowMidi: 34, highMidi: 52 },
      comp: { lowMidi: 52, highMidi: 76 },
    },
    roleProgram: { bass: 32, comp: 0, pad: 48, lead: 65, drum: 0 },
    programByRoleSection: {
      bass: roleSectionPrograms(32),
      comp: roleSectionPrograms(0),
      drum: roleSectionPrograms(0),
    },
    bankByRoleSection: {},
    roleBank: {},
  } as unknown as InstrumentationPlan;
}

function score(): JazzFiveFourScorePlan {
  const result = buildJazzFiveFourScorePlan({
    arrangement: fixtureArrangement(),
    harmonic: fixtureHarmony(),
    instrumentation: fixtureInstrumentation(),
    options: {
      enabled: true,
      mode: 'canonical-reference',
      performanceMode: 'reference-zero',
      foundationMode: 'acoustic-bass+full-piano',
    },
  });
  if (!result) throw new Error('Jazz 5/4 score fixture unexpectedly disabled');
  return result;
}

function score184Bars(): JazzFiveFourScorePlan {
  const sectionId = 'long-head';
  const arrangement = {
    meter: { numerator: 5, denominator: 4 },
    sections: [
      { id: sectionId, role: 'verse', functionTag: 'head', bars: 184, hookPolicy: 'main' },
    ],
  } as unknown as ArrangementPlan;
  const harmonic = {
    chordTimeline: [{
      id: 'em-long',
      sectionId,
      startBeat: beats(0),
      durationBeats: beats(184 * 5),
      rootPc: pc(4),
      roman: { degree: 1, accidental: 'natural', quality: 'm7' },
      quality: 'm7',
    }],
    stableToneMap: { 'em-long': [4, 7, 11, 2].map(pc) },
  } as unknown as HarmonicPlan;
  const result = buildJazzFiveFourScorePlan({
    arrangement,
    harmonic,
    instrumentation: fixtureInstrumentation([sectionId]),
    options: {
      enabled: true,
      mode: 'canonical-reference',
      performanceMode: 'reference-zero',
      foundationMode: 'acoustic-bass+full-piano',
    },
  });
  if (!result) throw new Error('184-bar Jazz 5/4 score fixture unexpectedly disabled');
  return result;
}

function projectedTracks(plan: JazzFiveFourScorePlan): TrackIR[] {
  return projectJazzFiveFourScoreTracks([
    { role: 'bass', notes: [], program: 32 },
    { role: 'comp', notes: [], program: 0 },
    { role: 'lead', notes: [] },
    { role: 'drum', notes: [] },
  ], plan);
}

function cloneTracks(tracks: readonly TrackIR[]): TrackIR[] {
  return tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({ ...note })),
    programChanges: track.programChanges?.map((event) => ({ ...event })),
    pedalEvents: track.pedalEvents?.map((event) => ({ ...event })),
    mixChanges: track.mixChanges?.map((event) => ({ ...event, mix: { ...event.mix } })),
    ccEvents: track.ccEvents?.map((event) => ({ ...event })),
    pitchBendEvents: track.pitchBendEvents?.map((event) => ({ ...event })),
  }));
}

function track(tracks: TrackIR[], role: 'bass' | 'comp' | 'drum'): TrackIR {
  const result = tracks.find((candidate) => candidate.role === role);
  if (!result) throw new Error(`Missing ${role} track`);
  return result;
}

describe('Jazz 5/4 Gate-G groove matcher', () => {
  it('passes an exact canonical score projected to MusicalIR and reports every role/bar signature', () => {
    const plan = score();
    const tracks = projectedTracks(plan);
    const ir = freezeMusicalIR({
      tracks,
      timebase: createTimebase({
        meter: { numerator: 5, denominator: 4 },
        tempoMap: [{ atBeat: beats(0), bpm: JAZZ_FIVE_FOUR_REFERENCE_TEMPO_BPM }],
      }),
      durationTicks: ticks(4_800),
    });

    const report = assertJazzFiveFourGrooveMatch(plan, ir);

    expect(report.pass).toBe(true);
    expect(report.clockViolations).toEqual([]);
    expect(report.scoreDelta).toMatchObject({
      expectedCount: 54,
      actualCount: 54,
      isIdentity: true,
    });
    expect(report.roleBarSignatures).toHaveLength(6);
    expect(report.roleBarSignatures.find((bar) => bar.role === 'bass' && bar.absoluteBar === 0))
      .toMatchObject({ actualPhaseSignature: [0, 1_440, 1_920], matches: true });
    expect(report.roleBarSignatures.find((bar) => bar.role === 'comp' && bar.absoluteBar === 0))
      .toMatchObject({ actualPhaseSignature: [0, 305, 785, 960, 1_440, 1_920], matches: true });
    expect(report.roleBarSignatures.find((bar) => bar.role === 'drum' && bar.absoluteBar === 0))
      .toMatchObject({
        actualPhaseSignature: [0, 480, 800, 960, 1_280, 1_440, 1_760, 1_920, 2_080, 2_240],
        matches: true,
      });
    expect(report.timingLinkViolations).toEqual([]);
    expect(report.barDriftViolations).toEqual([]);
    expect(report.drumTriggerViolations).toEqual([]);
    expect(report.referenceViolations).toEqual([]);
  });

  it('fails a non-reference tempo even when every note is bit-identical', () => {
    const plan = score();
    const ir = freezeMusicalIR({
      tracks: projectedTracks(plan),
      timebase: createTimebase({
        meter: { numerator: 5, denominator: 4 },
        tempoMap: [{ atBeat: beats(0), bpm: 167 }],
      }),
      durationTicks: ticks(4_800),
    });

    const report = matchJazzFiveFourGroove(plan, ir);

    expect(report.scoreDelta.isIdentity).toBe(true);
    expect(report.pass).toBe(false);
    expect(report.clockViolations).toEqual([
      expect.stringContaining('FinalIR reference tempo 167 != canonical'),
    ]);
    expect(report.issues.some((issue) => issue.code === 'clock')).toBe(true);
  });

  it('keeps one song-global origin through 184 product bars without cumulative drift', () => {
    const plan = score184Bars();
    const report = assertJazzFiveFourGrooveMatch(plan, projectedTracks(plan));
    const lastBar = 183;
    const lastBarStart = lastBar * 2_400;

    expect(plan.clock.totalBars).toBe(184);
    expect(plan.roleBars.filter((bar) => bar.absoluteBar === lastBar)
      .every((bar) => bar.barStartTick === lastBarStart)).toBe(true);
    expect(plan.drumBars.find((bar) => bar.absoluteBar === lastBar)).toMatchObject({
      barStartTick: lastBarStart,
      active: true,
      hitCount: 12,
    });
    expect(report.barDriftViolations).toEqual([]);
    for (const role of ['bass', 'comp', 'drum'] as const) {
      const first = report.roleBarSignatures.find((bar) => bar.role === role && bar.absoluteBar === 0)!;
      const last = report.roleBarSignatures.find((bar) => bar.role === role && bar.absoluteBar === lastBar)!;
      expect(last.actualPhaseSignature).toEqual(first.actualPhaseSignature);
      expect(last.actualEventSignature).toEqual(first.actualEventSignature);
      expect(last.matches).toBe(true);
    }
  });

  it('fails a one-tick movement and identifies the exact-link and bar phase drift', () => {
    const plan = score();
    const tracks = cloneTracks(projectedTracks(plan));
    const moved = track(tracks, 'bass').notes.find((note) => Number(note.startTick) === 0)!;
    moved.startTick = ticks(1);

    const report = matchJazzFiveFourGroove(plan, tracks);

    expect(report.pass).toBe(false);
    expect(report.scoreDelta.changedEvents.some((event) =>
      event.role === 'bass' && event.changedFields.includes('tick'))).toBe(true);
    expect(report.barDriftViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'bass', expectedAbsoluteBar: 0, tickDeltas: [1] }),
    ]));
    expect(report.timingLinkViolations.some((link) =>
      link.kind === 'exact'
      && link.reasons.includes('relative-offset-changed')
      && link.reasons.includes('residual-budget-exceeded'))).toBe(true);
    expect(() => assertJazzFiveFourGrooveMatch(plan, tracks)).toThrow(/Gate G failed/);
  });

  it('fails a velocity rewrite even when onset, duration and pitch are unchanged', () => {
    const plan = score();
    const tracks = cloneTracks(projectedTracks(plan));
    const rewritten = track(tracks, 'comp').notes.find((note) => Number(note.startTick) === 305)!;
    rewritten.velocity += 1;

    const report = matchJazzFiveFourGroove(plan, tracks);

    expect(report.pass).toBe(false);
    expect(report.scoreDelta.changedEvents.some((event) =>
      event.role === 'comp'
      && event.changedFields.length === 1
      && event.changedFields[0] === 'velocity')).toBe(true);
    expect(report.referenceViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'final-ir', role: 'comp', absoluteBar: 0 }),
    ]));
  });

  it('rejects a mutually-wrong Score/FinalIR pair instead of accepting identity as reference truth', () => {
    const wrong = JSON.parse(JSON.stringify(score())) as JazzFiveFourScorePlanData;
    const performed = wrong.performance.events.find((event) =>
      event.role === 'comp' && event.tick === 305)!;
    const instrument = wrong.instrumentEvents.find((event) => event.eventId === performed.eventId)!;
    const semantic = wrong.semanticEvents.find((event) => event.eventId === performed.eventId)!;
    performed.velocity += 1;
    instrument.velocity += 1;
    semantic.velocity += 1;
    const mutuallyWrongPlan = wrong as unknown as JazzFiveFourScorePlan;
    const tracks = projectedTracks(mutuallyWrongPlan);

    const report = matchJazzFiveFourGroove(mutuallyWrongPlan, tracks);

    expect(report.scoreDelta.isIdentity).toBe(true);
    expect(report.pass).toBe(false);
    expect(report.referenceViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'score', role: 'comp', absoluteBar: 0 }),
      expect.objectContaining({ layer: 'final-ir', role: 'comp', absoluteBar: 0 }),
    ]));
  });

  it('fails when a ride trigger is stretched beyond the canonical 10 ticks', () => {
    const plan = score();
    const tracks = cloneTracks(projectedTracks(plan));
    const ride = track(tracks, 'drum').notes.find((note) =>
      Number(note.startTick) === 0 && Number(note.pitch) === 51)!;
    ride.durationTicks = ticks(288);

    const report = matchJazzFiveFourGroove(plan, tracks);

    expect(report.pass).toBe(false);
    expect(report.drumTriggerViolations).toEqual([
      expect.objectContaining({ tick: 0, pitch: 51, expectedDurationTicks: 10, actualDurationTicks: 288 }),
    ]);
    expect(report.issues.some((issue) => issue.code === 'drum-trigger-duration')).toBe(true);
  });

  it('fails a section-local phase reset even though every local modulo phase is unchanged', () => {
    const plan = score();
    const tracks = cloneTracks(projectedTracks(plan));
    for (const ownedRole of ['bass', 'comp', 'drum'] as const) {
      for (const note of track(tracks, ownedRole).notes) {
        if (Number(note.startTick) >= 2_400) {
          note.startTick = ticks(Number(note.startTick) - 2_400);
        }
      }
    }

    const report = matchJazzFiveFourGroove(plan, tracks);

    expect(report.pass).toBe(false);
    expect(report.scoreDelta.expectedCount).toBe(report.scoreDelta.actualCount);
    expect(report.barDriftViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionId: 'head-b',
        expectedAbsoluteBar: 1,
        observedAbsoluteBars: [0],
        tickDeltas: [-2_400],
        phaseDeltas: [0],
      }),
    ]));
    expect(report.roleBarSignatures.find((bar) => bar.role === 'drum' && bar.absoluteBar === 1))
      .toMatchObject({ actualPhaseSignature: [], matches: false });
    expect(report.referenceViolations.some((violation) =>
      violation.layer === 'final-ir' && violation.absoluteBar === 1)).toBe(true);
  });

  it('reports an authored 785→800 flam violation independently from exact links', () => {
    const plan = score();
    const tracks = cloneTracks(projectedTracks(plan));
    const snare = track(tracks, 'drum').notes.find((note) =>
      Number(note.startTick) === 800 && Number(note.pitch) === 40)!;
    snare.startTick = ticks(801);

    const report = matchJazzFiveFourGroove(plan, tracks);

    expect(report.timingLinkViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'flam',
        reasons: expect.arrayContaining(['relative-offset-changed', 'residual-budget-exceeded']),
      }),
    ]));
    expect(report.issues.some((issue) => issue.code === 'timing-link-flam')).toBe(true);
  });
});
