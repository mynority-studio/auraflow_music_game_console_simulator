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
import { BUILTIN_RULES } from './melodyBuiltinGrammar';
import { jazzSlopeRulesToGrammarRules, lofiStableSlopeRulesToGrammarRules, popStableSlopeRulesToGrammarRules, rnbSoulSlopeRulesToGrammarRules, softParallelFavoriteSlopeRulesToGrammarRules } from './melodySlopeAdapter';

const JAZZ_SLOPE_RULES = jazzSlopeRulesToGrammarRules();
const LOFI_SLOPE_RULES = lofiStableSlopeRulesToGrammarRules();
const POP_SLOPE_RULES = popStableSlopeRulesToGrammarRules();
const RNB_SLOPE_RULES = rnbSoulSlopeRulesToGrammarRules();
// ★ 产品语义分叉(2026-07-02):softParallel favorite 只作为风味候选,不能作为任何 style 的
// Cadence 超级权重。4096 boost 会让 Surprise-Major-Cadence 的同签名副本吞掉
// Perfect/Amen/Diatonic 等不同 Cadence brick,压住 seed 随机性与 family 内部细分。
// ★ 黄金种子 SLOPE 权重降 30%(2026-07-03,用户):16→11.2(jazz/lofi/rnb)· 8→5.6(pop),进一步弱化 favorite 主导。
const SOFT_PARALLEL_FAVORITE_RULES = softParallelFavoriteSlopeRulesToGrammarRules(11.2);
// POP 不能沿用 LOFI 级别的 4096 boost:该规则源自 Surprise-Major-Cadence,但转换后只按
// Cadence family 匹配,会压过 Perfect/Amen/Diatonic 等所有 POP 开头终止式。
const POP_SOFT_PARALLEL_FAVORITE_RULES = softParallelFavoriteSlopeRulesToGrammarRules(5.6);
const ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...JAZZ_SLOPE_RULES];
const POP_ALL_RULES = [...POP_SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...POP_SLOPE_RULES];
const LOFI_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...LOFI_SLOPE_RULES];
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
