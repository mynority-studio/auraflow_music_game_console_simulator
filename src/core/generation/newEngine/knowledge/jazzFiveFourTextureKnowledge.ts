// ============================================================
// newEngine · knowledge · Jazz 5/4 Bass/Comp texture families
// ------------------------------------------------------------
// Pitchless semantic texture vocabulary.  It preserves the reference timing,
// gate and velocity evidence while leaving concrete pitch/register/voicing to
// the post-harmony ScoreCompiler.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
  jazzFiveFourRoleBeatToEngineTicks,
  type JazzFiveFourRationalBeat,
} from './jazzFiveFourRoleKnowledge';

export type JazzFiveFourTextureSublayer = 'foundation' | 'upper';
export type JazzFiveFourVelocityTier = 'breakdown' | 'support' | 'accent' | 'arrival';
export type JazzFiveFourTextureAuthority = 'midi-derived-kb' | 'generative-extension';
export type JazzFiveFourHarmonicToneIntent =
  | 'current-root'
  | 'pedal-current-root'
  | 'approach-next-root'
  | 'guide-third'
  | 'guide-seventh'
  | 'upper-extension';
export type JazzFiveFourVoicingIntent =
  | 'foundation-register-gesture'
  | 'nearest-rootless-shell'
  | 'nearest-upper-structure';

export interface JazzFiveFourTextureTiming {
  readonly beats: JazzFiveFourRationalBeat;
  readonly engineTicks: number;
}
export interface JazzFiveFourTextureProvenance {
  readonly authority: JazzFiveFourTextureAuthority;
  readonly sourceFamilyId: string;
  readonly sourceCellId?: string;
  readonly sourceSha256?: string;
}

export interface JazzFiveFourTextureCell {
  readonly id: string;
  readonly sublayer: JazzFiveFourTextureSublayer;
  readonly phase: JazzFiveFourTextureTiming;
  readonly gate: JazzFiveFourTextureTiming;
  readonly velocityTier: JazzFiveFourVelocityTier;
  readonly referenceVelocity: number;
  readonly harmonicToneIntent: JazzFiveFourHarmonicToneIntent;
  readonly voicingIntent: JazzFiveFourVoicingIntent;
  readonly voiceIndex?: 0 | 1 | 2;
  readonly provenance: JazzFiveFourTextureProvenance;
}

export type JazzFiveFourPianoTextureVariantId =
  | 'a.full'
  | 'a.foundationOnly'
  | 'a.upperOnly'
  | 'a.fill'
  | 'b.body.full'
  | 'b.body.foundationOnly'
  | 'b.body.upperOnly'
  | 'b.turnaround.full'
  | 'b.turnaround.foundationOnly'
  | 'b.turnaround.upperOnly'
  | 'ending.hold';

export interface JazzFiveFourPianoTextureVariant {
  readonly id: JazzFiveFourPianoTextureVariantId;
  readonly familyId: 'kb.texture.jazz_5_4.cool_piano_interlock';
  readonly phraseRole: 'base' | 'fill' | 'bridge-body' | 'turnaround' | 'ending';
  readonly mutationUnit: 'whole-bar' | 'whole-phrase';
  readonly selectedCellIds: readonly string[];
}

export type JazzFiveFourBassTextureVariantId =
  | 'keyboardFoundation.a'
  | 'acoustic.a'
  | 'bridge.body'
  | 'bridge.turnaround'
  | 'ending.lift'
  | 'ending.hold';

export interface JazzFiveFourBassTextureVariant {
  readonly id: JazzFiveFourBassTextureVariantId;
  readonly familyId: 'kb.bass.jazz_5_4.ostinato';
  readonly phraseRole: 'base' | 'bridge-body' | 'turnaround' | 'ending';
  readonly mutationUnit: 'whole-bar' | 'whole-phrase';
  readonly selectedCellIds: readonly string[];
  readonly registerOctaveShift: 0 | 1;
}

export type JazzFiveFourFoundationMode =
  | 'keyboardBassOnly'
  | 'compOwnsFoundation'
  | 'acousticBass+upperComp'
  | 'acousticBass+fullPiano';

export interface JazzFiveFourFoundationModePolicy {
  readonly id: JazzFiveFourFoundationMode;
  readonly bassActive: boolean;
  readonly compFoundationActive: boolean;
  readonly compUpperActive: boolean;
  readonly allowsLowRegisterDoubling: boolean;
  readonly foundationOwner: 'bass' | 'comp';
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function beat(numerator: number, denominator = 1): JazzFiveFourRationalBeat {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`Invalid Jazz 5/4 texture beat ${numerator}/${denominator}`);
  }
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function timing(beats: JazzFiveFourRationalBeat): JazzFiveFourTextureTiming {
  return Object.freeze({ beats, engineTicks: jazzFiveFourRoleBeatToEngineTicks(beats) });
}

function velocityTier(velocity: number): JazzFiveFourVelocityTier {
  if (velocity < 64) return 'breakdown';
  if (velocity < 80) return 'support';
  if (velocity < 94) return 'accent';
  return 'arrival';
}

function foundationCell(
  source: (typeof JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS)[number]
    | (typeof JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS)[number],
  sourceFamilyId: string,
): JazzFiveFourTextureCell {
  return deepFreeze({
    id: source.cellId,
    sublayer: 'foundation' as const,
    phase: timing(source.phase.beats),
    gate: timing(source.duration.beats),
    velocityTier: velocityTier(source.velocity),
    referenceVelocity: source.velocity,
    harmonicToneIntent: 'current-root' as const,
    voicingIntent: 'foundation-register-gesture' as const,
    provenance: {
      authority: 'midi-derived-kb' as const,
      sourceFamilyId,
      sourceCellId: source.cellId,
      sourceSha256: JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
    },
  });
}

function upperCell(
  source: (typeof JAZZ_FIVE_FOUR_UPPER_COMP_CELLS)[number],
): JazzFiveFourTextureCell {
  const voiceIndex = source.semanticAction.voiceIndex;
  const harmonicToneIntent = voiceIndex === 0
    ? 'guide-third'
    : voiceIndex === 1
      ? 'guide-seventh'
      : 'upper-extension';
  return deepFreeze({
    id: source.cellId,
    sublayer: 'upper' as const,
    phase: timing(source.phase.beats),
    gate: timing(source.duration.beats),
    velocityTier: velocityTier(source.velocity),
    referenceVelocity: source.velocity,
    harmonicToneIntent,
    voicingIntent: voiceIndex === 2 ? 'nearest-upper-structure' as const : 'nearest-rootless-shell' as const,
    voiceIndex,
    provenance: {
      authority: 'midi-derived-kb' as const,
      sourceFamilyId: source.family,
      sourceCellId: source.cellId,
      sourceSha256: JAZZ_FIVE_FOUR_ROLE_SOURCE_SHA256,
    },
  });
}

function extensionCell(input: {
  id: string;
  sublayer: JazzFiveFourTextureSublayer;
  phase: JazzFiveFourRationalBeat;
  gate: JazzFiveFourRationalBeat;
  velocity: number;
  harmonicToneIntent: JazzFiveFourHarmonicToneIntent;
  voicingIntent: JazzFiveFourVoicingIntent;
  sourceFamilyId: string;
}): JazzFiveFourTextureCell {
  return deepFreeze({
    id: input.id,
    sublayer: input.sublayer,
    phase: timing(input.phase),
    gate: timing(input.gate),
    velocityTier: velocityTier(input.velocity),
    referenceVelocity: input.velocity,
    harmonicToneIntent: input.harmonicToneIntent,
    voicingIntent: input.voicingIntent,
    provenance: {
      authority: 'generative-extension' as const,
      sourceFamilyId: input.sourceFamilyId,
    },
  });
}

const PIANO_FOUNDATION_CELLS = JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS.map((cell) =>
  foundationCell(cell, cell.family));
const PIANO_UPPER_CELLS = JAZZ_FIVE_FOUR_UPPER_COMP_CELLS.map(upperCell);
const PIANO_FILL_CELL = extensionCell({
  id: 'piano-upper-fill-14-3', sublayer: 'upper', phase: beat(14, 3), gate: beat(1, 6), velocity: 96,
  harmonicToneIntent: 'guide-seventh', voicingIntent: 'nearest-rootless-shell',
  sourceFamilyId: 'kb.texture.jazz_5_4.cool_piano_interlock.a.fill',
});
const PIANO_ENDING_HOLD = extensionCell({
  id: 'piano-ending-hold', sublayer: 'upper', phase: beat(0), gate: beat(5), velocity: 86,
  harmonicToneIntent: 'guide-third', voicingIntent: 'nearest-rootless-shell',
  sourceFamilyId: 'kb.texture.jazz_5_4.cool_piano_interlock.ending.hold',
});

export const JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS = deepFreeze([
  ...PIANO_FOUNDATION_CELLS,
  ...PIANO_UPPER_CELLS,
  PIANO_FILL_CELL,
  PIANO_ENDING_HOLD,
] as const);

const foundationIds = PIANO_FOUNDATION_CELLS.map((cell) => cell.id);
const upperIds = PIANO_UPPER_CELLS.map((cell) => cell.id);
const upperBodyIds = PIANO_UPPER_CELLS.filter((cell) => cell.phase.engineTicks !== 960).map((cell) => cell.id);
const upperTurnIds = PIANO_UPPER_CELLS.filter((cell) => cell.phase.engineTicks !== 1_920).map((cell) => cell.id);

function pianoVariant(
  id: JazzFiveFourPianoTextureVariantId,
  phraseRole: JazzFiveFourPianoTextureVariant['phraseRole'],
  selectedCellIds: readonly string[],
  mutationUnit: JazzFiveFourPianoTextureVariant['mutationUnit'] = 'whole-phrase',
): JazzFiveFourPianoTextureVariant {
  return deepFreeze({
    id,
    familyId: 'kb.texture.jazz_5_4.cool_piano_interlock' as const,
    phraseRole,
    mutationUnit,
    selectedCellIds,
  });
}

export const JAZZ_FIVE_FOUR_PIANO_TEXTURE_VARIANTS = deepFreeze([
  pianoVariant('a.full', 'base', [...foundationIds, ...upperIds]),
  pianoVariant('a.foundationOnly', 'base', foundationIds),
  pianoVariant('a.upperOnly', 'base', upperIds),
  pianoVariant('a.fill', 'fill', [...foundationIds, ...upperIds, PIANO_FILL_CELL.id], 'whole-bar'),
  pianoVariant('b.body.full', 'bridge-body', [...foundationIds, ...upperBodyIds]),
  pianoVariant('b.body.foundationOnly', 'bridge-body', foundationIds),
  pianoVariant('b.body.upperOnly', 'bridge-body', upperBodyIds),
  pianoVariant('b.turnaround.full', 'turnaround', [...foundationIds, ...upperTurnIds], 'whole-bar'),
  pianoVariant('b.turnaround.foundationOnly', 'turnaround', foundationIds, 'whole-bar'),
  pianoVariant('b.turnaround.upperOnly', 'turnaround', upperTurnIds, 'whole-bar'),
  pianoVariant('ending.hold', 'ending', [PIANO_FOUNDATION_CELLS[0]!.id, PIANO_ENDING_HOLD.id], 'whole-bar'),
] as const);

const ACOUSTIC_A_CELLS = JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS.map((cell) => foundationCell(cell, cell.family));
const KEYBOARD_A_CELLS = PIANO_FOUNDATION_CELLS.map((cell) => deepFreeze({
  ...cell,
  id: `bass-${cell.id}`,
  provenance: { ...cell.provenance, sourceFamilyId: 'kb.bass.jazz_5_4.ostinato.keyboardFoundation.a' },
}));
const BRIDGE_APPROACH_CELL = extensionCell({
  id: 'bass-bridge-approach-5-3', sublayer: 'foundation', phase: beat(5, 3), gate: beat(73, 48), velocity: 72,
  harmonicToneIntent: 'approach-next-root', voicingIntent: 'foundation-register-gesture',
  sourceFamilyId: 'kb.bass.jazz_5_4.ostinato.bridge.turnaround',
});
const BASS_ENDING_HOLD = extensionCell({
  id: 'bass-ending-hold', sublayer: 'foundation', phase: beat(0), gate: beat(5), velocity: 88,
  harmonicToneIntent: 'current-root', voicingIntent: 'foundation-register-gesture',
  sourceFamilyId: 'kb.bass.jazz_5_4.ostinato.ending.hold',
});

export const JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS = deepFreeze([
  ...ACOUSTIC_A_CELLS,
  ...KEYBOARD_A_CELLS,
  BRIDGE_APPROACH_CELL,
  BASS_ENDING_HOLD,
] as const);

function bassVariant(
  id: JazzFiveFourBassTextureVariantId,
  phraseRole: JazzFiveFourBassTextureVariant['phraseRole'],
  selectedCellIds: readonly string[],
  registerOctaveShift: 0 | 1 = 0,
  mutationUnit: JazzFiveFourBassTextureVariant['mutationUnit'] = 'whole-phrase',
): JazzFiveFourBassTextureVariant {
  return deepFreeze({
    id,
    familyId: 'kb.bass.jazz_5_4.ostinato' as const,
    phraseRole,
    mutationUnit,
    selectedCellIds,
    registerOctaveShift,
  });
}

const acousticIds = ACOUSTIC_A_CELLS.map((cell) => cell.id);
const keyboardIds = KEYBOARD_A_CELLS.map((cell) => cell.id);
export const JAZZ_FIVE_FOUR_BASS_TEXTURE_VARIANTS = deepFreeze([
  bassVariant('keyboardFoundation.a', 'base', keyboardIds),
  bassVariant('acoustic.a', 'base', acousticIds),
  bassVariant('bridge.body', 'bridge-body', acousticIds),
  bassVariant('bridge.turnaround', 'turnaround', [
    ACOUSTIC_A_CELLS[0]!.id,
    BRIDGE_APPROACH_CELL.id,
    ACOUSTIC_A_CELLS[1]!.id,
    ACOUSTIC_A_CELLS[2]!.id,
  ], 0, 'whole-bar'),
  bassVariant('ending.lift', 'ending', acousticIds, 1),
  bassVariant('ending.hold', 'ending', [BASS_ENDING_HOLD.id], 0, 'whole-bar'),
] as const);

export const JAZZ_FIVE_FOUR_FOUNDATION_MODES: Readonly<
  Record<JazzFiveFourFoundationMode, JazzFiveFourFoundationModePolicy>
> = deepFreeze({
  keyboardBassOnly: {
    id: 'keyboardBassOnly', bassActive: true, compFoundationActive: false, compUpperActive: false,
    allowsLowRegisterDoubling: false, foundationOwner: 'bass',
  },
  compOwnsFoundation: {
    id: 'compOwnsFoundation', bassActive: false, compFoundationActive: true, compUpperActive: true,
    allowsLowRegisterDoubling: false, foundationOwner: 'comp',
  },
  'acousticBass+upperComp': {
    id: 'acousticBass+upperComp', bassActive: true, compFoundationActive: false, compUpperActive: true,
    allowsLowRegisterDoubling: false, foundationOwner: 'bass',
  },
  'acousticBass+fullPiano': {
    id: 'acousticBass+fullPiano', bassActive: true, compFoundationActive: true, compUpperActive: true,
    allowsLowRegisterDoubling: true, foundationOwner: 'bass',
  },
});

function cellById(
  cells: readonly DeepReadonly<JazzFiveFourTextureCell>[],
  id: string,
): DeepReadonly<JazzFiveFourTextureCell> {
  const found = cells.find((cell) => cell.id === id);
  if (!found) throw new Error(`Unknown Jazz 5/4 texture cell ${id}`);
  return found;
}

export function jazzFiveFourPianoTextureVariant(
  id: JazzFiveFourPianoTextureVariantId,
): DeepReadonly<JazzFiveFourPianoTextureVariant> {
  const found = JAZZ_FIVE_FOUR_PIANO_TEXTURE_VARIANTS.find((variant) => variant.id === id);
  if (!found) throw new Error(`Unknown Jazz 5/4 piano texture variant ${id}`);
  return found;
}

export function jazzFiveFourBassTextureVariant(
  id: JazzFiveFourBassTextureVariantId,
): DeepReadonly<JazzFiveFourBassTextureVariant> {
  const found = JAZZ_FIVE_FOUR_BASS_TEXTURE_VARIANTS.find((variant) => variant.id === id);
  if (!found) throw new Error(`Unknown Jazz 5/4 bass texture variant ${id}`);
  return found;
}

export function jazzFiveFourPianoTextureCells(
  id: JazzFiveFourPianoTextureVariantId,
): readonly DeepReadonly<JazzFiveFourTextureCell>[] {
  return jazzFiveFourPianoTextureVariant(id).selectedCellIds.map((cellId) =>
    cellById(JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS, cellId));
}

export function jazzFiveFourBassTextureCells(
  id: JazzFiveFourBassTextureVariantId,
): readonly DeepReadonly<JazzFiveFourTextureCell>[] {
  return jazzFiveFourBassTextureVariant(id).selectedCellIds.map((cellId) =>
    cellById(JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS, cellId));
}

export function jazzFiveFourTextureOnsetMask(
  cells: readonly DeepReadonly<JazzFiveFourTextureCell>[],
): readonly number[] {
  return Object.freeze([...new Set(cells.map((cell) => cell.phase.engineTicks))].sort((left, right) => left - right));
}
