import { describe, expect, it, vi } from 'vitest';
import { makeGrammar, type GrammarRule } from '../knowledge/melodyGrammarTypes';
import type { BrickMatch } from './mgRoadMapParser';
import {
  expandGrammarForBrick,
  type GrammarExpansionTraceEvent,
} from './mgGrammarRuntime';
import { makeSeededRng } from './mgRng';

const BRICK: BrickMatch = Object.freeze({
  name: 'TraceCompatibilityBrick',
  family: 'Unknown',
  startBeat: 0,
  durationBeats: 5,
  chordIndices: [0],
  cost: 0,
});

const RULES: GrammarRule[] = [
  {
    lhs: 'Phrase',
    weight: 1,
    metadata: { sourceRuleId: 'compat:phrase' },
    rhs: ['Line'],
  },
  {
    lhs: 'Line',
    weight: 1,
    metadata: { sourceRuleId: 'compat:first' },
    rhs: [{ kind: 'C', duration: 0.5 }],
  },
  {
    lhs: 'Line',
    weight: 1,
    metadata: { sourceRuleId: 'compat:second' },
    rhs: [{ kind: 'G', duration: 1 }],
  },
];

function sequenceRng(values: readonly number[]) {
  let index = 0;
  const rng = vi.fn(() => values[index++] ?? values.at(-1) ?? 0);
  return rng;
}

describe('MG grammar expansion trace compatibility', () => {
  it('keeps the legacy default expansion byte-identical when trace is omitted', () => {
    const legacyDefault = expandGrammarForBrick(makeGrammar(RULES, 'Phrase'), {
      brick: BRICK,
      rng: sequenceRng([0.2, 0.75]),
    });
    const explicitlyDisabled = expandGrammarForBrick(makeGrammar(RULES, 'Phrase'), {
      brick: BRICK,
      rng: sequenceRng([0.2, 0.75]),
      trace: undefined,
    });

    const expectedLegacyBytes = '[{"kind":"G","duration":1}]';
    expect(JSON.stringify(legacyDefault)).toBe(expectedLegacyBytes);
    expect(JSON.stringify(explicitlyDisabled)).toBe(expectedLegacyBytes);
  });

  it('reports rule paths without consuming RNG or changing emitted tokens', () => {
    const baselineRng = sequenceRng([0.2, 0.75]);
    const tracedRng = sequenceRng([0.2, 0.75]);
    const baseline = expandGrammarForBrick(makeGrammar(RULES, 'Phrase'), {
      brick: BRICK,
      rng: baselineRng,
    });
    const events: GrammarExpansionTraceEvent[] = [];
    const traced = expandGrammarForBrick(makeGrammar(RULES, 'Phrase'), {
      brick: BRICK,
      rng: tracedRng,
      trace: (event) => events.push(event),
    });

    expect(JSON.stringify(traced)).toBe(JSON.stringify(baseline));
    expect(tracedRng).toHaveBeenCalledTimes(baselineRng.mock.calls.length);
    expect(events.map((event) => event.type)).toEqual([
      'rule-selected',
      'rule-selected',
      'terminal-emitted',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'terminal-emitted',
      outputIndex: 0,
      tokenKind: 'G',
      sourceRuleId: 'compat:second',
      rulePath: ['compat:phrase', 'compat:second'],
    });
    expect(events.every(Object.isFrozen)).toBe(true);
    expect(events.every((event) => Object.isFrozen(event.rulePath))).toBe(true);
  });

  it('family-only mode ignores brick name/duration gates after family match', () => {
    const grammar = makeGrammar([
      {
        lhs: 'Phrase',
        weight: 1,
        metadata: { sourceRuleId: 'A_1', sourceName: 'A', authoredDurationBeats: 2 },
        conditions: { brickFamily: ['Unknown'], brickName: ['Other-A'], minDuration: 1, maxDuration: 2 },
        rhs: [{ kind: 'X', degree: 1, duration: 1 }],
      },
      {
        lhs: 'Phrase',
        weight: 1,
        metadata: { sourceRuleId: 'B_1', sourceName: 'B', authoredDurationBeats: 32 },
        conditions: { brickFamily: ['Unknown'], brickName: ['Other-B'], minDuration: 24, maxDuration: 40 },
        rhs: [{ kind: 'X', degree: 2, duration: 1 }],
      },
    ], 'Phrase', {
      matchMode: 'family-only',
      collapseRhsSignatures: true,
      sourceWeightCap: 0.5,
      durationFitFloor: 0.45,
    });
    const selected = new Set<number | string | undefined>();
    for (let seed = 0; seed < 80; seed++) {
      const [token] = expandGrammarForBrick(grammar, { brick: BRICK, rng: makeSeededRng(seed) });
      if (token.kind === 'X') selected.add(token.degree);
    }
    expect(selected).toEqual(new Set([1, 2]));
  });

  it('collapses duplicate RHS IDs before selecting a concrete variant', () => {
    const duplicates: GrammarRule[] = Array.from({ length: 20 }, (_, index) => ({
      lhs: 'Phrase',
      weight: 1,
      metadata: { sourceRuleId: `same_${index}`, sourceName: 'same-source' },
      conditions: { brickFamily: ['Unknown'] },
      rhs: [{ kind: 'C', duration: 1 }],
    }));
    const grammar = makeGrammar([
      ...duplicates,
      {
        lhs: 'Phrase',
        weight: 1,
        metadata: { sourceRuleId: 'other_1', sourceName: 'same-source' },
        conditions: { brickFamily: ['Unknown'] },
        rhs: [{ kind: 'G', duration: 1 }],
      },
    ], 'Phrase', {
      matchMode: 'family-only',
      collapseRhsSignatures: true,
      sourceWeightCap: 1,
    });
    let chordToneCount = 0;
    const trials = 2_000;
    for (let seed = 0; seed < trials; seed++) {
      const [token] = expandGrammarForBrick(grammar, { brick: BRICK, rng: makeSeededRng(seed) });
      if (token.kind === 'C') chordToneCount++;
    }
    expect(chordToneCount / trials).toBeGreaterThan(0.45);
    expect(chordToneCount / trials).toBeLessThan(0.55);
  });

  it('caps one source marginal and redistributes its overflow inside the family', () => {
    const rules: GrammarRule[] = [];
    for (const [sourceIndex, sourceName] of ['dominant', 'two', 'three', 'four'].entries()) {
      for (let shape = 0; shape < 12; shape++) {
        rules.push({
          lhs: 'Phrase',
          weight: sourceIndex === 0 ? 20 : 1,
          metadata: { sourceRuleId: `${sourceName}_${shape}`, sourceName },
          conditions: { brickFamily: ['Unknown'] },
          rhs: [{ kind: 'X', degree: sourceIndex * 100 + shape, duration: 1 }],
        });
      }
    }
    const grammar = makeGrammar(rules, 'Phrase', {
      matchMode: 'family-only',
      collapseRhsSignatures: true,
      sourceWeightCap: 0.25,
    });
    const counts = new Map<string, number>();
    const trials = 4_000;
    for (let seed = 0; seed < trials; seed++) {
      expandGrammarForBrick(grammar, {
        brick: BRICK,
        rng: makeSeededRng(seed),
        trace: (event) => {
          if (event.type === 'rule-selected' && event.symbol === 'Phrase') {
            counts.set(event.sourceName, (counts.get(event.sourceName) ?? 0) + 1);
          }
        },
      });
    }
    expect(Math.max(...counts.values()) / trials).toBeLessThanOrEqual(0.27);
  });

});
