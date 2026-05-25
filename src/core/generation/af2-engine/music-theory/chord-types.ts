// ============================================================
// chord-types.ts — CHORD_TYPES interval table
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
//
// 2026-05-25 死代码清扫(净 -400 行):
//   删 CHORD_COLOR_DICTIONARY / parseColorDictEntry / RAW_MODE_DEGREE_QUALITY /
//      MODE_NAME_NORMALIZE / ROMAN_TO_DEGREE / ChordQuality(local type)/
//      classifyEngineChordType / getModeDegreeQuality / chordTypeFitsMode /
//      qualityToDefaultEngineType / getModeAwareSubstitutions /
//      getChordBackboneIntervals(cadence.ts 删后 0 调用)/
//      isChordBackbone / findCommonTones / CHORD_TYPE_ALIASES /
//      ALIAS_TO_CANONICAL / normalizeChordType / 配套 audit interfaces。
//   全部零外部调用。
//
// 仅保留 CHORD_TYPES — 是 Composer / voicing.ts / chord-color.ts 的查表底座。
// ============================================================

/**
 * Chord type → intervals(半音 from root)映射。
 *
 * 用法:Composer 决定 chord type 后,intervals = CHORD_TYPES[type]
 *      → voicing PCs 由 root + interval mod 12 得。
 *
 * 大于 12 的 interval(13/14/17/18/20/21)是 9/11/13 等 tension,assembleVoicing
 * 决定是否真发声(per-style voicing mode + clash detection 控制)。
 */
export const CHORD_TYPES: Record<string, number[]> = {
  'maj': [0, 4, 7],
  'min': [0, 3, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  'dom7': [0, 4, 7, 10],
  '7': [0, 4, 7, 10],
  'm7b5': [0, 3, 6, 10],
  'dim7': [0, 3, 6, 9],
  'add9': [0, 4, 7, 14],
  'm9': [0, 3, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14],
  '9': [0, 4, 7, 10, 14],
  'sus4': [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  '7b13': [0, 4, 7, 10, 20],
  '13': [0, 4, 7, 10, 14, 21],
  '7#9': [0, 4, 7, 10, 15],
  '7alt': [0, 4, 10, 13, 15, 20],
  'm11': [0, 3, 7, 10, 14, 17],
  'maj13': [0, 4, 7, 11, 14, 21],
  '6': [0, 4, 7, 9],
  '6/9': [0, 4, 7, 9, 14],
  '11': [0, 4, 7, 10, 14, 17],
  '13b9': [0, 4, 7, 10, 13, 21],
  '7#11': [0, 4, 7, 10, 18],
  'm9b5': [0, 3, 6, 10, 14],
  'm7sus4': [0, 5, 7, 10],
  '7#5': [0, 4, 8, 10],
  'maj7#11': [0, 4, 7, 11, 18],
  '7b9': [0, 4, 7, 10, 13],
  'maj9#11': [0, 4, 7, 11, 14, 18],

  // ------- Stage D #6 — extras curated from tonal chord-type (MIT) -------
  'sus2':      [0, 2, 7],              // 1 2 5  — modern pop / Coldplay
  '5':         [0, 7],                 // 1 5    — power chord (rock)
  '7b5':       [0, 4, 6, 10],          // 1 3 b5 b7  — dim-7 substitute
  '9#5':       [0, 4, 8, 10, 14],      // 1 3 #5 b7 9  — augmented 9
  '9#11':      [0, 4, 7, 10, 14, 18],  // 1 3 5 b7 9 #11  — Lydian dom 9
  '13#11':     [0, 4, 7, 10, 14, 18, 21], // Lydian dom 13
  '7#9#11':    [0, 4, 7, 10, 15, 18],  // 1 3 5 b7 #9 #11  — altered without root duplication
  'mMaj9':     [0, 3, 7, 11, 14],      // 1 b3 5 7 9  — minor-major 9 (Hermione's mode)
  'm13':       [0, 3, 7, 10, 14, 21],  // 1 b3 5 b7 9 13  — minor 13
  'm6/9':      [0, 3, 7, 9, 14],       // 1 b3 5 6 9  — neo-soul / fusion
  'quartal':   [0, 5, 10, 15],         // P4 stack — McCoy Tyner modal voicing

  // Stage E #1 audit surface — JAZZ rootless 把 min triad voice 成
  // [3, 7, 14] (Bill Evans 给所有 minor 类型加 9 的传统),实际 sounding
  // 就是 madd9。
  'madd9':     [0, 3, 7, 14],          // minor add 9 (no 7) — Bill Evans m triad
};
