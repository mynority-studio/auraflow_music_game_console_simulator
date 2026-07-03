// ============================================================
// newEngine · intent · Intent Audit Types(mg_intent_planning_layer_migration_directive_v2 §8)
// ------------------------------------------------------------
// intent 审计/上报用的紧凑摘要类型。供 §8.1 intent-family audit + report 暴露(observe 只报告不改输出)。
// ============================================================

import type { IntentMode, IntentSource, TextureFamily, BassPatternFamily, CompOnsetForm } from './MusicIntentPlan';

/** 逐段 intent 摘要(report 暴露 + 审计)。actual* 字段供 enforce 后对照(Phase 1 observe:仅 intended)。 */
export interface SectionIntentSummary {
  sectionId: string;
  sectionRole: string;
  functionTag?: string;
  startBeat: number;
  bars: number;
  energy: number;
  grooveContractId?: string;
  mode: IntentMode;
  source: IntentSource;
  bassFamily?: BassPatternFamily;
  bassTargetNotesPerBar?: [number, number];
  textureFamily?: TextureFamily;   // placeholder(Phase 1);Phase 3 精化
  compOnsetForm?: CompOnsetForm;   // Phase 4
  leadTargetCoverage?: [number, number]; // Phase 6
}

/** 整曲 intent 摘要(挂到 AuditReport.intent;observe = 不被 render 消费)。 */
export interface IntentSummary {
  version: 1;
  style: string;
  mode: IntentMode;
  source: IntentSource;
  sections: SectionIntentSummary[];
}
