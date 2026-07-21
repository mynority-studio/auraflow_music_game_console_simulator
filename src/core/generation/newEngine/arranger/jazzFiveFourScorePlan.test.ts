import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beats, pc } from '../foundation';
import type { ArrangementPlan } from './ArrangementPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import {
  buildJazzFiveFourScorePlan,
  validateJazzFiveFourScorePlan,
  type JazzFiveFourScorePlanData,
} from './jazzFiveFourScorePlan';

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

function fixtureInstrumentation(bassProgram = 32): InstrumentationPlan {
  const active = ['bass', 'comp', 'lead', 'drum'];
  return {
    activeRolesBySection: { 'head-a': active, 'head-b': active },
    registerByRole: {
      bass: { lowMidi: 34, highMidi: 52 },
      comp: { lowMidi: 52, highMidi: 76 },
    },
    strictRegisterByRole: {
      bass: { lowMidi: 34, highMidi: 52 },
      comp: { lowMidi: 52, highMidi: 76 },
    },
    roleProgram: { bass: bassProgram, comp: 0, pad: 48, lead: 65, drum: 0 },
    programByRoleSection: {
      bass: { 'head-a': bassProgram, 'head-b': bassProgram },
      comp: { 'head-a': 0, 'head-b': 0 },
      drum: { 'head-a': 0, 'head-b': 0 },
    },
    bankByRoleSection: {},
    roleBank: {},
  } as unknown as InstrumentationPlan;
}

function build(
  foundationMode: 'acoustic-bass+full-piano' | 'acoustic-bass' | 'keyboard-foundation' = 'acoustic-bass+full-piano',
) {
  const score = buildJazzFiveFourScorePlan({
    arrangement: fixtureArrangement(),
    harmonic: fixtureHarmony(),
    instrumentation: fixtureInstrumentation(foundationMode === 'keyboard-foundation' ? 0 : 32),
    options: {
      enabled: true,
      mode: 'canonical-reference',
      performanceMode: 'reference-zero',
      foundationMode,
    },
  });
  if (!score) throw new Error('fixture score unexpectedly disabled');
  return score;
}

describe('arranger/jazzFiveFourScorePlan · post-harmony score seam', () => {
  it('consumes product Role/Drum KBs without importing the read-only MIDI oracle', () => {
    const source = readFileSync(new URL('./jazzFiveFourScorePlan.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../knowledge/jazzFiveFourRoleKnowledge'");
    expect(source).toContain("from '../knowledge/jazzFiveFourDrumKnowledge'");
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toContain('JAZZ_FIVE_FOUR_MIDI_ORACLE');
  });

  it('requires explicit caller opt-in instead of treating every 5/4 song as this archetype', () => {
    expect(buildJazzFiveFourScorePlan({
      arrangement: fixtureArrangement(),
      harmonic: fixtureHarmony(),
      instrumentation: fixtureInstrumentation(),
      options: { enabled: false, mode: 'canonical-reference', performanceMode: 'reference-zero' },
    })).toBeUndefined();
  });

  it('compiles canonical Bass/Comp/Drum on one song-global 5/4 clock', () => {
    const score = build();
    expect(score.clock).toMatchObject({
      ppq: 480,
      meter: { numerator: 5, denominator: 4 },
      grouping: [3, 2],
      ticksPerBar: 2_400,
      groupBoundaryTick: 1_440,
      barOriginPolicy: 'song-global',
      totalBars: 2,
    });

    const eventsInBar = (role: 'bass' | 'comp' | 'drum', absoluteBar: number) =>
      score.instrumentEvents.filter((event) => event.role === role && event.absoluteBar === absoluteBar);
    expect(eventsInBar('bass', 0).map((event) => event.phaseTick)).toEqual([0, 1_440, 1_920]);
    expect([...new Set(eventsInBar('comp', 0).map((event) => event.phaseTick))].sort((a, b) => a - b))
      .toEqual([0, 305, 785, 960, 1_440, 1_920]);
    expect(eventsInBar('drum', 0)).toHaveLength(12);
    expect(new Set(eventsInBar('drum', 0).map((event) => event.phaseTick)).size).toBe(10);
    expect(eventsInBar('bass', 1).map((event) => event.nominalTick)).toEqual([2_400, 3_840, 4_320]);
    expect(eventsInBar('comp', 1).map((event) => event.nominalTick % 2_400))
      .toEqual(eventsInBar('comp', 0).map((event) => event.nominalTick % 2_400));

    expect(score.semanticEvents).toHaveLength(54);
    expect(score.instrumentEvents).toHaveLength(54);
    expect(score.performance.events).toHaveLength(54);
    expect(Object.keys(score.provenanceByEventId)).toHaveLength(54);
    expect(new Set(score.semanticEvents.map((event) => event.eventId)).size).toBe(54);
    expect(score.roleBars).toHaveLength(4);
    expect(score.drumBars).toHaveLength(2);
    expect(score.drumBars.every((bar) => bar.hitCount === 12 && bar.distinctOnsetCount === 10)).toBe(true);
    expect(Object.isFrozen(score)).toBe(true);
    expect(validateJazzFiveFourScorePlan(score)).toEqual([]);
  });

  it('records exact cross-role locks and an authored 785→800 keyboard/snare flam', () => {
    const acoustic = build();
    const firstBarExact = acoustic.timingLinks.filter((link) => link.kind === 'exact' && link.anchorNominalTick < 2_400);
    expect(firstBarExact.map((link) => link.anchorNominalTick)).toEqual([0, 960, 1_440, 1_920]);
    expect(firstBarExact.every((link) =>
      link.members.every((member) => member.offsetTicks === 0)
      && link.residualPolicy.mode === 'reference-zero'
      && link.residualPolicy.maxAbsTicks === 0)).toBe(true);
    expect(acoustic.instrumentEvents.filter((event) => event.role === 'bass' && event.absoluteBar === 0)
      .map((event) => event.pitch)).toEqual([40, 47, 35]);
    expect(acoustic.instrumentEvents.filter((event) =>
      event.role === 'comp'
      && event.absoluteBar === 0
      && scoreFamily(acoustic, event.eventId).includes('piano-foundation'))
      .map((event) => event.pitch)).toEqual([40, 40, 47]);

    const keyboard = build('keyboard-foundation');
    expect(keyboard.instrumentEvents.filter((event) => event.role === 'bass' && event.absoluteBar === 0)
      .map((event) => event.phaseTick)).toEqual([0, 785, 1_440]);
    const flam = keyboard.timingLinks.find((link) => link.kind === 'flam' && link.anchorNominalTick === 785);
    expect(flam).toBeDefined();
    expect(flam?.members.map((member) => member.offsetTicks)).toEqual([0, 15]);
    expect(flam?.residualPolicy).toMatchObject({
      mode: 'reference-zero', maxAbsTicks: 0, applyOnce: true, preserveMemberOffsets: true,
    });
    expect(validateJazzFiveFourScorePlan(keyboard)).toEqual([]);
  });

  it('keeps event provenance outside NoteIR and makes reference-zero a validated identity projection', () => {
    const score = build();
    for (const event of score.instrumentEvents) {
      const trace = score.provenanceByEventId[event.eventId];
      expect(trace?.eventId).toBe(event.eventId);
      expect(trace?.sourceSha256).toBe('2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1');
      const performed = score.performance.events.find((candidate) => candidate.eventId === event.eventId);
      expect(performed).toMatchObject({
        tick: event.nominalTick,
        durationTicks: event.durationTicks,
        velocity: event.velocity,
        pitch: event.pitch,
        program: event.program,
      });
    }

    const broken = JSON.parse(JSON.stringify(score)) as JazzFiveFourScorePlanData;
    broken.performance.events[0]!.tick += 1;
    broken.provenanceByEventId[broken.instrumentEvents[1]!.eventId]!.eventId = 'wrong-id';
    const issues = validateJazzFiveFourScorePlan(broken);
    expect(issues.some((entry) => entry.code === 'reference-zero')).toBe(true);
    expect(issues.some((entry) => entry.code === 'provenance')).toBe(true);
  });
});

function scoreFamily(
  score: ReturnType<typeof build>,
  eventId: string,
): string {
  return score.provenanceByEventId[eventId]?.familyId ?? '';
}
