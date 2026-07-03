// ============================================================
// newEngine · intent · MusicIntentPlan(mg_intent_planning_layer_migration_directive_v2 §4)
// ------------------------------------------------------------
// 分层迁移的核心契约:Arranger owns musical intent · KB owns legal materials · Render owns realization。
// 本文件只放【类型】,供 arranger(派生)/ render(消费)/ audit 共用。派生逻辑在
//   `newEngine/arranger/deriveMusicIntentPlan.ts`;风格规则在 `newEngine/knowledge/styleIntentProfiles.ts`。
// ★ IntentMode:observe = 只记录/审计,不改输出;enforce = render 可消费改输出。Phase 1 只产 observe。
// ============================================================

import type { StyleName } from '../knowledge/mgMusicTheory';

export type IntentMode = 'observe' | 'enforce';

export type IntentSource = 'legacy' | 'mg-derived' | 'sim-derived' | 'manual-override';

export interface IntentMeta {
  mode: IntentMode;
  source: IntentSource;
  repeatGroupId?: string;
  createdBy: string;
}

// —— §4.3 Texture family ——
export type TextureFamily =
  | 'block' | 'roll' | 'arp' | 'broken' | 'sparseAnswer'
  | 'pulse' | 'wash' | 'pedal' | 'stride' | 'ostinato';

export interface TextureFamilySlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  family: TextureFamily;
  densityHint: 'sparse' | 'medium' | 'dense';
  switchPolicy: 'section' | 'phrase' | 'bar';
  requiresBridge?: boolean;
  allowsCarryTail?: boolean;
  clockSafety?: 'strict' | 'loose';
}
export interface TextureFamilySchedule { meta: IntentMeta; slots: TextureFamilySlot[]; }

// —— §4.4 Comp onset-form ——
export type CompOnsetForm = 'blockHeavy' | 'rollHeavy' | 'singleLine' | 'sparseAnswer' | 'mixed';
export interface CompOnsetFormSlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  form: CompOnsetForm;
  targetBlockRatio?: [number, number];
  targetSingleRatio?: [number, number];
  offgridVelocityRange?: [number, number];
}
export interface CompOnsetFormSchedule { meta: IntentMeta; slots: CompOnsetFormSlot[]; }

// —— §4.5 Bass pattern ——
export type BassPatternFamily =
  | 'rootAnchor' | 'walking' | 'syncopated' | 'pedal' | 'broken' | 'octaveAlternate' | 'fifthDrop' | 'minimal';
export interface BassPatternSlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  family: BassPatternFamily;
  minAnchorsPerBar?: number;
  targetNotesPerBar?: [number, number];
  allowEnergyThinning?: boolean;
}
export interface BassPatternSchedule { meta: IntentMeta; slots: BassPatternSlot[]; }

// —— §4.6 Lead grammar ——
export interface LeadGrammarIntent {
  meta: IntentMeta;
  roadmapId?: string;
  grammarFamily?: string;
  targetCoverage?: [number, number];
  maxGapBeats?: number;
  registerRange?: [number, number];
  preserveRests: boolean;
  preserveSlope: boolean;
  boundaryResolution: 'mg' | 'sim-safe' | 'off';
}

// —— §4.7 Texture transition ——
export interface TextureTransitionSlot {
  meta: IntentMeta;
  atBeat: number;
  fromFamily: TextureFamily;
  toFamily: TextureFamily;
  bridge: 'none' | 'carryTail' | 'downbeatAnchor' | 'softShell';
  repeatGroupId?: string;
}
export interface TextureTransitionPlan { meta: IntentMeta; slots: TextureTransitionSlot[]; }

// —— §4.2 Section / plan ——
export interface SectionMusicIntent {
  meta: IntentMeta;
  sectionId: string;
  sectionRole: string;
  functionTag?: string;
  startBeat: number;
  endBeat: number;
  bars: number;
  energy: number;

  grooveContractId?: string;
  // 各 schedule 增量落地(Phase 2-6);Phase 1 只 observe 派生 bass/texture placeholder,其余 undefined。
  leadGrammarIntent?: LeadGrammarIntent;
  textureFamilySchedule?: TextureFamilySchedule;
  compOnsetFormSchedule?: CompOnsetFormSchedule;
  bassPatternSchedule?: BassPatternSchedule;
  textureTransitionPlan?: TextureTransitionPlan;
}

export interface MusicIntentPlan {
  version: 1;
  style: StyleName;
  mode: IntentMode;
  source: IntentSource;
  sections: SectionMusicIntent[];
}
