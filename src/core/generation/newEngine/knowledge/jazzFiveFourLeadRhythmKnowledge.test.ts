import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
  bindJazzFiveFourLeadSlots,
  materializeJazzFiveFourLeadRhythmTemplate,
  type LeadRhythmSlot,
  type LeadRhythmTemplate,
  type SemanticGrammarToken,
} from '../arranger/jazzFiveFourLeadRhythm';
import {
  JAZZ_FIVE_FOUR_LEAD_CODA_ID,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_TEMPLATES,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_WHOLE_PHRASE_SPECS,
  JAZZ_FIVE_FOUR_LEAD_HEAD_B,
  JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID,
  JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID,
  JAZZ_FIVE_FOUR_LEAD_PICKUP_ID,
  JAZZ_FIVE_FOUR_LEAD_PICKUP,
  JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS,
  JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS,
  JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_PPQ,
  JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES,
  JAZZ_FIVE_FOUR_LEAD_SOLO_ID,
  jazzFiveFourLeadRhythmSkeletonIdentity,
  jazzFiveFourLeadRhythmSkeletonSignature,
  materializeJazzFiveFourLeadRhythm,
  type JazzFiveFourLeadRhythmTemplateId,
} from './jazzFiveFourLeadRhythmKnowledge';

type SourceTiming = readonly [phaseTicks: number, durationTicks: number];

/**
 * Hand-fixed, rhythm-only audit fixture from the Alto Sax channel. Values are
 * bar-relative source ticks; no filesystem/MIDI/oracle dependency enters tests
 * or product runtime.
 */
const OBSERVED_SOURCE_TIMING: Readonly<
  Record<
    | typeof JAZZ_FIVE_FOUR_LEAD_PICKUP_ID
    | typeof JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID
    | typeof JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID
    | typeof JAZZ_FIVE_FOUR_LEAD_SOLO_ID
    | typeof JAZZ_FIVE_FOUR_LEAD_CODA_ID,
    readonly (readonly SourceTiming[])[]
  >
> = Object.freeze({
  [JAZZ_FIVE_FOUR_LEAD_PICKUP_ID]: [
    [[590, 46], [698, 46], [776, 68], [878, 54]],
  ],
  [JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID]: [
    [[14, 78], [110, 50], [226, 38], [326, 64], [404, 92], [584, 168], [728, 56], [768, 42], [784, 64]],
    [[18, 544], [578, 74], [664, 38], [700, 30], [730, 38], [772, 196]],
    [[12, 554], [580, 74], [682, 22], [692, 40], [730, 48], [774, 186]],
    [[0, 478], [590, 74], [698, 58], [778, 70], [878, 60]],
    [[14, 78], [110, 50], [226, 38], [326, 64], [404, 92], [584, 168], [728, 56], [768, 42], [784, 64]],
    [[18, 544], [578, 74], [664, 38], [700, 30], [730, 38], [772, 188]],
    [[18, 544], [578, 74], [664, 38], [700, 30], [730, 38], [772, 188]],
    [[24, 320]],
  ],
  [JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID]: [
    [[22, 88], [146, 72], [312, 68], [406, 98], [594, 64], [686, 72], [780, 80], [878, 68]],
    [[18, 94], [164, 58], [324, 76], [428, 112], [618, 80], [712, 76], [792, 66], [878, 72]],
    [[26, 96], [150, 74], [318, 80], [420, 110], [594, 76], [702, 64], [794, 74], [892, 58]],
    [[14, 82], [126, 52], [212, 76], [318, 62], [412, 100], [610, 80], [718, 64], [818, 74], [900, 54]],
    [[22, 88], [146, 72], [312, 68], [406, 98], [594, 64], [686, 72], [780, 80], [878, 68]],
    [[18, 94], [164, 58], [324, 76], [428, 112], [618, 80], [712, 76], [792, 66], [878, 72]],
    [[22, 102], [156, 62], [320, 74], [422, 110], [602, 76], [702, 60], [788, 76], [898, 72]],
    [[42, 470], [692, 32], [776, 62], [872, 52]],
  ],
  [JAZZ_FIVE_FOUR_LEAD_SOLO_ID]: [
    [[12, 28], [40, 472], [506, 70], [548, 50], [584, 62]],
    [[8, 314], [326, 72], [424, 86]],
    [[4, 104], [126, 64], [208, 84], [316, 58], [390, 88], [484, 262], [782, 46]],
    [[16, 282], [316, 74], [402, 84], [514, 52]],
    [[14, 314], [340, 154], [508, 50], [580, 146], [768, 66]],
    [[20, 286], [320, 182], [512, 66], [592, 78], [704, 70], [798, 60], [888, 58]],
    [[18, 282], [324, 188], [522, 48], [596, 142], [766, 66]],
    [[14, 284], [320, 192], [508, 64], [590, 96], [706, 54]],
  ],
  [JAZZ_FIVE_FOUR_LEAD_CODA_ID]: [
    [[578, 74], [664, 38], [700, 30], [730, 38], [772, 188]],
    [[18, 544]],
    [[578, 74], [664, 38], [700, 30], [730, 38], [772, 188]],
    [[18, 544]],
    [[578, 74], [664, 38], [700, 30], [730, 38], [772, 188]],
    [[20, 2592]],
  ],
});

const HEAD_A_RECAP_SOURCE_PHASES: readonly (readonly number[])[] = Object.freeze([
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [12, 580, 682, 692, 730, 774],
  [0, 590, 698, 778, 878],
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [12, 580, 682, 692, 730, 774],
  [18],
]);

const HEAD_A_VARIANT_SOURCE_PHASES: readonly (readonly number[])[] = Object.freeze([
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [8, 578, 664, 700, 730, 772],
  [0, 590, 698, 778, 878],
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [8, 578, 664, 700, 730, 772],
  [6],
]);

const PICKUP_RECAP_SOURCE_PHASES: readonly (readonly number[])[] = Object.freeze([
  [592, 702, 780, 874],
]);

const HEAD_B_RECAP_SOURCE_PHASES: readonly (readonly number[])[] = Object.freeze([
  [22, 146, 312, 406, 594, 686, 780, 878],
  [18, 164, 324, 428, 618, 712, 792, 878],
  [26, 150, 318, 420, 594, 702, 794, 892],
  [14, 126, 212, 318, 412, 610, 718, 818, 900],
  [22, 146, 312, 406, 594, 686, 780, 878],
  [18, 164, 324, 428, 618, 712, 792, 878],
  [22, 156, 320, 422, 602, 702, 788, 898],
  [42, 692, 776, 872],
]);

const HEAD_A_CODA_RECAP_SOURCE_PHASES: readonly (readonly number[])[] = Object.freeze([
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [8, 578, 664, 700, 730, 772],
  [0, 590, 698, 778, 878],
  [14, 110, 226, 326, 404, 584, 728, 768, 784],
  [18, 578, 664, 700, 730, 772],
  [18, 578, 664, 700, 730, 772],
  [6],
]);

function attackSlotsForBar(template: LeadRhythmTemplate, barOffset: number): LeadRhythmSlot[] {
  return template.slots
    .filter((slot) => slot.kind === 'attack' && slot.barOffset === barOffset)
    .sort((left, right) => left.cellInBar - right.cellInBar);
}

function grammarToken(index: number): SemanticGrammarToken {
  return {
    tokenId: `grammar-${index}`,
    audible: true,
    semanticAtom: index % 2 === 0 ? 'chord-tone' : 'guide-tone',
    rulePath: ['jazz-five-four', 'test-bind'],
    chordSpanId: `span-${Math.floor(index / 4)}`,
  };
}

function expectObservedMaskFitsTemplate(
  template: LeadRhythmTemplate,
  observedSourcePhases: readonly (readonly number[])[],
): void {
  expect(observedSourcePhases).toHaveLength(template.barCount);
  observedSourcePhases.forEach((phases, barOffset) => {
    const expected = attackSlotsForBar(template, barOffset).map((slot) => slot.cellInBar);
    const observed = phases.map((phase) =>
      Math.round(phase / JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS));
    expect(observed).toHaveLength(expected.length);
    observed.forEach((cell, index) => {
      expect(Math.abs(cell - expected[index]!))
        .toBeLessThanOrEqual(template.mutationBudget.maxOnsetShiftCells);
    });
  });
}

describe('knowledge/jazzFiveFourLeadRhythmKnowledge', () => {
  it('contains only rhythm ownership and keeps every template on the 30-cell 5/4 clock', () => {
    const allowedTemplateKeys = ['barCount', 'cellsPerBar', 'id', 'mutationBudget', 'slots'];
    const allowedSlotKeys = [
      'accent', 'barOffset', 'cadence', 'cellInBar', 'gateCells', 'kind',
      'referenceResidualTicks', 'slotId',
    ];

    for (const template of Object.values(JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES)) {
      expect(Object.keys(template).sort()).toEqual(allowedTemplateKeys);
      expect(template.cellsPerBar).toBe(JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR);
      expect(Object.isFrozen(template)).toBe(true);
      expect(Object.isFrozen(template.slots)).toBe(true);
      for (const slot of template.slots) {
        expect(Object.keys(slot).sort()).toEqual(allowedSlotKeys);
        expect(slot.barOffset).toBeGreaterThanOrEqual(0);
        expect(slot.barOffset).toBeLessThan(template.barCount);
        expect(slot.cellInBar).toBeGreaterThanOrEqual(0);
        expect(slot.cellInBar).toBeLessThan(30);
      }
      expect(() => materializeJazzFiveFourLeadRhythmTemplate(template, 0)).not.toThrow();
    }

    expect(JSON.stringify(JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES))
      .not.toMatch(/pitch|degree|interval|sourceBar|absoluteBar|absoluteTick/i);
  });

  it('keeps every source-derived onset and gate residual within 40 engine ticks', () => {
    const sourceToEngine = 480 / JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_PPQ;
    expect(sourceToEngine).toBe(2.5);
    expect(JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS * sourceToEngine)
      .toBe(JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS);

    for (const [id, observedBars] of Object.entries(OBSERVED_SOURCE_TIMING)) {
      const template = JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[id as JazzFiveFourLeadRhythmTemplateId];
      observedBars.forEach((observed, barOffset) => {
        const slots = attackSlotsForBar(template, barOffset);
        expect(slots).toHaveLength(observed.length);
        observed.forEach(([sourcePhase, sourceDuration], index) => {
          const slot = slots[index]!;
          const onsetResidual = Math.abs(
            sourcePhase * sourceToEngine
            - slot.cellInBar * JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS,
          );
          const gateResidual = Math.abs(
            sourceDuration * sourceToEngine
            - slot.gateCells * JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS,
          );
          expect(onsetResidual).toBeLessThanOrEqual(40);
          expect(slot.referenceResidualTicks).toBe(sourcePhase * sourceToEngine
            - slot.cellInBar * JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS);
          expect(gateResidual).toBeLessThanOrEqual(40);
          expect(slot.cellInBar).toBe(Math.round(sourcePhase / JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS));
          expect(slot.gateCells).toBe(Math.max(1, Math.round(sourceDuration / JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS)));
        });
      });
    }
  });

  it('reuses pickup and Head A/B masks through variants and recap instead of copying fixed melody', () => {
    expectObservedMaskFitsTemplate(JAZZ_FIVE_FOUR_LEAD_PICKUP, PICKUP_RECAP_SOURCE_PHASES);
    expectObservedMaskFitsTemplate(JAZZ_FIVE_FOUR_LEAD_HEAD_A, HEAD_A_VARIANT_SOURCE_PHASES);
    expectObservedMaskFitsTemplate(JAZZ_FIVE_FOUR_LEAD_HEAD_A, HEAD_A_RECAP_SOURCE_PHASES);
    expectObservedMaskFitsTemplate(JAZZ_FIVE_FOUR_LEAD_HEAD_B, HEAD_B_RECAP_SOURCE_PHASES);
    expectObservedMaskFitsTemplate(JAZZ_FIVE_FOUR_LEAD_HEAD_A, HEAD_A_CODA_RECAP_SOURCE_PHASES);

    const head = materializeJazzFiveFourLeadRhythm(JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID, 4);
    const recap = materializeJazzFiveFourLeadRhythm(JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID, 72);
    expect(recap.slots).toEqual(head.slots);
    expect(recap.startBar - head.startBar).toBe(68);
  });

  it('models an intentional-rest bar with zero attacks and consumes zero grammar tokens', () => {
    const rest = materializeJazzFiveFourLeadRhythm(JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID, 40);
    expect(rest.slots.filter((slot) => slot.kind === 'attack')).toHaveLength(0);
    expect(rest.slots).toEqual([
      expect.objectContaining({ kind: 'rest', barOffset: 0, cellInBar: 0, gateCells: 30, accent: 0 }),
    ]);
    expect(bindJazzFiveFourLeadSlots(rest, [])).toEqual([]);
  });

  it('materializes at an Arranger startBar and binds one grammar token per attack', () => {
    const brick = materializeJazzFiveFourLeadRhythm(JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID, 7);
    const attackCount = brick.slots.filter((slot) => slot.kind === 'attack').length;
    const bound = bindJazzFiveFourLeadSlots(
      brick,
      Array.from({ length: attackCount }, (_, index) => grammarToken(index)),
    );

    expect(attackCount).toBe(48);
    expect(bound).toHaveLength(attackCount);
    expect(bound[0]).toMatchObject({ absoluteCell: 7 * 30, nominalTick: 7 * 2_400 });
    expect(bound.every((event) => event.nominalTick % 80 === 0)).toBe(true);
    expect(new Set(bound.map((event) => event.eventId)).size).toBe(attackCount);
  });

  it('stores sixteen complete eight-bar A skeletons without event-level drop decisions', () => {
    expect(JAZZ_FIVE_FOUR_LEAD_HEAD_A_WHOLE_PHRASE_SPECS).toHaveLength(16);
    expect(JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_TEMPLATES).toHaveLength(16);
    expect(new Set(JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS).size).toBe(16);

    const signatures = new Set<string>();
    for (const [index, template] of JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_TEMPLATES.entries()) {
      const attacks = template.slots.filter((slot) => slot.kind === 'attack');
      expect(template.id).toBe(JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS[index]);
      expect(template.barCount).toBe(8);
      expect(attacks).toHaveLength(48);
      expect(template.mutationBudget).toMatchObject({
        maxAttackInsertions: 0,
        maxAttackDeletions: 0,
        preserveCadenceSlots: true,
      });
      expect(attacks.map((slot) => slot.referenceResidualTicks)).toEqual(
        JAZZ_FIVE_FOUR_LEAD_HEAD_A.slots
          .filter((slot) => slot.kind === 'attack')
          .map((slot) => slot.referenceResidualTicks),
      );
      // Phase 4 (cell 24) remains the phrase-level Comp interlock anchor in
      // both repeated A halves; the optional tail operation moves cell 25.
      expect(attacks.filter((slot) =>
        (slot.barOffset === 0 || slot.barOffset === 4) && slot.cellInBar === 24))
        .toHaveLength(2);
      expect(attacks.every((slot) => Math.abs(slot.referenceResidualTicks ?? 0) <= 40)).toBe(true);
      signatures.add(jazzFiveFourLeadRhythmSkeletonSignature(template.id as JazzFiveFourLeadRhythmTemplateId));
    }
    expect(signatures.size).toBe(16);
  });

  it('keeps every whole-phrase A variant inside the declared 70% identity floor', () => {
    for (const left of JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS) {
      expect(jazzFiveFourLeadRhythmSkeletonIdentity(JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID, left))
        .toBeGreaterThanOrEqual(0.7);
      for (const right of JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS) {
        expect(jazzFiveFourLeadRhythmSkeletonIdentity(left, right)).toBeGreaterThanOrEqual(0.7);
        expect(jazzFiveFourLeadRhythmSkeletonIdentity(left, right)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fails closed if a reusable template tries to smuggle in absolute placement', () => {
    const malformed = {
      ...JAZZ_FIVE_FOUR_LEAD_HEAD_A,
      startBar: 12,
    } as unknown as LeadRhythmTemplate;
    expect(() => materializeJazzFiveFourLeadRhythmTemplate(malformed, 0))
      .toThrowError(/must not own startBar/);
  });
});
