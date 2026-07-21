// ============================================================
// newEngine · arranger · JazzArchetypePlanner
// ------------------------------------------------------------
// Jazz 的编配主型先于 Time/Form/Groove 选择。当前仅保留已验证的注册；
// 新的参考型必须以独立设计进入，而不是复用已删除的 macro。
// ============================================================

import type { RandomContext } from '../foundation';
import { JAZZ_4_4_GROOVE_CONTRACT, JAZZ_5_4_GROOVE_CONTRACT } from '../knowledge/grooveContracts';
import {
  BASS_PATTERN_JAZZ_FIVE_FOUR,
  BASS_PATTERN_JAZZ_WALKING,
  BOUNDARY_POLICY_PLANNED,
  CADENCE_POLICY_AUTHENTIC,
  COMP_PATTERN_JAZZ_FIVE_FOUR,
  COMP_PATTERN_JAZZ_SWING,
  HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
  HARMONY_POLICY_JAZZ_STANDARD,
  LEAD_PATTERN_JAZZ_FIVE_FOUR,
  LEAD_PATTERN_MG_JAZZ,
  MOTIF_POLICY_REPEAT_GROUP,
  OPENING_POLICY_PLANNED,
  type ArrangementArchetypeContract,
} from './arrangementArchetypeContract';

export const JAZZ_4_4_ARCHETYPE_ID = 'jazz_4_4_standard' as const;
export const JAZZ_4_4_FORM_BLUEPRINT_ID = 'jazz.head-solo-headout.v1' as const;
export const JAZZ_5_4_ARCHETYPE_ID = 'jazz_5_4_modern_piano' as const;
export const JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID = 'jazz_5_4_reference_quartet' as const;
export const JAZZ_5_4_FORM_BLUEPRINT_ID =
  'jazz.reference-quartet-5-4.pickup-head-headout-coda.v1' as const;
export const JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID =
  'jazz.reference-quartet-5-4.pickup-head-headout-coda.v1' as const;

export type JazzArrangementArchetypeId =
  | typeof JAZZ_4_4_ARCHETYPE_ID
  | typeof JAZZ_5_4_ARCHETYPE_ID
  | typeof JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID;

export type JazzArrangementArchetype = ArrangementArchetypeContract<JazzArrangementArchetypeId>;

const JAZZ_4_4_ARCHETYPE: JazzArrangementArchetype = {
  schemaVersion: 1,
  id: JAZZ_4_4_ARCHETYPE_ID,
  style: 'jazz',
  meterFamily: '4/4',
  weightWithinMeter: 1,
  grooveContract: JAZZ_4_4_GROOVE_CONTRACT,
  formBlueprintId: JAZZ_4_4_FORM_BLUEPRINT_ID,
  defaultSectionPolicy: {
    activeRoles: ['bass', 'comp', 'lead', 'drum'],
    foregroundRole: 'lead',
    foundationOwner: 'bass',
    rolePatternByRole: {
      bass: BASS_PATTERN_JAZZ_WALKING,
      comp: COMP_PATTERN_JAZZ_SWING,
      lead: LEAD_PATTERN_MG_JAZZ,
    },
    harmonyPolicyId: HARMONY_POLICY_JAZZ_STANDARD,
    cadencePolicyId: CADENCE_POLICY_AUTHENTIC,
  },
  sectionPolicyByFormSlot: {},
  openingPolicyId: OPENING_POLICY_PLANNED,
  boundaryPolicyId: BOUNDARY_POLICY_PLANNED,
  motifPolicyId: MOTIF_POLICY_REPEAT_GROUP,
};

/**
 * Product 5/4 modern-piano archetype. The same 33-bar structural vocabulary
 * is shared with the frozen reference control, while Arranger selects complete
 * role textures and Lead grammar material by seed. Bass/Comp/Lead intentionally
 * share one piano palette; their low/middle/high functional roles stay separate.
 */
const JAZZ_5_4_ARCHETYPE: JazzArrangementArchetype = {
  schemaVersion: 1,
  id: JAZZ_5_4_ARCHETYPE_ID,
  style: 'jazz',
  meterFamily: '5/4',
  weightWithinMeter: 1,
  grooveContract: JAZZ_5_4_GROOVE_CONTRACT,
  formBlueprintId: JAZZ_5_4_FORM_BLUEPRINT_ID,
  instrumentationEnsembleId: 'jazzFiveFourSoloPiano',
  instrumentationVoicePolicy: 'ensemble-locked',
  sharedInstrumentRoleGroups: [['bass', 'comp', 'lead']],
  tonalityMode: 'minor',
  defaultSectionPolicy: {
    activeRoles: ['comp', 'lead', 'drum'],
    foregroundRole: 'lead',
    foundationOwner: 'comp',
    entryMode: 'downbeat',
    rolePatternByRole: {
      comp: COMP_PATTERN_JAZZ_FIVE_FOUR,
      lead: LEAD_PATTERN_JAZZ_FIVE_FOUR,
    },
    harmonyPolicyId: HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
    cadencePolicyId: CADENCE_POLICY_AUTHENTIC,
  },
  sectionPolicyByFormSlot: {
    pickup: {
      activeRoles: ['bass', 'lead', 'drum'],
      foregroundRole: 'lead',
      foundationOwner: 'bass',
      entryMode: 'downbeat',
      rolePatternByRole: {
        bass: BASS_PATTERN_JAZZ_FIVE_FOUR,
        lead: LEAD_PATTERN_JAZZ_FIVE_FOUR,
      },
      harmonyPolicyId: HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
      cadencePolicyId: CADENCE_POLICY_AUTHENTIC,
    },
    headA: {
      activeRoles: ['bass', 'lead', 'drum'],
      foregroundRole: 'lead',
      foundationOwner: 'bass',
      entryMode: 'downbeat',
      rolePatternByRole: {
        bass: BASS_PATTERN_JAZZ_FIVE_FOUR,
        lead: LEAD_PATTERN_JAZZ_FIVE_FOUR,
      },
      harmonyPolicyId: HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
      cadencePolicyId: CADENCE_POLICY_AUTHENTIC,
    },
  },
  openingPolicyId: OPENING_POLICY_PLANNED,
  boundaryPolicyId: BOUNDARY_POLICY_PLANNED,
  motifPolicyId: MOTIF_POLICY_REPEAT_GROUP,
};

/**
 * Production reference ensemble for the supplied MIDI evidence.  Unlike the
 * video-inspired solo-piano handoff above, all four functional participants
 * coexist.  The post-harmony JazzFiveFourScorePlan owns their concrete score;
 * this archetype only states participation, instrumentation world and meter.
 */
const JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE: JazzArrangementArchetype = {
  schemaVersion: 1,
  id: JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE_ID,
  style: 'jazz',
  meterFamily: '5/4',
  weightWithinMeter: 0,
  grooveContract: JAZZ_5_4_GROOVE_CONTRACT,
  formBlueprintId: JAZZ_5_4_REFERENCE_QUARTET_FORM_BLUEPRINT_ID,
  instrumentationEnsembleId: 'jazzFiveFourQuartet',
  instrumentationVoicePolicy: 'ensemble-locked',
  tonalityMode: 'minor',
  defaultSectionPolicy: {
    activeRoles: ['bass', 'comp', 'lead', 'drum'],
    foregroundRole: 'lead',
    foundationOwner: 'bass',
    entryMode: 'downbeat',
    rolePatternByRole: {
      bass: BASS_PATTERN_JAZZ_FIVE_FOUR,
      comp: COMP_PATTERN_JAZZ_FIVE_FOUR,
      lead: LEAD_PATTERN_JAZZ_FIVE_FOUR,
    },
    harmonyPolicyId: HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
    cadencePolicyId: CADENCE_POLICY_AUTHENTIC,
  },
  sectionPolicyByFormSlot: {},
  openingPolicyId: OPENING_POLICY_PLANNED,
  boundaryPolicyId: BOUNDARY_POLICY_PLANNED,
  motifPolicyId: MOTIF_POLICY_REPEAT_GROUP,
};

export const JAZZ_ARCHETYPE_REGISTRY: readonly JazzArrangementArchetype[] = [
  JAZZ_4_4_ARCHETYPE,
  JAZZ_5_4_ARCHETYPE,
  JAZZ_5_4_REFERENCE_QUARTET_ARCHETYPE,
];

/** Ordinary Jazz remains the approved 4/4 baseline; 5/4 is explicitly forced during tuning. */
export function planJazzArrangementArchetype(
  _rng?: RandomContext,
  forcedId?: JazzArrangementArchetypeId,
): JazzArrangementArchetype {
  if (forcedId) {
    const forced = JAZZ_ARCHETYPE_REGISTRY.find((entry) => entry.id === forcedId);
    if (!forced) throw new RangeError(`Unknown Jazz arrangement archetype: ${forcedId}`);
    return forced;
  }
  return JAZZ_4_4_ARCHETYPE;
}
