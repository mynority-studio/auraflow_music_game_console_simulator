import { describe, expect, it } from 'vitest';
import { expandGrammarForBrick } from '../render/mgGrammarRuntime';
import type { BrickMatch } from '../render/mgRoadMapParser';
import {
  JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES,
  JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY,
  jazzFiveFourAbstractTokenSemanticAtom,
  jazzFiveFourLeadGrammar,
} from './jazzFiveFourLeadGrammar';

const BRICK: BrickMatch = Object.freeze({
  name: 'JazzFiveFourSemanticSpan',
  family: 'Unknown',
  startBeat: 0,
  durationBeats: 5,
  chordIndices: [0],
  keyPc: 4,
  cost: 0,
});

function expand(
  family: (typeof JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES)[number],
  audibleCount: number,
  randomValue = 0.42,
) {
  return expandGrammarForBrick(jazzFiveFourLeadGrammar(family, audibleCount), {
    brick: BRICK,
    rng: () => randomValue,
  });
}

describe('Jazz 5/4 Lead Grammar KB', () => {
  it('registers the six arrangement-facing semantic families', () => {
    expect(JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES).toEqual([
      'pickup',
      'headA',
      'headB',
      'solo',
      'coda',
      'intentionalRest',
    ]);
  });

  it.each(JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES)(
    '%s expands to exactly the requested audible cardinality',
    (family) => {
      for (const audibleCount of [0, 1, 7, 31, JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY]) {
        const tokens = expand(family, audibleCount);
        expect(tokens).toHaveLength(audibleCount);
        expect(tokens.every((token) => jazzFiveFourAbstractTokenSemanticAtom(token) !== null)).toBe(true);
      }
    },
  );

  it('keeps expanded material pitch-free and maps it to timing-free semantic atoms', () => {
    const tokens = expand('solo', 24);
    const semanticAtoms = tokens.map(jazzFiveFourAbstractTokenSemanticAtom);

    expect(semanticAtoms).toHaveLength(24);
    expect(semanticAtoms.every((atom) => typeof atom === 'string')).toBe(true);
    expect(JSON.stringify(semanticAtoms)).not.toMatch(
      /pitch|midi|degree|interval|duration|gate|onset|startBeat|cellInBar/i,
    );

    for (const token of tokens) {
      // `duration: 0` is only the legacy MG schema sentinel. It cannot author
      // any time, and no terminal carries a pitch/degree/interval chain.
      expect(token.duration).toBe(0);
      expect(token.kind).not.toBe('R');
      expect(Object.keys(token).sort()).toEqual(['duration', 'kind']);
    }
  });

  it('varies weighted semantic choices with RNG while preserving cardinality', () => {
    const lowDraw = expand('solo', 16, 0).map((token) => token.kind);
    const highDraw = expand('solo', 16, 0.999_999).map((token) => token.kind);

    expect(lowDraw).toHaveLength(16);
    expect(highDraw).toHaveLength(16);
    expect(lowDraw).not.toEqual(highDraw);
    expect(new Set([...lowDraw, ...highDraw]).size).toBeGreaterThan(1);
  });

  it('provides a bounded pitchless structural-anchor fallback grammar', () => {
    const tokens = expandGrammarForBrick(
      jazzFiveFourLeadGrammar('headB', 32, 'structural-anchor-fallback'),
      { brick: BRICK, rng: () => 0.42 },
    );
    expect(tokens).toHaveLength(32);
    expect(tokens.every((token) => token.kind === 'C' || token.kind === 'G')).toBe(true);
    expect(tokens.every((token) => token.duration === 0)).toBe(true);
  });

  it('contains no authored absolute pitch or per-slot degree/interval chain', () => {
    for (const family of JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES) {
      const grammar = jazzFiveFourLeadGrammar(family, 9);
      const rules = [...grammar.rulesByLhs.values()].flat();
      const authored = JSON.stringify(rules);
      expect(authored).not.toMatch(/"(?:pitch|midiPitch|pitchClass|degree|interval|slotId|cellInBar)"/);
      expect(rules.filter((rule) => rule.lhs === 'Atom').length).toBeGreaterThanOrEqual(4);
    }
  });

  it('rejects invalid cardinality instead of silently truncating', () => {
    expect(() => jazzFiveFourLeadGrammar('headA', -1)).toThrow(/audibleCount/);
    expect(() => jazzFiveFourLeadGrammar('headA', 1.5)).toThrow(/audibleCount/);
    expect(() => jazzFiveFourLeadGrammar(
      'headA',
      JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY + 1,
    )).toThrow(/audibleCount/);
  });
});
