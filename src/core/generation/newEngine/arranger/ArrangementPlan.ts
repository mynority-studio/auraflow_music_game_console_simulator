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

// ★ 风格编排吸纳(CODEX V4.2,分层加字段,不动管道):
//   harmonyRole → progressionSelector 选 prototype(值集 = KB ProtoSectionRole,直接可传);
//   functionTag → dynamics 能量 / phrase hook scope 的轻量语义;
//   linkOut    → harmony 段尾骨架链接(标意图;T6 才落实,当前 inert)。三者皆可选,向后兼容。
export type HarmonySectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
export type SectionFunctionTag =
  | 'setup' | 'story' | 'build' | 'hook' | 'breakdown'
  | 'loop' | 'head' | 'solo' | 'headOut' | 'tag' | 'outro';
export type HarmonyLinkKind =
  | 'none'
  | 'dominantLift'              // IV -> V -> next I/vi
  | 'secondaryToRelativeMinor' // IV -> III7 -> next vi
  | 'backdoorToSubdominant'    // v/IV -> I7/IV -> next IV
  | 'minorIvHold'              // iv hold -> next I/vi
  | 'stopOnDominant';          // V stop -> next hook impact

export interface Section {
  id: SectionId;
  role: SectionRole;              // legacy 投影(render/texture/trace),五类不变
  harmonyRole?: HarmonySectionRole; // 给 progressionSelector(可选;缺省回退 role 映射)
  functionTag?: SectionFunctionTag; // 给 dynamics / phrase(可选;缺省回退 role)
  linkOut?: HarmonyLinkKind;        // 段尾和声链接意图(T6 落实;当前未消费)
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
