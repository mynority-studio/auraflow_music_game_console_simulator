import { describe, expect, it } from 'vitest';
import {
  ACG_RETURN_BRICKS,
  acgReturnBrickTokens,
  getAcgReturnBrickCandidates,
  type AcgReturnFunction,
} from './acgReturnGrammar';

const FUNCTIONS: readonly AcgReturnFunction[] = ['T', 'S', 'D'];
const KINDS = ['stable-single', 'sigh', 'lift-riff'] as const;

describe('knowledge/acgReturnGrammar', () => {
  it('covers every T/S/D function with the three atomic return shapes', () => {
    expect(ACG_RETURN_BRICKS).toHaveLength(9);

    for (const func of FUNCTIONS) {
      const bricks = ACG_RETURN_BRICKS.filter((brick) => brick.function === func);
      expect(bricks.map((brick) => brick.kind).sort()).toEqual([...KINDS].sort());
    }
  });

  it('defines each return as a bounded approach/pickup → stable arrival gesture', () => {
    for (const brick of ACG_RETURN_BRICKS) {
      const audibleCount = brick.tokens.length;
      const duration = brick.tokens.reduce((sum, token) => sum + token.durationBeats, 0);
      const arrival = brick.tokens.at(-1);

      expect(audibleCount).toBeGreaterThanOrEqual(brick.tokenBudget.minAudibleTokens);
      expect(audibleCount).toBeLessThanOrEqual(brick.tokenBudget.maxAudibleTokens);
      expect(duration).toBeGreaterThanOrEqual(brick.tokenBudget.minDurationBeats);
      expect(duration).toBeLessThanOrEqual(brick.tokenBudget.maxDurationBeats);
      expect(arrival).toMatchObject({ role: 'arrival', tokenKind: 'G' });
      expect(brick.arrival.stableRoles.length).toBeGreaterThan(0);
      expect(brick.precedingRest.minBeats).toBeGreaterThan(0);
      expect(brick.precedingRest.maxBeats).toBeGreaterThanOrEqual(brick.precedingRest.minBeats);

      for (const token of brick.tokens.filter((token) => token.role === 'approach')) {
        expect(token.tokenKind).toBe('A');
        expect(token.approach?.maxSemitones).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps T/S arrivals on the current chord and resolves D into the next chord', () => {
    for (const brick of ACG_RETURN_BRICKS) {
      expect(brick.arrival.harmonicScope).toBe(brick.function === 'D' ? 'next-chord' : 'current-chord');
    }
  });

  it('filters candidates from the RoadMap-provided rest and available token budget', () => {
    const shortT = getAcgReturnBrickCandidates({ function: 'T', precedingRestBeats: 0.8 });
    expect(shortT.map((brick) => brick.kind)).toEqual(['stable-single']);

    const roomyD = getAcgReturnBrickCandidates({ function: 'D', precedingRestBeats: 1.5, maxAudibleTokens: 2 });
    expect(roomyD.map((brick) => brick.kind).sort()).toEqual(['sigh', 'stable-single']);

    expect(getAcgReturnBrickCandidates({ function: 'S', precedingRestBeats: 4.5 })).toEqual([]);
  });

  it('maps the semantic sequence back to existing abstract grammar terminals without leaking mutable catalog tokens', () => {
    const source = ACG_RETURN_BRICKS.find((brick) => brick.id === 'acg-return-d-lift-riff');
    expect(source).toBeDefined();

    const tokens = acgReturnBrickTokens(source!);
    expect(tokens.map((token) => token.kind)).toEqual(['L', 'S', 'A', 'G']);
    expect(tokens.map((token) => token.duration)).toEqual([0.25, 0.25, 0.25, 0.75]);
    expect(tokens[2].acg).toEqual({ colorIntent: 'harmonic7' });
    expect(tokens[3].acg).toMatchObject({
      harmonicScope: 'next-chord',
      stableRoles: ['root', 'third', 'fifth'],
      dyad: { voicing: 'below-topline' },
    });

    tokens[0] = { kind: 'G', duration: 99 };
    expect(source!.tokens[0]).toMatchObject({ tokenKind: 'L', durationBeats: 0.25 });
  });

  it('expresses dyad and borrowed/modal colors as grammar-token intent, not a renderer-side ornament', () => {
    const colors = new Set(
      ACG_RETURN_BRICKS.flatMap((brick) => brick.tokens.map((token) => token.colorIntent).filter(Boolean)),
    );
    expect(colors).toEqual(new Set(['dorian6', 'harmonic7', 'phrygianb2']));

    const dyadArrivals = ACG_RETURN_BRICKS
      .flatMap((brick) => brick.tokens.filter((token) => token.role === 'arrival' && token.dyad));
    expect(dyadArrivals.length).toBeGreaterThan(0);
    for (const arrival of dyadArrivals) {
      expect(arrival.dyad!.voicing).toBe('below-topline');
      expect(arrival.dyad!.partnerRoles.length).toBeGreaterThan(0);
      expect(arrival.dyad!.preferredIntervals.length).toBeGreaterThan(0);
    }
  });
});
