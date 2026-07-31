// ============================================================
// newEngine · knowledge · LOFI lead continuity knowledge
// ------------------------------------------------------------
// This is Arranger knowledge, not a renderer-side duration repair. It maps
// the existing LOFI grammar corpus onto a small set of score responsibilities
// and makes short material conditional on a real target.
// ============================================================

import type { TailPolicy } from '../instrumental/InstrumentationPlan';
import type { LofiGrammarTag } from './melodyLofiGrammarTags';

/** The only four top-level writing responsibilities in the LOFI lead score. */
export type LofiLeadScoreRole =
  | 'rest'
  | 'statement-carrier'
  | 'answer-riff'
  | 'return-hold';

/**
 * Short material is semantic, not a free rhythmic density option. The
 * scheduler must see the following target before it admits either class.
 */
export type LofiLeadShortGestureClass =
  | 'answer-riff'
  | 'connected-crawl'
  | 'approach-target';

export interface LofiLeadConditionalGrammarTag {
  readonly tag: 'lofi_short_crawl' | 'lofi_chromatic_neighbor';
  readonly gestureClass: 'connected-crawl' | 'approach-target';
  readonly requiresResolvedTarget: true;
}

export interface LofiLeadContinuityProfile {
  readonly role: LofiLeadScoreRole;
  /** A lone onset followed by at least this much actual air needs a carrier/release decision. */
  readonly exposedGapBeats: number;
  /** Written key-down duration for an exposed single, before any voice-specific decay. */
  readonly minimumWrittenDurationBeats: number;
  readonly releaseGuardBeats: number;
  readonly reentryGuardBeats: number;
  readonly maxOnsetNudgeBeats: number;
  readonly allowedShortGestureClasses: readonly LofiLeadShortGestureClass[];
  readonly allowedGrammarTags: readonly LofiGrammarTag[];
  /** These tags are never admitted as free fragments. */
  readonly conditionalGrammarTags: readonly LofiLeadConditionalGrammarTag[];
}

/** A normal melodic breath, not merely the next grid subdivision. */
export const LOFI_LEAD_EXPOSED_GAP_BEATS = 1.25;
export const LOFI_LEAD_RELEASE_GUARD_BEATS = 0.08;
export const LOFI_LEAD_REENTRY_GUARD_BEATS = 0.0625;
export const LOFI_LEAD_MAX_ONSET_NUDGE_BEATS = 0.125;

const STATEMENT_TAGS = [
  'lofi_hold_answer',
  'lofi_color_hold',
  'lofi_crawl_hold',
  'lofi_vamp_friendly',
] as const satisfies readonly LofiGrammarTag[];

const ANSWER_TAGS = [
  'lofi_parallel_answer',
  'lofi_crawl_hold',
  'lofi_hold_answer',
  'lofi_vamp_friendly',
] as const satisfies readonly LofiGrammarTag[];

const RETURN_TAGS = [
  'lofi_soft_cadence',
  'lofi_hold_answer',
  'lofi_color_hold',
] as const satisfies readonly LofiGrammarTag[];

const REST_TAGS = ['lofi_rest_space'] as const satisfies readonly LofiGrammarTag[];

const NO_SHORT_GESTURES = [] as const satisfies readonly LofiLeadShortGestureClass[];
const STATEMENT_SHORT_GESTURES = ['connected-crawl', 'approach-target'] as const satisfies readonly LofiLeadShortGestureClass[];
const ANSWER_SHORT_GESTURES = ['answer-riff', 'connected-crawl', 'approach-target'] as const satisfies readonly LofiLeadShortGestureClass[];
const RETURN_SHORT_GESTURES = ['approach-target'] as const satisfies readonly LofiLeadShortGestureClass[];

const CRAWL_CONDITION: LofiLeadConditionalGrammarTag = Object.freeze({
  tag: 'lofi_short_crawl',
  gestureClass: 'connected-crawl',
  requiresResolvedTarget: true,
});

const APPROACH_CONDITION: LofiLeadConditionalGrammarTag = Object.freeze({
  tag: 'lofi_chromatic_neighbor',
  gestureClass: 'approach-target',
  requiresResolvedTarget: true,
});

const NO_CONDITIONAL_TAGS = [] as const satisfies readonly LofiLeadConditionalGrammarTag[];
const CRAWL_AND_APPROACH = [CRAWL_CONDITION, APPROACH_CONDITION] as const satisfies readonly LofiLeadConditionalGrammarTag[];
const APPROACH_ONLY = [APPROACH_CONDITION] as const satisfies readonly LofiLeadConditionalGrammarTag[];

/**
 * A written carrier should follow the selected instrument's real envelope.
 * This does not authorize downstream CC generation: it only tells the score
 * writer how much note value is needed before that voice's known decay can be
 * heard musically.
 */
export function lofiLeadMinimumWrittenDurationForTail(tailPolicy?: TailPolicy): number {
  switch (tailPolicy) {
    case 'pad-sustain':
      return 2.5;
    case 'keyboard-natural':
    case 'electric-key-tail':
    case 'piano-pedal-comp':
      return 2;
    case 'wind-breath':
      return 1.5;
    case 'pluck-short':
      // A pluck can decay naturally, but a sixteen-note gate is still not an
      // authored answer across a real breath.
      return 0.75;
    case 'none':
    default:
      return 1.5;
  }
}

/**
 * Resolve the exact score contract for one phrase-bar role. The caller still
 * proves common tones against the concrete HarmonicPlan; no pitch class is
 * guessed here.
 */
export function resolveLofiLeadContinuityProfile(args: {
  readonly role: LofiLeadScoreRole;
  readonly tailPolicy?: TailPolicy;
}): LofiLeadContinuityProfile {
  const minimum = lofiLeadMinimumWrittenDurationForTail(args.tailPolicy);
  const common = {
    exposedGapBeats: LOFI_LEAD_EXPOSED_GAP_BEATS,
    releaseGuardBeats: LOFI_LEAD_RELEASE_GUARD_BEATS,
    reentryGuardBeats: LOFI_LEAD_REENTRY_GUARD_BEATS,
    maxOnsetNudgeBeats: LOFI_LEAD_MAX_ONSET_NUDGE_BEATS,
  } as const;

  switch (args.role) {
    case 'statement-carrier':
      return {
        role: args.role,
        ...common,
        minimumWrittenDurationBeats: minimum,
        allowedShortGestureClasses: STATEMENT_SHORT_GESTURES,
        allowedGrammarTags: STATEMENT_TAGS,
        conditionalGrammarTags: CRAWL_AND_APPROACH,
      };
    case 'answer-riff':
      return {
        role: args.role,
        ...common,
        minimumWrittenDurationBeats: minimum,
        allowedShortGestureClasses: ANSWER_SHORT_GESTURES,
        allowedGrammarTags: ANSWER_TAGS,
        conditionalGrammarTags: CRAWL_AND_APPROACH,
      };
    case 'return-hold':
      return {
        role: args.role,
        ...common,
        // Returns are a resting point even when the selected voice is an EP.
        minimumWrittenDurationBeats: Math.max(2, minimum),
        allowedShortGestureClasses: RETURN_SHORT_GESTURES,
        allowedGrammarTags: RETURN_TAGS,
        conditionalGrammarTags: APPROACH_ONLY,
      };
    case 'rest':
      return {
        role: args.role,
        ...common,
        minimumWrittenDurationBeats: 0,
        allowedShortGestureClasses: NO_SHORT_GESTURES,
        allowedGrammarTags: REST_TAGS,
        conditionalGrammarTags: NO_CONDITIONAL_TAGS,
      };
  }
}
