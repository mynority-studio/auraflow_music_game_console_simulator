// ============================================================
// newEngine · arranger · ArrangementPlan 契约
// ------------------------------------------------------------
// 架构定稿 Part 2.3:Arranger 输出(最高权威)。值对象快照,deepFreeze。
// motifBindings = 凝聚力引擎(slot→motifId+排比);restatementStrength 连续标量。
// Slice 1:curves 简化为 per-section 标量;tempoCurve / 连续曲线后续叠加。
// ============================================================

import { deepFreeze, type DeepReadonly, type Meter } from '../foundation';

export type SectionId = string;
export type PhraseId = string;
export type MotifId = string;
export type MotifBindingId = string;
export type RepeatGroupId = string;

export type SectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
export type HookPolicy = 'none' | 'light' | 'main' | 'call-response';

export interface Section {
  id: SectionId;
  role: SectionRole;
  bars: number;
  repeatGroup?: RepeatGroupId;
  hookPolicy: HookPolicy;
}

export type PhraseRole = 'antecedent' | 'consequent' | 'climax' | 'cadence' | 'link' | 'fill';
export type SkeletonRole = 'hook' | 'connector' | 'cadence' | 'fill';
export type CadenceTarget = 'open' | 'half' | 'authentic' | 'climax';

export interface Phrase {
  id: PhraseId;
  sectionId: SectionId;
  bars: number;
  phraseSlot: number;
  role: PhraseRole;
  cadenceTarget: CadenceTarget;
  repeatGroup?: RepeatGroupId;
  skeletonRole: SkeletonRole;
}

export interface MotifBinding {
  id: MotifBindingId;
  motifId: MotifId;
  phraseId: PhraseId;
  repeatGroup?: RepeatGroupId;
  requestedRestatementStrength: number; // 0..1,Arranger 戏剧意图(不可变)
}

export type FeelKind = 'straight' | 'swing' | 'shuffle' | 'half-time' | 'double-time';
export interface Feel {
  kind: FeelKind;
  swingRatio: number;
}

export interface PhraseBreathing {
  phraseBars: number;
  cadenceBreathBeats: number;
}

export interface ClimaxPoint {
  sectionId: SectionId;
  intensity: number; // 0..1
}

export interface HarmonicRhythmTarget {
  chordsPerBarBySection: Record<SectionId, number>;
}

export interface ArrangementPlanData {
  sections: Section[];
  phrases: Phrase[];
  motifBindings: MotifBinding[];
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
  phraseBreathing: PhraseBreathing;
  energyBySection: Record<SectionId, number>;
  densityBySection: Record<SectionId, number>;
  climaxMap: ClimaxPoint[];
  harmonicRhythmTarget: HarmonicRhythmTarget;
}

export type ArrangementPlan = DeepReadonly<ArrangementPlanData>;

export function freezeArrangementPlan(data: ArrangementPlanData): ArrangementPlan {
  return deepFreeze(data);
}
