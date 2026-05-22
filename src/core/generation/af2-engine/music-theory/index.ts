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
//   audit.ts         — Harmonic perception + melody audit
//   cadence.ts       — Cadence tier / phrase / tonic strength / DURATION_VALUES
//
// 调用方应优先 import 特定 topic 文件(e.g. './music-theory/midi'),也可
// 用 barrel `import { X } from './music-theory'`(等价于本文件)。
// ============================================================

export * from './midi';
export * from './mode';
export * from './meter';
export * from './scale';
export * from './chord-types';
export * from './chord-detection';
export * from './chord-color';
export * from './voicing';
export * from './tendency';
export * from './tension-state';
export * from './audit';
export * from './cadence';
