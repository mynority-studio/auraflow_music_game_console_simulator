// ============================================================
// newEngine · arranger · ACG PIANOSONG hidden arrangement profiles
// ------------------------------------------------------------
// ACG 仍然是一个 UI style。这里的 profile 只是一首钢琴短篇在 Arranger
// 内部选择的总谱蓝图：它约束开场、中段表面弧线与收尾，而不新增用户可选风格。
// ============================================================

import type { Rng } from '../foundation';

export const ACG_PIANO_ARRANGEMENT_PROFILE_IDS = [
  'motif-first',
  'dialogue-breath',
  'ripple-journey',
  'wide-cinema',
  'descending-memory',
] as const;

export type AcgPianoArrangementProfileId = (typeof ACG_PIANO_ARRANGEMENT_PROFILE_IDS)[number];

/** Form identity only; no value here is exposed as a selectable genre. */
export type AcgPianoArrangementFormShape =
  | 'motif-first'
  | 'dialogue-breath'
  | 'ripple-journey'
  | 'wide-cinema'
  | 'descending-memory';

/** Score-plan facing intent for the first phrase, not a renderer texture name. */
export type AcgPianoOpeningStrategy =
  | 'direct-theme'
  | 'call-and-answer'
  | 'pedal-prelude'
  | 'wide-prelude'
  | 'falling-pickup';

/** A compact vocabulary lets the score plan vary surfaces without losing a coherent cue identity. */
export type AcgPianoSurfaceFamily = 'air' | 'ripple' | 'pulse' | 'vertical' | 'answer';

export type AcgPianoCodaStrategy =
  | 'echo-tag'
  | 'sigh-tag'
  | 'pedal-dissolve'
  | 'frame-arrival'
  | 'descending-release';

export interface AcgPianoArrangementProfile {
  id: AcgPianoArrangementProfileId;
  formShape: AcgPianoArrangementFormShape;
  openingStrategy: AcgPianoOpeningStrategy;
  /** Ordered contrast target for statement/development/return; score-owned, never a UI control. */
  middleSurfaceArc: readonly AcgPianoSurfaceFamily[];
  codaStrategy: AcgPianoCodaStrategy;
}

/**
 * The order is part of deterministic seed selection. Keep the profile itself
 * compact: a cue gets a coherent vocabulary, while a different seed can pick
 * a genuinely different macro form instead of merely changing one arp note.
 */
export const ACG_PIANO_ARRANGEMENT_PROFILES: readonly AcgPianoArrangementProfile[] = Object.freeze([
  {
    id: 'motif-first',
    formShape: 'motif-first',
    openingStrategy: 'direct-theme',
    middleSurfaceArc: ['pulse', 'ripple', 'vertical', 'answer'],
    codaStrategy: 'echo-tag',
  },
  {
    id: 'dialogue-breath',
    formShape: 'dialogue-breath',
    openingStrategy: 'call-and-answer',
    middleSurfaceArc: ['air', 'answer', 'ripple', 'vertical'],
    codaStrategy: 'sigh-tag',
  },
  {
    id: 'ripple-journey',
    formShape: 'ripple-journey',
    openingStrategy: 'pedal-prelude',
    middleSurfaceArc: ['air', 'ripple', 'answer', 'vertical'],
    codaStrategy: 'pedal-dissolve',
  },
  {
    id: 'wide-cinema',
    formShape: 'wide-cinema',
    openingStrategy: 'wide-prelude',
    middleSurfaceArc: ['air', 'vertical', 'ripple', 'vertical'],
    codaStrategy: 'frame-arrival',
  },
  {
    id: 'descending-memory',
    formShape: 'descending-memory',
    openingStrategy: 'falling-pickup',
    middleSurfaceArc: ['answer', 'air', 'ripple', 'vertical'],
    codaStrategy: 'descending-release',
  },
]);

export const ACG_PIANO_DEFAULT_ARRANGEMENT_PROFILE_ID: AcgPianoArrangementProfileId = 'ripple-journey';

export function acgPianoArrangementProfileForId(
  id: AcgPianoArrangementProfileId | undefined,
): AcgPianoArrangementProfile {
  return ACG_PIANO_ARRANGEMENT_PROFILES.find((profile) => profile.id === id)
    ?? ACG_PIANO_ARRANGEMENT_PROFILES.find((profile) => profile.id === ACG_PIANO_DEFAULT_ARRANGEMENT_PROFILE_ID)!;
}

/** A named, deterministic Arranger choice. Absence of RNG intentionally returns the legacy-like baseline. */
export function resolveAcgPianoArrangementProfile(rng?: Rng): AcgPianoArrangementProfile {
  return rng
    ? rng.pick(ACG_PIANO_ARRANGEMENT_PROFILES)
    : acgPianoArrangementProfileForId(ACG_PIANO_DEFAULT_ARRANGEMENT_PROFILE_ID);
}
