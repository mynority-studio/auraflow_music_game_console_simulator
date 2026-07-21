// ============================================================
// newEngine · knowledge · Jazz 5/4 Drum phrase vocabulary
// ------------------------------------------------------------
// Complete bar/phrase patterns derived from the supplied performance.  These
// are semantic score materials: Arranger chooses a whole pattern, Kit
// Realization maps intent to a concrete drum, and Renderer only projects it.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import {
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
  JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ,
  jazzFiveFourDrumKitIntent,
  jazzFiveFourDrumPhaseTicks,
  type JazzFiveFourDrumLane,
  type JazzFiveFourRationalBeat,
} from './jazzFiveFourDrumKnowledge';
import { JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256 } from './jazzFiveFourRoleKnowledge';

export type JazzFiveFourDrumPhrasePatternId =
  | 'coreKeepTime'
  | 'rideDevelopmentOverlay'
  | 'snareCrescendo3Beat'
  | 'downbeatBomb'
  | 'rollBombCallResponse2Bar'
  | 'freeSoloPhrase'
  | 'tomOstinato2Bar'
  | 'returnFill'
  | 'lateEndingHit';

export type JazzFiveFourPhraseDrumIntentId =
  | 'kick-anchor'
  | 'snare-center'
  | 'ride-bow'
  | 'low-floor-tom'
  | 'floor-tom'
  | 'low-tom'
  | 'mid-tom'
  | 'high-tom'
  | 'ending-ride-edge';

export type JazzFiveFourDrumPhraseLane = JazzFiveFourDrumLane | 'fill' | 'solo';

export interface JazzFiveFourPhraseDrumIntent {
  readonly id: JazzFiveFourPhraseDrumIntentId;
  readonly semanticVoice: 'kick' | 'snare' | 'ride' | 'tom';
  readonly articulation: string;
  readonly preferredGmPitch: 35 | 40 | 41 | 43 | 45 | 47 | 48 | 51 | 59;
  readonly allowedGmPitches: readonly (35 | 40 | 41 | 43 | 45 | 47 | 48 | 51 | 59)[];
}

export interface JazzFiveFourDrumPhraseHit {
  readonly id: string;
  readonly barOffset: number;
  readonly phase: JazzFiveFourRationalBeat;
  readonly phaseTick: number;
  readonly lane: JazzFiveFourDrumPhraseLane;
  readonly kitIntentId: JazzFiveFourPhraseDrumIntentId;
  readonly velocity: number;
  readonly gateTicks: 10;
}

export interface JazzFiveFourDrumPhrasePattern {
  readonly id: JazzFiveFourDrumPhrasePatternId;
  readonly family:
    | 'timekeeper'
    | 'development-overlay'
    | 'dialogue'
    | 'fill-solo-phrase'
    | 'ending';
  readonly spanBars: number;
  readonly meter: { readonly numerator: 5; readonly denominator: 4; readonly grouping: readonly [3, 2] };
  readonly mutationUnit: 'whole-pattern' | 'whole-phrase';
  readonly referenceCanonical: boolean;
  readonly generativeEligible: boolean;
  readonly density: 'sparse' | 'medium' | 'dense';
  readonly interactionIntent: 'keep-time' | 'answer' | 'solo-space' | 'return-cue' | 'ending-cue';
  readonly requiredAnchorHitIds: readonly string[];
  readonly kitIntentAllowlist: readonly JazzFiveFourPhraseDrumIntentId[];
  readonly mutationBudget: {
    readonly timingResidualMaxTicks: 0;
    readonly velocityScaleMin: number;
    readonly velocityScaleMax: number;
    readonly mayDropIndividualHits: false;
  };
  readonly provenance: {
    readonly authority: 'midi-derived-kb';
    readonly sourceSha256: typeof JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256;
    readonly derivationId: string;
  };
  readonly hits: readonly JazzFiveFourDrumPhraseHit[];
}

export const JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS: Readonly<
  Record<JazzFiveFourPhraseDrumIntentId, JazzFiveFourPhraseDrumIntent>
> = deepFreeze({
  'kick-anchor': {
    id: 'kick-anchor', semanticVoice: 'kick', articulation: 'acoustic-kick',
    preferredGmPitch: 35, allowedGmPitches: [35],
  },
  'snare-center': {
    id: 'snare-center', semanticVoice: 'snare', articulation: 'snare-center',
    preferredGmPitch: 40, allowedGmPitches: [40],
  },
  'ride-bow': {
    id: 'ride-bow', semanticVoice: 'ride', articulation: 'ride-bow',
    preferredGmPitch: 51, allowedGmPitches: [51],
  },
  'low-floor-tom': {
    id: 'low-floor-tom', semanticVoice: 'tom', articulation: 'low-floor-tom',
    preferredGmPitch: 41, allowedGmPitches: [41],
  },
  'floor-tom': {
    id: 'floor-tom', semanticVoice: 'tom', articulation: 'floor-tom',
    preferredGmPitch: 43, allowedGmPitches: [43],
  },
  'low-tom': {
    id: 'low-tom', semanticVoice: 'tom', articulation: 'low-tom',
    preferredGmPitch: 45, allowedGmPitches: [45],
  },
  'mid-tom': {
    id: 'mid-tom', semanticVoice: 'tom', articulation: 'mid-tom',
    preferredGmPitch: 47, allowedGmPitches: [47],
  },
  'high-tom': {
    id: 'high-tom', semanticVoice: 'tom', articulation: 'high-tom',
    preferredGmPitch: 48, allowedGmPitches: [48],
  },
  'ending-ride-edge': {
    id: 'ending-ride-edge', semanticVoice: 'ride', articulation: 'ride-edge-ending-only',
    preferredGmPitch: 59, allowedGmPitches: [59],
  },
});

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function phaseFromTick(phaseTick: number): JazzFiveFourRationalBeat {
  if (!Number.isSafeInteger(phaseTick) || phaseTick < 0 || phaseTick >= 2_400) {
    throw new RangeError(`Invalid Jazz 5/4 drum phrase phase ${phaseTick}`);
  }
  const divisor = gcd(phaseTick, JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ);
  return Object.freeze({
    numerator: phaseTick / divisor,
    denominator: JAZZ_FIVE_FOUR_DRUM_ENGINE_PPQ / divisor,
  });
}

function intentForGmPitch(
  pitch: JazzFiveFourPhraseDrumIntent['preferredGmPitch'],
): JazzFiveFourPhraseDrumIntentId {
  const found = Object.values(JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS)
    .find((intent) => intent.preferredGmPitch === pitch);
  if (!found) throw new Error(`No semantic Jazz 5/4 kit intent for GM pitch ${pitch}`);
  return found.id;
}

function laneFor(intent: JazzFiveFourPhraseDrumIntentId, family: JazzFiveFourDrumPhrasePattern['family']): JazzFiveFourDrumPhraseLane {
  if (family === 'fill-solo-phrase') return 'solo';
  if (family === 'ending') return 'fill';
  if (intent === 'kick-anchor') return 'foundation';
  if (intent === 'ride-bow') return 'timekeeper';
  return 'dialogue';
}

type HitTuple = readonly [barOffset: number, phaseTick: number, gmPitch: JazzFiveFourPhraseDrumIntent['preferredGmPitch'], velocity: number];

function hit(
  patternId: JazzFiveFourDrumPhrasePatternId,
  family: JazzFiveFourDrumPhrasePattern['family'],
  tuple: HitTuple,
  index: number,
): JazzFiveFourDrumPhraseHit {
  const [barOffset, phaseTick, gmPitch, velocity] = tuple;
  const kitIntentId = intentForGmPitch(gmPitch);
  return deepFreeze({
    id: `${patternId}:${barOffset}:${phaseTick}:${kitIntentId}:${index}`,
    barOffset,
    phase: phaseFromTick(phaseTick),
    phaseTick,
    lane: laneFor(kitIntentId, family),
    kitIntentId,
    velocity,
    gateTicks: 10 as const,
  });
}

function pattern(input: {
  id: JazzFiveFourDrumPhrasePatternId;
  family: JazzFiveFourDrumPhrasePattern['family'];
  spanBars: number;
  mutationUnit: JazzFiveFourDrumPhrasePattern['mutationUnit'];
  referenceCanonical?: boolean;
  density: JazzFiveFourDrumPhrasePattern['density'];
  interactionIntent: JazzFiveFourDrumPhrasePattern['interactionIntent'];
  requiredAnchorIndexes: readonly number[];
  velocityScaleMin?: number;
  velocityScaleMax?: number;
  derivationId: string;
  hits: readonly HitTuple[];
}): JazzFiveFourDrumPhrasePattern {
  const hits = input.hits.map((tuple, index) => hit(input.id, input.family, tuple, index));
  if (hits.length === 0 || hits.some((event) => event.barOffset < 0 || event.barOffset >= input.spanBars)) {
    throw new Error(`Invalid Jazz 5/4 Drum phrase span for ${input.id}`);
  }
  const kitIntentAllowlist = [...new Set(hits.map((event) => event.kitIntentId))];
  const requiredAnchorHitIds = input.requiredAnchorIndexes.map((index) => {
    const event = hits[index];
    if (!event) throw new Error(`Invalid required anchor ${index} for ${input.id}`);
    return event.id;
  });
  const result: JazzFiveFourDrumPhrasePattern = {
    id: input.id,
    family: input.family,
    spanBars: input.spanBars,
    meter: { numerator: 5, denominator: 4, grouping: [3, 2] },
    mutationUnit: input.mutationUnit,
    referenceCanonical: input.referenceCanonical ?? false,
    generativeEligible: true,
    density: input.density,
    interactionIntent: input.interactionIntent,
    requiredAnchorHitIds,
    kitIntentAllowlist,
    mutationBudget: {
      timingResidualMaxTicks: 0 as const,
      velocityScaleMin: input.velocityScaleMin ?? 1,
      velocityScaleMax: input.velocityScaleMax ?? 1,
      mayDropIndividualHits: false as const,
    },
    provenance: {
      authority: 'midi-derived-kb' as const,
      sourceSha256: JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
      derivationId: input.derivationId,
    },
    hits,
  };
  deepFreeze(result);
  return result;
}

const coreTuples: HitTuple[] = JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits.map((sourceHit) => {
  const sourceIntent = jazzFiveFourDrumKitIntent(sourceHit.kitIntentId);
  return [0, jazzFiveFourDrumPhaseTicks(sourceHit.phaseBeats), sourceIntent.preferredGmPitch, sourceHit.velocity];
});

export const JAZZ_FIVE_FOUR_DRUM_PHRASE_PATTERNS = deepFreeze([
  pattern({
    id: 'coreKeepTime', family: 'timekeeper', spanBars: 1, mutationUnit: 'whole-pattern',
    referenceCanonical: true, density: 'dense', interactionIntent: 'keep-time',
    requiredAnchorIndexes: [0, 1, 6, 9], derivationId: 'core-a-canonical', hits: coreTuples,
  }),
  pattern({
    id: 'rideDevelopmentOverlay', family: 'development-overlay', spanBars: 1, mutationUnit: 'whole-pattern',
    density: 'dense', interactionIntent: 'answer', requiredAnchorIndexes: [0, 1, 8, 12],
    velocityScaleMin: 0.88, velocityScaleMax: 1.05, derivationId: 'ride-development-a',
    hits: [
      [0, 0, 35, 94], [0, 0, 51, 92], [0, 300, 40, 65], [0, 480, 40, 65],
      [0, 480, 51, 92], [0, 960, 51, 92], [0, 1_260, 40, 75], [0, 1_260, 51, 77],
      [0, 1_440, 51, 88], [0, 1_740, 40, 51], [0, 1_740, 51, 69],
      [0, 1_920, 40, 79], [0, 1_920, 51, 105],
    ],
  }),
  pattern({
    id: 'snareCrescendo3Beat', family: 'dialogue', spanBars: 1, mutationUnit: 'whole-pattern',
    density: 'medium', interactionIntent: 'answer', requiredAnchorIndexes: [0, 8],
    derivationId: 'snare-crescendo-three-beat',
    hits: [
      [0, 0, 40, 41], [0, 120, 40, 41], [0, 240, 40, 51], [0, 360, 40, 51],
      [0, 480, 40, 63], [0, 600, 40, 85], [0, 720, 40, 95], [0, 840, 40, 105],
      [0, 960, 40, 115],
    ],
  }),
  pattern({
    id: 'downbeatBomb', family: 'dialogue', spanBars: 1, mutationUnit: 'whole-pattern',
    density: 'sparse', interactionIntent: 'answer', requiredAnchorIndexes: [0, 1],
    derivationId: 'kick-floor-tom-downbeat-bomb',
    hits: [[0, 0, 35, 108], [0, 0, 43, 127]],
  }),
  pattern({
    id: 'rollBombCallResponse2Bar', family: 'dialogue', spanBars: 2, mutationUnit: 'whole-phrase',
    density: 'medium', interactionIntent: 'answer', requiredAnchorIndexes: [0, 8, 9, 10, 11, 12],
    derivationId: 'roll-bomb-call-response-two-bar',
    hits: [
      [0, 0, 40, 41], [0, 120, 40, 41], [0, 240, 40, 51], [0, 360, 40, 51],
      [0, 480, 40, 63], [0, 600, 40, 85], [0, 720, 40, 95], [0, 840, 40, 105],
      [0, 960, 40, 115], [0, 1_760, 35, 114], [0, 1_760, 41, 127],
      [1, 800, 35, 108], [1, 800, 41, 120],
    ],
  }),
  pattern({
    id: 'freeSoloPhrase', family: 'fill-solo-phrase', spanBars: 4, mutationUnit: 'whole-phrase',
    density: 'sparse', interactionIntent: 'solo-space', requiredAnchorIndexes: [0, 3, 9, 12],
    velocityScaleMin: 0.9, velocityScaleMax: 1.05, derivationId: 'free-solo-four-bar-vocabulary',
    hits: [
      [0, 0, 35, 103], [0, 480, 40, 99], [0, 1_920, 40, 95],
      [1, 0, 35, 83], [1, 0, 43, 100], [1, 800, 45, 80], [1, 1_200, 45, 63],
      [1, 1_280, 43, 100], [1, 1_440, 41, 127],
      [2, 0, 40, 95], [2, 720, 40, 99], [2, 1_440, 40, 105],
      [3, 800, 40, 43], [3, 880, 43, 100], [3, 960, 41, 100], [3, 1_740, 43, 85],
    ],
  }),
  pattern({
    id: 'tomOstinato2Bar', family: 'fill-solo-phrase', spanBars: 2, mutationUnit: 'whole-phrase',
    density: 'medium', interactionIntent: 'solo-space', requiredAnchorIndexes: [0, 5, 6, 11],
    derivationId: 'tom-ostinato-two-bar',
    hits: [
      [0, 55, 43, 120], [0, 160, 41, 66], [0, 475, 45, 127], [0, 720, 43, 114],
      [0, 850, 41, 68], [0, 1_145, 45, 127],
      [1, 780, 43, 85], [1, 1_260, 45, 67], [1, 1_440, 45, 58], [1, 1_740, 41, 66],
      [1, 1_920, 43, 80], [1, 2_220, 41, 80],
    ],
  }),
  pattern({
    id: 'returnFill', family: 'fill-solo-phrase', spanBars: 1, mutationUnit: 'whole-pattern',
    density: 'sparse', interactionIntent: 'return-cue', requiredAnchorIndexes: [0, 1, 4, 5],
    derivationId: 'return-to-core-fill',
    hits: [
      [0, 0, 35, 79], [0, 0, 43, 85], [0, 780, 40, 57], [0, 960, 40, 83],
      [0, 1_440, 43, 85], [0, 1_920, 43, 85],
    ],
  }),
  pattern({
    id: 'lateEndingHit', family: 'ending', spanBars: 1, mutationUnit: 'whole-pattern',
    density: 'sparse', interactionIntent: 'ending-cue', requiredAnchorIndexes: [0, 1],
    derivationId: 'late-ending-hit',
    hits: [[0, 40, 35, 103], [0, 40, 59, 90]],
  }),
] as const);

const PATTERN_BY_ID = new Map(
  JAZZ_FIVE_FOUR_DRUM_PHRASE_PATTERNS.map((entry) => [entry.id, entry] as const),
);

export function jazzFiveFourDrumPhrasePattern(
  id: JazzFiveFourDrumPhrasePatternId,
): DeepReadonly<JazzFiveFourDrumPhrasePattern> {
  const found = PATTERN_BY_ID.get(id);
  if (!found) throw new Error(`Unknown Jazz 5/4 Drum phrase pattern ${id}`);
  return found;
}

export function jazzFiveFourDrumPhraseEventSignature(
  value: DeepReadonly<JazzFiveFourDrumPhrasePattern>,
): readonly string[] {
  return Object.freeze(value.hits.map((event) => {
    const intent = JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS[event.kitIntentId];
    return `${event.barOffset}|${event.phaseTick}|${intent.preferredGmPitch}|${event.velocity}|${event.gateTicks}`;
  }));
}
