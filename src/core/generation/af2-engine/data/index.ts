// ============================================================
// af2-engine/data/index.ts — Barrel re-export
// ============================================================
//
// Phase 6.2 移入的 data/rules 模块,从 mg-engine/ 整体迁移到 af2-engine/data/。
//
//   styleDictionary.ts  (~1467 行)— Per-style 配置:BPM / 和弦池 / personas /
//                                     progressions / motifs / texture recipes
//   basslineRules.ts    (~454 行) — BASSLINE_RULES + BASS_PATTERN_RULES
//                                     (stride / boogie / dilla / 等行进规则)
//   dynamicHarmony.ts   (~170 行) — DYNAMIC_TSD_DICTIONARY(T/S/D × style ×
//                                     color level → chord type 池)+
//                                     analyzeTargetQuality
//   motifTransform.ts   (~179 行) — Motif → notes 实化的工具函数
//   rhythmPattern.ts    (~118 行) — Rhythm pattern 注册表
//
// 调用方应优先 import 特定文件(e.g. './data/styleDictionary'),也可走 barrel。
// ============================================================

export * from './styleDictionary';
export * from './basslineRules';
export * from './dynamicHarmony';
export * from './motifTransform';
export * from './rhythmPattern';
