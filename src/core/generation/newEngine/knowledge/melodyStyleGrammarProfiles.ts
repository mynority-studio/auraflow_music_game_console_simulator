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

import { makeGrammar, type Grammar, type GrammarRule } from './melodyGrammarTypes';
import { BUILTIN_RULES } from './melodyBuiltinGrammar';
import {
  jazzSlopeRulesToGrammarRules,
  lofiStableSlopeRulesToGrammarRules,
  popStableSlopeRulesToGrammarRules,
  rnbSoulSlopeRulesToGrammarRules,
  softParallelFavoriteSlopeRulesToGrammarRules,
  sourceSlopeRulesToGrammarRules,
  acgPianoSongSlopeRulesToGrammarRules,
  type AcgPianoSongGrammarSubset,
} from './melodySlopeAdapter';

const JAZZ_SLOPE_RULES = jazzSlopeRulesToGrammarRules();
const JAZZ_SAX_DEXTER_GORDON_SLOPE_RULES = sourceSlopeRulesToGrammarRules(['DexterGordon'], {
  styleTags: ['jazz_sax_source', 'dexter_gordon'],
  weightMultiplier: 1.35,
});

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
const JAZZ_SAX_DEXTER_GORDON_RULES = [...BUILTIN_RULES, ...JAZZ_SAX_DEXTER_GORDON_SLOPE_RULES];
const POP_ALL_RULES = [...POP_SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...POP_SLOPE_RULES];
const LOFI_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...LOFI_SLOPE_RULES];
// ACG PIANOSONG 是“从既有相邻语料中挑选 + 标注”，不是另造一套假 corpus。
// 这保留 LOFI/电影钢琴共有的留白与 cantabile，同时额外启用可审计的上行
// 落点、broken-chord motion 与调式色彩。返场仍由 acgReturnGrammar + scheduler
// 结合 RoadMap/TSD 实化，绝不在 NoteIR 后期补音。
function tagAcgPianoSongRules(rules: readonly GrammarRule[], tags: readonly string[]): GrammarRule[] {
  return rules.map((rule) => ({
    ...rule,
    metadata: {
      ...rule.metadata,
      styleTags: [...new Set([...(rule.metadata?.styleTags ?? []), ...tags])],
    },
  }));
}

const ACG_PIANOSONG_CORE_RULES = tagAcgPianoSongRules(BUILTIN_RULES, [
  'acg_pianosong_pool',
  'acg_pianosong_core_contract',
]);
// Keep the former shared favorite as one recognised color, but remove its old
// cross-style dominance.  ACG now gains variation from the labelled pool
// below rather than repeatedly opening with this single crawl.
const ACG_PIANOSONG_PARALLEL_FAVORITE_RULES = tagAcgPianoSongRules(
  softParallelFavoriteSlopeRulesToGrammarRules(3.2),
  ['acg_pianosong_pool', 'acg_pianosong_parallel_favorite'],
);
const ACG_PIANOSONG_SLOPE_RULES = acgPianoSongSlopeRulesToGrammarRules();
const ACG_PIANOSONG_RULES = [
  ...ACG_PIANOSONG_PARALLEL_FAVORITE_RULES,
  ...ACG_PIANOSONG_CORE_RULES,
  ...ACG_PIANOSONG_SLOPE_RULES,
];

type AcgPianoSongInternalSubset = Exclude<AcgPianoSongGrammarSubset, 'all'>;

const ACG_PIANOSONG_INTERNAL_SUBSET_RULES: Record<AcgPianoSongInternalSubset, GrammarRule[]> = {
  'intro-breath': [
    ...ACG_PIANOSONG_PARALLEL_FAVORITE_RULES,
    ...ACG_PIANOSONG_CORE_RULES,
    ...acgPianoSongSlopeRulesToGrammarRules('intro-breath'),
  ],
  'cantabile-theme': [
    ...ACG_PIANOSONG_CORE_RULES,
    ...acgPianoSongSlopeRulesToGrammarRules('cantabile-theme'),
  ],
  'ascending-lift': [
    ...ACG_PIANOSONG_CORE_RULES,
    ...acgPianoSongSlopeRulesToGrammarRules('ascending-lift'),
  ],
  'modal-color': [
    ...ACG_PIANOSONG_CORE_RULES,
    ...acgPianoSongSlopeRulesToGrammarRules('modal-color'),
  ],
  'cadential-return': [
    ...ACG_PIANOSONG_CORE_RULES,
    ...acgPianoSongSlopeRulesToGrammarRules('cadential-return'),
  ],
};

/**
 * Internal ACG grammar banks.  They are intentionally not StyleName/UI
 * values: the production lead renderer derives one from RoadMap position and
 * harmonic brick identity, then consumes it through the normal grammar
 * runtime.  This gives the middle of a cue a different arrangement vocabulary
 * without exposing a new user-facing genre switch.
 */
export const ACG_PIANOSONG_INTERNAL_GRAMMARS: Record<AcgPianoSongInternalSubset, Grammar> = {
  'intro-breath': makeGrammar(ACG_PIANOSONG_INTERNAL_SUBSET_RULES['intro-breath'], 'Phrase'),
  'cantabile-theme': makeGrammar(ACG_PIANOSONG_INTERNAL_SUBSET_RULES['cantabile-theme'], 'Phrase'),
  'ascending-lift': makeGrammar(ACG_PIANOSONG_INTERNAL_SUBSET_RULES['ascending-lift'], 'Phrase'),
  'modal-color': makeGrammar(ACG_PIANOSONG_INTERNAL_SUBSET_RULES['modal-color'], 'Phrase'),
  'cadential-return': makeGrammar(ACG_PIANOSONG_INTERNAL_SUBSET_RULES['cadential-return'], 'Phrase'),
};

export const ACG_PIANOSONG_INTERNAL_GRAMMAR_RULE_COUNTS: Record<AcgPianoSongInternalSubset, number> = {
  'intro-breath': ACG_PIANOSONG_INTERNAL_SUBSET_RULES['intro-breath'].length,
  'cantabile-theme': ACG_PIANOSONG_INTERNAL_SUBSET_RULES['cantabile-theme'].length,
  'ascending-lift': ACG_PIANOSONG_INTERNAL_SUBSET_RULES['ascending-lift'].length,
  'modal-color': ACG_PIANOSONG_INTERNAL_SUBSET_RULES['modal-color'].length,
  'cadential-return': ACG_PIANOSONG_INTERNAL_SUBSET_RULES['cadential-return'].length,
};

export interface AcgPianoSongGrammarContext {
  startBeat: number;
  durationBeats?: number;
  family?: string;
  name?: string;
}

/**
 * A deterministic, internal arrangement selector.  Early material prioritises
 * breath; later cadential/turnaround material periodically calls the upward
 * lift bank, so ACG does not repeat one intro-shaped cadence through the
 * entire 1–2 minute cue.
 */
export function acgPianoSongInternalSubsetForContext(
  context: AcgPianoSongGrammarContext,
): AcgPianoSongInternalSubset {
  const startBeat = Math.max(0, context.startBeat || 0);
  const family = String(context.family ?? '');
  const name = String(context.name ?? '');
  const isCadential = family === 'Cadence' || /Cadence|Ending|Amen|Plagal/i.test(name);
  const isLiftFunction = family === 'Launcher' || family === 'Turnaround' || family === 'Dropback'
    || /Launcher|Turnaround|Dropback|Approach/i.test(name);
  const isColorFunction = family === 'Borrowed' || family === 'GenDom'
    || /Borrowed|Color|Surge|Side-Slip/i.test(name);

  if (startBeat < 8) return 'intro-breath';
  if (isColorFunction) return 'modal-color';
  if (isLiftFunction) return 'ascending-lift';
  if (isCadential) {
    // Later cadence bricks alternate source vocabulary by phrase window while
    // their actual phrase choice remains seed-random inside each pool.
    return startBeat >= 16 && Math.floor(startBeat / 8) % 2 === 0
      ? 'ascending-lift'
      : 'cadential-return';
  }
  if (startBeat >= 16 && Math.floor(startBeat / 8) % 3 === 2) return 'ascending-lift';
  return 'cantabile-theme';
}

export function acgPianoSongGrammarForContext(context: AcgPianoSongGrammarContext): Grammar {
  return ACG_PIANOSONG_INTERNAL_GRAMMARS[acgPianoSongInternalSubsetForContext(context)];
}

export type { AcgPianoSongGrammarSubset } from './melodySlopeAdapter';
const RNB_ALL_RULES = [...SOFT_PARALLEL_FAVORITE_RULES, ...BUILTIN_RULES, ...RNB_SLOPE_RULES];

export const ENRICHED_GRAMMAR = makeGrammar(ALL_RULES, 'Phrase');
export const JAZZ_SAX_DEXTER_GORDON_GRAMMAR = makeGrammar(JAZZ_SAX_DEXTER_GORDON_RULES, 'Phrase');
export const POP_ENRICHED_GRAMMAR = makeGrammar(POP_ALL_RULES, 'Phrase');
export const LOFI_ENRICHED_GRAMMAR = makeGrammar(LOFI_ALL_RULES, 'Phrase');
export const ACG_PIANOSONG_GRAMMAR = makeGrammar(ACG_PIANOSONG_RULES, 'Phrase');
export const RNB_ENRICHED_GRAMMAR = makeGrammar(RNB_ALL_RULES, 'Phrase');

/** Total rule count for diagnostics. */
export const ENRICHED_GRAMMAR_RULE_COUNT = ALL_RULES.length;
export const JAZZ_SAX_DEXTER_GORDON_GRAMMAR_RULE_COUNT = JAZZ_SAX_DEXTER_GORDON_RULES.length;
export const POP_ENRICHED_GRAMMAR_RULE_COUNT = POP_ALL_RULES.length;
export const LOFI_ENRICHED_GRAMMAR_RULE_COUNT = LOFI_ALL_RULES.length;
export const ACG_PIANOSONG_GRAMMAR_RULE_COUNT = ACG_PIANOSONG_RULES.length;
export const RNB_ENRICHED_GRAMMAR_RULE_COUNT = RNB_ALL_RULES.length;
