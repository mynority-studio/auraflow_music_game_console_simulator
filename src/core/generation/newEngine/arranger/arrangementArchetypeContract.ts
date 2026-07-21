// ============================================================
// newEngine · arranger · ArrangementArchetypeContract
// ------------------------------------------------------------
// 静态 archetype 是 Arranger 内部的“编配注册表”；Resolved plan 才是下游可消费的
// 自包含快照。GrooveContract 只描述 meter/feel/pocket/texture，不再充当整套编配身份。
// ============================================================

import type { InstrumentRoleName, Mode } from '../band/BandSpec';
import type { GrooveContract } from '../knowledge/grooveContracts';
import type { EnsembleWorldId } from '../knowledge/gmOrchestrationChains';
import { JAZZ_FIVE_FOUR_BASS_PATTERN_ID, JAZZ_WALKING_BASS_PATTERN_ID } from '../knowledge/grooveBassPatterns';

/** Meter families registered by Arranger. Each archetype still owns one exact GrooveContract. */
export type ArrangementMeterFamily = '4/4' | '5/4';
export type ArrangementFoundationOwner = 'bass' | 'comp' | 'pad' | 'none';
export type InstrumentationVoicePolicy = 'participant-family-constrained' | 'ensemble-locked';
export type ArchetypeSectionEntry = 'downbeat' | 'lead-in';

export const BOUNDARY_POLICY_PLANNED = 'boundary.planned.v1' as const;
export const OPENING_POLICY_PLANNED = 'opening.planned.v1' as const;

export const MOTIF_POLICY_REPEAT_GROUP = 'motif.repeat-group.v1' as const;

export const HARMONY_POLICY_JAZZ_STANDARD = 'harmony.jazz-standard-by-section.v1' as const;
/**
 * Arranger-owned opt-in for the transposition-invariant Jazz 5/4 form grammar.
 * Harmony consumes this resolved section policy; it must not infer the path
 * from style, meter, or a renderer-side archetype check.
 */
export const HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR = 'harmony.jazz-five-four-form-grammar.v1' as const;

export const CADENCE_POLICY_AUTHENTIC = 'cadence.authentic.v1' as const;

export const BASS_PATTERN_JAZZ_WALKING = JAZZ_WALKING_BASS_PATTERN_ID;
export const COMP_PATTERN_JAZZ_SWING = 'comp.jazz-swing.v1' as const;
export const LEAD_PATTERN_MG_JAZZ = 'lead.mg-jazz.v1' as const;
export const BASS_PATTERN_JAZZ_FIVE_FOUR = JAZZ_FIVE_FOUR_BASS_PATTERN_ID;
export const COMP_PATTERN_JAZZ_FIVE_FOUR = 'comp.jazz-five-four-piano-interlock.v1' as const;
export const LEAD_PATTERN_JAZZ_FIVE_FOUR = 'lead.jazz-five-four-phrase.v1' as const;

export type BoundaryPolicyId = typeof BOUNDARY_POLICY_PLANNED;
export type OpeningPolicyId = typeof OPENING_POLICY_PLANNED;

/** Arranger 注册表中的一个 form-slot（当前 form-slot 与稳定 section id 一致）。 */
export interface ArchetypeSectionPolicy {
  activeRoles: readonly InstrumentRoleName[];
  foregroundRole: InstrumentRoleName;
  foundationOwner: ArrangementFoundationOwner;
  /** Exact-form archetypes may override the generic energy-derived edge. */
  entryMode?: ArchetypeSectionEntry;
  rolePatternByRole: Partial<Record<InstrumentRoleName, string>>;
  harmonyPolicyId: string;
  cadencePolicyId: string;
}

/**
 * 静态注册定义。权重、Groove 与 form blueprint 只参与 Arranger 选择/展开，
 * 不能整对象下发给 Harmony/Render。
 */
export interface ArrangementArchetypeContract<Id extends string = string> {
  schemaVersion: 1;
  id: Id;
  style: string;
  meterFamily: ArrangementMeterFamily;
  weightWithinMeter: number;
  grooveContract: GrooveContract;
  formBlueprintId: string;
  /** Arranger 只选择编制语义；具体 GM/Bank 映射仍由 Instrumental knowledge 兑现。 */
  instrumentationEnsembleId?: EnsembleWorldId;
  /** ensemble-locked:角色仍可归属不同 participant，但最终音色不得被 participant 家族改写。 */
  instrumentationVoicePolicy?: InstrumentationVoicePolicy;
  /** 同一实体乐器被拆成多个写作职责；下游只消费角色关系，不识别 archetype id。 */
  sharedInstrumentRoleGroups?: readonly (readonly InstrumentRoleName[])[];
  /** 该 archetype 的和声/旋律语境；请求显式 mode 时仍由用户覆盖。 */
  tonalityMode?: Mode;
  defaultSectionPolicy?: ArchetypeSectionPolicy;
  sectionPolicyByFormSlot: Readonly<Record<string, ArchetypeSectionPolicy>>;
  openingPolicyId: OpeningPolicyId;
  boundaryPolicyId: BoundaryPolicyId;
  motifPolicyId: string;
}

/** ArrangementPlan 中按实际 section id 展开的、纯数据执行快照。 */
export interface ResolvedSectionArrangementPolicy {
  foundationOwner: ArrangementFoundationOwner;
  entryMode?: ArchetypeSectionEntry;
  rolePatternByRole: Partial<Record<InstrumentRoleName, string>>;
  harmonyPolicyId: string;
  cadencePolicyId: string;
}

export interface ResolvedArrangementArchetypePlan {
  schemaVersion: 1;
  id: string;
  instrumentationEnsembleId?: EnsembleWorldId;
  instrumentationVoicePolicy?: InstrumentationVoicePolicy;
  sharedInstrumentRoleGroups?: readonly (readonly InstrumentRoleName[])[];
  tonalityMode?: Mode;
  sectionPolicyById: Record<string, ResolvedSectionArrangementPolicy>;
  motifPolicyId: string;
  boundaryPolicyId: BoundaryPolicyId;
}

export function sectionPolicyForArchetype(
  archetype: ArrangementArchetypeContract,
  sectionId: string,
): ArchetypeSectionPolicy {
  const policy = archetype.sectionPolicyByFormSlot[sectionId] ?? archetype.defaultSectionPolicy;
  if (!policy) throw new Error(`Arrangement archetype ${archetype.id} has no policy for section ${sectionId}`);
  return policy;
}

/** clone 成普通 Record/array，避免 ArrangementPlan.deepFreeze 冻结共享 registry。 */
export function resolveArrangementArchetype(
  archetype: ArrangementArchetypeContract,
  sectionIds: readonly string[],
): ResolvedArrangementArchetypePlan {
  return {
    schemaVersion: 1,
    id: archetype.id,
    instrumentationEnsembleId: archetype.instrumentationEnsembleId,
    instrumentationVoicePolicy: archetype.instrumentationVoicePolicy,
    sharedInstrumentRoleGroups: archetype.sharedInstrumentRoleGroups?.map((roles) => [...roles]),
    tonalityMode: archetype.tonalityMode,
    sectionPolicyById: Object.fromEntries(sectionIds.map((sectionId) => {
      const policy = sectionPolicyForArchetype(archetype, sectionId);
      return [sectionId, {
        foundationOwner: policy.foundationOwner,
        entryMode: policy.entryMode,
        rolePatternByRole: { ...policy.rolePatternByRole },
        harmonyPolicyId: policy.harmonyPolicyId,
        cadencePolicyId: policy.cadencePolicyId,
      }];
    })),
    motifPolicyId: archetype.motifPolicyId,
    boundaryPolicyId: archetype.boundaryPolicyId,
  };
}
