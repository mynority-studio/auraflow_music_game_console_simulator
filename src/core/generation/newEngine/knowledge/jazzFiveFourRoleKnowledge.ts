// ============================================================
// newEngine · knowledge · Jazz 5/4 role vocabulary
// ------------------------------------------------------------
// Product-runtime knowledge derived from the reference MIDI. Unlike the
// read-only evidence oracle, these cells are reusable musical material: they
// contain bar-local rational timing and semantic actions only. Source-global
// bars, absolute ticks and origin metadata intentionally do not belong here.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';

export const JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ = 480 as const;
export const JAZZ_FIVE_FOUR_ROLE_BAR_TICKS = 2_400 as const;
export const JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS = 1_440 as const;
export const JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256 =
  '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1' as const;

export const JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY =
  'role.jazz-five-four.piano-foundation-a.source-canonical.v1' as const;
export const JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY =
  'role.jazz-five-four.piano-upper-comp-a.source-canonical.v1' as const;
export const JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY =
  'role.jazz-five-four.acoustic-bass-a.source-canonical.v1' as const;

export type JazzFiveFourRoleFamily =
  | typeof JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY
  | typeof JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY
  | typeof JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY;

export type JazzFiveFourRoleSublayer =
  | 'piano-foundation'
  | 'piano-upper-comp'
  | 'acoustic-bass';

export interface JazzFiveFourRationalBeat {
  readonly numerator: number;
  readonly denominator: number;
}

export interface JazzFiveFourRoleTiming {
  /** Exact bar-local duration/phase expressed in quarter-note beats. */
  readonly beats: JazzFiveFourRationalBeat;
  /** Exact projection at the product engine's PPQ480 clock. */
  readonly engineTicks: number;
}

export interface JazzFiveFourSourcePitch {
  readonly midi: number;
}

export type JazzFiveFourRegisterGesture =
  | {
      readonly kind: 'source-relative-octave';
      readonly sourceMidi: number;
    }
  | {
      readonly kind: 'ascending-chord-voice';
      readonly voiceIndex: 0 | 1 | 2;
    };

export type JazzFiveFourSemanticAction =
  | { readonly kind: 'harmony-bass-anchor' }
  | {
      readonly kind: 'rootless-chord-tone';
      readonly voiceIndex: 0 | 1 | 2;
    };

interface JazzFiveFourRoleCellBase {
  readonly family: JazzFiveFourRoleFamily;
  readonly sublayer: JazzFiveFourRoleSublayer;
  readonly cellId: string;
  readonly phase: JazzFiveFourRoleTiming;
  readonly duration: JazzFiveFourRoleTiming;
  readonly velocity: number;
  readonly sourcePitch: JazzFiveFourSourcePitch;
  readonly sourceSha256: typeof JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256;
}

export interface JazzFiveFourFoundationCell extends JazzFiveFourRoleCellBase {
  readonly sublayer: 'piano-foundation' | 'acoustic-bass';
  readonly registerGesture: Extract<JazzFiveFourRegisterGesture, { kind: 'source-relative-octave' }>;
  readonly semanticAction: Extract<JazzFiveFourSemanticAction, { kind: 'harmony-bass-anchor' }>;
}

export interface JazzFiveFourUpperCompCell extends JazzFiveFourRoleCellBase {
  readonly sublayer: 'piano-upper-comp';
  readonly registerGesture: Extract<JazzFiveFourRegisterGesture, { kind: 'ascending-chord-voice' }>;
  readonly semanticAction: Extract<JazzFiveFourSemanticAction, { kind: 'rootless-chord-tone' }>;
}

export type JazzFiveFourRoleCell = JazzFiveFourFoundationCell | JazzFiveFourUpperCompCell;

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function rationalBeat(numerator: number, denominator = 1): JazzFiveFourRationalBeat {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`Invalid Jazz 5/4 rational beat ${numerator}/${denominator}`);
  }
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

export function jazzFiveFourRoleBeatToEngineTicks(
  beat: JazzFiveFourRationalBeat,
  ppq: number = JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
): number {
  if (
    !Number.isSafeInteger(beat.numerator)
    || !Number.isSafeInteger(beat.denominator)
    || beat.denominator <= 0
    || !Number.isSafeInteger(ppq)
    || ppq <= 0
  ) {
    throw new RangeError(`Invalid Jazz 5/4 beat/PPQ ${beat.numerator}/${beat.denominator} @ ${ppq}`);
  }
  const ticks = beat.numerator * ppq / beat.denominator;
  if (!Number.isSafeInteger(ticks)) {
    throw new RangeError(`Jazz 5/4 beat ${beat.numerator}/${beat.denominator} is not exact at PPQ ${ppq}`);
  }
  return ticks;
}

function timing(numerator: number, denominator = 1): JazzFiveFourRoleTiming {
  const beats = rationalBeat(numerator, denominator);
  return Object.freeze({ beats, engineTicks: jazzFiveFourRoleBeatToEngineTicks(beats) });
}

function foundationCell(input: {
  family: typeof JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY | typeof JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY;
  sublayer: 'piano-foundation' | 'acoustic-bass';
  cellId: string;
  phase: JazzFiveFourRoleTiming;
  duration: JazzFiveFourRoleTiming;
  velocity: number;
  sourceMidi: number;
}): JazzFiveFourFoundationCell {
  return deepFreeze({
    family: input.family,
    sublayer: input.sublayer,
    cellId: input.cellId,
    phase: input.phase,
    duration: input.duration,
    velocity: input.velocity,
    sourcePitch: { midi: input.sourceMidi },
    registerGesture: { kind: 'source-relative-octave' as const, sourceMidi: input.sourceMidi },
    semanticAction: { kind: 'harmony-bass-anchor' as const },
    sourceSha256: JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
  });
}

function upperCompCell(input: {
  cellId: string;
  phase: JazzFiveFourRoleTiming;
  duration: JazzFiveFourRoleTiming;
  velocity: number;
  sourceMidi: number;
  voiceIndex: 0 | 1 | 2;
}): JazzFiveFourUpperCompCell {
  return deepFreeze({
    family: JAZZ_FIVE_FOUR_UPPER_COMP_FAMILY,
    sublayer: 'piano-upper-comp' as const,
    cellId: input.cellId,
    phase: input.phase,
    duration: input.duration,
    velocity: input.velocity,
    sourcePitch: { midi: input.sourceMidi },
    registerGesture: { kind: 'ascending-chord-voice' as const, voiceIndex: input.voiceIndex },
    semanticAction: { kind: 'rootless-chord-tone' as const, voiceIndex: input.voiceIndex },
    sourceSha256: JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
  });
}

/** Low piano sublayer. Arranger may assign it to Bass or the full-piano Comp role. */
export const JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS = deepFreeze([
  foundationCell({
    family: JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY,
    sublayer: 'piano-foundation',
    cellId: 'piano-foundation-1',
    phase: timing(0), duration: timing(43, 96), velocity: 76, sourceMidi: 39,
  }),
  foundationCell({
    family: JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY,
    sublayer: 'piano-foundation',
    cellId: 'piano-foundation-2',
    phase: timing(157, 96), duration: timing(5, 16), velocity: 94, sourceMidi: 39,
  }),
  foundationCell({
    family: JAZZ_FIVE_FOUR_PIANO_FOUNDATION_FAMILY,
    sublayer: 'piano-foundation',
    cellId: 'piano-foundation-3',
    phase: timing(3), duration: timing(139, 96), velocity: 90, sourceMidi: 46,
  }),
] as const);

/** Rootless three-voice upper piano attacks; each voice retains its own gate/velocity. */
export const JAZZ_FIVE_FOUR_UPPER_COMP_CELLS = deepFreeze([
  upperCompCell({ cellId: 'piano-upper-1-low', phase: timing(61, 96), duration: timing(5, 32), velocity: 90, sourceMidi: 54, voiceIndex: 0 }),
  upperCompCell({ cellId: 'piano-upper-1-mid', phase: timing(61, 96), duration: timing(1, 12), velocity: 68, sourceMidi: 58, voiceIndex: 1 }),
  upperCompCell({ cellId: 'piano-upper-1-high', phase: timing(61, 96), duration: timing(1, 6), velocity: 86, sourceMidi: 63, voiceIndex: 2 }),
  upperCompCell({ cellId: 'piano-upper-2-low', phase: timing(2), duration: timing(23, 96), velocity: 90, sourceMidi: 54, voiceIndex: 0 }),
  upperCompCell({ cellId: 'piano-upper-2-mid', phase: timing(2), duration: timing(11, 96), velocity: 86, sourceMidi: 58, voiceIndex: 1 }),
  upperCompCell({ cellId: 'piano-upper-2-high', phase: timing(2), duration: timing(13, 96), velocity: 68, sourceMidi: 63, voiceIndex: 2 }),
  upperCompCell({ cellId: 'piano-upper-3-low', phase: timing(4), duration: timing(1, 3), velocity: 72, sourceMidi: 53, voiceIndex: 0 }),
  upperCompCell({ cellId: 'piano-upper-3-mid', phase: timing(4), duration: timing(1, 3), velocity: 94, sourceMidi: 56, voiceIndex: 1 }),
  upperCompCell({ cellId: 'piano-upper-3-high', phase: timing(4), duration: timing(11, 32), velocity: 90, sourceMidi: 61, voiceIndex: 2 }),
] as const);

/** Acoustic bass foundation used by the reference-quartet orchestration. */
export const JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS = deepFreeze([
  foundationCell({
    family: JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY,
    sublayer: 'acoustic-bass',
    cellId: 'acoustic-bass-1',
    phase: timing(0), duration: timing(39, 16), velocity: 84, sourceMidi: 39,
  }),
  foundationCell({
    family: JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY,
    sublayer: 'acoustic-bass',
    cellId: 'acoustic-bass-2',
    phase: timing(3), duration: timing(73, 96), velocity: 65, sourceMidi: 46,
  }),
  foundationCell({
    family: JAZZ_FIVE_FOUR_ACOUSTIC_BASS_FAMILY,
    sublayer: 'acoustic-bass',
    cellId: 'acoustic-bass-3',
    phase: timing(4), duration: timing(19, 32), velocity: 65, sourceMidi: 34,
  }),
] as const);

export const JAZZ_FIVE_FOUR_ROLE_KB = deepFreeze({
  schemaVersion: 1 as const,
  clock: {
    ppq: JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
    meter: { numerator: 5 as const, denominator: 4 as const },
    grouping: [3, 2] as const,
    barTicks: JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
    groupBoundaryTick: JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS,
  },
  cellsBySublayer: {
    'piano-foundation': JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
    'piano-upper-comp': JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
    'acoustic-bass': JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  },
});

/** Pure product-KB accessor; reference evidence is intentionally not reachable here. */
export function jazzFiveFourRoleCells(
  sublayer: JazzFiveFourRoleSublayer,
): readonly DeepReadonly<JazzFiveFourRoleCell>[] {
  return JAZZ_FIVE_FOUR_ROLE_KB.cellsBySublayer[sublayer];
}
