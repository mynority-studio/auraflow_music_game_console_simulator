// ============================================================
// newEngine · knowledge · ACG PIANOSONG continuity knowledge
// ------------------------------------------------------------
// This is score-writing knowledge, not a renderer repair or a CC policy.
// The Arranger decides whether an authored event is truly exposed; this KB
// says how that kind of event should retain musical continuity when it is.
// ============================================================

/** A lyrical exposed piano note should normally be at least a half note. */
export const ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS = 2;

/** Leave a small score-owned release before the next harmonic boundary. */
export const ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS = 0.08;

/** A short top-note only becomes a continuity problem after a real breath. */
export const ACG_PIANO_LEAD_EXPOSED_GAP_BEATS = 1.25;

/** Do not collide an authored carrier with the following lead attack. */
export const ACG_PIANO_LEAD_REENTRY_GUARD_BEATS = 0.0625;

/** A scheduler-time nudge may only correct a tiny cycle-spread grid miss. */
export const ACG_PIANO_LEAD_MAX_ONSET_NUDGE_BEATS = 0.125;

/**
 * Shared piano writing knowledge consumed by the Arranger before NoteIR.
 *
 * CC64 is a latched, physical-piano state, so `pedal-default` never means
 * "emit one controller beside every note".  It means that a written attack
 * must occur inside one continuous damper technique unless the score has
 * explicitly proved a connected fast run or an intentional dry release.
 */
export const ACG_PIANO_REST_CONTINUITY_KNOWLEDGE = Object.freeze({
  /** Air this long after key-up is a real written rest, not an absent token. */
  exposedRestBeats: 0.5,
  /** A run needs at least three attacks; one isolated 1/16 never qualifies. */
  fastRunMinimumAttacks: 3,
  /** 1/16 at quarter-note beat resolution. 1/32 is naturally included. */
  fastRunMaximumIoiBeats: 0.25,
  minimumCarrierKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
  releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
  /** Strike the new harmony first, then clear and catch it with the damper. */
  repedalReleaseAfterAttackBeats: 0.02,
  repedalDownAfterAttackBeats: 0.0625,
  /** Do not manufacture a dry hole immediately before a scored re-entry. */
  nearReentryBeats: 0.25,
});

export type AcgPianoWrittenContinuityClass =
  | 'fast-run'
  | 'connected'
  | 'exposed-carrier';

export interface AcgPianoWrittenContinuityIntent {
  readonly continuityClass: AcgPianoWrittenContinuityClass;
  /** Fast runs may use finger connection; all other piano writing defaults to damper support. */
  readonly damperPolicy: 'dry-allowed' | 'pedal-default';
  /** Time between written key-up and the following attack/release horizon. */
  readonly restAfterKeyUpBeats: number;
  readonly minimumKeyDownBeats: number;
  readonly releaseGuardBeats: number;
}

/**
 * Classify an already-authored hand gesture.  The caller proves run length
 * from neighbouring score attacks, so a lone short note followed by air can
 * never accidentally inherit the fast-run exception.
 */
export function resolveAcgPianoWrittenContinuity(args: {
  durationBeats: number;
  restAfterKeyUpBeats: number;
  fastRunAttackCount: number;
}): AcgPianoWrittenContinuityIntent {
  const knowledge = ACG_PIANO_REST_CONTINUITY_KNOWLEDGE;
  const restAfterKeyUpBeats = Math.max(0, args.restAfterKeyUpBeats);
  const fastRun = args.fastRunAttackCount >= knowledge.fastRunMinimumAttacks;
  if (fastRun) {
    return {
      continuityClass: 'fast-run',
      damperPolicy: 'dry-allowed',
      restAfterKeyUpBeats,
      minimumKeyDownBeats: Math.max(0, args.durationBeats),
      releaseGuardBeats: knowledge.releaseGuardBeats,
    };
  }
  return {
    continuityClass: restAfterKeyUpBeats >= knowledge.exposedRestBeats
      ? 'exposed-carrier'
      : 'connected',
    damperPolicy: 'pedal-default',
    restAfterKeyUpBeats,
    minimumKeyDownBeats: knowledge.minimumCarrierKeyDownBeats,
    releaseGuardBeats: knowledge.releaseGuardBeats,
  };
}

/**
 * These are score semantics, not MIDI articulations.  In particular,
 * `release` is an explicit choice to omit an unsafe boundary fragment; it is
 * never permission to leave an accidental 1/8-note carrier in the score.
 */
export type AcgPianoLeadContinuityClass =
  | 'carrier'
  | 'ornament'
  | 'pulse'
  | 'suspension'
  | 'release';

/** Short material is permitted only as an explicitly connected mini-phrase. */
export type AcgPianoLeadShortGestureClass = Exclude<
  AcgPianoLeadContinuityClass,
  'carrier' | 'release'
>;

/** The only legal ways for a lyrical top note to survive a chord change. */
export type AcgPianoLeadBoundaryBridgeKind =
  | 'common-tone'
  | 'dominant-b9'
  | 'release-at-boundary';

/**
 * Phrase-level rule produced by the knowledge base and persisted by the
 * Arranger.  Per-harmony slots refine it with exact span IDs and pitch-class
 * intersections; the scheduler is deliberately not a KB consumer.
 */
export interface AcgPianoLeadContinuityProfile {
  readonly continuityClass: 'carrier';
  readonly exposedGapBeats: number;
  readonly minimumKeyDownBeats: number;
  readonly releaseGuardBeats: number;
  readonly reentryGuardBeats: number;
  /** Small grid correction for any carrier onset; not a renderer-time fix. */
  readonly maxOnsetNudgeBeats: number;
  /** Grammar classes that may remain short when they form a connected riff. */
  readonly allowedShortGestureClasses: readonly AcgPianoLeadShortGestureClass[];
  /** A bass root supports harmony but never shortens a cantabile top note. */
  readonly lowerHandPolicy: 'does-not-shorten-key';
  /** The final top note uses song end as its horizon when there is room. */
  readonly terminalTailPolicy: 'allow-song-end-carrier';
}

export interface ResolveAcgPianoLeadContinuityProfileArgs {
  readonly phase: string;
  readonly phraseGesture: string;
  readonly cadenceTarget: string;
  readonly grammarSubset: string;
  readonly hasPlannedLeadSilence: boolean;
}

const LYRICAL_PIANO_LEAD_PROFILE: AcgPianoLeadContinuityProfile = Object.freeze({
  continuityClass: 'carrier',
  exposedGapBeats: ACG_PIANO_LEAD_EXPOSED_GAP_BEATS,
  minimumKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
  releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
  reentryGuardBeats: ACG_PIANO_LEAD_REENTRY_GUARD_BEATS,
  maxOnsetNudgeBeats: ACG_PIANO_LEAD_MAX_ONSET_NUDGE_BEATS,
  allowedShortGestureClasses: ['ornament', 'pulse', 'suspension'] as const,
  lowerHandPolicy: 'does-not-shorten-key',
  terminalTailPolicy: 'allow-song-end-carrier',
});

/**
 * Translate researched lyrical-piano practice into an arranger-owned
 * contract.  The current ACG vocabulary remains cantabile in every phrase:
 * opening/coda can be sparser, but a genuinely exposed top-line single still
 * needs a written carrier or an explicit release.  The arguments are kept in
 * the API so future phrase profiles can specialize this knowledge without
 * making the scheduler the style authority again.
 */
export function resolveAcgPianoLeadContinuityProfile(
  _args: ResolveAcgPianoLeadContinuityProfileArgs,
): AcgPianoLeadContinuityProfile {
  return LYRICAL_PIANO_LEAD_PROFILE;
}

export type AcgPianoContinuityRole = 'comp' | 'bass';

export type AcgPianoContinuityTarget = 'minimum-key-hold' | 'release-boundary';

export interface AcgPianoContinuityRule {
  /** Traceable musical reason; it never authorizes a controller event. */
  readonly reason: 'arrival-single-carrier' | 'full-breath-root-carrier';
  readonly target: AcgPianoContinuityTarget;
  readonly minimumKeyDownBeats: number;
  readonly releaseGuardBeats: number;
}

export interface ResolveAcgPianoContinuityRuleArgs {
  readonly role: AcgPianoContinuityRole;
  readonly sentenceId: string;
  readonly gesture: string;
  readonly voice: string;
  readonly eventRole?: string;
  /** The Arranger has checked every authored comp/bass onset in this slice. */
  readonly isTerminalCarrier: boolean;
  /** `low|inner-low|inner-high|high` are deterministic one-note score selections. */
  readonly isSingleVoice: boolean;
}

const EXPLICIT_SHORT_COMP_GESTURES = new Set([
  'pulse',
  'answer-dyad',
  'dyad-riff',
  'late-question',
  'tremolo-color',
]);

const ARRIVAL_SINGLE_CARRIER_RULE: AcgPianoContinuityRule = Object.freeze({
  reason: 'arrival-single-carrier',
  target: 'minimum-key-hold',
  minimumKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
  releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
});

const FULL_BREATH_ROOT_CARRIER_RULE: AcgPianoContinuityRule = Object.freeze({
  reason: 'full-breath-root-carrier',
  target: 'release-boundary',
  minimumKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
  releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
});

/**
 * Resolve a legal piano-continuity request from already-authored score facts.
 *
 * Deliberately absent: program, pedal, CC, MIDI timing, and final NoteIR.
 * Those are not arranger knowledge. A caller still has to respect the next
 * attack and the current harmonic/phrase release boundary before applying a
 * returned rule.
 */
export function resolveAcgPianoContinuityRule(
  args: ResolveAcgPianoContinuityRuleArgs,
): AcgPianoContinuityRule | undefined {
  if (!args.isTerminalCarrier) return undefined;

  // A full-breath sentence has no middle-hand attack. Its lone bass root is
  // the written resonance carrier, so it should bloom through the authored
  // air rather than release after the legacy short root gate.
  if (args.role === 'bass' && args.sentenceId === 'full-breath' && args.voice === 'root') {
    return FULL_BREATH_ROOT_CARRIER_RULE;
  }

  // A terminal, one-note arrival is musical material, not an arp interior.
  // Pulse/riff vocabulary remains intentionally short even when it happens to
  // be the last onset in a slice.
  if (args.role === 'comp'
    && args.isSingleVoice
    && args.eventRole === 'arrival'
    && !EXPLICIT_SHORT_COMP_GESTURES.has(args.gesture)) {
    return ARRIVAL_SINGLE_CARRIER_RULE;
  }

  return undefined;
}
