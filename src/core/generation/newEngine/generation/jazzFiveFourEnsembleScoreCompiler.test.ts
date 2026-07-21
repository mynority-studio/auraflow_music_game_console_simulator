import { describe, expect, it } from 'vitest';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { planJazzFiveFourEnsembleScore } from '../arranger/jazzFiveFourEnsembleScore';
import { assertValidJazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import { pc } from '../foundation';
import { buildSongBundle } from './GenerationController';
import {
  JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS,
  jazzFiveFourDrumPhrasePattern,
} from '../knowledge/jazzFiveFourDrumPhraseKnowledge';
import {
  compileJazzFiveFourEnsembleScore,
  compileJazzFiveFourRhythmSection,
} from './jazzFiveFourEnsembleScoreCompiler';

function referenceBundle() {
  return buildSongBundle({
    seed: 1662,
    styleHint: 'jazz',
    mood: 'ensemble score compiler',
    targetDuration: 57.5,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    bandConstraint: {
      allowedRoles: new Set(['bass', 'comp', 'lead', 'drum']),
      requiredRoles: new Set(['bass', 'comp', 'lead', 'drum']),
    },
  });
}

function withGenerativeEnsemble(seed: number, returnMode: 'full-ensemble-return' | 'continue-comp-foundation') {
  const bundle = referenceBundle();
  const jazzFiveFourEnsembleScore = planJazzFiveFourEnsembleScore({
    mode: 'generative',
    seed,
    codaDirective: { returnMode },
    meter: bundle.arrangement.meter,
    sections: bundle.arrangement.sections,
    phrases: bundle.arrangement.phrases,
  });
  const arrangement = {
    ...bundle.arrangement,
    jazzFiveFourEnsembleScore,
  } as ArrangementPlan;
  return { ...bundle, arrangement, jazzFiveFourEnsembleScore };
}

describe('JazzFiveFourEnsembleScoreCompiler', () => {
  it('compiles the canonical 33-bar Bass/Comp/Drum control on one song-global clock', () => {
    const bundle = referenceBundle();
    const rhythm = compileJazzFiveFourRhythmSection(bundle);
    const score = compileJazzFiveFourEnsembleScore(bundle);

    expect(Object.isFrozen(rhythm)).toBe(true);
    expect(score.compilationMode).toBe('canonical-reference');
    expect(score.foundationMode).toBe('acoustic-bass+full-piano');
    expect(score.clock).toMatchObject({ ppq: 480, ticksPerBar: 2_400, totalBars: 33 });
    expect(score.instrumentEvents.filter((event) => event.role === 'bass')).toHaveLength(99);
    expect(score.instrumentEvents.filter((event) => event.role === 'comp')).toHaveLength(396);
    expect(score.instrumentEvents.filter((event) => event.role === 'drum')).toHaveLength(396);
    expect(score.performance.events).toHaveLength(score.instrumentEvents.length);
    expect(() => assertValidJazzFiveFourScorePlan(score)).not.toThrow();

    const phases = (role: 'bass' | 'comp' | 'drum') => [...new Set(score.instrumentEvents
      .filter((event) => event.absoluteBar === 0 && event.role === role)
      .map((event) => event.phaseTick))].sort((left, right) => left - right);
    expect(phases('bass')).toEqual([0, 1_440, 1_920]);
    expect(phases('comp')).toEqual([0, 305, 785, 960, 1_440, 1_920]);
    expect(phases('drum')).toEqual([0, 480, 800, 960, 1_280, 1_440, 1_760, 1_920, 2_080, 2_240]);
    expect(score.instrumentEvents
      .filter((event) => event.absoluteBar === 0 && event.role === 'bass')
      .map((event) => event.pitch)).toEqual([40, 47, 35]);
    expect(score.instrumentEvents.filter((event) => event.role === 'bass')
      .every((event) => event.pitch >= 29 && event.pitch <= 48)).toBe(true);
    expect(score.instrumentEvents.filter((event) => event.role === 'comp')
      .every((event) => event.pitch >= 39 && event.pitch <= 66)).toBe(true);

    const resolvedById = new Map(score.instrumentEvents.map((event) => [event.eventId, event] as const));
    const upperByTick = new Map<number, { voiceIndex: number; pitch: number }[]>();
    for (const event of score.semanticEvents) {
      if (event.pitchIntent.kind !== 'rootless-chord-tone') continue;
      const list = upperByTick.get(event.nominalTick) ?? [];
      list.push({ voiceIndex: event.pitchIntent.voiceIndex, pitch: resolvedById.get(event.eventId)!.pitch });
      upperByTick.set(event.nominalTick, list);
    }
    for (const voices of upperByTick.values()) {
      if (voices.length !== 3) continue;
      const pitches = voices.sort((left, right) => left.voiceIndex - right.voiceIndex).map((voice) => voice.pitch);
      expect(pitches[0]).toBeLessThan(pitches[1]!);
      expect(pitches[1]).toBeLessThan(pitches[2]!);
    }

    for (const event of score.instrumentEvents) {
      expect(event.nominalTick).toBe(event.absoluteBar * 2_400 + event.phaseTick);
      const performed = score.performance.events.find((candidate) => candidate.eventId === event.eventId)!;
      expect(performed).toMatchObject({
        tick: event.nominalTick,
        durationTicks: event.durationTicks,
        velocity: event.velocity,
        pitch: event.pitch,
      });
      expect(score.provenanceByEventId[event.eventId]?.ensembleDirectiveId).toBeTruthy();
    }
  });

  it('obeys the Arranger Bass/Lead -> Comp/Lead handoff and fully expands selected textures', () => {
    const bundle = withGenerativeEnsemble(9_104, 'continue-comp-foundation');
    const score = compileJazzFiveFourEnsembleScore(bundle);

    expect(score.compilationMode).toBe('generative');
    expect(score.foundationMode).toBe('arranger-per-bar');
    for (const absoluteBar of Array.from({ length: 9 }, (_, index) => index)) {
      const bass = score.roleBars.find((bar) => bar.role === 'bass' && bar.absoluteBar === absoluteBar)!;
      const comp = score.roleBars.find((bar) => bar.role === 'comp' && bar.absoluteBar === absoluteBar)!;
      expect(bass.active).toBe(true);
      expect(bass.eventIds).toHaveLength(3);
      expect(comp).toMatchObject({ active: false, eventIds: [] });
      expect(bass.eventIds.map((id) => score.instrumentEvents.find((event) => event.eventId === id)!.phaseTick))
        .toEqual([0, 785, 1_440]);
    }
    for (const absoluteBar of Array.from({ length: 24 }, (_, index) => index + 9)) {
      const bass = score.roleBars.find((bar) => bar.role === 'bass' && bar.absoluteBar === absoluteBar)!;
      const comp = score.roleBars.find((bar) => bar.role === 'comp' && bar.absoluteBar === absoluteBar)!;
      expect(bass).toMatchObject({ active: false, eventIds: [] });
      expect(comp.active).toBe(true);
      expect(comp.eventIds.length).toBeGreaterThan(0);
    }
    const upper = score.semanticEvents.filter((event) =>
      event.role === 'comp' && event.pitchIntent.kind === 'rootless-chord-tone');
    expect(upper.length).toBeGreaterThan(0);
    for (const event of upper) {
      if (event.pitchIntent.kind !== 'rootless-chord-tone') throw new Error('test narrowing failed');
      const intent = event.pitchIntent;
      const span = bundle.harmonic.chordTimeline.find((candidate) => candidate.id === intent.chordSpanId)!;
      expect(intent.pitchClass).not.toBe(span.rootPc);
    }
    expect(() => assertValidJazzFiveFourScorePlan(score)).not.toThrow();
  });

  it('expands each Arranger-selected Drum phrase whole, with exact pattern-relative GM hits', () => {
    const bundle = withGenerativeEnsemble(54_054, 'full-ensemble-return');
    const rhythm = compileJazzFiveFourRhythmSection(bundle);
    const drumEvents = rhythm.instrumentEvents.filter((event) => event.role === 'drum');
    const expectedHitCount = bundle.jazzFiveFourEnsembleScore.drumPhraseDirectives.reduce(
      (sum, directive) => sum + jazzFiveFourDrumPhrasePattern(directive.patternId).hits.length,
      0,
    );
    expect(drumEvents).toHaveLength(expectedHitCount);

    for (const placement of bundle.jazzFiveFourEnsembleScore.drumPhraseDirectives) {
      const pattern = jazzFiveFourDrumPhrasePattern(placement.patternId);
      for (const hit of pattern.hits) {
        const absoluteBar = placement.startBar + hit.barOffset;
        const matches = drumEvents.filter((event) => {
          const provenance = rhythm.provenanceByEventId[event.eventId];
          return provenance?.drumPhraseDirectiveId === placement.id
            && provenance.cellId === hit.id
            && event.absoluteBar === absoluteBar
            && event.phaseTick === hit.phaseTick;
        });
        expect(matches, `${placement.id}:${hit.id}`).toHaveLength(1);
        expect(matches[0]!.pitch).toBe(
          JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS[hit.kitIntentId].preferredGmPitch,
        );
        expect(matches[0]!.durationTicks).toBe(10);
      }
    }
  });

  it('rejects missing Arranger ownership instead of falling back to meter/style inference', () => {
    const bundle = referenceBundle();
    const arrangement = { ...bundle.arrangement, jazzFiveFourEnsembleScore: undefined } as ArrangementPlan;
    expect(() => compileJazzFiveFourEnsembleScore({ ...bundle, arrangement }))
      .toThrow('requires an Arranger-frozen ensemble score');
  });
});
