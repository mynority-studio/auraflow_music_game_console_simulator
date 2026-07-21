// ============================================================
// newEngine · knowledge · Jazz 5/4 Lead semantic grammar
// ------------------------------------------------------------
// Rhythm is deliberately absent from this KB.  A LeadRhythmBrick owns rests,
// attacks, gates and accents; this grammar supplies exactly one semantic atom
// for each audible attack requested by the caller.
// ============================================================

import {
  makeGrammar,
  type AbstractMelodyToken,
  type Grammar,
  type GrammarRule,
  type TokenKind,
} from './melodyGrammarTypes';

export const JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES = Object.freeze([
  'pickup',
  'headA',
  'headB',
  'solo',
  'coda',
  'intentionalRest',
] as const);

export type JazzFiveFourLeadGrammarFamily =
  (typeof JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES)[number];

export type JazzFiveFourLeadGrammarProfile =
  | 'family-color'
  | 'structural-anchor-fallback';

export type JazzFiveFourLeadSemanticAtom =
  | 'chord-tone'
  | 'guide-tone'
  | 'scale-tone'
  | 'approach-tone'
  | 'neighbor-tone'
  | 'enclosure-tone';

/** More than enough for a multi-bar 30-cell phrase; guards accidental blow-up. */
export const JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY = 512 as const;

type AudibleJazzFiveFourTokenKind = 'C' | 'G' | 'S' | 'A' | 'L' | 'H';

interface WeightedSemanticTerminal {
  readonly kind: AudibleJazzFiveFourTokenKind;
  readonly weight: number;
  readonly variantId: string;
}

/**
 * Family weights describe semantic tendencies, never a note-for-slot chain.
 * Every attack expands the same weighted `Atom` non-terminal independently,
 * so a seed can vary the line without encoding absolute pitch or intervals.
 */
const FAMILY_TERMINALS: Readonly<Record<JazzFiveFourLeadGrammarFamily, readonly WeightedSemanticTerminal[]>> =
  Object.freeze({
    pickup: Object.freeze([
      Object.freeze({ kind: 'A', weight: 5, variantId: 'approach' }),
      Object.freeze({ kind: 'S', weight: 3, variantId: 'scale-motion' }),
      Object.freeze({ kind: 'G', weight: 2, variantId: 'guide-aim' }),
      Object.freeze({ kind: 'C', weight: 1, variantId: 'chord-anchor' }),
    ]),
    headA: Object.freeze([
      Object.freeze({ kind: 'G', weight: 5, variantId: 'guide-statement' }),
      Object.freeze({ kind: 'C', weight: 4, variantId: 'chord-statement' }),
      Object.freeze({ kind: 'S', weight: 2, variantId: 'modal-link' }),
      Object.freeze({ kind: 'H', weight: 1, variantId: 'soft-enclosure' }),
    ]),
    headB: Object.freeze([
      Object.freeze({ kind: 'S', weight: 4, variantId: 'modal-color' }),
      Object.freeze({ kind: 'L', weight: 3, variantId: 'upper-neighbor' }),
      Object.freeze({ kind: 'G', weight: 3, variantId: 'guide-answer' }),
      Object.freeze({ kind: 'C', weight: 2, variantId: 'answer-anchor' }),
    ]),
    solo: Object.freeze([
      Object.freeze({ kind: 'L', weight: 4, variantId: 'color-neighbor' }),
      Object.freeze({ kind: 'A', weight: 4, variantId: 'chromatic-approach' }),
      Object.freeze({ kind: 'H', weight: 3, variantId: 'enclosure' }),
      Object.freeze({ kind: 'S', weight: 3, variantId: 'scale-flight' }),
      Object.freeze({ kind: 'G', weight: 2, variantId: 'guide-resolution' }),
      Object.freeze({ kind: 'C', weight: 2, variantId: 'chord-resolution' }),
    ]),
    coda: Object.freeze([
      Object.freeze({ kind: 'G', weight: 6, variantId: 'guide-arrival' }),
      Object.freeze({ kind: 'C', weight: 5, variantId: 'chord-arrival' }),
      Object.freeze({ kind: 'S', weight: 1, variantId: 'release-color' }),
      Object.freeze({ kind: 'H', weight: 1, variantId: 'release-enclosure' }),
    ]),
    // The rest itself remains a RhythmBrick slot.  This family supplies the
    // semantic attacks surrounding that protected silence, if there are any.
    intentionalRest: Object.freeze([
      Object.freeze({ kind: 'G', weight: 5, variantId: 'post-rest-guide' }),
      Object.freeze({ kind: 'C', weight: 4, variantId: 'post-rest-anchor' }),
      Object.freeze({ kind: 'A', weight: 2, variantId: 'rest-boundary-approach' }),
      Object.freeze({ kind: 'S', weight: 1, variantId: 'rest-boundary-color' }),
    ]),
  });

/**
 * Bounded Grammar fallback used only after ordinary family-color expansions
 * have failed a score-level structural-slot acceptance check.  It is still a
 * semantic grammar expansion (and remains pitch/timing free); it does not
 * rewrite an already bound note.
 */
const STRUCTURAL_ANCHOR_FALLBACK_TERMINALS: readonly WeightedSemanticTerminal[] = Object.freeze([
  Object.freeze({ kind: 'G', weight: 1, variantId: 'bounded-guide-anchor' }),
  Object.freeze({ kind: 'C', weight: 1, variantId: 'bounded-chord-anchor' }),
]);

const FAMILY_SET = new Set<string>(JAZZ_FIVE_FOUR_LEAD_GRAMMAR_FAMILIES);

function assertFamily(family: string): asserts family is JazzFiveFourLeadGrammarFamily {
  if (!FAMILY_SET.has(family)) {
    throw new Error(`Unknown Jazz 5/4 lead grammar family: ${family}`);
  }
}

function assertAudibleCount(audibleCount: number): void {
  if (
    !Number.isSafeInteger(audibleCount)
    || audibleCount < 0
    || audibleCount > JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY
  ) {
    throw new Error(
      `Jazz 5/4 lead audibleCount must be an integer within 0..${JAZZ_FIVE_FOUR_LEAD_MAX_AUDIBLE_CARDINALITY}`,
    );
  }
}

function abstractTerminal(kind: AudibleJazzFiveFourTokenKind): AbstractMelodyToken {
  // The legacy MG terminal schema requires `duration`.  Zero is an explicit
  // non-owning sentinel here: the downstream SlotBinder takes all timing from
  // LeadRhythmBrick and the semantic mapper below drops this compatibility key.
  return Object.freeze({ kind, duration: 0 }) as AbstractMelodyToken;
}

/**
 * Builds a count-indexed grammar whose expansion cardinality is structural.
 * A balanced `Emit:n` tree keeps recursion shallow; Atom choice remains
 * weighted and seed-random at every leaf.
 */
export function jazzFiveFourLeadGrammar(
  family: JazzFiveFourLeadGrammarFamily,
  audibleCount: number,
  profile: JazzFiveFourLeadGrammarProfile = 'family-color',
): Grammar {
  assertFamily(family);
  assertAudibleCount(audibleCount);
  if (profile !== 'family-color' && profile !== 'structural-anchor-fallback') {
    throw new Error(`Unknown Jazz 5/4 lead grammar profile: ${String(profile)}`);
  }

  const terminals = profile === 'structural-anchor-fallback'
    ? STRUCTURAL_ANCHOR_FALLBACK_TERMINALS
    : FAMILY_TERMINALS[family];
  const profileTag = `profile-${profile}`;

  const rules: GrammarRule[] = [
    {
      lhs: 'Phrase',
      weight: 1,
      metadata: {
        sourceRuleId: `j54-lead:${family}:${profile}:cardinality-${audibleCount}`,
        styleTags: ['jazz_5_4', 'lead_semantic', family, profileTag],
      },
      rhs: audibleCount === 0 ? [] : [`Emit:${audibleCount}`],
    },
  ];

  const pendingCounts = audibleCount > 0 ? [audibleCount] : [];
  const authoredCounts = new Set<number>();
  while (pendingCounts.length > 0) {
    const remaining = pendingCounts.pop()!;
    if (authoredCounts.has(remaining)) continue;
    authoredCounts.add(remaining);
    const leftCount = remaining === 1 ? 0 : Math.floor(remaining / 2);
    const rightCount = remaining - leftCount;
    rules.push({
      lhs: `Emit:${remaining}`,
      weight: 1,
      metadata: {
        sourceRuleId: `j54-lead:${family}:${profile}:emit-${remaining}`,
        styleTags: ['jazz_5_4', 'lead_semantic', family, profileTag],
      },
      rhs: remaining === 1
        ? ['Atom']
        : [`Emit:${leftCount}`, `Emit:${rightCount}`],
    });
    if (remaining > 1) {
      pendingCounts.push(leftCount, rightCount);
    }
  }

  for (const terminal of terminals) {
    rules.push({
      lhs: 'Atom',
      weight: terminal.weight,
      metadata: {
        sourceRuleId: `j54-lead:${family}:${profile}:${terminal.variantId}`,
        styleTags: ['jazz_5_4', 'lead_semantic', family, profileTag, terminal.variantId],
      },
      rhs: [abstractTerminal(terminal.kind)],
    });
  }

  return makeGrammar(rules, 'Phrase');
}

/** Maps an MG compatibility terminal to the timing-free SlotBinder atom. */
export function jazzFiveFourAbstractTokenSemanticAtom(
  tokenOrKind: AbstractMelodyToken | TokenKind,
): JazzFiveFourLeadSemanticAtom | null {
  const kind = typeof tokenOrKind === 'string' ? tokenOrKind : tokenOrKind.kind;
  switch (kind) {
    case 'C':
    case 'B':
    case 'Triadic':
      return 'chord-tone';
    case 'G':
      return 'guide-tone';
    case 'S':
    case 'X':
    case 'Slope':
      return 'scale-tone';
    case 'A':
      return 'approach-tone';
    case 'L':
      return 'neighbor-tone';
    case 'H':
      return 'enclosure-tone';
    case 'R':
    case 'SlopeEnter':
    case 'SlopeExit':
      return null;
  }
}
