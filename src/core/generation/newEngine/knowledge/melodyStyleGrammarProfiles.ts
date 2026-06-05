// ============================================================
// newEngine · knowledge · MelodyStyleGrammarProfiles(MG strict 移植:EnrichedGrammar)
// Provenance: ../melodygenerative/src/lib/improvisor/EnrichedGrammar.ts 忠实港(cp + 改 import)。
// BUILTIN_RULES + slope 转换 → ENRICHED/POP/LOFI/RNB_ENRICHED_GRAMMAR(生产用 per-style 语法)。
// ============================================================

// EnrichedGrammar.ts — Builtin rules + imported IV slope rules merged.
// This is the default grammar consumed by generateImprovisorMelody.
//
// Composition:
//   - BUILTIN_RULES (~22): project-original cadence/turnaround/blues
//     templates. Small but cover all 8 brick families with weight 1-2.
//   - slope rules: IV's BillEvans/Lovano/Heath/Perry .grammar
//     authored patterns. Each has its own IV-authored weight.
//   - soft-parallel favorite rules: the crawl/hold slope shape behind
//     `lofi_uhloiw` bar 5-6, prepended for all styles.
//
// Builtin rules act as "fallback" when no slope rule's duration window
// matches the current brick; slope rules dominate by sheer count + weight
// when their window fits.

import { makeGrammar } from './melodyGrammarTypes';
import type { GrammarRule } from './melodyGrammarTypes';
import { BUILTIN_RULES } from './melodyBuiltinGrammar';
import { jazzSlopeRulesToGrammarRules, lofiStableSlopeRulesToGrammarRules, popStableSlopeRulesToGrammarRules, rnbSoulSlopeRulesToGrammarRules, softParallelFavoriteSlopeRulesToGrammarRules } from './melodySlopeAdapter';

const LOFI_VAMP_RULES: GrammarRule[] = [
  {
    lhs: 'Phrase',
    weight: 96,
    conditions: { brickFamily: ['Borrowed', 'Minor-On', 'Major-On'] },
    rhs: ['LofiVampLine'],
    metadata: { styleTags: ['lofi_pool', 'lofi_vamp_friendly', 'lofi_rest_space', 'lofi_color_hold'] },
  },
  {
    lhs: 'LofiVampLine',
    weight: 3,
    rhs: [
      { kind: 'C', duration: 1.0 },
      { kind: 'R', duration: 0.5 },
      { kind: 'L', duration: 0.5 },
      { kind: 'C', duration: 1.5 },
      { kind: 'R', duration: 0.5 },
    ],
    metadata: { styleTags: ['lofi_pool', 'lofi_vamp_friendly', 'lofi_rest_space'] },
  },
  {
    lhs: 'LofiVampLine',
    weight: 2,
    rhs: [
      { kind: 'C', duration: 1.0 },
      { kind: 'L', duration: 0.5 },
      { kind: 'C', duration: 0.5 },
      { kind: 'R', duration: 0.5 },
      { kind: 'L', duration: 1.0 },
      { kind: 'R', duration: 0.5 },
    ],
    metadata: { styleTags: ['lofi_pool', 'lofi_vamp_friendly', 'lofi_color_hold'] },
  },
  {
    lhs: 'LofiVampLine',
    weight: 2,
    rhs: [
      { kind: 'R', duration: 0.5 },
      { kind: 'C', duration: 0.5 },
      { kind: 'L', duration: 0.5 },
      { kind: 'C', duration: 0.5 },
      { kind: 'L', duration: 1.5 },
      { kind: 'R', duration: 0.5 },
    ],
    metadata: { styleTags: ['lofi_pool', 'lofi_vamp_friendly', 'lofi_rest_space', 'lofi_color_hold'] },
  },
];

const JAZZ_SLOPE_RULES = jazzSlopeRulesToGrammarRules();
const LOFI_SLOPE_RULES = lofiStableSlopeRulesToGrammarRules();
const POP_SLOPE_RULES = popStableSlopeRulesToGrammarRules();
const RNB_SLOPE_RULES = rnbSoulSlopeRulesToGrammarRules();
const SOFT_PARALLEL_FAVORITE_RULES = softParallelFavoriteSlopeRulesToGrammarRules();
const ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...JAZZ_SLOPE_RULES];
const POP_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...POP_SLOPE_RULES];
const LOFI_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...LOFI_VAMP_RULES, ...BUILTIN_RULES, ...LOFI_SLOPE_RULES];
const RNB_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...RNB_SLOPE_RULES];

export const ENRICHED_GRAMMAR = makeGrammar(ALL_RULES, 'Phrase');
export const POP_ENRICHED_GRAMMAR = makeGrammar(POP_ALL_RULES, 'Phrase');
export const LOFI_ENRICHED_GRAMMAR = makeGrammar(LOFI_ALL_RULES, 'Phrase');
export const RNB_ENRICHED_GRAMMAR = makeGrammar(RNB_ALL_RULES, 'Phrase');

/** Total rule count for diagnostics. */
export const ENRICHED_GRAMMAR_RULE_COUNT = ALL_RULES.length;
export const POP_ENRICHED_GRAMMAR_RULE_COUNT = POP_ALL_RULES.length;
export const LOFI_ENRICHED_GRAMMAR_RULE_COUNT = LOFI_ALL_RULES.length;
export const RNB_ENRICHED_GRAMMAR_RULE_COUNT = RNB_ALL_RULES.length;
