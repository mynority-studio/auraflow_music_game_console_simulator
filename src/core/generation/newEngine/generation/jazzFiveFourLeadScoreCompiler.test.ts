import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import {
  JAZZ_4_4_ARCHETYPE_ID,
  JAZZ_5_4_ARCHETYPE_ID,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
} from '../arranger/jazzArchetypePlanner';
import { bindJazzFiveFourLeadSlots } from '../arranger/jazzFiveFourLeadRhythm';
import { buildJazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import {
  JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID,
  materializeJazzFiveFourLeadRhythm,
} from '../knowledge/jazzFiveFourLeadRhythmKnowledge';
import { jazzFiveFourLeadGrammar } from '../knowledge/jazzFiveFourLeadGrammar';
import { expandGrammarForBrick } from '../render/mgGrammarRuntime';
import { makeSeededRng } from '../render/mgRng';
import { buildSongBundle } from './GenerationController';
import { compileJazzFiveFourLeadScore } from './jazzFiveFourLeadScoreCompiler';

const ROLES = new Set(['bass', 'comp', 'lead', 'drum'] as const);

function bundle(seed: number, targetDuration = 57.5) {
  return buildSongBundle({
    seed,
    styleHint: 'jazz',
    mood: 'Jazz 5/4 Lead score compiler',
    targetDuration,
    key: pc(4),
    mode: 'minor',
    jazzArchetypeId: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
    bandConstraint: { allowedRoles: ROLES, requiredRoles: ROLES },
  });
}

describe('Jazz 5/4 Lead main-chain score compiler', () => {
  it('freezes one complete 33-bar Arranger score without slicing phrase templates', () => {
    for (const targetDuration of [15, 57.5, 120]) {
      const arrangement = bundle(1662, targetDuration).arrangement;
      expect(arrangement.sections.map((section) => [section.id, section.bars])).toEqual([
        ['pickup', 1],
        ['headA', 8],
        ['headB', 8],
        ['headOut', 8],
        ['coda', 8],
      ]);
      expect(arrangement.sections.reduce((sum, section) => sum + section.bars, 0)).toBe(33);
      expect(arrangement.jazzFiveFourLeadDirectives?.map((directive) => [
        directive.startBar,
        directive.barCount,
        directive.family,
        directive.rhythmTemplateId,
        directive.grammarFamilyId,
      ])).toEqual([
        [0, 1, 'pickup', 'lead.j54.pickup.source-derived.v1', 'pickup'],
        [1, 8, 'headA', 'lead.j54.head-a.source-derived.v1', 'headA'],
        [9, 8, 'headB', 'lead.j54.head-b.source-derived.v1', 'headB'],
        [17, 8, 'headA', 'lead.j54.head-a.source-derived.v1', 'headA'],
        [25, 8, 'coda', 'lead.j54.coda.source-derived.v1', 'coda'],
      ]);
      expect(Object.isFrozen(arrangement.jazzFiveFourLeadDirectives)).toBe(true);
      for (const directive of arrangement.jazzFiveFourLeadDirectives ?? []) {
        expect(Object.isFrozen(directive)).toBe(true);
        expect(directive.register).toEqual({ lowMidi: 54, highMidi: 78 });
        expect(directive.phraseIds.length).toBeGreaterThan(0);
        expect(directive.transformBudget).toMatchObject({
          maxGrammarRedraws: 2,
          preserveRhythmMask: true,
          preserveNominalHarmony: true,
        });
      }
    }
  });

  it('keeps every audible Lead note fully traceable and resolves Harmony only at its bound nominal tick', () => {
    const built = bundle(1662);
    const score = built.jazzFiveFourScorePlan!;
    const lead = score.instrumentEvents.filter((event) => event.role === 'lead');
    const performedById = new Map(score.performance.events.map((event) => [event.eventId, event] as const));
    expect(score.performance.mode).toBe('reference-authored-lead');
    const semanticById = new Map(score.semanticEvents.map((event) => [event.eventId, event] as const));
    expect(lead.length).toBeGreaterThan(0);

    for (const event of lead) {
      const provenance = score.provenanceByEventId[event.eventId];
      const nominalBeat = event.nominalTick / 480;
      const span = built.harmonic.chordTimeline.find((candidate) =>
        nominalBeat >= (candidate.startBeat as number)
        && nominalBeat < (candidate.startBeat as number) + (candidate.durationBeats as number));
      expect(span?.id).toBe(provenance.nominalChordSpanId);
      expect(semanticById.get(event.eventId)?.pitchIntent).toMatchObject({
        kind: 'grammar-lead',
        chordSpanId: span?.id,
        semanticAtom: provenance.semanticAtom,
        grammarTokenKind: provenance.grammarTokenKind,
      });
      expect(provenance).toMatchObject({
        authority: 'arranger-grammar-score',
        variantId: 'seed-generated',
        directiveId: expect.any(String),
        rhythmTemplateId: expect.any(String),
        rhythmSlotId: expect.any(String),
        grammarFamilyId: expect.any(String),
        grammarTokenId: expect.any(String),
        semanticAtom: expect.any(String),
        harmonicBrickIndex: expect.any(Number),
        harmonicBrickName: expect.any(String),
        harmonicBrickFamily: expect.any(String),
        nominalTick: event.nominalTick,
        renderedTick: performedById.get(event.eventId)?.tick,
      });
      expect(Math.abs(performedById.get(event.eventId)!.tick - event.nominalTick)).toBeLessThanOrEqual(40);
      expect(provenance.phraseIds?.length).toBeGreaterThan(0);
      expect(provenance.grammarRulePath?.length).toBeGreaterThan(0);
      expect(event.pitch).toBeGreaterThanOrEqual(54);
      expect(event.pitch).toBeLessThanOrEqual(78);
    }
  });

  it('meets the first harmonic landing gate without a NoteIR repair pass', () => {
    const built = bundle(1662);
    const score = built.jazzFiveFourScorePlan!;
    const lead = score.instrumentEvents.filter((event) => event.role === 'lead');
    const slotCadence = new Map<string, string>();
    for (const directive of built.arrangement.jazzFiveFourLeadDirectives ?? []) {
      const brick = materializeJazzFiveFourLeadRhythm(directive.rhythmTemplateId, directive.startBar);
      for (const slot of brick.slots) slotCadence.set(`${directive.id}|${slot.slotId}`, slot.cadence);
    }
    const structural = lead.filter((event) => {
      const provenance = score.provenanceByEventId[event.eventId];
      const cadence = slotCadence.get(`${provenance.directiveId}|${provenance.rhythmSlotId}`);
      return event.phaseTick === 0 || event.phaseTick === 1_440 || cadence === 'arrival';
    });
    const chordOrGuide = structural.filter((event) => {
      const atom = score.provenanceByEventId[event.eventId].semanticAtom;
      return atom === 'chord-tone' || atom === 'guide-tone';
    });
    expect(structural.length).toBeGreaterThan(0);
    expect(chordOrGuide.length / structural.length).toBeGreaterThanOrEqual(0.7);

    const arrivals = lead.filter((event) => {
      const provenance = score.provenanceByEventId[event.eventId];
      return slotCadence.get(`${provenance.directiveId}|${provenance.rhythmSlotId}`) === 'arrival';
    });
    expect(arrivals.length).toBeGreaterThan(0);
    for (const event of arrivals) {
      const spanId = score.provenanceByEventId[event.eventId].nominalChordSpanId!;
      expect(built.harmonic.avoidNoteMap[spanId]).not.toContain(pc(event.pitch % 12));
    }
  });

  it('is deterministic by seed while pitch/semantics vary and the Arranger rhythm mask stays fixed', () => {
    const a = bundle(1662).jazzFiveFourScorePlan!;
    const aAgain = bundle(1662).jazzFiveFourScorePlan!;
    const b = bundle(1663).jazzFiveFourScorePlan!;
    const leadSignature = (score: typeof a) => score.performance.events
      .filter((event) => event.role === 'lead')
      .map((event) => `${event.tick}|${event.durationTicks}|${event.pitch}|${score.provenanceByEventId[event.eventId].semanticAtom}`);
    const rhythmMask = (score: typeof a) => score.performance.events
      .filter((event) => event.role === 'lead')
      .map((event) => `${event.tick}|${event.durationTicks}`);

    expect(leadSignature(aAgain)).toEqual(leadSignature(a));
    expect(rhythmMask(b)).toEqual(rhythmMask(a));
    expect(leadSignature(b)).not.toEqual(leadSignature(a));
  });

  it('keeps intentionalRest at zero audible notes and ordinary Jazz paths directive-free', () => {
    const rest = materializeJazzFiveFourLeadRhythm(JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID, 0);
    const grammar = jazzFiveFourLeadGrammar('intentionalRest', 0);
    const abstract = expandGrammarForBrick(grammar, {
      brick: { name: 'rest', family: 'Unknown', startBeat: 0, durationBeats: 5, chordIndices: [], cost: 0 },
      rng: makeSeededRng(5),
    });
    expect(abstract).toEqual([]);
    expect(bindJazzFiveFourLeadSlots(rest, [])).toEqual([]);

    const built = bundle(1662);
    const base = buildJazzFiveFourScorePlan({
      arrangement: built.arrangement,
      harmonic: built.harmonic,
      instrumentation: built.instrumentation,
      options: {
        enabled: true,
        mode: 'canonical-reference',
        performanceMode: 'reference-zero',
        foundationMode: 'acoustic-bass+full-piano',
      },
    })!;
    const sourceDirective = built.arrangement.jazzFiveFourLeadDirectives![0]!;
    const restArrangement = {
      ...built.arrangement,
      jazzFiveFourLeadDirectives: [{
        ...sourceDirective,
        id: 'j54-lead:intentional-rest-test',
        family: 'intentionalRest' as const,
        rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID,
        grammarFamilyId: 'intentionalRest' as const,
        mutationBudget: rest.mutationBudget,
      }],
    };
    const restScore = compileJazzFiveFourLeadScore({
      score: base,
      arrangement: restArrangement,
      harmonic: built.harmonic,
      instrumentation: built.instrumentation,
      band: built.band,
      seed: 1662,
    });
    expect(restScore.performance.events.filter((event) => event.role === 'lead')).toEqual([]);

    const ordinary = buildSongBundle({
      seed: 8,
      styleHint: 'jazz',
      mood: 'ordinary path',
      targetDuration: 60,
      mode: 'minor',
      jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    expect(ordinary.arrangement.jazzFiveFourLeadDirectives).toBeUndefined();

    const generative = buildSongBundle({
      seed: 8,
      styleHint: 'jazz',
      mood: '5/4 generative path',
      targetDuration: 60,
      mode: 'minor',
      jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
    });
    expect(generative.arrangement.jazzFiveFourLeadDirectives).toHaveLength(5);
  });
});
