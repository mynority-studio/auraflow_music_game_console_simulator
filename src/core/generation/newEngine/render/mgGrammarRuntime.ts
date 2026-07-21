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
// Per-brick context: each brick in the RoadMap drives one expansion
// pass. The condition fields filter rules by current brick family / name
// / duration.

import type { AbstractMelodyToken, Grammar, GrammarRule } from '../knowledge/melodyGrammarTypes';
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
  const eligible = rules.filter(r => ruleEligible(r, ctx.brick));
  if (eligible.length === 0) return;  // no rule fires — silent expand
  const picked = weightedPick(eligible, ctx.rng);
  const selectedRuleIndex = eligible.indexOf(picked);
  const sourceRuleId = picked.metadata?.sourceRuleId ?? `${symbol}#${selectedRuleIndex}`;
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

function ruleEligible(rule: GrammarRule, brick: BrickMatch): boolean {
  const c = rule.conditions;
  if (!c) return true;
  if (c.brickFamily && !c.brickFamily.includes(brick.family)) return false;
  if (c.brickName && !c.brickName.includes(brick.name)) return false;
  if (c.minDuration !== undefined && brick.durationBeats < c.minDuration) return false;
  if (c.maxDuration !== undefined && brick.durationBeats > c.maxDuration) return false;
  return true;
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
