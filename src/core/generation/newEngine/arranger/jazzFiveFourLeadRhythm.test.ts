import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
  JazzFiveFourLeadBindingError,
  bindJazzFiveFourLeadSlots,
  type LeadRhythmBrick,
  type SemanticGrammarToken,
} from './jazzFiveFourLeadRhythm';

const ZERO_MUTATION_BUDGET = {
  maxOnsetShiftCells: 0,
  maxGateDeltaCells: 0,
  maxAttackInsertions: 0,
  maxAttackDeletions: 0,
  preserveIntentionalRests: true,
  preserveCadenceSlots: true,
} as const;

function brick(slots: LeadRhythmBrick['slots'], overrides: Partial<LeadRhythmBrick> = {}): LeadRhythmBrick {
  return {
    id: 'lead-rhythm-a',
    startBar: 0,
    barCount: 1,
    cellsPerBar: JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
    slots,
    mutationBudget: ZERO_MUTATION_BUDGET,
    ...overrides,
  };
}

function token(
  tokenId: string,
  semanticAtom: SemanticGrammarToken['semanticAtom'] = 'chord-tone',
  chordSpanId = 'chord-a',
): SemanticGrammarToken {
  return {
    tokenId,
    audible: true,
    semanticAtom,
    rulePath: ['jazz-five-four', tokenId],
    chordSpanId,
  };
}

describe('arranger/jazzFiveFourLeadRhythm · score-owned SlotBinder', () => {
  it('protects intentional rests and consumes grammar only for attack slots', () => {
    const rhythm = brick([
      { slotId: 'a0', kind: 'attack', barOffset: 0, cellInBar: 0, gateCells: 2, accent: 1, cadence: 'none' },
      { slotId: 'r0', kind: 'rest', barOffset: 0, cellInBar: 2, gateCells: 4, accent: 0, cadence: 'none' },
      { slotId: 'a1', kind: 'attack', barOffset: 0, cellInBar: 6, gateCells: 3, accent: 0.72, cadence: 'setup' },
    ]);

    const bound = bindJazzFiveFourLeadSlots(rhythm, [token('g0'), token('g1', 'guide-tone')]);

    expect(bound).toHaveLength(2);
    expect(bound.map((event) => event.slotId)).toEqual(['a0', 'a1']);
    expect(bound.map((event) => event.absoluteCell)).toEqual([0, 6]);
    expect(bound.map((event) => event.nominalTick)).toEqual([0, 480]);
    expect(bound.map((event) => event.nominalDurationTicks)).toEqual([160, 240]);
    expect(bound.some((event) => event.slotId === 'r0')).toBe(false);
  });

  it('uses one 30-cell clock across bars and permits an authored cross-bar gate', () => {
    const rhythm = brick([
      { slotId: 'last-cell', kind: 'attack', barOffset: 0, cellInBar: 29, gateCells: 2, accent: 0.8, cadence: 'setup' },
      { slotId: 'next-bar', kind: 'attack', barOffset: 1, cellInBar: 2, gateCells: 4, accent: 1, cadence: 'arrival' },
    ], { startBar: 2, barCount: 2 });

    const bound = bindJazzFiveFourLeadSlots(rhythm, [token('before'), token('after', 'guide-tone', 'chord-b')]);

    expect(bound.map((event) => event.absoluteCell)).toEqual([89, 92]);
    expect(bound.map((event) => event.nominalTick)).toEqual([7_120, 7_360]);
    expect(bound[0]?.nominalDurationTicks).toBe(160);
    expect(bound.every((event) => Number.isSafeInteger(event.nominalTick))).toBe(true);
  });

  it('fails closed on grammar/attack count mismatch without truncation, stretching or fallback', () => {
    const rhythm = brick([
      { slotId: 'a0', kind: 'attack', barOffset: 0, cellInBar: 0, gateCells: 2, accent: 1, cadence: 'none' },
      { slotId: 'a1', kind: 'attack', barOffset: 0, cellInBar: 6, gateCells: 2, accent: 0.7, cadence: 'none' },
    ]);

    let failure: unknown;
    try {
      bindJazzFiveFourLeadSlots(rhythm, [token('only-one')]);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(JazzFiveFourLeadBindingError);
    expect(failure).toMatchObject({
      code: 'TOKEN_COUNT_MISMATCH',
      redrawRequest: {
        strategy: 'redraw-semantic-grammar',
        expectedAudibleTokenCount: 2,
        receivedAudibleTokenCount: 1,
        maxAttempts: 2,
      },
    });
    expect(Object.prototype.hasOwnProperty.call(failure, 'boundTokens')).toBe(false);
  });

  it('keeps the rhythm schema free of pitch and degree-chain ownership', () => {
    const rhythm = brick([
      { slotId: 'a0', kind: 'attack', barOffset: 0, cellInBar: 4, gateCells: 2, accent: 0.8, cadence: 'none' },
    ]);
    const serialized = JSON.stringify(rhythm);

    expect(serialized).not.toMatch(/pitch/i);
    expect(serialized).not.toMatch(/degree/i);

    const malformed = {
      ...rhythm,
      slots: [{ ...rhythm.slots[0], pitch: 64 }],
    } as unknown as LeadRhythmBrick;
    expect(() => bindJazzFiveFourLeadSlots(malformed, [token('g0')]))
      .toThrowError(/must not own pitch/);
  });

  it('keeps clocks and event identities invariant when grammar semantics change', () => {
    const rhythm = brick([
      { slotId: 'a0', kind: 'attack', barOffset: 0, cellInBar: 1, gateCells: 2, accent: 0.86, cadence: 'none' },
      { slotId: 'a1', kind: 'attack', barOffset: 0, cellInBar: 10, gateCells: 5, accent: 1, cadence: 'arrival' },
    ], { startBar: 4 });
    const grammarA = [token('a0', 'chord-tone', 'span-1'), token('a1', 'guide-tone', 'span-2')];
    const grammarB = [token('b0', 'enclosure-tone', 'span-x'), token('b1', 'neighbor-tone', 'span-y')];

    const a = bindJazzFiveFourLeadSlots(rhythm, grammarA);
    const b = bindJazzFiveFourLeadSlots(rhythm, grammarB);
    const clock = (events: typeof a) => events.map((event) => ({
      eventId: event.eventId,
      slotId: event.slotId,
      absoluteCell: event.absoluteCell,
      nominalTick: event.nominalTick,
      nominalDurationTicks: event.nominalDurationTicks,
      accent: event.accent,
      cadence: event.cadence,
    }));

    expect(clock(a)).toEqual(clock(b));
    expect(a.map((event) => event.semanticAtom)).not.toEqual(b.map((event) => event.semanticAtom));
    expect(a.map((event) => event.rulePath)).not.toEqual(b.map((event) => event.rulePath));
    expect(a.map((event) => event.chordSpanId)).not.toEqual(b.map((event) => event.chordSpanId));
  });

  it('rejects grammar tokens that try to reclaim timing ownership', () => {
    const rhythm = brick([
      { slotId: 'a0', kind: 'attack', barOffset: 0, cellInBar: 0, gateCells: 2, accent: 1, cadence: 'none' },
    ]);
    const malformed = { ...token('g0'), durationTicks: 240 } as unknown as SemanticGrammarToken;

    expect(() => bindJazzFiveFourLeadSlots(rhythm, [malformed]))
      .toThrowError(/must not own durationTicks/);
  });
});
