// ============================================================
// newEngine · knowledge · Jazz 5/4 Drum Vocabulary
// ------------------------------------------------------------
// This module is deliberately independent from an arrangement archetype.
// It describes semantic score material; a later score compiler may select the
// pattern and a kit realizer may project its intents to MIDI pitches.
// ============================================================

export const JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ = 480 as const;
export const JAZZ_FIVE_FOUR_DRUM_BAR_TICKS = 2_400 as const;
export const JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID =
  'drum.jazz-five-four.core-keep-time.source-canonical.v1' as const;

export type JazzFiveFourDrumPatternId = typeof JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID;
export type JazzFiveFourDrumPatternFamily = 'coreKeepTime';
export type JazzFiveFourDrumLane = 'foundation' | 'timekeeper' | 'dialogue';
export type JazzFiveFourDrumHitIntent =
  | 'foundation-anchor'
  | 'timekeeper-pulse'
  | 'dialogue-answer'
  | 'dialogue-ghost';
export type JazzFiveFourDrumKitIntentId =
  | 'acoustic-kick-anchor'
  | 'acoustic-snare-center'
  | 'acoustic-ride-bow';
export type JazzFiveFourDrumSemanticVoice = 'kick' | 'snare' | 'ride';

export interface JazzFiveFourRationalBeat {
  numerator: number;
  denominator: number;
}

/** Semantic target consumed by KitRealization; pattern hits do not own MIDI pitches. */
export interface JazzFiveFourDrumKitIntent {
  id: JazzFiveFourDrumKitIntentId;
  voice: JazzFiveFourDrumSemanticVoice;
  articulation: 'acoustic-kick' | 'snare-center' | 'ride-bow';
  preferredGmPitch: 35 | 40 | 51;
  allowedGmPitches: readonly (35 | 40 | 51)[];
}

/**
 * Reference duration is immutable source evidence. Generative mode may keep
 * that duration or accept an explicit kit-class override in KitRealization;
 * a generic performance pass is not an authorized owner.
 */
export interface JazzFiveFourDrumTriggerGate {
  referenceTicks: 10;
  generative: {
    defaultTicks: 10;
    owner: 'kit-realization';
    overridePolicy: 'explicit-kit-class-profile-only';
  };
}

export interface JazzFiveFourDrumPatternHit {
  id: string;
  phaseBeats: JazzFiveFourRationalBeat;
  lane: JazzFiveFourDrumLane;
  hitIntent: JazzFiveFourDrumHitIntent;
  kitIntentId: JazzFiveFourDrumKitIntentId;
  velocity: number;
  gate: JazzFiveFourDrumTriggerGate;
}

export interface JazzFiveFourDrumPattern {
  id: JazzFiveFourDrumPatternId;
  family: JazzFiveFourDrumPatternFamily;
  meter: { numerator: 5; denominator: 4; beatGrouping: readonly [3, 2] };
  authoredAtPpq: typeof JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ;
  barTicks: typeof JAZZ_FIVE_FOUR_DRUM_BAR_TICKS;
  source: {
    kind: 'source-derived';
    sourceId: 'Take-Five-1.mid';
    sha256: '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1';
    sourcePpq: 192;
    contentOriginTick: 960;
  };
  eligibility: {
    reference: true;
    generative: true;
  };
  /** Arranger selects or omits the complete pattern; it must not drop individual hits. */
  mutationUnit: 'whole-pattern';
  kitIntentAllowlist: readonly JazzFiveFourDrumKitIntentId[];
  gmPitchAllowlist: readonly (35 | 40 | 51)[];
  hits: readonly JazzFiveFourDrumPatternHit[];
}

const SOURCE_TRIGGER_GATE: JazzFiveFourDrumTriggerGate = Object.freeze({
  referenceTicks: 10,
  generative: Object.freeze({
    defaultTicks: 10,
    owner: 'kit-realization',
    overridePolicy: 'explicit-kit-class-profile-only',
  }),
});

export const JAZZ_FIVE_FOUR_DRUM_KIT_INTENTS: Readonly<
  Record<JazzFiveFourDrumKitIntentId, JazzFiveFourDrumKitIntent>
> = Object.freeze({
  'acoustic-kick-anchor': Object.freeze({
    id: 'acoustic-kick-anchor',
    voice: 'kick',
    articulation: 'acoustic-kick',
    preferredGmPitch: 35,
    allowedGmPitches: Object.freeze([35] as const),
  }),
  'acoustic-snare-center': Object.freeze({
    id: 'acoustic-snare-center',
    voice: 'snare',
    articulation: 'snare-center',
    preferredGmPitch: 40,
    allowedGmPitches: Object.freeze([40] as const),
  }),
  'acoustic-ride-bow': Object.freeze({
    id: 'acoustic-ride-bow',
    voice: 'ride',
    articulation: 'ride-bow',
    preferredGmPitch: 51,
    allowedGmPitches: Object.freeze([51] as const),
  }),
});

const beat = (numerator: number, denominator = 1): JazzFiveFourRationalBeat =>
  Object.freeze({ numerator, denominator });

const hit = (
  id: string,
  phaseBeats: JazzFiveFourRationalBeat,
  lane: JazzFiveFourDrumLane,
  hitIntent: JazzFiveFourDrumHitIntent,
  kitIntentId: JazzFiveFourDrumKitIntentId,
  velocity: number,
): JazzFiveFourDrumPatternHit => Object.freeze({
  id,
  phaseBeats,
  lane,
  hitIntent,
  kitIntentId,
  velocity,
  gate: SOURCE_TRIGGER_GATE,
});

/**
 * Canonical one-bar keep-time cell derived from the reference MIDI after the
 * single global content-origin subtraction. It has 12 hits on 10 onsets.
 */
export const JAZZ_FIVE_FOUR_CORE_KEEP_TIME: JazzFiveFourDrumPattern = Object.freeze({
  id: JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID,
  family: 'coreKeepTime',
  meter: Object.freeze({ numerator: 5, denominator: 4, beatGrouping: Object.freeze([3, 2] as const) }),
  authoredAtPpq: JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ,
  barTicks: JAZZ_FIVE_FOUR_DRUM_BAR_TICKS,
  source: Object.freeze({
    kind: 'source-derived',
    sourceId: 'Take-Five-1.mid',
    sha256: '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1',
    sourcePpq: 192,
    contentOriginTick: 960,
  }),
  eligibility: Object.freeze({ reference: true, generative: true }),
  mutationUnit: 'whole-pattern',
  kitIntentAllowlist: Object.freeze([
    'acoustic-kick-anchor',
    'acoustic-snare-center',
    'acoustic-ride-bow',
  ] as const),
  gmPitchAllowlist: Object.freeze([35, 40, 51] as const),
  hits: Object.freeze([
    hit('core-0000-kick', beat(0), 'foundation', 'foundation-anchor', 'acoustic-kick-anchor', 94),
    hit('core-0000-ride', beat(0), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 92),
    hit('core-0480-ride', beat(1), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 92),
    hit('core-0800-snare', beat(5, 3), 'dialogue', 'dialogue-answer', 'acoustic-snare-center', 67),
    hit('core-0960-ride', beat(2), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 92),
    hit('core-1280-ride', beat(8, 3), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 77),
    hit('core-1440-ride', beat(3), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 88),
    hit('core-1440-snare', beat(3), 'dialogue', 'dialogue-answer', 'acoustic-snare-center', 67),
    hit('core-1760-ride', beat(11, 3), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 69),
    hit('core-1920-ride', beat(4), 'timekeeper', 'timekeeper-pulse', 'acoustic-ride-bow', 105),
    hit('core-2080-snare', beat(13, 3), 'dialogue', 'dialogue-ghost', 'acoustic-snare-center', 33),
    hit('core-2240-snare', beat(14, 3), 'dialogue', 'dialogue-answer', 'acoustic-snare-center', 63),
  ]),
});

const JAZZ_FIVE_FOUR_DRUM_PATTERNS: Readonly<
  Record<JazzFiveFourDrumPatternId, JazzFiveFourDrumPattern>
> = Object.freeze({
  [JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID]: JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
});

/** Exact rational projection. Invalid PPQ/phase pairs fail instead of silently quantizing. */
export function jazzFiveFourDrumPhaseTicks(
  phase: JazzFiveFourRationalBeat,
  ppq: number = JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ,
): number {
  if (!Number.isInteger(phase.numerator) || !Number.isInteger(phase.denominator) || phase.denominator <= 0) {
    throw new Error(`Invalid Jazz 5/4 drum phase ${phase.numerator}/${phase.denominator}`);
  }
  const ticks = (phase.numerator * ppq) / phase.denominator;
  if (!Number.isInteger(ticks)) {
    throw new Error(`Jazz 5/4 drum phase ${phase.numerator}/${phase.denominator} is not exact at PPQ ${ppq}`);
  }
  return ticks;
}

/** Pure KB accessor. Selection remains an Arranger responsibility. */
export function jazzFiveFourDrumPattern(
  id: string | undefined,
): JazzFiveFourDrumPattern | undefined {
  return id === JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID
    ? JAZZ_FIVE_FOUR_DRUM_PATTERNS[JAZZ_FIVE_FOUR_CORE_KEEP_TIME_ID]
    : undefined;
}

/** Pure semantic-kit lookup for the future score compiler/KitRealization seam. */
export function jazzFiveFourDrumKitIntent(
  id: JazzFiveFourDrumKitIntentId,
): JazzFiveFourDrumKitIntent {
  return JAZZ_FIVE_FOUR_DRUM_KIT_INTENTS[id];
}
