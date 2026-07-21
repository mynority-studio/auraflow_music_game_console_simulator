import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS,
  JAZZ_FIVE_FOUR_ENGINE_PPQ,
  JAZZ_FIVE_FOUR_MIDI_ORACLE,
  JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS,
  JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK,
  JAZZ_FIVE_FOUR_SOURCE_PPQ,
  projectRationalTick,
  rationalTickToNumber,
  sourceAbsoluteTickToEngineRational,
  sourceTickDeltaToEngineRational,
  type JazzFiveFourCanonicalEvent,
} from './jazzFiveFourEvidence';

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function enginePhases(events: readonly JazzFiveFourCanonicalEvent[]): number[] {
  return uniqueSorted(events.map((event) => event.engineExpected.projectedPhaseTick));
}

function groupByProjectedPhase(events: readonly JazzFiveFourCanonicalEvent[]): Map<number, JazzFiveFourCanonicalEvent[]> {
  const groups = new Map<number, JazzFiveFourCanonicalEvent[]>();
  for (const event of events) {
    const phase = event.engineExpected.projectedPhaseTick;
    groups.set(phase, [...(groups.get(phase) ?? []), event]);
  }
  return groups;
}

describe('knowledge/jazzFiveFourEvidence MIDI oracle', () => {
  it('locks source identity, tempo, PPQ, channel/program mapping and paired-note counts', () => {
    const source = JAZZ_FIVE_FOUR_MIDI_ORACLE.source;
    expect(source).toMatchObject({
      fileName: 'Take-Five-1.mid',
      sha256: '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1',
      byteLength: 43_209,
      smfFormat: 0,
      trackCount: 1,
      ppq: 192,
      inferredMeter: { numerator: 5, denominator: 4 },
      inferredGrouping: [3, 2],
      barTicks: 960,
      groupBoundaryTick: 576,
      pairedNoteCount: 4_966,
    });
    expect(source.tempo.microsecondsPerQuarter).toBe(359_281);
    expect(source.tempo.bpm).toBeCloseTo(167.000203, 6);
    expect(source.roleNoteCounts).toEqual({
      piano: 2_091,
      acousticBass: 525,
      lead: 466,
      drum: 1_884,
    });
    expect(Object.values(source.roleNoteCounts).reduce((sum, count) => sum + count, 0))
      .toBe(source.pairedNoteCount);
    expect(source.channelPrograms.map(({ role, channelZeroBased, programZeroBased }) => ({
      role, channelZeroBased, programZeroBased,
    }))).toEqual([
      { role: 'acousticBass', channelZeroBased: 1, programZeroBased: 32 },
      { role: 'piano', channelZeroBased: 2, programZeroBased: 0 },
      { role: 'lead', channelZeroBased: 3, programZeroBased: 65 },
      { role: 'drum', channelZeroBased: 9, programZeroBased: 0 },
    ]);
  });

  it('has one immutable song-global origin and no attachment-path/runtime dependency', () => {
    const oracle = JAZZ_FIVE_FOUR_MIDI_ORACLE;
    expect(oracle.source.globalOrigin).toEqual({
      sourceAbsoluteTick: 960,
      preOriginTicks: 960,
      preOriginBars: 1,
      count: 1,
      policy: 'song-global-only',
      roleLocalResetAllowed: false,
      sectionLocalResetAllowed: false,
    });
    expect(oracle.authority).toEqual({
      kind: 'read-only-midi-evidence',
      runtimeFilesystemDependency: 'none',
      productSelectionAuthority: 'none',
    });
    expect(JSON.stringify(oracle)).not.toMatch(/(?:\/Users\/|\.codex|attachments)/);
    expect(Object.isFrozen(oracle)).toBe(true);
    expect(Object.isFrozen(oracle.source.globalOrigin)).toBe(true);
    expect(Object.isFrozen(oracle.canonicalSimultaneousBar.piano.upperComp)).toBe(true);
    expect(() => {
      (oracle.source.globalOrigin as unknown as { sourceAbsoluteTick: number }).sourceAbsoluteTick = 0;
    }).toThrow(TypeError);
  });

  it('freezes the canonical simultaneous Piano foundation/upper and Acoustic Bass bar', () => {
    const bar = JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar;
    const foundation = bar.piano.foundation;
    const upper = bar.piano.upperComp;
    const bass = bar.acousticBass;

    expect(bar).toMatchObject({
      contentBarIndex: 8,
      sourceAbsoluteStartTick: 8_640,
      engineExpectedStartTick: 19_200,
      patternFamily: 'A-base',
    });
    expect(enginePhases(foundation)).toEqual([0, 785, 1_440]);
    expect(foundation.map((event) => ({
      pitch: event.pitch,
      duration: event.engineExpected.projectedDurationTicks,
      velocity: event.velocity,
    }))).toEqual([
      { pitch: 39, duration: 215, velocity: 76 },
      { pitch: 39, duration: 150, velocity: 94 },
      { pitch: 46, duration: 695, velocity: 90 },
    ]);

    expect(enginePhases(upper)).toEqual([305, 960, 1_920]);
    const upperByPhase = groupByProjectedPhase(upper);
    expect([...upperByPhase.entries()].map(([phase, events]) => ({
      phase,
      pitches: events.map((event) => event.pitch),
      durations: events.map((event) => event.engineExpected.projectedDurationTicks),
      velocities: events.map((event) => event.velocity),
    }))).toEqual([
      { phase: 305, pitches: [54, 58, 63], durations: [75, 40, 80], velocities: [90, 68, 86] },
      { phase: 960, pitches: [54, 58, 63], durations: [115, 55, 65], velocities: [90, 86, 68] },
      { phase: 1_920, pitches: [53, 56, 61], durations: [160, 160, 165], velocities: [72, 94, 90] },
    ]);

    expect(enginePhases(bass)).toEqual([0, 1_440, 1_920]);
    expect(bass.map((event) => ({
      pitch: event.pitch,
      duration: event.engineExpected.projectedDurationTicks,
      velocity: event.velocity,
    }))).toEqual([
      { pitch: 39, duration: 1_170, velocity: 84 },
      { pitch: 46, duration: 365, velocity: 65 },
      { pitch: 34, duration: 285, velocity: 65 },
    ]);
    expect(bass.map((event, index) => {
      const nextPhase = index + 1 < bass.length
        ? bass[index + 1].engineExpected.projectedPhaseTick
        : JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS;
      return nextPhase
        - event.engineExpected.projectedPhaseTick
        - event.engineExpected.projectedDurationTicks;
    })).toEqual([270, 115, 195]);
  });

  it('freezes the 12-hit/10-onset canonical Drum cell and all-hit duration fact', () => {
    const drum = JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.drum;
    expect(drum).toHaveLength(12);
    expect(enginePhases(drum)).toEqual([0, 480, 800, 960, 1_280, 1_440, 1_760, 1_920, 2_080, 2_240]);
    expect(drum.filter((event) => event.lane === 'kick').map((event) => [
      event.engineExpected.projectedPhaseTick, event.velocity,
    ])).toEqual([[0, 94]]);
    expect(drum.filter((event) => event.lane === 'ride').map((event) => [
      event.engineExpected.projectedPhaseTick, event.velocity,
    ])).toEqual([[0, 92], [480, 92], [960, 92], [1_280, 77], [1_440, 88], [1_760, 69], [1_920, 105]]);
    expect(drum.filter((event) => event.lane === 'snare').map((event) => [
      event.engineExpected.projectedPhaseTick, event.velocity,
    ])).toEqual([[800, 67], [1_440, 67], [2_080, 33], [2_240, 63]]);
    expect(drum.every((event) => event.source.durationTicks === 4)).toBe(true);
    expect(drum.every((event) => event.engineExpected.projectedDurationTicks === 10)).toBe(true);
    expect(JAZZ_FIVE_FOUR_MIDI_ORACLE.source.drumCoverage).toEqual({
      firstNonEmptyBarIndex: 0,
      lastNonEmptyBarIndex: 182,
      nonEmptyBarCount: 183,
      sourceNoteDurationTicks: 4,
      engineNoteDurationTicks: 10,
      notesWithThatDuration: 1_884,
    });
  });

  it('maps PPQ192 to PPQ480 as exact rationals before nearest-tick projection', () => {
    expect(JAZZ_FIVE_FOUR_SOURCE_PPQ).toBe(192);
    expect(JAZZ_FIVE_FOUR_ENGINE_PPQ).toBe(480);
    expect(sourceTickDeltaToEngineRational(128)).toEqual({ numerator: 320, denominator: 1 });
    expect(sourceTickDeltaToEngineRational(122)).toEqual({ numerator: 305, denominator: 1 });
    expect(sourceTickDeltaToEngineRational(120)).toEqual({ numerator: 300, denominator: 1 });
    expect(sourceTickDeltaToEngineRational(48)).toEqual({ numerator: 120, denominator: 1 });
    expect(sourceTickDeltaToEngineRational(32)).toEqual({ numerator: 80, denominator: 1 });

    const oddSourceTick = sourceTickDeltaToEngineRational(1);
    expect(oddSourceTick).toEqual({ numerator: 5, denominator: 2 });
    expect(projectRationalTick(oddSourceTick)).toBe(3);
    expect(Math.abs(projectRationalTick(oddSourceTick) - rationalTickToNumber(oddSourceTick))).toBe(0.5);
    expect(JAZZ_FIVE_FOUR_MIDI_ORACLE.engineProjection.postSwing).toBe(false);
  });

  it('keeps phase and <=0.5-tick projection error across the entire 184-bar content span', () => {
    const phases = [0, 1, 32, 48, 120, 122, 128, 192, 314, 576, 768, 959];
    for (let barIndex = 0; barIndex < 184; barIndex += 1) {
      for (const sourcePhase of phases) {
        const sourceAbsoluteTick = JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK
          + barIndex * JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS
          + sourcePhase;
        const exactAbsolute = sourceAbsoluteTickToEngineRational(sourceAbsoluteTick);
        const projectedAbsolute = projectRationalTick(exactAbsolute);
        const exactNumber = rationalTickToNumber(exactAbsolute);
        const expectedFromGlobalBar = barIndex * JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS
          + projectRationalTick(sourceTickDeltaToEngineRational(sourcePhase));

        expect(projectedAbsolute).toBe(expectedFromGlobalBar);
        expect(Math.abs(projectedAbsolute - exactNumber)).toBeLessThanOrEqual(0.5);
        expect(projectedAbsolute % JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS)
          .toBe(projectRationalTick(sourceTickDeltaToEngineRational(sourcePhase)));
      }
    }

    const endBoundary = sourceAbsoluteTickToEngineRational(
      JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK + 184 * JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS,
    );
    expect(endBoundary).toEqual({ numerator: 441_600, denominator: 1 });
    expect(JAZZ_FIVE_FOUR_MIDI_ORACLE.source.contentCoverage).toEqual({
      firstBarIndex: 0,
      lastBarIndex: 183,
      barCount: 184,
      sourceEndExclusiveTick: 177_600,
    });
  });

  it('keeps arranger-authored handoff explicitly outside MIDI evidence', () => {
    expect(JAZZ_FIVE_FOUR_MIDI_ORACLE.arrangerAuthoredDecisions).toEqual([
      expect.objectContaining({
        id: 'bass-to-comp-handoff',
        authority: 'arranger-authored',
        observedInSourceMidi: false,
      }),
    ]);
    const allCanonicalEvents = [
      ...JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.piano.foundation,
      ...JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.piano.upperComp,
      ...JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.acousticBass,
      ...JAZZ_FIVE_FOUR_MIDI_ORACLE.canonicalSimultaneousBar.drum,
    ];
    expect(allCanonicalEvents.every((event) => event.evidenceAuthority === 'midi-observed')).toBe(true);
  });
});
