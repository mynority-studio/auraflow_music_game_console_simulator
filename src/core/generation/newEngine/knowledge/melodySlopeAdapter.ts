// SlopeAdapter.ts — Convert imported IV slope rules (improvisorSlopes.ts) into
// GrammarRule[] consumable by GrammarRuntime.
//
// Per spec §1 "stop using IV lick pool AS final motif池" — but the
// GPL-2 license we adopted allows reading IV's slope (abstract grammar)
// rules. We re-encode each slope rule into our AbstractMelodyToken
// alphabet and register at lhs='Phrase' with brickFamily conditions.
// IV's CLAX terminals map directly to ours:
//   C → C    L → L    A → A    X → X    R → R
//   S → S    N → R
//   H → H (helpful color, distinct kind — same pool as L, future-divergent)
//   G → G (goal — chord 3 + 7 guide tones)
//   B → B (bass — chord root)
//
// brickType → BrickFamily mapping follows IV's broad brick roles, with
// named jazz turnarounds/cadences routed before generic dominant/color
// tests so imported rules fire in the same harmonic neighborhood.
//
// Token duration matching: each slope rule retains its authored total duration
// (sum of token d's). Family-only style grammars use it as a soft fit weight;
// their scheduler owns repeat/rest-fill/clip adaptation after selection.

import { IMPROVISOR_SLOPES, type ImprovisorSlopeRule, type SlopeNote, type FlatToken } from './melodySlopeCorpus';
import type { GrammarRule, AbstractMelodyToken } from './melodyGrammarTypes';
import type { BrickFamily } from './melodyBrickDictionary';
import { extractLofiSlopeFeatures, lofiSlopeWeightMultiplier, tagImprovisorSlopeRule } from './melodyLofiGrammarTags';

export interface SlopeRuleConversionOptions {
  lofiTagBias?: boolean;
  includeLofiMetadata?: boolean;
  styleTags?: string[];
  weightMultiplier?: number;
}

/**
 * ACG PIANOSONG does not need a second, invented lick corpus: its lyrical
 * piano vocabulary overlaps the quiet/cantabile portion of the existing
 * Impro-Visor + LOFI-compatible pool.  These labels make that reuse explicit
 * and give the ACG renderer internal, non-UI pools to choose from.
 *
 * They are metadata only.  Pitch, harmonic contracts and note realization
 * remain owned by the normal grammar → scheduler → realizer chain.
 */
export type AcgPianoSongGrammarTag =
  | 'acg_pianosong_pool'
  | 'acg_pianosong_lofi_compatible'
  | 'acg_pianosong_breath'
  | 'acg_pianosong_cantabile'
  | 'acg_pianosong_lyrical_answer'
  | 'acg_pianosong_ascending_arrival'
  | 'acg_pianosong_broken_chord_motion'
  | 'acg_pianosong_modal_color'
  | 'acg_pianosong_cadential_return'
  | 'acg_pianosong_mid_variation';

/** Internal arrangement-facing pools; never a user-selectable style. */
export type AcgPianoSongGrammarSubset =
  | 'all'
  | 'intro-breath'
  | 'cantabile-theme'
  | 'ascending-lift'
  | 'modal-color'
  | 'cadential-return';

function isBebopSourceRule(rule: ImprovisorSlopeRule): boolean {
  return /CharlieParker/i.test(rule.source) || /CharlieParker/i.test(rule.id);
}

function isJazzSpecialSourceRule(rule: ImprovisorSlopeRule): boolean {
  return /(CharlieParker|JohnColtrane)/i.test(rule.source)
    || /(CharlieParker|JohnColtrane)/i.test(rule.id);
}

function isJazzOnlyBrickType(brickType: string): boolean {
  return /(Giant|Donna|Yardbird|Dominant-Cycle|Rhythm-Bridge|SPOT|Tension|Supertension|Side-Slips|Dizzy|Dogleg|Stablemates|Starlight|Bauble|Nowhere)/i
    .test(brickType);
}

function isDenseJazzRunRule(rule: ImprovisorSlopeRule): boolean {
  const features = extractLofiSlopeFeatures(rule);
  const audibleDensity = features.audibleDuration > 0
    ? features.audibleTokenCount / features.audibleDuration
    : features.audibleTokenCount;
  const hasTripletOrSubSixteenth = features.shortestDuration > 0 && features.shortestDuration < 0.25;
  const longUnbrokenSixteenthRun = features.maxConsecutiveShortAudibleCount > 4;
  const denseChromaticRun = features.chromaticTokenCount >= 3 && audibleDensity >= 2.0;
  const denseNoLandingRun = audibleDensity > 2.45 && features.longToneCount === 0;
  const denseJazzNamedBrick = isJazzOnlyBrickType(rule.brickType) && audibleDensity > 1.75;
  return hasTripletOrSubSixteenth
    || longUnbrokenSixteenthRun
    || denseChromaticRun
    || denseNoLandingRun
    || denseJazzNamedBrick;
}

function hasAudibleBody(rule: ImprovisorSlopeRule): boolean {
  if (rule.bodyKind === 'slope') {
    return rule.slopes.some(group => group.notes.some(note => note.type !== 'R' && note.type !== 'N'));
  }
  return rule.flatTokens.some(token =>
    token.kind === 'scaleDegree'
    || (token.kind === 'abstract' && token.type !== 'R' && token.type !== 'N')
  );
}

function slopeNoteToToken(note: SlopeNote): AbstractMelodyToken {
  switch (note.type) {
    case 'C': return { kind: 'C', duration: note.d };
    case 'L': return { kind: 'L', duration: note.d };
    case 'A': return { kind: 'A', duration: note.d };
    case 'X': return { kind: 'X', duration: note.d };
    case 'R': return { kind: 'R', duration: note.d };
    case 'S': return { kind: 'S', duration: note.d };
    case 'N': return { kind: 'R', duration: note.d };  // none → R
    case 'H': return { kind: 'H', duration: note.d };  // helpful color → H
    case 'G': return { kind: 'G', duration: note.d };  // goal → G
    case 'B': return { kind: 'B', duration: note.d };  // bass → B
  }
}

/** Convert a flat-body token (from a non-slope IV rule) to our abstract
 *  melody token. Two shapes:
 *    - { kind: 'abstract', type: 'C8'... } → standard SlopeNote mapping
 *    - { kind: 'scaleDegree', degree: 'b3' } → X token with degree label */
function flatTokenToToken(ft: FlatToken): AbstractMelodyToken {
  if (ft.kind === 'abstract') {
    // Reuse slopeNoteToToken via type widening
    return slopeNoteToToken({ type: ft.type, d: ft.d, raw: ft.raw });
  }
  // scaleDegree → X token, degree carries the literal label string ("1",
  // "b3", "#4" etc.). NoteChooser's X case calls resolveDegree(String(deg))
  // which accepts both number and string labels.
  return { kind: 'X', degree: ft.degree, duration: ft.d };
}

function brickTypeToFamilies(brickType: string): BrickFamily[] {
  const name = brickType.trim();
  if (/^Major-On$/i.test(name)) return ['Major-On'];
  if (/^Minor-On$/i.test(name)) return ['Minor-On'];
  if (/Blues/i.test(name)) return ['Blues'];
  if (
    /Cadence|Ending|Amen|Plagal/i.test(name)
    || /^Giant-Steps$/i.test(name)
    || /^IV-n-Back$/i.test(name)
    || /\+On$/i.test(name)
  ) return ['Cadence'];
  if (/Launcher/i.test(name)) return ['Launcher'];
  if (/Dropback|Pullback/i.test(name)) return ['Dropback'];
  if (/Turnaround|On-Off|Off-On|(?:^|-)SPOT(?:$|-)|(?:^|-)POT(?:$|-)/i.test(name)) return ['Turnaround'];
  if (/Side-Slip|Side-Slips/i.test(name)) return ['GenDom', 'Borrowed'];
  if (/Dominant|Approach|Cycle|GenDom|SuperGenDom|Tension/i.test(name)) return ['GenDom'];
  if (/Surge|Color|Borrowed|CESH|Chromatic|Misc/i.test(name)) return ['Borrowed'];
  if (name === 'Q-fragment') {
    return ['Major-On', 'Minor-On', 'Borrowed'];
  }
  return ['Unknown'];
}

/** Convert one IV slope rule to a GrammarRule. The rule registers at
 *  lhs='Phrase' (so it competes with BuiltinGrammar's dispatch) with
 *  brickFamily + duration conditions.
 *
 *  Each (slope MIN MAX ...) group is wrapped with SlopeEnter/SlopeExit
 *  markers so LickGen can apply IV's per-step pitch-range constraint
 *  ([prev + MIN, prev + MAX]) to each note inside the group. Per
 *  LickGen.java:1991+ semantics: the inner notes' types (C/L/A/S/X)
 *  determine WHICH pitch (chord-tone / color / scale / approach), and
 *  the slope range constrains how far from prev pitch it can land. */
export function slopeRuleToGrammarRule(ivRule: ImprovisorSlopeRule, options: SlopeRuleConversionOptions = {}): GrammarRule {
  const tokens: AbstractMelodyToken[] = [];
  let totalDur = 0;
  if (ivRule.bodyKind === 'slope') {
    for (const group of ivRule.slopes) {
      // Skip wrapping when the slope is null/empty (degenerate) — no
      // marker overhead for trivial cases. Per-step constraint of a
      // single-note slope is still useful, so wrap any group with notes.
      if (group.notes.length === 0) continue;
      tokens.push({ kind: 'SlopeEnter', dirMin: group.dirMin, dirMax: group.dirMax, duration: 0 });
      for (const note of group.notes) {
        const t = slopeNoteToToken(note);
        tokens.push(t);
        totalDur += t.duration;
      }
      tokens.push({ kind: 'SlopeExit', duration: 0 });
    }
  } else {
    // bodyKind === 'flat' — no slope wrapping; tokens fire under whatever
    // slope state is active (typically none = free pitch selection).
    for (const ft of ivRule.flatTokens) {
      const t = flatTokenToToken(ft);
      tokens.push(t);
      totalDur += t.duration;
    }
  }
  const families = brickTypeToFamilies(ivRule.brickType);

  const lofiTags = options.includeLofiMetadata || options.lofiTagBias
    ? tagImprovisorSlopeRule(ivRule)
    : undefined;
  const weight = ivRule.weight
    * (options.lofiTagBias ? lofiSlopeWeightMultiplier(ivRule) : 1)
    * (options.weightMultiplier ?? 1);

  return {
    lhs: 'Phrase',
    weight,
    metadata: {
      sourceRuleId: ivRule.id,
      sourceName: ivRule.source,
      sourceBrickType: ivRule.brickType,
      authoredDurationBeats: totalDur,
      ...(lofiTags ? { lofiTags } : {}),
      ...(options.styleTags ? { styleTags: options.styleTags } : {}),
    },
    conditions: {
      brickFamily: families,
      // Legacy grammars still read this as a hard window. POP/RNB's explicit
      // family-only policy reads the authored duration as a soft fit signal,
      // then lets the token scheduler adapt the selected phrase.
      minDuration: totalDur * 0.5,
      maxDuration: totalDur * 2.0,
    },
    rhs: tokens,
  };
}

/** Build the full slope-rule grammar from all imported IV slope rules. */
export function slopeRulesToGrammarRules(options: SlopeRuleConversionOptions = {}): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(hasAudibleBody)
    .map(rule => slopeRuleToGrammarRule(rule, options));
}

/** Build a source-scoped IV grammar subset.
 *  Used when an instrument family needs phrase ownership from a real
 *  Impro-Visor soloist grammar instead of the full cross-instrument pool. */
export function sourceSlopeRulesToGrammarRules(
  sources: readonly string[],
  options: SlopeRuleConversionOptions = {},
): GrammarRule[] {
  const sourceSet = new Set(sources.map(source => source.toLowerCase()));
  return IMPROVISOR_SLOPES
    .filter(rule => sourceSet.has(rule.source.toLowerCase()))
    .filter(hasAudibleBody)
    .map(rule => slopeRuleToGrammarRule(rule, options));
}

/** Shared compatibility test for the restrained LOFI-adjacent corpus.
 * Exported so ACG PIANOSONG can label (rather than silently copy) the
 * compatible material it reuses. */
export function isLofiStableSlopeRule(rule: ImprovisorSlopeRule): boolean {
  if (!hasAudibleBody(rule)) return false;
  if (isJazzSpecialSourceRule(rule)) return false;
  if (isJazzOnlyBrickType(rule.brickType)) return false;
  const tags = tagImprovisorSlopeRule(rule);
  if (tags.includes('lofi_star_crawl')) return true;
  if (isDenseJazzRunRule(rule)) return false;
  if (tags.includes('lofi_avoid_busy') || tags.includes('lofi_avoid_large_leap')) return false;

  const features = extractLofiSlopeFeatures(rule);
  if (features.shortestDuration <= 0.25 && features.maxConsecutiveShortAudibleCount >= 4) return false;
  if (rule.brickType === 'Q-fragment' && features.shortestDuration <= 0.25) return false;
  const audibleDensity = features.audibleDuration > 0
    ? features.audibleTokenCount / features.audibleDuration
    : features.tokenCount;
  if (features.shortestDuration > 0 && features.shortestDuration < 0.25) return false;
  if (features.shortestDuration <= 0.25 && audibleDensity > 2.15) return false;
  if (features.maxConsecutiveShortAudibleCount > 4) return false;
  if (features.shortAudibleTokenCount > 4 && features.longToneCount === 0) return false;
  if (features.restRatio < 0.06 && features.longToneCount === 0 && audibleDensity > 2.15) return false;
  if (features.chromaticTokenCount > Math.max(2, Math.ceil(features.tokenCount * 0.22))) return false;

  return tags.some(tag =>
    tag === 'lofi_crawl_hold'
    || tag === 'lofi_hold_answer'
    || tag === 'lofi_color_suspension'
    || tag === 'lofi_rest_space'
    || tag === 'lofi_short_crawl'
    || tag === 'lofi_color_hold'
    || tag === 'lofi_soft_cadence'
    || tag === 'lofi_parallel_answer'
    || tag === 'lofi_vamp_friendly'
  );
}

/** LOFI-safe imported slope subset.
 *  Keeps IV-derived color, but filters out dense bebop/jazz runs whose
 *  continuous 16th motion erases the loop's chord color. */
export function lofiStableSlopeRulesToGrammarRules(): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(isLofiStableSlopeRule)
    .map(rule => slopeRuleToGrammarRule(rule, {
      includeLofiMetadata: true,
      lofiTagBias: true,
      styleTags: ['lofi_pool'],
    }));
}

interface AcgPianoSongSlopeCandidate {
  rule: ImprovisorSlopeRule;
  tags: AcgPianoSongGrammarTag[];
}

let acgPianoSongSlopeCandidatesCache: readonly AcgPianoSongSlopeCandidate[] | undefined;

/**
 * Classify a pre-existing slope rule for lyrical piano use.  This is
 * deliberately a selection/tagging layer, not a new authored grammar:
 * LOFI-compatible phrase shapes remain valid, while a small additional set
 * supplies the upward broken-chord / color-answer movement needed after the
 * opening.
 */
export function tagImprovisorSlopeRuleForAcgPianoSong(rule: ImprovisorSlopeRule): AcgPianoSongGrammarTag[] {
  const features = extractLofiSlopeFeatures(rule);
  const lofiTags = tagImprovisorSlopeRule(rule);
  const tags = new Set<AcgPianoSongGrammarTag>(['acg_pianosong_pool']);
  const terminalTypes = rule.bodyKind === 'slope'
    ? rule.slopes.flatMap(group => group.notes.map(note => note.type))
    : rule.flatTokens.map(token => token.kind === 'abstract' ? token.type : 'X');
  const colorDegreeCount = rule.bodyKind === 'flat'
    ? rule.flatTokens.filter(token => token.kind === 'scaleDegree'
      && /^(b2|#4|#5|b6|#6|b7)$/i.test(token.degree)).length
    : 0;
  const ascendingGroups = rule.bodyKind === 'slope'
    ? rule.slopes.filter(group => group.dirMin >= 1 && group.dirMax <= 9).length
    : 0;
  const chordCarrierCount = terminalTypes.filter(type => type === 'C' || type === 'G' || type === 'B').length;
  const colorCarrierCount = terminalTypes.filter(type => type === 'L' || type === 'H').length;
  const isCadentialSource = /Cadence|Turnaround|Launcher|Dropback|POT|Approach/i.test(rule.brickType);
  const isLofiCompatible = isLofiStableSlopeRule(rule);

  if (isLofiCompatible) tags.add('acg_pianosong_lofi_compatible');
  if (features.restRatio >= 0.14 || features.restDuration >= 1) tags.add('acg_pianosong_breath');
  if (
    (features.longToneCount >= 1 || features.restRatio >= 0.12)
    && features.audibleTokenCount >= 2
    && features.audibleTokenCount <= 13
  ) tags.add('acg_pianosong_cantabile');
  if (lofiTags.includes('lofi_hold_answer') || lofiTags.includes('lofi_crawl_hold')) {
    tags.add('acg_pianosong_lyrical_answer');
  }
  if (ascendingGroups >= 1 && (chordCarrierCount >= 2 || features.smallCrawlGroupCount >= 1)) {
    tags.add('acg_pianosong_ascending_arrival');
  }
  if (ascendingGroups >= 1 && chordCarrierCount >= 3) {
    tags.add('acg_pianosong_broken_chord_motion');
  }
  if (colorCarrierCount >= 1 || colorDegreeCount >= 1) {
    tags.add('acg_pianosong_modal_color');
  }
  if (isCadentialSource && (features.longToneCount >= 1 || features.approachTokenCount >= 1 || features.restRatio >= 0.12)) {
    tags.add('acg_pianosong_cadential_return');
  }
  if (
    tags.has('acg_pianosong_ascending_arrival')
    || tags.has('acg_pianosong_broken_chord_motion')
    || tags.has('acg_pianosong_modal_color')
    || tags.has('acg_pianosong_lyrical_answer')
  ) tags.add('acg_pianosong_mid_variation');

  return [...tags];
}

function isAcgPianoSongSlopeRule(rule: ImprovisorSlopeRule, tags = tagImprovisorSlopeRuleForAcgPianoSong(rule)): boolean {
  if (!hasAudibleBody(rule)) return false;
  // Keep the piano pool lyrical rather than importing instrument-specific
  // bebop language.  The existing LOFI filter already makes the same broad
  // distinction; ACG permits a little more shaped movement, not dense runs.
  if (isJazzSpecialSourceRule(rule) || isJazzOnlyBrickType(rule.brickType) || isDenseJazzRunRule(rule)) return false;
  const features = extractLofiSlopeFeatures(rule);
  const audibleDensity = features.audibleDuration > 0
    ? features.audibleTokenCount / features.audibleDuration
    : features.audibleTokenCount;
  if (features.shortestDuration > 0 && features.shortestDuration < 0.25) return false;
  if (features.maxConsecutiveShortAudibleCount > 5) return false;
  if (features.chromaticTokenCount > Math.max(3, Math.ceil(features.tokenCount * 0.3))) return false;
  if (features.maxAbsSlope > 13 && features.restRatio < 0.14) return false;
  if (audibleDensity > 2.3 && features.longToneCount === 0 && features.restRatio < 0.1) return false;

  return tags.some(tag => tag !== 'acg_pianosong_pool' && tag !== 'acg_pianosong_lofi_compatible');
}

function acgPianoSongSubsetIncludes(
  subset: AcgPianoSongGrammarSubset,
  tags: readonly AcgPianoSongGrammarTag[],
): boolean {
  if (subset === 'all') return true;
  const has = (tag: AcgPianoSongGrammarTag) => tags.includes(tag);
  switch (subset) {
    case 'intro-breath':
      return has('acg_pianosong_breath') || (has('acg_pianosong_cantabile') && has('acg_pianosong_lofi_compatible'));
    case 'cantabile-theme':
      return has('acg_pianosong_cantabile') || has('acg_pianosong_lyrical_answer');
    case 'ascending-lift':
      return has('acg_pianosong_ascending_arrival') || has('acg_pianosong_broken_chord_motion');
    case 'modal-color':
      return has('acg_pianosong_modal_color') && (has('acg_pianosong_cantabile') || has('acg_pianosong_breath'));
    case 'cadential-return':
      return has('acg_pianosong_cadential_return')
        && (has('acg_pianosong_cantabile') || has('acg_pianosong_ascending_arrival') || has('acg_pianosong_lyrical_answer'));
  }
}

function acgPianoSongSlopeWeightMultiplier(tags: readonly AcgPianoSongGrammarTag[]): number {
  let multiplier = 1;
  const has = (tag: AcgPianoSongGrammarTag) => tags.includes(tag);
  if (has('acg_pianosong_lofi_compatible')) multiplier *= 1.04;
  if (has('acg_pianosong_cantabile')) multiplier *= 1.08;
  if (has('acg_pianosong_lyrical_answer')) multiplier *= 1.08;
  if (has('acg_pianosong_ascending_arrival')) multiplier *= 1.16;
  if (has('acg_pianosong_broken_chord_motion')) multiplier *= 1.06;
  if (has('acg_pianosong_modal_color')) multiplier *= 1.06;
  if (has('acg_pianosong_cadential_return')) multiplier *= 1.10;
  return Math.min(1.75, multiplier);
}

function acgPianoSongSlopeCandidates(): readonly AcgPianoSongSlopeCandidate[] {
  if (acgPianoSongSlopeCandidatesCache) return acgPianoSongSlopeCandidatesCache;
  acgPianoSongSlopeCandidatesCache = IMPROVISOR_SLOPES
    .map(rule => ({ rule, tags: tagImprovisorSlopeRuleForAcgPianoSong(rule) }))
    .filter(({ rule, tags }) => isAcgPianoSongSlopeRule(rule, tags));
  return acgPianoSongSlopeCandidatesCache;
}

/**
 * Existing-corpus ACG PIANOSONG subset.  `subset` is an internal
 * arrangement selector (intro / theme / lift / color / return), never a UI
 * style.  Every returned rule is labelled in `metadata.styleTags` so audits
 * can prove what vocabulary was used.
 */
export function acgPianoSongSlopeRulesToGrammarRules(
  subset: AcgPianoSongGrammarSubset = 'all',
): GrammarRule[] {
  return acgPianoSongSlopeCandidates()
    .filter(({ tags }) => acgPianoSongSubsetIncludes(subset, tags))
    .map(({ rule, tags }) => slopeRuleToGrammarRule(rule, {
      includeLofiMetadata: true,
      styleTags: tags,
      weightMultiplier: acgPianoSongSlopeWeightMultiplier(tags),
    }));
}

function isSoftParallelFavoriteCrawlRule(rule: ImprovisorSlopeRule): boolean {
  return rule.brickType === 'Surprise-Major-Cadence'
    && rule.bodyKind === 'slope'
    && rule.rawLine.includes('(slope 1 3 C8 L8 C8 L2)')
    && rule.rawLine.includes('(slope -9 -1 C4+8 C8 C8 C8)');
}

/** Cross-style favorite: short crawl into long color/chord-tone holds.
 *  This is an imported Impro-Visor `Surprise-Major-Cadence` slope. Keep
 *  it in 2-5-1 cadence territory; do not promote it onto locally-created
 *  longer cycle bricks. */
export function softParallelFavoriteSlopeRulesToGrammarRules(boost = 256): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(isSoftParallelFavoriteCrawlRule)
    .map(rule => {
      const grammarRule = slopeRuleToGrammarRule(rule, { includeLofiMetadata: true });
      return {
        ...grammarRule,
        weight: grammarRule.weight * boost,
      };
    });
}

/** Back-compat alias for older diagnostics. */
export const lofiFavoriteSlopeRulesToGrammarRules = softParallelFavoriteSlopeRulesToGrammarRules;

function popStableSlopeRule(rule: ImprovisorSlopeRule): boolean {
  if (!hasAudibleBody(rule)) return false;
  if (isJazzSpecialSourceRule(rule)) return false;
  if (isJazzOnlyBrickType(rule.brickType)) return false;
  if (isDenseJazzRunRule(rule)) return false;
  if (rule.bodyKind !== 'slope') return false;
  const notes = rule.slopes.flatMap(group => group.notes);
  if (notes.length === 0) return false;

  const onHalfBeatGrid = notes.every(note => Math.abs(note.d * 2 - Math.round(note.d * 2)) < 1e-6);
  if (!onHalfBeatGrid) return false;
  if (notes.some(note => note.d < 0.5)) return false;

  const chromaticCount = notes.filter(note => note.type === 'X').length;
  if (chromaticCount > 2) return false;

  const maxAbsSlope = Math.max(
    0,
    ...rule.slopes.map(group => Math.max(Math.abs(group.dirMin), Math.abs(group.dirMax))),
  );
  if (maxAbsSlope > 8) return false;

  const totalDuration = notes.reduce((sum, note) => sum + note.d, 0);
  const audibleNotes = notes.filter(note => note.type !== 'R' && note.type !== 'N');
  if (audibleNotes.length === 0) return false;
  const audibleDensity = audibleNotes.length / Math.max(1, totalDuration);
  return audibleDensity <= 2.05;
}

function popSlopeTags(rule: ImprovisorSlopeRule): string[] {
  const notes = rule.slopes.flatMap(group => group.notes);
  const tags: string[] = ['pop_pool'];
  const chromaticCount = notes.filter(note => note.type === 'X' || note.type === 'A').length;
  const longCount = notes.filter(note => note.d >= 1 && note.type !== 'R' && note.type !== 'N').length;
  const contractCount = notes.filter(note => note.type === 'C' || note.type === 'G' || note.type === 'B').length;
  const colorCount = notes.filter(note => note.type === 'L' || note.type === 'H').length;
  const restDuration = notes.filter(note => note.type === 'R' || note.type === 'N').reduce((sum, note) => sum + note.d, 0);
  const totalDuration = notes.reduce((sum, note) => sum + note.d, 0);

  if (chromaticCount === 0) tags.push('pop_no_chromatic');
  if (contractCount >= colorCount * 1.5) tags.push('pop_contract_first');
  if (longCount >= 1) tags.push('pop_clear_landing');
  if (restDuration / Math.max(1, totalDuration) >= 0.12) tags.push('pop_phrase_space');
  if (/Cadence|Turnaround/i.test(rule.brickType)) tags.push('pop_functional_shape');
  return tags;
}

function popSlopeWeightMultiplier(rule: ImprovisorSlopeRule): number {
  const tags = popSlopeTags(rule);
  let multiplier = 1;
  if (tags.includes('pop_no_chromatic')) multiplier *= 1.18;
  if (tags.includes('pop_contract_first')) multiplier *= 1.22;
  if (tags.includes('pop_clear_landing')) multiplier *= 1.18;
  if (tags.includes('pop_phrase_space')) multiplier *= 1.08;
  if (tags.includes('pop_functional_shape')) multiplier *= 1.10;
  return Math.min(1.75, multiplier);
}

/** POP-safe imported slope subset.
 *  Excludes IV rules with triplets, 16ths, large bebop leaps, and dense
 *  chromatic lines so POP melody keeps a straight 8th/quarter grammar. */
export function popStableSlopeRulesToGrammarRules(): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(popStableSlopeRule)
    .map(rule => slopeRuleToGrammarRule(rule, {
      styleTags: popSlopeTags(rule),
      weightMultiplier: popSlopeWeightMultiplier(rule),
    }));
}

function rnbSoulSlopeRule(rule: ImprovisorSlopeRule): boolean {
  if (!hasAudibleBody(rule)) return false;
  if (isJazzSpecialSourceRule(rule)) return false;
  if (isJazzOnlyBrickType(rule.brickType)) return false;
  if (isDenseJazzRunRule(rule)) return false;
  if (rule.bodyKind !== 'slope') return false;
  const features = extractLofiSlopeFeatures(rule);
  if (features.shortestDuration > 0 && features.shortestDuration < 0.25) return false;
  if (features.maxAbsSlope > 12 && features.restRatio < 0.15) return false;
  if (features.chromaticTokenCount > Math.max(4, Math.ceil(features.tokenCount * 0.28))) return false;
  const audibleDensity = features.audibleDuration > 0 ? features.tokenCount / features.audibleDuration : features.tokenCount;
  if (audibleDensity > 2.6 && features.longToneCount === 0) return false;
  return features.colorTokenCount >= 2
    || features.longToneCount >= 1
    || features.smallCrawlGroupCount >= 2
    || /Cadence|Turnaround|Dropback|POT|Major-On|Minor-On/i.test(rule.brickType);
}

function rnbSlopeTags(rule: ImprovisorSlopeRule): string[] {
  const tags = ['rnb_pool'];
  const features = extractLofiSlopeFeatures(rule);
  if (features.colorTokenCount >= 3) tags.push('rnb_color_forward');
  if (features.longToneCount >= 1) tags.push('rnb_vocal_hold');
  if (features.smallCrawlGroupCount >= 2) tags.push('rnb_melisma_crawl');
  if (features.chromaticTokenCount >= 1 && features.chromaticTokenCount <= 3) tags.push('rnb_chromatic_grace');
  if (/Cadence|Turnaround|Dropback/i.test(rule.brickType)) tags.push('rnb_soul_cadence');
  return tags;
}

function rnbSlopeWeightMultiplier(rule: ImprovisorSlopeRule): number {
  const tags = rnbSlopeTags(rule);
  let multiplier = 1;
  if (tags.includes('rnb_color_forward')) multiplier *= 1.24;
  if (tags.includes('rnb_vocal_hold')) multiplier *= 1.20;
  if (tags.includes('rnb_melisma_crawl')) multiplier *= 1.14;
  if (tags.includes('rnb_chromatic_grace')) multiplier *= 1.06;
  if (tags.includes('rnb_soul_cadence')) multiplier *= 1.10;
  return Math.min(1.85, multiplier);
}

/** RNB keeps expressive color and vocal-like holds, but leaves bebop-
 *  specific Charlie Parker grammar to JAZZ. */
export function rnbSoulSlopeRulesToGrammarRules(): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(rnbSoulSlopeRule)
    .map(rule => slopeRuleToGrammarRule(rule, {
      styleTags: rnbSlopeTags(rule),
      weightMultiplier: rnbSlopeWeightMultiplier(rule),
    }));
}

function jazzSlopeTags(rule: ImprovisorSlopeRule): string[] {
  const tags = ['jazz_pool'];
  const features = extractLofiSlopeFeatures(rule);
  if (isBebopSourceRule(rule)) tags.push('jazz_bebop');
  if (features.chromaticTokenCount >= 2) tags.push('jazz_chromatic_line');
  if (/Dominant|Cycle|Cadence|Giant-Steps/i.test(rule.brickType)) tags.push('jazz_functional_harmony');
  if (features.smallCrawlGroupCount >= 2) tags.push('jazz_motivic_cells');
  if (features.longToneCount >= 1) tags.push('jazz_phrase_landing');
  return tags;
}

function jazzSlopeWeightMultiplier(rule: ImprovisorSlopeRule): number {
  const tags = jazzSlopeTags(rule);
  let multiplier = 1;
  if (tags.includes('jazz_bebop')) multiplier *= 1.20;
  if (tags.includes('jazz_chromatic_line')) multiplier *= 1.14;
  if (tags.includes('jazz_functional_harmony')) multiplier *= 1.12;
  if (tags.includes('jazz_motivic_cells')) multiplier *= 1.06;
  if (tags.includes('jazz_phrase_landing')) multiplier *= 1.04;
  return Math.min(1.75, multiplier);
}

/** JAZZ is the only macro that keeps the full imported vocabulary,
 *  including bebop-specific sources. The multiplier nudges those rules
 *  toward functional dominant/cadence contexts without hiding others. */
export function jazzSlopeRulesToGrammarRules(): GrammarRule[] {
  return IMPROVISOR_SLOPES
    .filter(hasAudibleBody)
    .map(rule => slopeRuleToGrammarRule(rule, {
      includeLofiMetadata: false,
      styleTags: jazzSlopeTags(rule),
      weightMultiplier: jazzSlopeWeightMultiplier(rule),
    }));
}

/** Diagnostic — count slope rules per target family. */
export function slopeRuleStats(): { perFamily: Record<string, number>; total: number } {
  const perFamily: Record<string, number> = {};
  for (const r of IMPROVISOR_SLOPES) {
    for (const fam of brickTypeToFamilies(r.brickType)) {
      perFamily[fam] = (perFamily[fam] ?? 0) + 1;
    }
  }
  return { perFamily, total: IMPROVISOR_SLOPES.length };
}
