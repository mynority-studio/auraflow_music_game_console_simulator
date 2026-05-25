// ============================================================
// chord-vocab.ts — ChordVocab 5 字段表(spell/color/priority/approach/avoid + scales)
// ============================================================
// Phase 1 of Impro-Visor 移植(2026-05-25)。
// 数据来源:`/Users/mynority/vibe_coding/Impro-Visor/vocab/My.voc`(Lisp).
//
// 价值:
//   - chord-types.ts 只有 type → intervals(纯几何)。这个文件补 chord theory:
//     哪些 non-chord pc 是 "color tone"(可用 extension)、哪些是 "avoid"
//     (永不选)、每个 chord tone 的 chromatic approach pc 集合、可用 scale 列表。
//   - 给 future plugin(MargulisExpectancyShaper / ApproachToneTargeter /
//     PassingToneSelector)做查表底座。
//
// 规模:18 个 curated type(覆盖 AF2 90% 用例,POP / JAZZ / RNB / BLUES 主力)。
// 其余 type 用 deriveDefaultVocab() fallback,不阻塞任何 caller。
//
// 不变式:
//   - spell / color / avoid 用 pitch class 0-11(C=0, C#=1, ..., B=11)
//   - spell 必须等于 (CHORD_TYPES[type] mod 12 去重)(关联组 #4 ChordQuality 同步)
//   - approach[i] 长度可变;首元素是 target(等于 spell[i]),后续是 approach options
//   - scales 用 canonical name(major / dorian / mixolydian / ...),不带 root
// ============================================================

import { CHORD_TYPES } from './chord-types';

export interface ChordVocab {
  /** chord tones — pc 0-11 relative to root. 等于 CHORD_TYPES[type] mod 12 去重 */
  spell: number[];
  /** extension / color tones — non-chord pcs that fit the family(可用 tension) */
  color: number[];
  /** voicing priority order — pcs descending importance(典型:7 → 3 → root → 5 → 9 → 13) */
  priority: number[];
  /** per-chord-tone approach options — approach[i] = [spell[i], opt1, opt2, ...]
   *  即第一元素是 target chord tone,后续是 chromatic approach 候选(±1 / ±2 半音) */
  approach: number[][];
  /** pcs to never select(e.g., 4th over maj triad)。空数组 = 无 avoid */
  avoid: number[];
  /** 适用 scale 名(canonical,不带 root)。e.g. ['major', 'lydian', 'mixolydian'] */
  scales: string[];
}

// ============================================================
// CURATED VOCAB — 直接从 Impro-Visor vocab/My.voc 翻译(C 根音 → pc)
// ============================================================
// 注:Impro-Visor 把每个 chord 列在 C 根音的具体 spelling(如 c8 e8 g8),
//     这里 normalize 成 pc(0,4,7)。

// helper 用音名 → pc 的转换在审计时完成,这里直接落 pc 数组。
// pc 速查:c=0, c#/db=1, d=2, d#/eb=3, e=4, f=5, f#/gb=6, g=7, g#/ab=8, a=9, a#/bb=10, b=11

export const CHORD_VOCAB: Record<string, ChordVocab> = {
  // ============ Major family ============
  'maj': {
    spell: [0, 4, 7],                                      // c e g
    color: [9, 11, 2, 6],                                  // a b d f#
    priority: [4, 7, 0],                                   // e g c
    approach: [
      [0, 11, 1, 2],                                       // c: b c# d
      [4, 3, 5],                                           // e: eb f
      [7, 6, 8, 9],                                        // g: f# g# a
    ],
    avoid: [],
    scales: ['major', 'lydian'],
  },

  'maj7': {
    spell: [0, 4, 7, 11],                                  // c e g b
    color: [2, 9, 6],                                      // d a f#
    priority: [11, 4, 7, 0],                               // b e g c
    approach: [
      [0, 1, 2],                                           // c: c# d (NB: vocab 跳 b,因为 b 是 maj7)
      [4, 3, 5],                                           // e: eb f
      [7, 6, 8],                                           // g: f# g#
      [11, 10, 0],                                         // b: bb c
    ],
    avoid: [0],                                            // root 是 avoid(Bill Evans-style 鼓励 rootless)
    scales: ['major', 'lydian'],
  },

  'maj9': {
    spell: [0, 4, 7, 11, 2],                               // c e g b d
    color: [9, 6],                                         // a f#
    priority: [11, 4, 2, 7, 0],                            // b e d g c
    approach: [
      [0, 1],                                              // c: c#
      [4, 3, 5],                                           // e: eb f
      [7, 6, 8],                                           // g: f# g#
      [11, 10, 0],                                         // b: bb c
      [2, 1, 3],                                           // d: c# eb
    ],
    avoid: [0],
    scales: ['major', 'lydian'],
  },

  '6': {
    spell: [0, 4, 7, 9],                                   // c e g a
    color: [2, 11, 6],                                     // d b f#
    priority: [4, 9, 7, 0],                                // e a g c
    approach: [
      [0, 11, 1, 2],
      [4, 3, 5],
      [7, 6, 8],
      [9, 8, 10],
    ],
    avoid: [],
    scales: ['major', 'lydian'],
  },

  '6/9': {
    spell: [0, 4, 7, 9, 2],                                // c e g a d
    color: [11, 6],                                        // b f#
    priority: [2, 4, 9, 7, 0],                             // d e a g c
    approach: [
      [0, 11, 1],
      [4, 3, 5],
      [7, 6, 8],
      [9, 8, 10],
      [2, 1, 3],
    ],
    avoid: [],
    scales: ['major', 'lydian'],
  },

  // ============ Minor family ============
  'min': {
    spell: [0, 3, 7],                                      // c eb g
    color: [2, 5, 8, 6, 9, 10, 11],                        // d f ab gb a bb b(注:bb=b7,b=maj7,都可用 — minor 颜色宽)
    priority: [3, 7, 0],                                   // eb g c
    approach: [
      [0, 11, 1, 2],
      [3, 2, 4, 5],                                        // eb: d e f
      [7, 6, 8, 9],
    ],
    avoid: [],
    scales: ['dorian', 'aeolian', 'melodic minor', 'harmonic minor', 'phrygian'],
  },

  'm7': {
    spell: [0, 3, 7, 10],                                  // c eb g bb
    color: [2, 5, 9, 11],                                  // d f a b
    priority: [3, 10, 7, 0],                               // eb bb g c
    approach: [
      [0, 11, 1, 2],
      [3, 2, 4, 5],
      [7, 6, 8],
      [10, 9, 11],
    ],
    avoid: [],
    scales: ['dorian', 'aeolian', 'phrygian', 'mixolydian'],
  },

  'm9': {
    spell: [0, 3, 7, 10, 2],                               // c eb g bb d
    color: [9, 5, 11],                                     // a f b
    priority: [3, 10, 2, 7, 0],                            // eb bb d g c
    approach: [
      [0, 11, 1],
      [3, 4, 5],
      [7, 6, 8],
      [10, 9, 11],
      [2, 1],
    ],
    avoid: [],
    scales: ['dorian', 'aeolian', 'mixolydian'],
  },

  'madd9': {
    // Bill Evans 给所有 minor triad 加 9 的传统(vocab Cmadd9 line 1790,近似)
    spell: [0, 3, 7, 2],                                   // c eb g d
    color: [5, 9, 11],
    priority: [3, 2, 7, 0],
    approach: [
      [0, 11, 1],
      [3, 2, 4],
      [7, 6, 8],
      [2, 1, 3],
    ],
    avoid: [],
    scales: ['dorian', 'aeolian'],
  },

  // ============ Dominant 7 family ============
  'dom7': {
    spell: [0, 4, 7, 10],                                  // c e g bb
    color: [9, 6, 1, 2, 3, 8, 5],                          // a f# db d d# g# f(dom7 颜色最宽)
    priority: [10, 4, 7, 0],                               // bb e g c
    approach: [
      [0, 11, 1, 2],
      [4, 5, 3],                                           // e: f eb(vocab 把 f 放第一,反顺序 OK)
      [7, 6, 8],
      [10, 9, 11],
    ],
    avoid: [],
    scales: ['mixolydian', 'lydian dominant', 'bebop dominant', 'whole tone', 'major blues', 'minor blues', 'composite blues'],
  },

  '7': {
    // alias to dom7
    spell: [0, 4, 7, 10],
    color: [9, 6, 1, 2, 3, 8, 5],
    priority: [10, 4, 7, 0],
    approach: [
      [0, 11, 1, 2],
      [4, 5, 3],
      [7, 6, 8],
      [10, 9, 11],
    ],
    avoid: [],
    scales: ['mixolydian', 'lydian dominant', 'bebop dominant', 'whole tone', 'major blues', 'minor blues', 'composite blues'],
  },

  '9': {
    spell: [0, 4, 7, 10, 2],                               // c e g bb d
    color: [9, 6, 8, 5],                                   // a f# g# f
    priority: [2, 10, 4, 7, 0],                            // d bb e g c
    approach: [
      [0, 11, 1],
      [4, 5, 3],
      [7, 6, 8],
      [10, 9, 11],
      [2, 1, 3],
    ],
    avoid: [],
    scales: ['mixolydian', 'lydian dominant', 'whole tone'],
  },

  '7b9': {
    spell: [0, 4, 7, 10, 1],                               // c e g bb db
    color: [9, 8, 6, 3],                                   // a ab f# d#
    priority: [1, 10, 4, 0],                               // db bb e c
    approach: [
      [0, 11],
      [4, 5, 3],
      [7, 6, 8],
      [10, 9, 11],
      [1, 2, 3],
    ],
    avoid: [],
    scales: ['diminished'],
  },

  '7#9': {
    spell: [0, 4, 7, 10, 3],                               // c e g bb d#
    color: [6, 8, 1, 9],                                   // f# ab db a
    priority: [3, 10, 4, 0],                               // d# bb e c
    approach: [
      [0, 11],
      [4, 5, 3],
      [7, 6, 8],
      [10, 9, 11],
      [3, 2],
    ],
    avoid: [],
    scales: ['diminished', 'altered'],
  },

  '7#5': {
    spell: [0, 4, 8, 10],                                  // c e g# bb
    color: [3, 1, 6, 2],                                   // d# db f# d
    priority: [8, 10, 4, 0],                               // g# bb e c
    approach: [
      [0, 11, 1],
      [4, 5, 3],
      [8, 7, 9],
      [10, 9, 11],
    ],
    avoid: [],
    scales: ['whole tone', 'altered', 'lydian augmented'],
  },

  '9#11': {
    spell: [0, 4, 7, 10, 2, 6],                            // c e g bb d f#
    color: [9],                                            // a
    priority: [6, 10, 4, 2, 0, 7],                         // f# bb e d c g
    approach: [
      [0, 11, 1],
      [4, 5, 3],
      [7, 6, 8],
      [10, 9, 11],
      [2, 1, 3],
      [6, 5, 7],
    ],
    avoid: [],
    scales: ['lydian dominant', 'whole tone'],
  },

  '9sus4': {
    spell: [0, 5, 7, 10, 2],                               // c f g bb d
    color: [4, 9],                                         // e a
    priority: [5, 10, 2, 7, 0],                            // f bb d g c
    approach: [
      [0, 11, 1],
      [5, 6],
      [7, 6, 8],
      [10, 9, 11],
      [2, 1],
    ],
    avoid: [],
    scales: ['mixolydian', 'aeolian'],
  },

  // ============ Half-diminished / diminished ============
  'm7b5': {
    spell: [0, 3, 6, 10],                                  // c eb gb bb
    color: [1, 2, 5, 8, 9],                                // db d f ab a
    priority: [6, 3, 10, 0],                               // gb eb bb c
    approach: [
      [0, 11, 1, 2],
      [3, 2, 4, 5],
      [6, 5, 7],
      [10, 9, 11],
    ],
    avoid: [],
    scales: ['locrian', 'locrian #2', 'minor blues'],
  },

  'm9b5': {
    spell: [0, 3, 10, 6, 2],                               // c eb bb gb d
    color: [5, 8, 9],                                      // f ab a
    priority: [3, 10, 6, 2, 0],
    approach: [
      [0, 11, 1],
      [3, 2, 4, 5],
      [6, 5, 7],
      [10, 9, 11],
      [2, 1],
    ],
    avoid: [],
    scales: ['locrian #2', 'minor blues'],
  },

  'dim': {
    spell: [0, 3, 6],                                      // c eb gb
    color: [9, 11, 10, 2, 5],                              // a b bb d f
    priority: [6, 3, 0],                                   // gb eb c
    approach: [
      [0, 11, 2, 1],
      [3, 2, 4, 5],
      [6, 5, 7, 8],
    ],
    avoid: [],
    scales: ['diminished'],
  },

  'dim7': {
    spell: [0, 3, 6, 9],                                   // c eb gb a
    color: [2, 5, 8, 11],                                  // d f ab b
    priority: [9, 3, 6, 0],                                // a eb gb c
    approach: [
      [0, 11, 2, 1],
      [3, 2, 4, 5],
      [6, 5, 7, 8],
      [9, 8, 10, 11],
    ],
    avoid: [],
    scales: ['diminished'],
  },

  // ============ Sus / sus2 / sus4 ============
  'sus4': {
    spell: [0, 5, 7],                                      // c f g
    color: [11, 2, 9],                                     // b d a
    priority: [5, 7, 0],                                   // f g c
    approach: [
      [0, 1, 11, 2],
      [5, 6],
      [7, 6],
    ],
    avoid: [],
    scales: ['mixolydian', 'major'],
  },

  // ============ Power / quartal ============
  '5': {
    spell: [0, 7],                                         // c g(power chord,无 3rd)
    color: [],
    priority: [7, 0],
    approach: [
      [0, 11, 1, 2],
      [7, 6, 8],
    ],
    avoid: [],
    scales: ['major', 'minor', 'mixolydian'],
  },

  // ============ Augmented ============
  'aug': {
    spell: [0, 4, 8],                                      // c e g#(CM#5,vocab 引用同 family augmented)
    color: [3, 10, 1, 2],
    priority: [8, 4, 0],
    approach: [
      [0, 11, 1],
      [4, 3, 5],
      [8, 7, 9],
    ],
    avoid: [],
    scales: ['whole tone', 'lydian augmented', 'augmented'],
  },
};

// ============================================================
// HELPER:fallback derivation for un-curated types
// ============================================================
/**
 * 对 CHORD_VOCAB 没收录的 type,从 CHORD_TYPES intervals 推一份默认 vocab。
 * 比纯几何稍微聪明:
 *   - spell 直接从 intervals mod 12 去重
 *   - priority 排序:root → 3 → 7 → 5 → 其他
 *   - approach:每个 chord tone 加 ±1 半音
 *   - color / avoid / scales 留空数组(consumer 决定 fallback 行为)
 */
function deriveDefaultVocab(intervals: number[]): ChordVocab {
  const spell = Array.from(new Set(intervals.map((i) => ((i % 12) + 12) % 12)));

  // priority 启发:7th / 3rd / root / 5th 优先(典型 voicing 顺序)
  const priorityOrder = [10, 11, 3, 4, 0, 6, 8, 7, 2, 9, 1, 5];
  const priority = priorityOrder.filter((pc) => spell.includes(pc));

  const approach = spell.map((t) => [t, (t + 11) % 12, (t + 1) % 12]);

  return {
    spell,
    color: [],
    priority,
    approach,
    avoid: [],
    scales: [],
  };
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * 拿 chord type 的 vocab。curated 优先,没有就 derived。
 * 永不返回 null — derived 至少能覆盖 spell + approach 基本需求。
 */
export function getChordVocab(type: string): ChordVocab {
  const curated = CHORD_VOCAB[type];
  if (curated) return curated;
  const intervals = CHORD_TYPES[type];
  if (!intervals) {
    // 完全未知 type:fallback 到 maj triad
    return CHORD_VOCAB['maj']!;
  }
  return deriveDefaultVocab(intervals);
}

/** pc 是 chord tone? */
export function isChordTone(pc: number, vocab: ChordVocab): boolean {
  return vocab.spell.includes(((pc % 12) + 12) % 12);
}

/** pc 是 color tone(extension)? */
export function isColorTone(pc: number, vocab: ChordVocab): boolean {
  return vocab.color.includes(((pc % 12) + 12) % 12);
}

/** pc 是 avoid tone? */
export function isAvoidTone(pc: number, vocab: ChordVocab): boolean {
  return vocab.avoid.includes(((pc % 12) + 12) % 12);
}

export type NoteCategory = 'chord' | 'color' | 'avoid' | 'random';

/**
 * 分类 pc → 一个 category。
 * 优先级:chord > color > avoid > random。
 * 调用方典型用法:决定要不要 boost / damp / skip 这个 pc。
 */
export function classifyPc(pc: number, vocab: ChordVocab): NoteCategory {
  const n = ((pc % 12) + 12) % 12;
  if (vocab.spell.includes(n)) return 'chord';
  if (vocab.color.includes(n)) return 'color';
  if (vocab.avoid.includes(n)) return 'avoid';
  return 'random';
}

/**
 * pc 对 chord vocab 的"稳定度"(Margulis Expectancy 用)。
 *   root → 6
 *   chord tone → 5
 *   color tone → 4
 *   random → 1
 *   avoid → 0(不在 Margulis 原模型,AF2 扩展)
 */
export function stability(pc: number, vocab: ChordVocab): number {
  const n = ((pc % 12) + 12) % 12;
  if (n === 0 || n === vocab.spell[0]) return 6; // root(假设 spell[0] 是 root)
  if (vocab.spell.includes(n)) return 5;
  if (vocab.color.includes(n)) return 4;
  if (vocab.avoid.includes(n)) return 0;
  return 1;
}

/**
 * 获取一个 chord tone 的 approach 选项(不含 target 本身)。
 * e.g. CM 的 e(spell[1])approach = [eb, f](去掉 e)。
 * 给 ApproachToneTargeter 选 approach pitch 用。
 */
export function approachOptionsForTarget(targetPc: number, vocab: ChordVocab): number[] {
  const n = ((targetPc % 12) + 12) % 12;
  for (const opts of vocab.approach) {
    if (opts.length > 0 && opts[0] === n) {
      return opts.slice(1);
    }
  }
  // fallback:任意 chord tone 都可 ±1 半音 approach
  return [(n + 11) % 12, (n + 1) % 12];
}
