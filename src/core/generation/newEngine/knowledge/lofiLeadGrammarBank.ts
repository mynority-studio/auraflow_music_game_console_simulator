// ============================================================
// newEngine · knowledge · LofiLeadGrammarBank
// ------------------------------------------------------------
// A hidden LOFI lead vocabulary selector.  It deliberately selects from the
// existing LOFI grammar metadata instead of authoring a second lick corpus.
// The arranger owns when a role may be used; this module only says which
// already-imported phrase rules are safe vocabulary for that role.
// ============================================================

import { makeGrammar, type AbstractMelodyToken, type Grammar, type GrammarRule } from './melodyGrammarTypes';
import type { LofiGrammarTag } from './melodyLofiGrammarTags';

/**
 * Semantic lead jobs issued by the LOFI score.  These stay internal: they
 * are not StyleName/UI values and do not create a new musical corpus.
 */
export type LofiLeadGrammarRole =
  | 'statement-carrier'
  | 'answer-riff'
  | 'connected-crawl'
  | 'approach-target'
  | 'return-hold'
  | 'release';

/** A structural context supplied by a RoadMap/score slot when available. */
export interface LofiLeadGrammarContext {
  family?: string;
  name?: string;
  durationBeats?: number;
}

export type LofiLeadGrammarFallback =
  | 'primary'
  | 'diatonic-connector'
  | 'safe-general'
  | 'explicit-release'
  | 'empty';

/**
 * `requiresFollowingTarget` is deliberately explicit.  A short crawl or a
 * chromatic approach is not independently admissible at the end of a phrase:
 * its caller must already have scheduled the arrival it connects to.
 */
export interface LofiLeadGrammarRuleSelection {
  role: LofiLeadGrammarRole;
  rules: readonly GrammarRule[];
  fallback: LofiLeadGrammarFallback;
  requiresFollowingTarget: boolean;
  requiresExplicitRelease: boolean;
}

export interface LofiLeadGrammarBank {
  context?: Readonly<LofiLeadGrammarContext>;
  selections: Readonly<Record<LofiLeadGrammarRole, LofiLeadGrammarRuleSelection>>;
}

/**
 * Role → preferred existing LOFI tags.  `short_crawl` and
 * `chromatic_neighbor` intentionally appear only in connection roles.
 */
export const LOFI_LEAD_GRAMMAR_ROLE_TAGS: Readonly<Record<LofiLeadGrammarRole, readonly LofiGrammarTag[]>> = {
  'statement-carrier': ['lofi_hold_answer', 'lofi_color_hold', 'lofi_crawl_hold'],
  'answer-riff': ['lofi_parallel_answer', 'lofi_crawl_hold', 'lofi_hold_answer'],
  'connected-crawl': ['lofi_short_crawl', 'lofi_crawl_hold'],
  'approach-target': ['lofi_chromatic_neighbor'],
  'return-hold': ['lofi_soft_cadence', 'lofi_hold_answer', 'lofi_color_hold'],
  release: [],
};

const TRANSITION_ONLY_TAGS = new Set<LofiGrammarTag>([
  'lofi_short_crawl',
  'lofi_chromatic_neighbor',
  'lofi_star_crawl',
]);

const DISALLOWED_TAGS = new Set<LofiGrammarTag>([
  'lofi_avoid_busy',
  'lofi_avoid_large_leap',
]);

const CONNECTION_ROLES = new Set<LofiLeadGrammarRole>([
  'connected-crawl',
  'approach-target',
]);

/**
 * Build all six role banks from one existing LOFI grammar.  The output is
 * deterministic: source order is retained and duplicate source rules are
 * reduced to their least-weighted existing entry, avoiding the legacy
 * favourite-rule duplicate from silently dominating a hidden role bank.
 */
export function buildLofiLeadGrammarBank(
  grammar: Grammar,
  context?: LofiLeadGrammarContext,
): LofiLeadGrammarBank {
  const selections = {
    'statement-carrier': selectLofiLeadGrammarRules('statement-carrier', grammar, context),
    'answer-riff': selectLofiLeadGrammarRules('answer-riff', grammar, context),
    'connected-crawl': selectLofiLeadGrammarRules('connected-crawl', grammar, context),
    'approach-target': selectLofiLeadGrammarRules('approach-target', grammar, context),
    'return-hold': selectLofiLeadGrammarRules('return-hold', grammar, context),
    release: selectLofiLeadGrammarRules('release', grammar, context),
  } satisfies Record<LofiLeadGrammarRole, LofiLeadGrammarRuleSelection>;

  return {
    ...(context ? { context: Object.freeze({ ...context }) } : {}),
    selections: Object.freeze(selections),
  };
}

/**
 * Select pre-existing Phrase rules for one semantic score role.  No rule is
 * cloned, rewritten, or reweighted.  An empty result means the score should
 * choose an explicit release/rest rather than fall through to a generic lick.
 */
export function selectLofiLeadGrammarRules(
  role: LofiLeadGrammarRole,
  grammar: Grammar,
  context?: LofiLeadGrammarContext,
): LofiLeadGrammarRuleSelection {
  if (role === 'release') {
    return Object.freeze({
      role,
      rules: Object.freeze([]),
      fallback: 'explicit-release',
      requiresFollowingTarget: false,
      requiresExplicitRelease: true,
    });
  }

  const eligibleRules = phraseRules(grammar).filter((rule) => ruleMatchesContext(rule, context));
  const safeRules = eligibleRules.filter(isLofiLeadGrammarRuleSafe);
  const primary = dedupeExistingRules(safeRules.filter((rule) => matchesPrimaryRole(role, rule)));
  if (primary.length > 0) {
    return selection(role, primary, 'primary');
  }

  const fallback = dedupeExistingRules(safeRules.filter((rule) => matchesFallbackRole(role, rule)));
  if (fallback.length > 0) {
    return selection(
      role,
      fallback,
      role === 'connected-crawl' || role === 'approach-target'
        ? 'diatonic-connector'
        : 'safe-general',
    );
  }

  return selection(role, [], 'empty');
}

/**
 * Convert one role selection back into a normal Grammar runtime input.  The
 * non-Phrase support rules are kept verbatim so this remains safe if a future
 * labelled source rule dispatches to an existing non-terminal.  `undefined`
 * is intentional for release/empty: callers must emit score-owned rest.
 */
export function lofiLeadGrammarForRole(
  role: LofiLeadGrammarRole,
  grammar: Grammar,
  context?: LofiLeadGrammarContext,
): Grammar | undefined {
  const selected = selectLofiLeadGrammarRules(role, grammar, context);
  if (selected.requiresExplicitRelease || selected.rules.length === 0) return undefined;

  const supportRules = [...grammar.rulesByLhs.values()]
    .flat()
    .filter((rule) => rule.lhs !== grammar.start);
  return makeGrammar([...selected.rules, ...supportRules], grammar.start);
}

/** Exported for score-level audits without exposing the implementation cache. */
export function isLofiLeadGrammarRuleSafe(rule: GrammarRule): boolean {
  const tags = lofiTags(rule);
  if (tags.length === 0 || tags.some((tag) => DISALLOWED_TAGS.has(tag))) return false;

  const facts = inspectRule(rule);
  if (facts.audibleTokenCount === 0) return false;
  // The imported LOFI pool already rejects dense bebop material.  Keep this
  // guard here too because this selector may be handed a future wider grammar.
  if (facts.shortestAudibleDuration > 0 && facts.shortestAudibleDuration < 0.25) return false;
  if (facts.maxConsecutiveShortAudibleCount > 4) return false;
  if (
    facts.audibleDensity > 2.15
    && facts.longToneCount === 0
    && facts.restRatio < 0.08
  ) return false;
  return true;
}

function selection(
  role: LofiLeadGrammarRole,
  rules: readonly GrammarRule[],
  fallback: LofiLeadGrammarFallback,
): LofiLeadGrammarRuleSelection {
  return Object.freeze({
    role,
    rules: Object.freeze([...rules]),
    fallback,
    requiresFollowingTarget: CONNECTION_ROLES.has(role),
    requiresExplicitRelease: false,
  });
}

function phraseRules(grammar: Grammar): readonly GrammarRule[] {
  return grammar.rulesByLhs.get(grammar.start) ?? [];
}

function ruleMatchesContext(rule: GrammarRule, context?: LofiLeadGrammarContext): boolean {
  if (!context) return true;
  const conditions = rule.conditions;
  if (!conditions) return true;
  if (context.family && conditions.brickFamily && !conditions.brickFamily.includes(context.family)) return false;
  if (context.name && conditions.brickName && !conditions.brickName.includes(context.name)) return false;
  if (context.durationBeats !== undefined && conditions.minDuration !== undefined && context.durationBeats < conditions.minDuration) return false;
  if (context.durationBeats !== undefined && conditions.maxDuration !== undefined && context.durationBeats > conditions.maxDuration) return false;
  return true;
}

function matchesPrimaryRole(role: Exclude<LofiLeadGrammarRole, 'release'>, rule: GrammarRule): boolean {
  const tags = lofiTags(rule);
  const facts = inspectRule(rule);
  const has = (tag: LofiGrammarTag) => tags.includes(tag);
  const hasTransitionOnlyTag = tags.some((tag) => TRANSITION_ONLY_TAGS.has(tag));

  switch (role) {
    case 'statement-carrier':
      return !hasTransitionOnlyTag
        && facts.longToneCount >= 1
        && (has('lofi_hold_answer') || has('lofi_color_hold') || has('lofi_crawl_hold'));
    case 'answer-riff':
      return !hasTransitionOnlyTag
        && facts.audibleTokenCount >= 2
        && facts.audibleTokenCount <= 14
        && (has('lofi_parallel_answer') || has('lofi_crawl_hold') || has('lofi_hold_answer'));
    case 'connected-crawl':
      return has('lofi_short_crawl')
        && facts.audibleTokenCount >= 2
        && facts.maxConsecutiveShortAudibleCount >= 2;
    case 'approach-target':
      return has('lofi_chromatic_neighbor') && hasApproachAndArrival(facts.tokens);
    case 'return-hold':
      return !hasTransitionOnlyTag
        && facts.longToneCount >= 1
        && (has('lofi_soft_cadence') || has('lofi_hold_answer') || has('lofi_color_hold'));
  }
}

function matchesFallbackRole(role: Exclude<LofiLeadGrammarRole, 'release'>, rule: GrammarRule): boolean {
  const tags = lofiTags(rule);
  const facts = inspectRule(rule);
  const has = (tag: LofiGrammarTag) => tags.includes(tag);
  const hasTransitionOnlyTag = tags.some((tag) => TRANSITION_ONLY_TAGS.has(tag));

  switch (role) {
    case 'statement-carrier':
      return !hasTransitionOnlyTag && facts.longToneCount >= 1
        && (has('lofi_color_suspension') || has('lofi_rest_space'));
    case 'answer-riff':
      return !hasTransitionOnlyTag && facts.audibleTokenCount >= 2
        && (has('lofi_color_suspension') || has('lofi_vamp_friendly'));
    case 'connected-crawl':
      // A connection slot may use a diatonic crawl only when its score has
      // already supplied the following arrival.  It never leaks into a
      // standalone statement/answer bank.
      return !has('lofi_chromatic_neighbor')
        && facts.audibleTokenCount >= 2
        && (has('lofi_crawl_hold') || has('lofi_hold_answer') || has('lofi_parallel_answer'));
    case 'approach-target':
      // If the imported pool has no eligible chromatic neighbour for this
      // exact brick, use an existing diatonic A/X → landing phrase rather
      // than inventing a chromatic token at render time.
      return !has('lofi_chromatic_neighbor') && hasApproachAndArrival(facts.tokens);
    case 'return-hold':
      return !hasTransitionOnlyTag && facts.longToneCount >= 1
        && (has('lofi_color_suspension') || has('lofi_rest_space'));
  }
}

function lofiTags(rule: GrammarRule): readonly LofiGrammarTag[] {
  return (rule.metadata?.lofiTags ?? []) as LofiGrammarTag[];
}

interface RuleFacts {
  tokens: readonly AbstractMelodyToken[];
  audibleTokenCount: number;
  longToneCount: number;
  shortestAudibleDuration: number;
  maxConsecutiveShortAudibleCount: number;
  audibleDensity: number;
  restRatio: number;
}

function inspectRule(rule: GrammarRule): RuleFacts {
  const tokens = rule.rhs.filter((item): item is AbstractMelodyToken => typeof item !== 'string' && item.duration > 0);
  let audibleTokenCount = 0;
  let longToneCount = 0;
  let shortestAudibleDuration = Number.POSITIVE_INFINITY;
  let consecutiveShort = 0;
  let maxConsecutiveShortAudibleCount = 0;
  let totalDuration = 0;
  let restDuration = 0;

  for (const token of tokens) {
    totalDuration += token.duration;
    if (token.kind === 'R') {
      restDuration += token.duration;
      consecutiveShort = 0;
      continue;
    }
    audibleTokenCount++;
    shortestAudibleDuration = Math.min(shortestAudibleDuration, token.duration);
    if (token.duration >= 1) longToneCount++;
    if (token.duration <= 0.25) {
      consecutiveShort++;
      maxConsecutiveShortAudibleCount = Math.max(maxConsecutiveShortAudibleCount, consecutiveShort);
    } else {
      consecutiveShort = 0;
    }
  }

  const audibleDuration = totalDuration - restDuration;
  return {
    tokens,
    audibleTokenCount,
    longToneCount,
    shortestAudibleDuration: Number.isFinite(shortestAudibleDuration) ? shortestAudibleDuration : 0,
    maxConsecutiveShortAudibleCount,
    audibleDensity: audibleDuration > 0 ? audibleTokenCount / audibleDuration : 0,
    restRatio: totalDuration > 0 ? restDuration / totalDuration : 0,
  };
}

function hasApproachAndArrival(tokens: readonly AbstractMelodyToken[]): boolean {
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    if (token.kind !== 'A' && token.kind !== 'X') continue;
    if (tokens.slice(index + 1).some(isStableArrivalToken)) return true;
  }
  return false;
}

function isStableArrivalToken(token: AbstractMelodyToken): boolean {
  return token.kind === 'C'
    || token.kind === 'G'
    || token.kind === 'B'
    || token.kind === 'S'
    || token.kind === 'L'
    || token.kind === 'H';
}

function dedupeExistingRules(rules: readonly GrammarRule[]): GrammarRule[] {
  const byIdentity = new Map<string, GrammarRule>();
  for (const rule of rules) {
    const identity = rule.metadata?.sourceRuleId
      ?? `${rule.lhs}:${JSON.stringify(rule.conditions ?? {})}:${JSON.stringify(rule.rhs)}`;
    const existing = byIdentity.get(identity);
    // The same imported source may occur once as a legacy boosted favourite
    // and again in the normal LOFI pool.  Keep the lower existing weight; this
    // changes no rule content and prevents a duplicate source from becoming a
    // hidden role-bank monopoly.
    if (!existing || rule.weight < existing.weight) byIdentity.set(identity, rule);
  }
  return [...byIdentity.values()];
}
