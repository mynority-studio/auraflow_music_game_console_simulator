// ============================================================
// af2-engine/music-theory/index.ts — Barrel re-export
// ============================================================
//
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(4271 行 / 118 exports)→
// af2-engine/music-theory/ 目录,按主题分 12 文件:
//
//   midi.ts          — Note ↔ MIDI 转换 + pitch ranges
//   mode.ts          — Emotion / mode resolution / key family
//   meter.ts         — Time signature / MeterContext
//   scale.ts         — Pcs / SCALE_TYPES / 检测 / borrowing / note role
//   chord-types.ts   — CHORD_TYPES / aliases / ChordQuality / backbone
//   chord-detection.ts — Chord recognition(reverse from midi notes)
//   chord-color.ts   — Color dictionary / resolution targets / global contract
//   voicing.ts       — Voicing pipeline + STYLE_* + override tables
//   tendency.ts      — KK / INTERVAL_AESTHETICS / Lerdahl / TENDENCY_TABLE
//                      + evaluateNoteInChordContext
//   tension-state.ts — TensionTracker / TensionState / evaluateTensionState
//
// 调用方应优先 import 特定 topic 文件(e.g. './music-theory/midi'),也可
// 用 barrel `import { X } from './music-theory'`(等价于本文件)。
//
// 2026-05-25 死代码清扫:删 audit.ts(整文件)/ cadence.ts(整文件)— 零外部 import。
// ============================================================

export * from './midi';
export * from './mode';
export * from './meter';
export * from './scale';
export * from './chord-types';
export * from './chord-detection';
export * from './chord-color';
// voicing.ts 已删(2026-05-26 Step 6.4)— ImproCore wide-piano-voicing 接管
export * from './tendency';
export * from './tension-state';
export * from './spell';
export * from './note-evaluator';
