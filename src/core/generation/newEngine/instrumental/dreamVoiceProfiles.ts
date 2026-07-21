// ============================================================
// newEngine · instrumental · Dream 5504 voice profiles
// ------------------------------------------------------------
// GMBK5X128 has two different address spaces:
// - modern GM: CC0 0..40 + Program Change (128 capitals + 141 variations)
// - MT-32 compatibility: CC0 127 + Program Change
//
// Only the modern GM space belongs in automatic orchestration.  A profile is
// keyed by the complete hardware address, never by Program Change alone.
// This registry classifies physical playing behaviour; it deliberately does
// not select a style palette or invent per-preset CC curves.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import {
  GM128_DRUM_KITS,
  GM128_MAIN_PROGRAMS,
  GM128_VARIATION_PROGRAMS,
  type GM128CatalogItem,
  type GM128CatalogSource,
} from '../../../sound/GMBK5X128Catalog';

export type DreamVoiceFamily =
  | 'acoustic-piano'
  | 'electric-piano'
  | 'acoustic-keyed-pluck'
  | 'electric-keyed-pluck'
  | 'mallet'
  | 'electric-organ'
  | 'free-reed'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'guitar-harmonics'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'synth-bass'
  | 'organ-bass'
  | 'bowed-string'
  | 'plucked-string'
  | 'orchestral-percussion'
  | 'ensemble-string'
  | 'choir-voice'
  | 'brass'
  | 'saxophone'
  | 'reed-woodwind'
  | 'flute-woodwind'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-texture'
  | 'world-plucked'
  | 'world-wind'
  | 'world-bowed'
  | 'pitched-percussion'
  | 'sfx'
  | 'drum-kit';

/** The top-level player/gesture family used by orchestration and future CC lanes. */
export type DreamPerformanceFamily =
  | 'keyboard'
  | 'mallet'
  | 'free-reed'
  | 'guitar'
  | 'plucked-string'
  | 'bass'
  | 'bowed-string'
  | 'wind'
  | 'synth'
  | 'voice'
  | 'percussion'
  | 'effect';

/** A concrete subfamily whose notes, continuity and CC policy can be audited together. */
export type DreamPerformanceSubfamily =
  | 'acoustic-piano'
  | 'electric-piano'
  | 'acoustic-keyed-pluck'
  | 'electric-keyed-pluck'
  | 'vibraphone'
  | 'mallet-strike'
  | 'electric-organ'
  | 'free-reed'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'guitar-harmonics'
  | 'acoustic-bass'
  | 'electric-bass'
  | 'synth-bass'
  | 'organ-bass'
  | 'bowed-solo-string'
  | 'bowed-ensemble-string'
  | 'plucked-orchestral-string'
  | 'brass'
  | 'saxophone'
  | 'reed-woodwind'
  | 'flute-woodwind'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-texture'
  | 'choir-voice'
  | 'world-plucked'
  | 'world-wind'
  | 'world-bowed'
  | 'pitched-percussion'
  | 'orchestral-percussion'
  | 'drum-kit'
  | 'sfx';

/** Future CC lanes attach to this physical playing behaviour, not to a GM number. */
export type DreamExpressionFamily =
  | 'piano-damper'
  | 'electric-keyboard'
  | 'plucked-keyboard'
  | 'mallet-damper'
  | 'mallet-strike'
  | 'organ-sustain'
  | 'free-reed-sustain'
  | 'guitar-pluck'
  | 'bass-pluck'
  | 'synth-bass'
  | 'bowed-string'
  | 'plucked-string'
  | 'brass-air'
  | 'sax-air'
  | 'woodwind-air'
  | 'synth-lead'
  | 'synth-pad'
  | 'pitched-percussion'
  | 'sfx'
  | 'drum-kit';

export type DreamVoiceMode = 'polyphonic-decay' | 'polyphonic-sustain' | 'monophonic-sustain' | 'percussive' | 'effect';
export type DreamArrangementStatus = 'available' | 'manual-only';

export interface DreamVoiceAddress {
  /** CC0 bank; drum kits deliberately have no melodic bank address. */
  bank?: number;
  program: number;
  role?: InstrumentRoleName;
}

export interface DreamVoiceProfile {
  address: Readonly<DreamVoiceAddress>;
  name: string;
  source: GM128CatalogSource;
  family: DreamVoiceFamily;
  performanceFamily: DreamPerformanceFamily;
  performanceSubfamily: DreamPerformanceSubfamily;
  expressionFamily: DreamExpressionFamily;
  mode: DreamVoiceMode;
  /** Physical/renderer capability only. Style palettes decide whether to use it. */
  roleCapabilities: readonly InstrumentRoleName[];
  /** Available means safe to place in a future style palette; it is not a selection weight. */
  arrangementStatus: DreamArrangementStatus;
}

type Classification = Omit<DreamVoiceProfile, 'address' | 'name' | 'source'>;

function performanceClassification(
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
): Pick<Classification, 'performanceFamily' | 'performanceSubfamily'> {
  switch (family) {
    case 'acoustic-piano': return { performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-piano' };
    case 'electric-piano': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-piano' };
    case 'acoustic-keyed-pluck': return { performanceFamily: 'keyboard', performanceSubfamily: 'acoustic-keyed-pluck' };
    case 'electric-keyed-pluck': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-keyed-pluck' };
    case 'mallet': return expressionFamily === 'mallet-damper'
      ? { performanceFamily: 'mallet', performanceSubfamily: 'vibraphone' }
      : { performanceFamily: 'mallet', performanceSubfamily: 'mallet-strike' };
    case 'electric-organ': return { performanceFamily: 'keyboard', performanceSubfamily: 'electric-organ' };
    case 'free-reed': return { performanceFamily: 'free-reed', performanceSubfamily: 'free-reed' };
    case 'acoustic-guitar': return { performanceFamily: 'guitar', performanceSubfamily: 'acoustic-guitar' };
    case 'electric-guitar': return { performanceFamily: 'guitar', performanceSubfamily: 'electric-guitar' };
    case 'guitar-harmonics': return { performanceFamily: 'guitar', performanceSubfamily: 'guitar-harmonics' };
    case 'acoustic-bass': return { performanceFamily: 'bass', performanceSubfamily: 'acoustic-bass' };
    case 'electric-bass': return { performanceFamily: 'bass', performanceSubfamily: 'electric-bass' };
    case 'synth-bass': return { performanceFamily: 'bass', performanceSubfamily: 'synth-bass' };
    case 'organ-bass': return { performanceFamily: 'bass', performanceSubfamily: 'organ-bass' };
    case 'bowed-string': return { performanceFamily: 'bowed-string', performanceSubfamily: 'bowed-solo-string' };
    case 'ensemble-string': return { performanceFamily: 'bowed-string', performanceSubfamily: 'bowed-ensemble-string' };
    case 'plucked-string': return { performanceFamily: 'plucked-string', performanceSubfamily: 'plucked-orchestral-string' };
    case 'brass': return { performanceFamily: 'wind', performanceSubfamily: 'brass' };
    case 'saxophone': return { performanceFamily: 'wind', performanceSubfamily: 'saxophone' };
    case 'reed-woodwind': return { performanceFamily: 'wind', performanceSubfamily: 'reed-woodwind' };
    case 'flute-woodwind': return { performanceFamily: 'wind', performanceSubfamily: 'flute-woodwind' };
    case 'world-plucked': return { performanceFamily: 'plucked-string', performanceSubfamily: 'world-plucked' };
    case 'world-wind': return { performanceFamily: 'wind', performanceSubfamily: 'world-wind' };
    case 'world-bowed': return { performanceFamily: 'bowed-string', performanceSubfamily: 'world-bowed' };
    case 'synth-lead': return { performanceFamily: 'synth', performanceSubfamily: 'synth-lead' };
    case 'synth-pad': return { performanceFamily: 'synth', performanceSubfamily: 'synth-pad' };
    case 'synth-texture': return { performanceFamily: 'synth', performanceSubfamily: 'synth-texture' };
    case 'choir-voice': return { performanceFamily: 'voice', performanceSubfamily: 'choir-voice' };
    case 'pitched-percussion': return { performanceFamily: 'percussion', performanceSubfamily: 'pitched-percussion' };
    case 'orchestral-percussion': return { performanceFamily: 'percussion', performanceSubfamily: 'orchestral-percussion' };
    case 'drum-kit': return { performanceFamily: 'percussion', performanceSubfamily: 'drum-kit' };
    case 'sfx': return { performanceFamily: 'effect', performanceSubfamily: 'sfx' };
  }
}

const playable = (
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
  mode: DreamVoiceMode,
  roleCapabilities: readonly InstrumentRoleName[],
): Classification => ({
  family,
  expressionFamily,
  ...performanceClassification(family, expressionFamily),
  mode,
  roleCapabilities,
  arrangementStatus: 'available',
});

const manual = (
  family: DreamVoiceFamily,
  expressionFamily: DreamExpressionFamily,
  mode: DreamVoiceMode,
): Classification => ({
  family,
  expressionFamily,
  ...performanceClassification(family, expressionFamily),
  mode,
  roleCapabilities: [],
  arrangementStatus: 'manual-only',
});

function baseClassification(program: number): Classification {
  // GM PC2 is Electric Grand Piano. Keep it with electric pianos rather than
  // treating the whole 0..3 range as acoustic solely because of its position.
  if (program === 0 || program === 1 || program === 3) return playable('acoustic-piano', 'piano-damper', 'polyphonic-decay', ['lead', 'comp', 'bass']);
  if (program === 2 || program === 4 || program === 5) return playable('electric-piano', 'electric-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 6) return playable('acoustic-keyed-pluck', 'plucked-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 7) return playable('electric-keyed-pluck', 'plucked-keyboard', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 11) return playable('mallet', 'mallet-damper', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 15) return playable('mallet', 'mallet-strike', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 20) return playable('electric-organ', 'organ-sustain', 'polyphonic-sustain', ['lead', 'pad']);
  if (program <= 23) return playable('free-reed', 'free-reed-sustain', 'polyphonic-sustain', ['lead', 'pad']);
  if (program <= 26) return playable('acoustic-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']);
  if (program <= 30) return playable('electric-guitar', 'guitar-pluck', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 31) return playable('guitar-harmonics', 'guitar-pluck', 'polyphonic-decay', ['lead']);
  if (program === 32) return playable('acoustic-bass', 'bass-pluck', 'monophonic-sustain', ['bass']);
  if (program <= 37) return playable('electric-bass', 'bass-pluck', 'monophonic-sustain', ['bass']);
  if (program <= 39) return playable('synth-bass', 'synth-bass', 'monophonic-sustain', ['bass']);
  if (program <= 42) return playable('bowed-string', 'bowed-string', 'monophonic-sustain', ['lead']);
  if (program === 43) return playable('bowed-string', 'bowed-string', 'monophonic-sustain', ['bass']);
  // GM44/48/49 are bow-sustained string sections. Their five-track role is
  // pad-like, but their physical expression belongs with bowed strings, not
  // with an electronic/synth pad.
  if (program === 44) return playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']);
  if (program <= 46) return playable('plucked-string', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 47) return manual('orchestral-percussion', 'pitched-percussion', 'percussive');
  if (program === 48 || program === 49) return playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']);
  if (program <= 51) return playable('synth-pad', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program <= 54) return playable('choir-voice', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program === 55) return manual('orchestral-percussion', 'pitched-percussion', 'percussive');
  if (program <= 63) return playable('brass', 'brass-air', 'monophonic-sustain', ['lead']);
  if (program <= 67) return playable('saxophone', 'sax-air', 'monophonic-sustain', ['lead']);
  if (program <= 71) return playable('reed-woodwind', 'woodwind-air', 'monophonic-sustain', ['lead']);
  if (program <= 79) return playable('flute-woodwind', 'woodwind-air', 'monophonic-sustain', ['lead']);
  if (program <= 87) return playable('synth-lead', 'synth-lead', 'monophonic-sustain', ['lead']);
  if (program <= 95) return playable('synth-pad', 'synth-pad', 'polyphonic-sustain', ['pad']);
  if (program <= 103) return manual('synth-texture', 'sfx', 'effect');
  if (program <= 108) return playable('world-plucked', 'plucked-string', 'polyphonic-decay', ['lead', 'comp']);
  if (program === 110) return playable('world-bowed', 'bowed-string', 'monophonic-sustain', ['lead']);
  if (program <= 111) return playable('world-wind', 'woodwind-air', 'monophonic-sustain', ['lead']);
  if (program <= 115) return playable('pitched-percussion', 'pitched-percussion', 'percussive', ['lead', 'comp']);
  return manual(program <= 119 ? 'orchestral-percussion' : 'sfx', program <= 119 ? 'pitched-percussion' : 'sfx', program <= 119 ? 'percussive' : 'effect');
}

/** Variations that genuinely change a Program family's physical role. */
const CLASSIFICATION_OVERRIDES: Readonly<Record<string, Classification>> = {
  // Hammond slot, but the official variation is explicitly an organ bass.
  '40/16': playable('organ-bass', 'bass-pluck', 'monophonic-sustain', ['bass']),
  // Warm Pad slot, but this variation is a rotary string ensemble rather than a synth pad.
  '3/89': playable('ensemble-string', 'bowed-string', 'polyphonic-sustain', ['pad']),
};

function melodicKey(bank: number, program: number): string {
  return `${bank}/${program}`;
}

function profileForCatalogItem(item: GM128CatalogItem): DreamVoiceProfile {
  const bank = item.bank;
  const classification = CLASSIFICATION_OVERRIDES[melodicKey(bank, item.program)] ?? baseClassification(item.program);
  return Object.freeze({
    address: Object.freeze({ bank, program: item.program }),
    name: item.name,
    source: item.source,
    ...classification,
    roleCapabilities: Object.freeze([...classification.roleCapabilities]),
  });
}

const MODERN_MELODIC_ITEMS = [
  ...GM128_MAIN_PROGRAMS,
  ...GM128_VARIATION_PROGRAMS.filter((item) => item.bank !== 127),
];

/** The only melodic address space available to future automatic orchestration. */
export const DREAM5504_MODERN_MELODIC_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  MODERN_MELODIC_ITEMS.map(profileForCatalogItem),
);

export const DREAM5504_DRUM_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  GM128_DRUM_KITS.map((item) => Object.freeze({
    address: Object.freeze({ program: item.program, role: 'drum' as const }),
    name: item.name,
    source: item.source,
    family: 'drum-kit' as const,
    performanceFamily: 'percussion' as const,
    performanceSubfamily: 'drum-kit' as const,
    expressionFamily: 'drum-kit' as const,
    mode: 'percussive' as const,
    roleCapabilities: Object.freeze(['drum'] as const),
    arrangementStatus: 'available' as const,
  })),
);

/** Modern GM inventory plus the dedicated Channel-10 drum kits. MT-32 is intentionally absent. */
export const DREAM5504_ORCHESTRATION_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze([
  ...DREAM5504_MODERN_MELODIC_VOICE_PROFILES,
  ...DREAM5504_DRUM_VOICE_PROFILES,
]);

/** Future style palettes may only draw from this set; it carries no style weight by itself. */
export const DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) => profile.arrangementStatus === 'available'),
);

/** One-shots, ambience and SFX require an explicit arranger cue, never a five-track fallback. */
export const DREAM5504_MANUAL_ONLY_VOICE_PROFILES: readonly DreamVoiceProfile[] = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) => profile.arrangementStatus === 'manual-only'),
);

export const DREAM5504_MODERN_MELODIC_VOICE_COUNT = DREAM5504_MODERN_MELODIC_VOICE_PROFILES.length;
export const DREAM5504_DRUM_KIT_COUNT = DREAM5504_DRUM_VOICE_PROFILES.length;
export const DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT = GM128_VARIATION_PROGRAMS.filter((item) => item.bank === 127).length;

const melodicProfileByKey = new Map(
  DREAM5504_MODERN_MELODIC_VOICE_PROFILES.map((profile) => [
    melodicKey(profile.address.bank ?? 0, profile.address.program),
    profile,
  ]),
);
const drumProfileByProgram = new Map(
  DREAM5504_DRUM_VOICE_PROFILES.map((profile) => [profile.address.program, profile]),
);

export function dreamVoiceProfileFor(address: DreamVoiceAddress): DreamVoiceProfile | undefined {
  if (address.role === 'drum') return drumProfileByProgram.get(address.program);
  return melodicProfileByKey.get(melodicKey(address.bank ?? 0, address.program));
}

export function isDreamVoiceRoleCapable(address: DreamVoiceAddress, role: InstrumentRoleName): boolean {
  return dreamVoiceProfileFor({ ...address, role })?.roleCapabilities.includes(role) ?? false;
}

export function isDreamVoiceAvailableForAutomaticArrangement(address: DreamVoiceAddress): boolean {
  return dreamVoiceProfileFor(address)?.arrangementStatus === 'available';
}

/** Query helper for a future style palette. It never assigns weights or combinations. */
export function dreamVoiceProfilesForFamily(
  family: DreamVoiceFamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.family === family && (status === undefined || profile.arrangementStatus === status));
}

/** Query by playing family, e.g. piano, guitar or wind, before choosing a palette. */
export function dreamVoiceProfilesForPerformanceFamily(
  performanceFamily: DreamPerformanceFamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.performanceFamily === performanceFamily && (status === undefined || profile.arrangementStatus === status));
}

/** Query a concrete player type, e.g. electric-piano or saxophone. */
export function dreamVoiceProfilesForPerformanceSubfamily(
  performanceSubfamily: DreamPerformanceSubfamily,
  status?: DreamArrangementStatus,
): readonly DreamVoiceProfile[] {
  return DREAM5504_ORCHESTRATION_VOICE_PROFILES.filter((profile) =>
    profile.performanceSubfamily === performanceSubfamily && (status === undefined || profile.arrangementStatus === status));
}

/** Query helper for a future five-track palette. Defaults to voices safe for automatic consideration. */
export function dreamVoiceProfilesForRole(
  role: InstrumentRoleName,
  includeManualOnly = false,
): readonly DreamVoiceProfile[] {
  const source = includeManualOnly ? DREAM5504_ORCHESTRATION_VOICE_PROFILES : DREAM5504_AUTOMATIC_ARRANGEMENT_VOICE_PROFILES;
  return source.filter((profile) => profile.roleCapabilities.includes(role));
}

export const DREAM5504_VOICE_FAMILY_COUNTS: Readonly<Record<DreamVoiceFamily, number>> = Object.freeze(
  DREAM5504_ORCHESTRATION_VOICE_PROFILES.reduce<Record<DreamVoiceFamily, number>>((counts, profile) => {
    counts[profile.family] = (counts[profile.family] ?? 0) + 1;
    return counts;
  }, {} as Record<DreamVoiceFamily, number>),
);
