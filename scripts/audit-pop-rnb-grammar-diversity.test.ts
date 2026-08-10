import { describe, expect, it } from 'vitest';
import { buildSongBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import type { Grammar } from '../src/core/generation/newEngine/knowledge/melodyGrammarTypes';
import {
  POP_ENRICHED_GRAMMAR,
  RNB_ENRICHED_GRAMMAR,
} from '../src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles';
import {
  expandGrammarForBrick,
  type GrammarExpansionTraceEvent,
} from '../src/core/generation/newEngine/render/mgGrammarRuntime';
import { buildMgLeadRoadMap } from '../src/core/generation/newEngine/render/mgLeadRenderer';
import { makeSeededRng } from '../src/core/generation/newEngine/render/mgRng';

interface DiversityAuditResult {
  expansionCount: number;
  eligibleCoverage: number;
  selectedRuleCount: number;
  selectedRhsCount: number;
  topSourceShare: number;
  topSource: string;
  topRhsShare: number;
  topRhsSource: string;
  topRhsFamily: string;
  signatureCountByFamily: Readonly<Record<string, number>>;
}

function topEntry(counts: ReadonlyMap<string, number>): readonly [string, number] {
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? ['', 0];
}

function audibleRhsSignature(tokens: readonly { kind: string; duration: number }[]): string {
  return JSON.stringify(tokens.filter(token => token.duration > 0));
}

function auditStyle(
  style: 'pop' | 'rnb',
  grammar: Grammar,
): DiversityAuditResult {
  const phraseRules = grammar.rulesByLhs.get(grammar.start) ?? [];
  const eligibleRuleIndices = new Set<number>();
  const selectedRuleIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const rhsCounts = new Map<string, number>();
  const sourceCountsByRhs = new Map<string, Map<string, number>>();
  const familyCountsByRhs = new Map<string, Map<string, number>>();
  const signaturesByFamily = new Map<string, Set<string>>();
  let expansionCount = 0;

  for (let seed = 0; seed < 200; seed++) {
    const bundle = buildSongBundle({
      seed,
      styleHint: style,
      mood: 'grammar diversity audit',
      targetDuration: 120,
    });
    const roadMap = buildMgLeadRoadMap(bundle.harmonic, bundle.band, bundle.timebase);
    const rng = makeSeededRng(seed);

    for (const brick of roadMap.bricks) {
      for (let index = 0; index < phraseRules.length; index++) {
        const families = phraseRules[index].conditions?.brickFamily;
        if (!families || families.includes(brick.family)) eligibleRuleIndices.add(index);
      }

      let selected: Extract<GrammarExpansionTraceEvent, { type: 'rule-selected' }> | undefined;
      const tokens = expandGrammarForBrick(grammar, {
        brick,
        rng,
        trace: (event) => {
          if (event.type === 'rule-selected' && event.symbol === grammar.start) selected = event;
        },
      });
      if (!selected) continue;
      const rhsSignature = audibleRhsSignature(tokens);
      expansionCount++;
      selectedRuleIds.add(selected.sourceRuleId);
      sourceCounts.set(selected.sourceName, (sourceCounts.get(selected.sourceName) ?? 0) + 1);
      rhsCounts.set(rhsSignature, (rhsCounts.get(rhsSignature) ?? 0) + 1);
      const rhsSources = sourceCountsByRhs.get(rhsSignature) ?? new Map<string, number>();
      rhsSources.set(selected.sourceName, (rhsSources.get(selected.sourceName) ?? 0) + 1);
      sourceCountsByRhs.set(rhsSignature, rhsSources);
      const rhsFamilies = familyCountsByRhs.get(rhsSignature) ?? new Map<string, number>();
      rhsFamilies.set(brick.family, (rhsFamilies.get(brick.family) ?? 0) + 1);
      familyCountsByRhs.set(rhsSignature, rhsFamilies);
      const familySignatures = signaturesByFamily.get(brick.family) ?? new Set<string>();
      familySignatures.add(rhsSignature);
      signaturesByFamily.set(brick.family, familySignatures);
    }
  }

  const [topSource, topSourceCount] = topEntry(sourceCounts);
  const [topRhsSignature, topRhsCount] = topEntry(rhsCounts);
  return {
    expansionCount,
    eligibleCoverage: eligibleRuleIndices.size / phraseRules.length,
    selectedRuleCount: selectedRuleIds.size,
    selectedRhsCount: rhsCounts.size,
    topSourceShare: topSourceCount / expansionCount,
    topSource,
    topRhsShare: topRhsCount / expansionCount,
    topRhsSource: topEntry(sourceCountsByRhs.get(topRhsSignature) ?? new Map())[0],
    topRhsFamily: topEntry(familyCountsByRhs.get(topRhsSignature) ?? new Map())[0],
    signatureCountByFamily: Object.fromEntries(
      [...signaturesByFamily.entries()].map(([family, signatures]) => [family, signatures.size]),
    ),
  };
}

describe('POP/RNB production Grammar/Slope family diversity audit', () => {
  it('keeps broad family eligibility while limiting source and exact-RHS dominance', () => {
    const pop = auditStyle('pop', POP_ENRICHED_GRAMMAR);
    const rnb = auditStyle('rnb', RNB_ENRICHED_GRAMMAR);
    console.info('[grammar-diversity]', JSON.stringify({ pop, rnb }, null, 2));

    expect(pop.eligibleCoverage).toBeGreaterThan(0.9);
    // The old 558 selected IDs represented only 473 distinct audible RHS
    // shapes. Duplicate IDs are deliberately folded now, so coverage is
    // compared in the post-fold unit that listeners can actually distinguish.
    expect(pop.selectedRhsCount).toBeGreaterThanOrEqual(473);
    expect(pop.selectedRuleCount).toBeGreaterThanOrEqual(pop.selectedRhsCount);
    expect(pop.topSourceShare).toBeLessThanOrEqual(0.3);
    expect(pop.topRhsShare).toBeLessThanOrEqual(0.03);

    expect(rnb.eligibleCoverage).toBeGreaterThan(0.9);
    // The old 907 selected IDs represented 785 distinct audible RHS shapes.
    expect(rnb.selectedRhsCount).toBeGreaterThanOrEqual(785);
    expect(rnb.selectedRuleCount).toBeGreaterThanOrEqual(rnb.selectedRhsCount);
    expect(rnb.topSourceShare).toBeLessThanOrEqual(0.3);
    expect(rnb.topRhsShare).toBeLessThanOrEqual(0.025);

    for (const [style, result] of [['POP', pop], ['RNB', rnb]] as const) {
      for (const family of ['GenDom', 'Cadence', 'Turnaround']) {
        expect(result.signatureCountByFamily[family] ?? 0, `${style} ${family}`).toBeGreaterThan(10);
      }
    }
  }, 120_000);
});
