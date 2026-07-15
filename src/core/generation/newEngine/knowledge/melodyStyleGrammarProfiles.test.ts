import { describe, expect, it } from 'vitest';
import { expandGrammarForRoadMap } from '../render/mgGrammarRuntime';
import { makeSeededRng } from '../render/mgRng';
import {
  ENRICHED_GRAMMAR,
  ENRICHED_GRAMMAR_RULE_COUNT,
  JAZZ_SAX_DEXTER_GORDON_GRAMMAR,
  JAZZ_SAX_DEXTER_GORDON_GRAMMAR_RULE_COUNT,
  LOFI_ENRICHED_GRAMMAR,
  POP_ENRICHED_GRAMMAR,
  RNB_ENRICHED_GRAMMAR,
} from './melodyStyleGrammarProfiles';
import type { BrickMatch } from '../render/mgRoadMapParser';

const PERFECT_CADENCE: BrickMatch = {
  name: 'Perfect-Cadence',
  family: 'Cadence',
  startBeat: 0,
  durationBeats: 8,
  chordIndices: [0, 1],
  keyPc: 0,
  cost: -0.6,
};

function audibleTokenSignature(tokens: readonly { kind: string; duration: number; degree?: string | number }[]): string {
  return tokens
    .filter((token) => token.duration > 0)
    .slice(0, 10)
    .map((token) => `${token.kind}${token.degree ? `:${token.degree}` : ''}/${token.duration}`)
    .join(' ');
}

const STYLE_GRAMMARS = [
  ['JAZZ', ENRICHED_GRAMMAR],
  ['POP', POP_ENRICHED_GRAMMAR],
  ['LOFI', LOFI_ENRICHED_GRAMMAR],
  ['ACG', LOFI_ENRICHED_GRAMMAR],
  ['RNB', RNB_ENRICHED_GRAMMAR],
] as const;

function eligiblePhraseRules(grammar: typeof ENRICHED_GRAMMAR, brick: BrickMatch) {
  return (grammar.rulesByLhs.get('Phrase') ?? []).filter((rule) => {
    const conditions = rule.conditions;
    if (!conditions) return true;
    if (conditions.brickFamily && !conditions.brickFamily.includes(brick.family)) return false;
    if (conditions.brickName && !conditions.brickName.includes(brick.name)) return false;
    if (conditions.minDuration !== undefined && brick.durationBeats < conditions.minDuration) return false;
    if (conditions.maxDuration !== undefined && brick.durationBeats > conditions.maxDuration) return false;
    return true;
  });
}

describe('knowledge/melodyStyleGrammarProfiles · opening diversity', () => {
  it.each(STYLE_GRAMMARS)('%s cadence opening is not dominated by one soft-parallel favorite phrase', (_style, grammar) => {
    const signatures = new Map<string, number>();

    for (let seed = 0; seed < 80; seed++) {
      const [expanded] = expandGrammarForRoadMap(grammar, [PERFECT_CADENCE], makeSeededRng(seed));
      const signature = audibleTokenSignature(expanded.tokens);
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }

    const topCount = Math.max(...signatures.values());
    expect(signatures.size).toBeGreaterThanOrEqual(40);
    expect(topCount).toBeLessThanOrEqual(16);
  });

  it.each(STYLE_GRAMMARS)('%s cadence weight table keeps favorite signature below dominance threshold', (_style, grammar) => {
    const rules = eligiblePhraseRules(grammar, PERFECT_CADENCE);
    const totalWeight = rules.reduce((sum, rule) => sum + Math.max(0, rule.weight), 0);
    const weightBySignature = new Map<string, number>();

    for (const rule of rules) {
      const key = JSON.stringify(rule.rhs);
      weightBySignature.set(key, (weightBySignature.get(key) ?? 0) + Math.max(0, rule.weight));
    }

    const maxSignatureShare = Math.max(...weightBySignature.values()) / totalWeight;
    expect(maxSignatureShare).toBeLessThanOrEqual(0.16);
  });

  it('Jazz sax audition grammar is scoped to Dexter Gordon Impro-Visor source rules', () => {
    const phraseRules = JAZZ_SAX_DEXTER_GORDON_GRAMMAR.rulesByLhs.get('Phrase') ?? [];
    const sourceRules = phraseRules.filter((rule) => rule.metadata?.sourceRuleId);
    const dexterRules = sourceRules.filter((rule) =>
      String(rule.metadata?.sourceRuleId).startsWith('DexterGordon_')
      && rule.metadata?.styleTags?.includes('dexter_gordon')
    );

    expect(JAZZ_SAX_DEXTER_GORDON_GRAMMAR_RULE_COUNT).toBeGreaterThan(40);
    expect(JAZZ_SAX_DEXTER_GORDON_GRAMMAR_RULE_COUNT).toBeLessThan(ENRICHED_GRAMMAR_RULE_COUNT);
    expect(sourceRules.length).toBe(dexterRules.length);
    expect(dexterRules.length).toBeGreaterThan(20);
  });
});
