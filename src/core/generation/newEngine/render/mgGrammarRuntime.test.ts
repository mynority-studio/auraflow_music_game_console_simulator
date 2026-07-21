import { describe, expect, it, vi } from 'vitest';
import { makeGrammar, type GrammarRule } from '../knowledge/melodyGrammarTypes';
import type { BrickMatch } from './mgRoadMapParser';
import {
  expandGrammarForBrick,
  type GrammarExpansionTraceEvent,
} from './mgGrammarRuntime';

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
});
