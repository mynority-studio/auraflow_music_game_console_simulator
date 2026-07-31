// ============================================================
// newEngine · knowledge · LOFI Foundation Archetypes
// ------------------------------------------------------------
// Song-level musical priors for slow Soul / Boom-bap.  These records bind
// compatible groove, harmony, bass, voicing, Pad and Lead-space vocabularies;
// they never contain a reference-track transcription or a section position.
// ============================================================

import type { GrooveBassPatternId } from './grooveBassPatterns';
import type { LofiDrumPhraseFamily } from './grooves';

export type LofiFoundationArchetypeId =
  | 'slow-soul-boombap'
  | 'dusty-dilla-boombap'
  | 'slow-soul-halftime'
  | 'ambient-study-boombap';

export type LofiVoicingFamily = 'close' | 'drop2' | 'rootless-guide';
export type LofiPadFamily = 'common-tone' | 'guide-bed' | 'slow-two-voice' | 'none';
export type LofiBrokenChordTechnique = 'anchored-finger-legato';
export type LofiChordContinuity = 'continuous' | 'semiContinuous' | 'sparse' | 'delayedEntry';

export interface LofiFoundationArchetype {
  id: LofiFoundationArchetypeId;
  weight: number;
  grooveContractId: string;
  drumPhraseFamily: LofiDrumPhraseFamily;
  topLoopProbability: number;
  mutationProbability: number;
  mutationCycleBars: 16;
  maxMutatedBars: 0 | 1 | 2;
  bassPatternId: GrooveBassPatternId;
  voicing: {
    family: LofiVoicingFamily;
    register: readonly [number, number];
    maxVoicesWithBass: number;
  };
  /**
   * How a pianist connects a written broken-chord texture before NoteIR exists.
   * CC64 remains voice-capability gated; unsupported electric keys execute the
   * same continuity with overlapping fingers and a held lower-hand guide tone.
   */
  comp: {
    brokenChordTechnique: LofiBrokenChordTechnique;
    anchorRetriggerBeats: 2;
    fingerOverlapBeats: number;
    harmonicReleaseBeats: number;
    /**
     * Block/chop textures keep their authored attacks, but their lower guide
     * finger connects the space while upper voices retain a short release.
     */
    chordGateRatioByContinuity: Readonly<Record<LofiChordContinuity, number>>;
    commonToneBridgeMaxBeats: number;
    damperPolicy: 'when-documented';
    unsupportedDamperFallback: 'finger-legato';
  };
  pad: {
    family: LofiPadFamily;
    anticipationProbability: number;
  };
  leadSpace: {
    activeBarTarget: readonly [number, number];
    minimumContiguousRestBars: number;
  };
}

const CONNECTED_CHORD_GATE = {
  continuous: 0.94,
  semiContinuous: 0.84,
  sparse: 0.64,
  delayedEntry: 0.78,
} as const;

export const LOFI_FOUNDATION_ARCHETYPES: readonly LofiFoundationArchetype[] = [
  {
    id: 'slow-soul-boombap',
    weight: 60,
    grooveContractId: 'lofi_soul_boombap',
    drumPhraseFamily: 'slow-boombap',
    topLoopProbability: 0.62,
    mutationProbability: 0.42,
    mutationCycleBars: 16,
    maxMutatedBars: 1,
    bassPatternId: 'lofi_soul_sparse',
    voicing: { family: 'drop2', register: [48, 72], maxVoicesWithBass: 4 },
    comp: {
      brokenChordTechnique: 'anchored-finger-legato',
      anchorRetriggerBeats: 2,
      fingerOverlapBeats: 0.12,
      harmonicReleaseBeats: 0.1,
      chordGateRatioByContinuity: CONNECTED_CHORD_GATE,
      commonToneBridgeMaxBeats: 0.65,
      damperPolicy: 'when-documented',
      unsupportedDamperFallback: 'finger-legato',
    },
    pad: { family: 'guide-bed', anticipationProbability: 0.06 },
    leadSpace: { activeBarTarget: [0.28, 0.4], minimumContiguousRestBars: 4 },
  },
  {
    id: 'dusty-dilla-boombap',
    weight: 20,
    grooveContractId: 'lofi_tape_late_chords',
    drumPhraseFamily: 'dusty-dilla-boombap',
    topLoopProbability: 0.48,
    mutationProbability: 0.62,
    mutationCycleBars: 16,
    maxMutatedBars: 2,
    bassPatternId: 'lofi_dilla_sparse',
    voicing: { family: 'rootless-guide', register: [48, 72], maxVoicesWithBass: 3 },
    comp: {
      brokenChordTechnique: 'anchored-finger-legato',
      anchorRetriggerBeats: 2,
      fingerOverlapBeats: 0.08,
      harmonicReleaseBeats: 0.1,
      chordGateRatioByContinuity: CONNECTED_CHORD_GATE,
      commonToneBridgeMaxBeats: 0.65,
      damperPolicy: 'when-documented',
      unsupportedDamperFallback: 'finger-legato',
    },
    pad: { family: 'common-tone', anticipationProbability: 0.04 },
    leadSpace: { activeBarTarget: [0.3, 0.42], minimumContiguousRestBars: 4 },
  },
  {
    id: 'slow-soul-halftime',
    weight: 12,
    grooveContractId: 'lofi_halftime_dusty',
    drumPhraseFamily: 'slow-soul-halftime',
    topLoopProbability: 0.34,
    mutationProbability: 0.34,
    mutationCycleBars: 16,
    maxMutatedBars: 1,
    bassPatternId: 'lofi_halftime_hold',
    voicing: { family: 'close', register: [48, 72], maxVoicesWithBass: 4 },
    comp: {
      brokenChordTechnique: 'anchored-finger-legato',
      anchorRetriggerBeats: 2,
      fingerOverlapBeats: 0.14,
      harmonicReleaseBeats: 0.1,
      chordGateRatioByContinuity: CONNECTED_CHORD_GATE,
      commonToneBridgeMaxBeats: 0.65,
      damperPolicy: 'when-documented',
      unsupportedDamperFallback: 'finger-legato',
    },
    pad: { family: 'slow-two-voice', anticipationProbability: 0.03 },
    leadSpace: { activeBarTarget: [0.25, 0.38], minimumContiguousRestBars: 4 },
  },
  {
    id: 'ambient-study-boombap',
    weight: 8,
    grooveContractId: 'lofi_ambient_study',
    drumPhraseFamily: 'slow-boombap',
    topLoopProbability: 0.52,
    mutationProbability: 0.18,
    mutationCycleBars: 16,
    maxMutatedBars: 1,
    bassPatternId: 'lofi_ambient_pedal',
    voicing: { family: 'rootless-guide', register: [50, 72], maxVoicesWithBass: 3 },
    comp: {
      brokenChordTechnique: 'anchored-finger-legato',
      anchorRetriggerBeats: 2,
      fingerOverlapBeats: 0.18,
      harmonicReleaseBeats: 0.12,
      chordGateRatioByContinuity: CONNECTED_CHORD_GATE,
      commonToneBridgeMaxBeats: 0.65,
      damperPolicy: 'when-documented',
      unsupportedDamperFallback: 'finger-legato',
    },
    pad: { family: 'common-tone', anticipationProbability: 0 },
    leadSpace: { activeBarTarget: [0.25, 0.34], minimumContiguousRestBars: 4 },
  },
] as const;

export function lofiFoundationArchetypeById(
  id: LofiFoundationArchetypeId,
): LofiFoundationArchetype {
  const archetype = LOFI_FOUNDATION_ARCHETYPES.find((candidate) => candidate.id === id);
  if (!archetype) throw new Error(`Unknown LOFI foundation archetype: ${id}`);
  return archetype;
}
