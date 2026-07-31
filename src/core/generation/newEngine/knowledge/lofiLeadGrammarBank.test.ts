import { describe, expect, it } from 'vitest';
import { makeGrammar, type GrammarRule } from './melodyGrammarTypes';
import { LOFI_ENRICHED_GRAMMAR } from './melodyStyleGrammarProfiles';
import {
  buildLofiLeadGrammarBank,
  isLofiLeadGrammarRuleSafe,
  lofiLeadGrammarForRole,
  selectLofiLeadGrammarRules,
  type LofiLeadGrammarRole,
} from './lofiLeadGrammarBank';

const ROLES: readonly LofiLeadGrammarRole[] = [
  'statement-carrier',
  'answer-riff',
  'connected-crawl',
  'approach-target',
  'return-hold',
  'release',
];

function tags(rule: GrammarRule): readonly string[] {
  return rule.metadata?.lofiTags ?? [];
}

describe('knowledge/lofiLeadGrammarBank', () => {
  it('selects only existing, LOFI-tagged phrase rules and exposes every semantic role', () => {
    const bank = buildLofiLeadGrammarBank(LOFI_ENRICHED_GRAMMAR);
    expect(Object.keys(bank.selections).sort()).toEqual([...ROLES].sort());

    for (const role of ROLES.filter((value) => value !== 'release')) {
      const selected = bank.selections[role];
      expect(selected.rules.length, role).toBeGreaterThan(0);
      for (const rule of selected.rules) {
        expect(LOFI_ENRICHED_GRAMMAR.rulesByLhs.get('Phrase')).toContain(rule);
        expect(tags(rule).length).toBeGreaterThan(0);
        expect(isLofiLeadGrammarRuleSafe(rule)).toBe(true);
      }
    }
  });

  it('keeps short crawls and chromatic-neighbour vocabulary out of standalone roles', () => {
    const bank = buildLofiLeadGrammarBank(LOFI_ENRICHED_GRAMMAR);
    for (const role of ['statement-carrier', 'answer-riff', 'return-hold'] as const) {
      for (const rule of bank.selections[role].rules) {
        expect(tags(rule)).not.toContain('lofi_short_crawl');
        expect(tags(rule)).not.toContain('lofi_chromatic_neighbor');
        expect(tags(rule)).not.toContain('lofi_star_crawl');
      }
    }

    const crawl = bank.selections['connected-crawl'];
    const approach = bank.selections['approach-target'];
    expect(crawl.requiresFollowingTarget).toBe(true);
    expect(approach.requiresFollowingTarget).toBe(true);
    expect(crawl.rules.every((rule) => tags(rule).includes('lofi_short_crawl'))).toBe(true);
    expect(approach.rules.every((rule) => tags(rule).includes('lofi_chromatic_neighbor'))).toBe(true);
  });

  it('filters tagged dense rules instead of trusting tags alone', () => {
    const safe: GrammarRule = {
      lhs: 'Phrase',
      weight: 1,
      metadata: { lofiTags: ['lofi_hold_answer'] },
      rhs: [{ kind: 'C', duration: 2 }],
    };
    const busy: GrammarRule = {
      lhs: 'Phrase',
      weight: 1,
      metadata: { lofiTags: ['lofi_hold_answer'] },
      rhs: [
        { kind: 'C', duration: 0.125 },
        { kind: 'S', duration: 0.125 },
        { kind: 'L', duration: 0.125 },
        { kind: 'C', duration: 0.125 },
        { kind: 'S', duration: 0.125 },
      ],
    };
    const grammar = makeGrammar([safe, busy], 'Phrase');

    expect(isLofiLeadGrammarRuleSafe(safe)).toBe(true);
    expect(isLofiLeadGrammarRuleSafe(busy)).toBe(false);
    expect(selectLofiLeadGrammarRules('statement-carrier', grammar).rules).toEqual([safe]);
  });

  it('uses an explicit, deterministic release instead of forcing a phrase fallback', () => {
    const first = selectLofiLeadGrammarRules('release', LOFI_ENRICHED_GRAMMAR);
    const second = selectLofiLeadGrammarRules('release', LOFI_ENRICHED_GRAMMAR);
    expect(first).toEqual(second);
    expect(first.rules).toEqual([]);
    expect(first.fallback).toBe('explicit-release');
    expect(first.requiresExplicitRelease).toBe(true);
    expect(lofiLeadGrammarForRole('release', LOFI_ENRICHED_GRAMMAR)).toBeUndefined();
  });

  it('falls back to an existing diatonic connector when a context has no chromatic candidate', () => {
    const diatonicConnector: GrammarRule = {
      lhs: 'Phrase',
      weight: 1,
      metadata: { lofiTags: ['lofi_crawl_hold'] },
      conditions: { brickFamily: ['Major-On'] },
      rhs: [
        { kind: 'A', duration: 0.5 },
        { kind: 'C', duration: 1 },
      ],
    };
    const grammar = makeGrammar([diatonicConnector], 'Phrase');
    const selection = selectLofiLeadGrammarRules('approach-target', grammar, {
      family: 'Major-On',
      durationBeats: 2,
    });

    expect(selection.rules).toEqual([diatonicConnector]);
    expect(selection.fallback).toBe('diatonic-connector');
    expect(selection.requiresFollowingTarget).toBe(true);
  });

  it('keeps a role grammar on the normal Grammar interface and is deterministic', () => {
    const one = lofiLeadGrammarForRole('return-hold', LOFI_ENRICHED_GRAMMAR);
    const two = lofiLeadGrammarForRole('return-hold', LOFI_ENRICHED_GRAMMAR);
    expect(one).toBeDefined();
    expect([...one!.rulesByLhs.get('Phrase') ?? []]).toEqual([...two!.rulesByLhs.get('Phrase') ?? []]);
    expect(one!.rulesByLhs.get('Phrase')!.length).toBeGreaterThan(0);
  });
});
