// ============================================================
// newEngine · render · MgGrammarRuntime(MG strict 移植 Loop 3)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/GrammarRuntime.ts 忠实港(逐值)。
// 唯一改动:import 改 ../knowledge/melodyGrammarTypes(Grammar/GrammarRule/AbstractMelodyToken)
//   + ./mgRoadMapParser(BrickMatch)。
// render 层:加权产生式展开 —— grammar + per-brick 上下文 + RNG → 抽象 token 流。确定性。
// ============================================================
//
// Algorithm:
//   - Start with the grammar's start symbol.
//   - Expand each non-terminal by:
//     1. Filter rules by lhs match + condition satisfaction
//     2. Sample one rule with probability proportional to weight
//     3. Replace the non-terminal with the rule's rhs (left-to-right)
//     4. Recurse into any new non-terminal children
//   - Stop when rhs is all terminal tokens.
//
// Per-brick context: each brick in the RoadMap drives one expansion pass.
// Legacy grammars use all condition gates; opt-in family grammars admit by
// family and treat name/duration only as selection metadata.

import type {
  AbstractMelodyToken,
  Grammar,
  GrammarRule,
  GrammarSelectionPolicy,
} from '../knowledge/melodyGrammarTypes';
import type { BrickMatch } from './mgRoadMapParser';

export interface ExpandContext {
  brick: BrickMatch;
  /** Pseudo-random number generator for determinism. */
  rng: () => number;
  /** Maximum recursion depth to prevent runaway grammars. */
  maxDepth?: number;
  /** Optional diagnostics only. Omitted by default and never sampled by RNG. */
  trace?: GrammarExpansionTraceHook;
}

export type GrammarExpansionTraceEvent =
  | Readonly<{
    type: 'rule-selected';
    symbol: string;
    depth: number;
    eligibleRuleCount: number;
    selectedRuleIndex: number;
    sourceRuleId: string;
    sourceName: string;
    rhsSignature: string;
    rulePath: readonly string[];
  }>
  | Readonly<{
    type: 'terminal-emitted';
    outputIndex: number;
    depth: number;
    tokenKind: AbstractMelodyToken['kind'];
    sourceRuleId: string;
    rulePath: readonly string[];
  }>;

export type GrammarExpansionTraceHook = (event: GrammarExpansionTraceEvent) => void;

/** Expand a grammar against a single brick's context. Returns a flat
 *  sequence of abstract tokens whose duration sums to brick.durationBeats
 *  (approximately — grammar authors should make their rules durationally
 *  consistent; the runtime doesn't normalize). */
export function expandGrammarForBrick(
  grammar: Grammar,
  ctx: ExpandContext,
): AbstractMelodyToken[] {
  const maxDepth = ctx.maxDepth ?? 32;
  const out: AbstractMelodyToken[] = [];
  expandSymbol(grammar.start, grammar, ctx, out, 0, maxDepth, EMPTY_RULE_PATH);
  return out;
}

const EMPTY_RULE_PATH: readonly string[] = Object.freeze([]);

function expandSymbol(
  symbol: string,
  grammar: Grammar,
  ctx: ExpandContext,
  out: AbstractMelodyToken[],
  depth: number,
  maxDepth: number,
  parentRulePath: readonly string[],
): void {
  if (depth > maxDepth) return;
  const rules = grammar.rulesByLhs.get(symbol) ?? [];
  const eligible = rules.filter(r => ruleEligible(r, ctx.brick, grammar.selectionPolicy));
  if (eligible.length === 0) return;  // no rule fires — silent expand
  const picked = symbol === grammar.start
    ? pickTopLevelRule(eligible, ctx.brick, ctx.rng, grammar)
    : weightedPick(eligible, ctx.rng);
  const selectedRuleIndex = eligible.indexOf(picked);
  const sourceRuleId = picked.metadata?.sourceRuleId ?? `${symbol}#${selectedRuleIndex}`;
  const sourceName = grammarRuleSourceName(picked);
  const rhsSignature = grammarRuleRhsSignature(picked);
  const rulePath = ctx.trace
    ? Object.freeze([...parentRulePath, sourceRuleId])
    : EMPTY_RULE_PATH;
  ctx.trace?.(Object.freeze({
    type: 'rule-selected',
    symbol,
    depth,
    eligibleRuleCount: eligible.length,
    selectedRuleIndex,
    sourceRuleId,
    sourceName,
    rhsSignature,
    rulePath,
  }));
  for (const child of picked.rhs) {
    if (typeof child === 'string') {
      expandSymbol(child, grammar, ctx, out, depth + 1, maxDepth, rulePath);
    } else {
      out.push(child);
      ctx.trace?.(Object.freeze({
        type: 'terminal-emitted',
        outputIndex: out.length - 1,
        depth,
        tokenKind: child.kind,
        sourceRuleId,
        rulePath,
      }));
    }
  }
}

function ruleEligible(
  rule: GrammarRule,
  brick: BrickMatch,
  policy?: GrammarSelectionPolicy,
): boolean {
  const c = rule.conditions;
  if (!c) return true;
  if (c.brickFamily && !c.brickFamily.includes(brick.family)) return false;
  // Impro-Visor fuzzy matching: once the family agrees, authored brick name
  // and duration are fit information, not admission gates.
  if (policy?.matchMode === 'family-only') return true;
  if (c.brickName && !c.brickName.includes(brick.name)) return false;
  if (c.minDuration !== undefined && brick.durationBeats < c.minDuration) return false;
  if (c.maxDuration !== undefined && brick.durationBeats > c.maxDuration) return false;
  return true;
}

interface WeightedRule {
  rule: GrammarRule;
  weight: number;
}

interface SourceSignatureGroup {
  sourceName: string;
  rhsSignature: string;
  variants: WeightedRule[];
  shapeWeight: number;
  jointWeight: number;
}

interface BalancedSignatureCandidate {
  signature: string;
  groups: SourceSignatureGroup[];
  weight: number;
}

const BALANCED_FAMILY_POOL_CACHE = new WeakMap<Grammar, Map<string, BalancedSignatureCandidate[]>>();

/** Stable audible-shape key. Zero-duration slope markers remain variants. */
export function grammarRuleRhsSignature(rule: GrammarRule): string {
  return JSON.stringify(rule.rhs.filter(child =>
    typeof child === 'string' || child.duration > 0));
}

/** Explicit adapter metadata wins; old corpora retain a deterministic key. */
export function grammarRuleSourceName(rule: GrammarRule): string {
  if (rule.metadata?.sourceName) return rule.metadata.sourceName;
  const id = rule.metadata?.sourceRuleId;
  if (!id) return 'builtin';
  const separator = id.indexOf('_');
  return separator > 0 ? id.slice(0, separator) : id;
}

function durationFitMultiplier(
  rule: GrammarRule,
  brick: BrickMatch,
  floor: number,
): number {
  const condition = rule.conditions;
  const authored = rule.metadata?.authoredDurationBeats
    ?? (condition?.minDuration !== undefined && condition.maxDuration !== undefined
      ? Math.sqrt(condition.minDuration * condition.maxDuration)
      : undefined);
  if (!authored || authored <= 0 || brick.durationBeats <= 0) return 1;
  const octaveDistance = Math.abs(Math.log2(brick.durationBeats / authored));
  return Math.max(floor, 1 / (1 + octaveDistance * 0.35));
}

/**
 * Cap normalized source mass and redistribute overflow proportionally among
 * sources that still have headroom. The effective cap is relaxed only when
 * there are too few sources for the requested cap to be mathematically valid.
 */
function cappedNormalizedShares(
  rawWeights: ReadonlyMap<string, number>,
  requestedCap: number,
): Map<string, number> {
  const positive = [...rawWeights.entries()].filter(([, weight]) => weight > 0);
  const out = new Map<string, number>();
  if (positive.length === 0) return out;
  const cap = Math.max(1 / positive.length, Math.min(1, requestedCap));
  let remainingShare = 1;
  let active = positive;

  while (active.length > 0) {
    const activeWeight = active.reduce((sum, [, weight]) => sum + weight, 0);
    const capped = active.filter(([, weight]) =>
      remainingShare * (weight / activeWeight) > cap + 1e-12);
    if (capped.length === 0) {
      for (const [source, weight] of active) {
        out.set(source, remainingShare * (weight / activeWeight));
      }
      break;
    }
    for (const [source] of capped) out.set(source, cap);
    remainingShare -= cap * capped.length;
    const cappedNames = new Set(capped.map(([source]) => source));
    active = active.filter(([source]) => !cappedNames.has(source));
  }
  return out;
}

/**
 * Two-stage family sampler:
 *   1. choose a unique RHS shape;
 *   2. choose a source and concrete rule variant inside that shape.
 *
 * A source's budget is distributed over its unique shapes, so repeated rules
 * cannot gain probability merely by appearing under several IDs.
 */
function pickBalancedFamilyRule(
  eligible: GrammarRule[],
  brick: BrickMatch,
  rng: () => number,
  grammar: Grammar,
): GrammarRule {
  const policy = grammar.selectionPolicy!;
  const cacheKey = `${brick.family}|${brick.durationBeats}`;
  const grammarCache = BALANCED_FAMILY_POOL_CACHE.get(grammar) ?? new Map<string, BalancedSignatureCandidate[]>();
  const cached = grammarCache.get(cacheKey);
  if (cached) return pickRuleFromBalancedSignatures(cached, rng);

  const bySourceAndSignature = new Map<string, Map<string, WeightedRule[]>>();
  const fitFloor = Math.max(0, Math.min(1, policy.durationFitFloor ?? 0.45));
  const weightExponent = Math.max(0.01, Math.min(1, policy.authoredWeightExponent ?? 1));

  for (const rule of eligible) {
    const sourceName = grammarRuleSourceName(rule);
    const signature = grammarRuleRhsSignature(rule);
    const authoredWeight = Math.max(0, rule.weight);
    const weighted: WeightedRule = {
      rule,
      weight: Math.pow(authoredWeight, weightExponent) * durationFitMultiplier(rule, brick, fitFloor),
    };
    const bySignature = bySourceAndSignature.get(sourceName) ?? new Map<string, WeightedRule[]>();
    const variants = bySignature.get(signature) ?? [];
    variants.push(weighted);
    bySignature.set(signature, variants);
    bySourceAndSignature.set(sourceName, bySignature);
  }

  const sourceGroups = new Map<string, SourceSignatureGroup[]>();
  const rawWeightBySource = new Map<string, number>();
  for (const [sourceName, bySignature] of bySourceAndSignature) {
    const groups: SourceSignatureGroup[] = [];
    for (const [rhsSignature, variants] of bySignature) {
      const shapeWeight = Math.max(...variants.map(variant => variant.weight));
      groups.push({ sourceName, rhsSignature, variants, shapeWeight, jointWeight: 0 });
    }
    const sourceRawWeight = groups.reduce((sum, group) => sum + group.shapeWeight, 0);
    sourceGroups.set(sourceName, groups);
    rawWeightBySource.set(sourceName, sourceRawWeight);
  }

  const sourceShares = cappedNormalizedShares(
    rawWeightBySource,
    policy.sourceWeightCap ?? 1,
  );
  const contributionsBySignature = new Map<string, SourceSignatureGroup[]>();
  for (const [sourceName, groups] of sourceGroups) {
    const sourceRaw = rawWeightBySource.get(sourceName) ?? 0;
    const sourceShare = sourceShares.get(sourceName) ?? 0;
    for (const group of groups) {
      group.jointWeight = sourceRaw > 0
        ? sourceShare * (group.shapeWeight / sourceRaw)
        : 0;
      const contributions = contributionsBySignature.get(group.rhsSignature) ?? [];
      contributions.push(group);
      contributionsBySignature.set(group.rhsSignature, contributions);
    }
  }

  const rawSignatureWeights = new Map(
    [...contributionsBySignature.entries()].map(([signature, groups]) => [
      signature,
      // Shared copies provide source variants but cannot add another audible
      // shape boost. The strongest capped source contribution owns the mass.
      Math.max(...groups.map(group => group.jointWeight)),
    ]),
  );
  const signatureTargets = cappedNormalizedShares(
    rawSignatureWeights,
    policy.rhsWeightCap ?? 1,
  );

  const scaleSourcesToTarget = (): void => {
    for (const [sourceName, groups] of sourceGroups) {
      const current = groups.reduce((sum, group) => sum + group.jointWeight, 0);
      const target = sourceShares.get(sourceName) ?? 0;
      const scale = current > 0 ? target / current : 0;
      for (const group of groups) group.jointWeight *= scale;
    }
  };
  // A few alternating normalizations are sufficient for these family pools.
  // End on RHS columns: audible phrase repetition is the authoritative bound;
  // source budgets deliberately leave headroom for sparse-family drift.
  for (let iteration = 0; iteration < 64; iteration++) {
    scaleSourcesToTarget();
    for (const [signature, groups] of contributionsBySignature) {
      const current = groups.reduce((sum, group) => sum + group.jointWeight, 0);
      const target = signatureTargets.get(signature) ?? 0;
      const scale = current > 0 ? target / current : 0;
      for (const group of groups) group.jointWeight *= scale;
    }
  }

  const signatures: BalancedSignatureCandidate[] = [...contributionsBySignature.entries()].map(([signature, groups]) => ({
    signature,
    groups,
    weight: groups.reduce((sum, group) => sum + group.jointWeight, 0),
  }));
  if (signatures.length === 0) return weightedPick(eligible, rng);
  grammarCache.set(cacheKey, signatures);
  BALANCED_FAMILY_POOL_CACHE.set(grammar, grammarCache);
  return pickRuleFromBalancedSignatures(signatures, rng);
}

function pickRuleFromBalancedSignatures(
  signatures: BalancedSignatureCandidate[],
  rng: () => number,
): GrammarRule {
  const selectedSignature = weightedPick(signatures, rng);
  const selectedSource = weightedPick(
    selectedSignature.groups.map(group => ({ group, weight: group.jointWeight })),
    rng,
  ).group;
  // Variants inside one source+RHS cell are audibly identical. Their old
  // authored weights have already contributed through shapeWeight, so adding
  // them again here would only suppress provenance/rule-ID coverage.
  return weightedPick(
    selectedSource.variants.map(variant => ({ variant, weight: 1 })),
    rng,
  ).variant.rule;
}

function pickTopLevelRule(
  eligible: GrammarRule[],
  brick: BrickMatch,
  rng: () => number,
  grammar: Grammar,
): GrammarRule {
  const policy = grammar.selectionPolicy;
  if (policy?.matchMode !== 'family-only' || !policy.collapseRhsSignatures) {
    return weightedPick(eligible, rng);
  }
  return pickBalancedFamilyRule(eligible, brick, rng, grammar);
}

function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((s, it) => s + Math.max(0, it.weight), 0);
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, it.weight);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Expand grammar across an entire RoadMap, one brick at a time, and
 *  concatenate the results into a single token stream. Each token's
 *  duration is preserved as the grammar authored it; LickGen places
 *  them at consecutive beats starting from each brick.startBeat. */
export function expandGrammarForRoadMap(
  grammar: Grammar,
  bricks: BrickMatch[],
  rng: () => number,
): Array<{ brickIndex: number; brick: BrickMatch; tokens: AbstractMelodyToken[] }> {
  const out: Array<{ brickIndex: number; brick: BrickMatch; tokens: AbstractMelodyToken[] }> = [];
  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    const tokens = expandGrammarForBrick(grammar, { brick, rng });
    out.push({ brickIndex: i, brick, tokens });
  }
  return out;
}
