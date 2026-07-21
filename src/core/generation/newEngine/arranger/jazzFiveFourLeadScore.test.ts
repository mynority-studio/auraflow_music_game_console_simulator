import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_LEAD_CELL_TICKS,
  bindJazzFiveFourLeadSlots,
  type SemanticGrammarToken,
} from './jazzFiveFourLeadRhythm';
import { planPhrases } from './phrasePlanner';
import {
  planJazzFiveFourLeadDirectives,
  type LeadPhraseDirective,
} from './jazzFiveFourLeadScore';
import type { Section } from './ArrangementPlan';
import {
  JAZZ_FIVE_FOUR_LEAD_HEAD_A,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID,
  jazzFiveFourLeadRhythmSkeletonIdentity,
  jazzFiveFourLeadRhythmSkeletonSignature,
  materializeJazzFiveFourLeadRhythm,
} from '../knowledge/jazzFiveFourLeadRhythmKnowledge';

function form(): { sections: Section[]; phrases: ReturnType<typeof planPhrases>['phrases'] } {
  const sections: Section[] = [
    { id: 'pickup', role: 'intro', functionTag: 'setup', bars: 1, hookPolicy: 'none' },
    { id: 'headA', role: 'verse', functionTag: 'head', bars: 8, hookPolicy: 'main' },
    { id: 'headB', role: 'bridge', functionTag: 'build', bars: 8, hookPolicy: 'light' },
    { id: 'headOut', role: 'chorus', functionTag: 'headOut', bars: 8, hookPolicy: 'main' },
    { id: 'coda', role: 'outro', functionTag: 'outro', bars: 8, hookPolicy: 'light' },
  ];
  return { sections, phrases: planPhrases(sections, 4).phrases };
}

function referenceDirectives(): readonly LeadPhraseDirective[] {
  const scoreForm = form();
  return planJazzFiveFourLeadDirectives({
    enabled: true,
    mode: 'canonical-reference',
    meter: { numerator: 5, denominator: 4 },
    ...scoreForm,
  })!;
}

function generativeDirectives(seed: number): readonly LeadPhraseDirective[] {
  const scoreForm = form();
  return planJazzFiveFourLeadDirectives({
    enabled: true,
    mode: 'generative',
    seed,
    meter: { numerator: 5, denominator: 4 },
    ...scoreForm,
  })!;
}

function grammarToken(index: number): SemanticGrammarToken {
  return {
    tokenId: `whole-phrase-token-${index}`,
    audible: true,
    semanticAtom: index % 2 === 0 ? 'chord-tone' : 'guide-tone',
    rulePath: ['jazz-five-four', 'whole-phrase-variant'],
  };
}

function headPair(directives: readonly LeadPhraseDirective[]): readonly [LeadPhraseDirective, LeadPhraseDirective] {
  return [directives[1]!, directives[3]!];
}

describe('arranger/jazzFiveFourLeadScore · whole-phrase generative rhythm', () => {
  it('keeps canonical-reference at the existing five directives and exact masks/residuals', () => {
    const directives = referenceDirectives();
    expect(directives.map((directive) => [
      directive.startBar,
      directive.barCount,
      directive.sectionId,
      directive.rhythmTemplateId,
    ])).toEqual([
      [0, 1, 'pickup', 'lead.j54.pickup.source-derived.v1'],
      [1, 8, 'headA', 'lead.j54.head-a.source-derived.v1'],
      [9, 8, 'headB', 'lead.j54.head-b.source-derived.v1'],
      [17, 8, 'headOut', 'lead.j54.head-a.source-derived.v1'],
      [25, 8, 'coda', 'lead.j54.coda.source-derived.v1'],
    ]);

    const [headA, recap] = headPair(directives);
    for (const directive of [headA, recap]) {
      const brick = materializeJazzFiveFourLeadRhythm(directive.rhythmTemplateId, directive.startBar);
      expect(brick.slots).toEqual(JAZZ_FIVE_FOUR_LEAD_HEAD_A.slots);
      expect(brick.slots.some((slot) => (slot.referenceResidualTicks ?? 0) !== 0)).toBe(true);
      expect(brick.slots.every((slot) => Math.abs(slot.referenceResidualTicks ?? 0) <= 40)).toBe(true);
    }
  });

  it('selects at least ten distinct complete A skeletons over fifty seeds', () => {
    const signatures = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      const [headA] = headPair(generativeDirectives(seed));
      expect(JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS).toContain(headA.rhythmTemplateId);
      signatures.add(jazzFiveFourLeadRhythmSkeletonSignature(headA.rhythmTemplateId));
    }
    expect(signatures.size).toBeGreaterThanOrEqual(10);
  });

  it('is stable for one seed and pairs A/recap at 70–100% structural identity', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const first = generativeDirectives(seed);
      const again = generativeDirectives(seed);
      expect(again).toEqual(first);

      const [headA, recap] = headPair(first);
      const identity = jazzFiveFourLeadRhythmSkeletonIdentity(
        headA.rhythmTemplateId,
        recap.rhythmTemplateId,
      );
      expect(identity).toBeGreaterThanOrEqual(0.7);
      expect(identity).toBeLessThanOrEqual(1);
    }
  });

  it('allows a coordinated recap ending mutation without per-note Bernoulli deletion', () => {
    let mutatedPair: readonly [LeadPhraseDirective, LeadPhraseDirective] | undefined;
    for (let seed = 0; seed < 100 && !mutatedPair; seed += 1) {
      const pair = headPair(generativeDirectives(seed));
      if (pair[0].rhythmTemplateId !== pair[1].rhythmTemplateId) mutatedPair = pair;
    }
    expect(mutatedPair).toBeDefined();

    const [headA, recap] = mutatedPair!;
    const headBrick = materializeJazzFiveFourLeadRhythm(headA.rhythmTemplateId, 0);
    const recapBrick = materializeJazzFiveFourLeadRhythm(recap.rhythmTemplateId, 0);
    const headAttacks = headBrick.slots.filter((slot) => slot.kind === 'attack');
    const recapAttacks = recapBrick.slots.filter((slot) => slot.kind === 'attack');
    expect(headAttacks).toHaveLength(48);
    expect(recapAttacks).toHaveLength(48);

    const changed = headAttacks.filter((slot, index) => {
      const other = recapAttacks[index]!;
      return slot.cellInBar !== other.cellInBar || slot.gateCells !== other.gateCells;
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ barOffset: 7, cadence: 'release' });
    expect(jazzFiveFourLeadRhythmSkeletonIdentity(headA.rhythmTemplateId, recap.rhythmTemplateId))
      .toBe(47 / 48);
  });

  it('materializes every selected phrase for the existing Grammar/SlotBinder clock API', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const [headA, recap] = headPair(generativeDirectives(seed));
      for (const directive of [headA, recap]) {
        const brick = materializeJazzFiveFourLeadRhythm(directive.rhythmTemplateId, directive.startBar);
        const attacks = brick.slots.filter((slot) => slot.kind === 'attack');
        const bound = bindJazzFiveFourLeadSlots(
          brick,
          attacks.map((_, index) => grammarToken(index)),
        );
        expect(brick.barCount).toBe(8);
        expect(bound).toHaveLength(48);
        expect(bound.every((event) => event.nominalTick % JAZZ_FIVE_FOUR_LEAD_CELL_TICKS === 0)).toBe(true);
        expect(bound.every((event) => Math.abs(event.referenceResidualTicks) <= 40)).toBe(true);
      }
    }
  });

  it('rejects generative planning without a finite integer seed', () => {
    const scoreForm = form();
    expect(() => planJazzFiveFourLeadDirectives({
      enabled: true,
      mode: 'generative',
      seed: Number.NaN,
      meter: { numerator: 5, denominator: 4 },
      ...scoreForm,
    })).toThrowError(/seed must be a safe integer/);
  });

  it('keeps the canonical source template addressable outside generative selection', () => {
    expect(jazzFiveFourLeadRhythmSkeletonSignature(JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID))
      .toBe(jazzFiveFourLeadRhythmSkeletonSignature(referenceDirectives()[1]!.rhythmTemplateId));
  });
});
