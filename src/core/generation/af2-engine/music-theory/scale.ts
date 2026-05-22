// ============================================================
// scale.ts — Pitch-class sets / scale detection / SCALE_TYPES /
//            modal characteristic notes / note role classification
// ============================================================
//
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: pcs utilities + scale detection (L376-648), SCALE_TYPES (L1015-1066),
// MODAL_CHARACTERISTIC + isAvoidNote + NoteRole + pcset helpers (L2761-3020)。
// ============================================================

import { normalizeModeName } from './mode';
import { CHORD_TYPES } from './chord-types';
import { computeGlobalContract } from './chord-color';

// ------------------------------------------------------------------
// Pitch-class set utilities (Set<number> based). Set theory primitives
// over 12-pc chroma. Distinct from tonal's chroma-string approach —
// our engine already speaks Set<number> throughout, so the utility
// surface stays consistent.
//
// Source: pattern borrowed from tonal `pcset` (MIT) — operations
// match `Pcset.isSubsetOf`, `Pcset.get`, etc. Data structure adapted
// to our Set<number> rather than tonal's 12-bit chroma string.
// ------------------------------------------------------------------

export function pcsFromIntervals(rootPc: number, intervals: number[]): Set<number> {
  const norm = (((rootPc % 12) + 12) % 12);
  return new Set(intervals.map(iv => (norm + iv) % 12));
}

export function pcsIsSubsetOf(child: Set<number>, parent: Set<number>): boolean {
  for (const pc of child) if (!parent.has(pc)) return false;
  return true;
}

// Scale pcs rooted at a key root, for any SCALE_TYPES mode name.
// Returns empty set when the mode isn't in the dictionary.
export function scalePcsForMode(keyRootPc: number, modeName: string): Set<number> {
  const intervals = SCALE_TYPES[modeName] ?? [];
  return pcsFromIntervals(keyRootPc, intervals);
}

// ------------------------------------------------------------------
// Mode-borrowing detection (modal interchange).
//
// What: given a chord's literal pitch content (root + chord type
// intervals) and the song's home key + home mode, return either:
//   - null    chord is diatonic to the home mode (no borrowing)
//   - string  the parallel mode the chord is borrowed from
//             (e.g., 'Aeolian' for a bVI in major-key song)
//
// Why: jazz / pop frequently uses "modal interchange" — chords from a
// parallel mode of the same tonic. Detecting and labeling these in
// the Engine Diagnostics panel makes the harmony analysis visible to
// the user. Pure diagnostic — does not change generation behavior.
//
// Search order: most-common borrowing sources first. Major-key songs
// most often borrow from Aeolian (gives bVI / bVII / iv), then
// Mixolydian (b7) and Dorian (natural-6 + b3). Minor-key songs
// borrow from Ionian (V7 with natural 7) and the minor-variant
// modes. Single global order picks the first match for either.
//
// Source: standard modal interchange theory (Levine 1995, Aldwell-
// Schachter); detection algorithm: pcs-subset over parallel modes
// (tonal `pcset` MIT pattern).
// ------------------------------------------------------------------

export const PARALLEL_MODE_SEARCH_ORDER: readonly string[] = [
  'Aeolian',         // major-key borrowing source #1 (bVI / bVII / iv)
  'Mixolydian',      // b7 — bVII
  'Dorian',          // natural-6 + b3 mix
  'Phrygian',        // b2 — Spanish flavor
  'Lydian',          // #4 — bright color
  'Ionian',          // for minor-key songs borrowing major
  'Harmonic Minor',  // V7 with natural leading tone in minor
  'Melodic Minor',   // jazz minor (natural 6 + natural 7)
  'Locrian',         // very rare
];

// ------------------------------------------------------------------
// detectScale — reverse-lookup which scale(s) a set of pcs fits in.
//
// What: given a collection of pitch classes (interpretable as a
// melody fragment / chord-tone pool), find every entry in
// SCALE_TYPES that contains the input as a subset.
//
// Why: useful for analysis — "what scale is this melody fragment
// from?" — and as a prereq for User Motif Override (parse a user's
// input motif and propagate it across chords using the inferred
// scale flavor). Not wired into the engine yet.
//
// Source: pattern borrowed from tonal `@tonaljs/scale` (MIT)
// `detect()` function, adapted to our SCALE_TYPES + Set<number> pcs
// representation.
// ------------------------------------------------------------------

export interface ScaleMatch {
  /** SCALE_TYPES key — e.g. 'Ionian', 'Dorian', 'Blues' */
  scaleName: string;
  /** pc 0..11 of the matching scale's tonic */
  tonicPc: number;
  /** 'exact' = scale cardinality equals input cardinality; 'fit' = scale is a strict superset */
  matchType: 'exact' | 'fit';
}

export function detectScale(
  notes: number[] | Set<number>,
  options: { tonicPc?: number; match?: 'exact' | 'fit' } = {},
): ScaleMatch[] {
  const inputPcs = new Set(
    Array.isArray(notes)
      ? notes.map(n => ((n % 12) + 12) % 12)
      : Array.from(notes).map(n => ((n % 12) + 12) % 12),
  );
  if (inputPcs.size === 0) return [];
  const matchMode = options.match ?? 'fit';
  const tonics = options.tonicPc !== undefined
    ? [((options.tonicPc % 12) + 12) % 12]
    : Array.from({ length: 12 }, (_, i) => i);

  const results: ScaleMatch[] = [];
  for (const [scaleName, intervals] of Object.entries(SCALE_TYPES)) {
    for (const tonicPc of tonics) {
      const scalePcs = pcsFromIntervals(tonicPc, intervals);
      if (!pcsIsSubsetOf(inputPcs, scalePcs)) continue;
      const isExact = scalePcs.size === inputPcs.size;
      if (isExact || matchMode === 'fit') {
        results.push({ scaleName, tonicPc, matchType: isExact ? 'exact' : 'fit' });
      }
    }
  }
  return results;
}

/**
 * Best-guess scale for a set of pcs. Sorts detectScale results by
 * (1) exact > fit, (2) smaller scale size = more specific.
 * Returns null when no scale in SCALE_TYPES contains the input.
 */
export function bestScaleGuess(
  notes: number[] | Set<number>,
  tonicPc?: number,
): ScaleMatch | null {
  const matches = detectScale(notes, { tonicPc, match: 'fit' });
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
    return (SCALE_TYPES[a.scaleName]?.length ?? 99) - (SCALE_TYPES[b.scaleName]?.length ?? 99);
  });
  return matches[0];
}

export function detectModeBorrowing(
  chordRootPc: number,
  chordType: string,
  keyRootPc: number,
  homeMode: string,
): string | null {
  const intervals = CHORD_TYPES[chordType];
  if (!intervals) return null;
  const chordPcs = pcsFromIntervals(chordRootPc, intervals);
  const canonicalHome = normalizeModeName(homeMode);
  const homePcs = scalePcsForMode(keyRootPc, canonicalHome);
  if (homePcs.size === 0) return null;  // unknown home mode — bail
  if (pcsIsSubsetOf(chordPcs, homePcs)) return null;
  for (const m of PARALLEL_MODE_SEARCH_ORDER) {
    if (m === canonicalHome) continue;
    const pcs = scalePcsForMode(keyRootPc, m);
    if (pcs.size === 0) continue;
    if (pcsIsSubsetOf(chordPcs, pcs)) return m;
  }
  return null;  // chromatic — not from any standard parallel mode
}

// ------------------------------------------------------------------
// Chord-scale theory — per diatonic chord, the recommended scale to
// improvise on. Mark Levine's chord-scale theory:
//   I chord    → Ionian (1st mode)
//   ii chord   → Dorian (2nd mode)
//   iii chord  → Phrygian (3rd mode)
//   IV chord   → Lydian (4th mode)
//   V chord    → Mixolydian (5th mode)
//   vi chord   → Aeolian (6th mode)
//   vii° chord → Locrian (7th mode)
//
// Source: tonal `@tonaljs/key` MajorKey/MinorKey chordScales data
// (MIT). Generalized to non-diatonic chords via chord-type heuristic
// (dom7 → Mixolydian, maj7 → Lydian for bright option, etc.).
// ------------------------------------------------------------------

const MAJOR_KEY_CHORD_SCALES: Record<number, string> = {
  0:  'Ionian',      // I
  2:  'Dorian',      // ii
  4:  'Phrygian',    // iii
  5:  'Lydian',      // IV
  7:  'Mixolydian',  // V
  9:  'Aeolian',     // vi
  11: 'Locrian',     // vii°
};

const MINOR_KEY_CHORD_SCALES: Record<number, string> = {
  0:  'Aeolian',     // i
  2:  'Locrian',     // ii°
  3:  'Ionian',      // bIII
  5:  'Dorian',      // iv
  7:  'Phrygian',    // v
  8:  'Lydian',      // bVI
  10: 'Mixolydian',  // bVII
};

// Quality of the chord's 3rd: 'maj' (M3) / 'min' (m3) / 'unknown' (sus).
// Used to verify whether a chord's actual quality matches its diatonic
// position's expectation — mismatches (e.g. dom7 on ii degree where
// diatonic expects m7) signal a non-diatonic chord that should route
// to the chord-type heuristic instead of the diatonic table.
function chordType3rd(chordType: string): 'maj' | 'min' | 'unknown' {
  if (chordType === 'maj' || chordType === '6' || chordType === '6/9'
      || chordType === 'add9' || /^maj/i.test(chordType)) return 'maj';
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) return 'min';
  if (chordType === 'dim' || chordType === 'dim7') return 'min';
  // dom-family — major 3 inside
  if (chordType === '7' || chordType === 'dom7'
      || /^[79]|^13|^11$|^7#5/.test(chordType)) return 'maj';
  if (chordType.startsWith('sus')) return 'unknown';
  return 'unknown';
}

function diatonicChord3rd(deltaPc: number, isMajor: boolean):
    'maj' | 'min' | 'unknown' {
  const major: Record<number, 'maj' | 'min'> = {
    0: 'maj', 2: 'min', 4: 'min', 5: 'maj', 7: 'maj', 9: 'min', 11: 'min',
  };
  const minor: Record<number, 'maj' | 'min'> = {
    0: 'min', 2: 'min', 3: 'maj', 5: 'min', 7: 'min', 8: 'maj', 10: 'maj',
  };
  return (isMajor ? major : minor)[deltaPc] ?? 'unknown';
}

/**
 * Recommended scale to play over a chord, given its root + the song's
 * key + mode. Returns a SCALE_TYPES key.
 *
 *   chordScaleFor(0, 0, 'Major')          → 'Ionian'      (C in C major)
 *   chordScaleFor(2, 0, 'Major')          → 'Dorian'      (Dm in C major)
 *   chordScaleFor(7, 0, 'Major')          → 'Mixolydian'  (G7 in C major)
 *   chordScaleFor(2, 0, 'Major', '7')     → 'Mixolydian'  (D7 = V/V, non-diatonic — dom7 doesn't match diatonic ii's m3)
 *   chordScaleFor(10, 0, 'Major', '7')    → 'Mixolydian'  (Bb7 — fully non-diatonic, dom7 fallback)
 *   chordScaleFor(10, 0, 'Major', 'maj7') → 'Lydian'      (Bbmaj7 — non-diatonic, maj7 fallback)
 *
 * Diatonic chords get the canonical Mark Levine table when the chord's
 * 3rd quality matches the diatonic expectation. Mismatches (secondary
 * dominants, modal interchange) route to the chord-type heuristic.
 */
export function chordScaleFor(
  chordRootPc: number,
  keyTonicPc: number,
  keyMode: string,
  chordType?: string,
): string {
  const delta = (((chordRootPc - keyTonicPc) % 12) + 12) % 12;
  const home = normalizeModeName(keyMode);
  const isMajor = home === 'Ionian' || keyMode === 'Major';
  const table = isMajor ? MAJOR_KEY_CHORD_SCALES : MINOR_KEY_CHORD_SCALES;
  const diatonic = table[delta];
  if (diatonic) {
    if (!chordType) return diatonic;
    const c3 = chordType3rd(chordType);
    const d3 = diatonicChord3rd(delta, isMajor);
    // Match — or either side is unknown (sus / triad-only) — use diatonic.
    if (c3 === 'unknown' || d3 === 'unknown' || c3 === d3) return diatonic;
    // Quality mismatch → secondary dom / modal interchange. Fall through.
  }

  // Non-diatonic: pick by chord type quality
  if (chordType) {
    if (chordType === 'sus4' || chordType === '7sus4' || chordType === '9sus4'
        || chordType === 'm7sus4' || chordType === '11') return 'Mixolydian';
    if (/^maj/i.test(chordType) || chordType === 'maj'
        || chordType === '6' || chordType === '6/9' || chordType === 'add9') return 'Lydian';
    if (/m7b5|m9b5/i.test(chordType)) return 'Locrian';
    if (/dim/i.test(chordType)) return 'Locrian';
    if (chordType.startsWith('m')) return 'Dorian';
    // dom-family fallback
    return 'Mixolydian';
  }
  return 'Ionian';
}
// ------------------------------------------------------------------
// Scale definitions. styleDictionary names are authoritative — when
// they reference a scale, this table must contain the matching key
// (otherwise getScaleForStyle silently falls back to Ionian and the
// modal flavour is lost).
// ------------------------------------------------------------------

export const SCALE_TYPES: Record<string, number[]> = {
  // Modes
  'Ionian':                [0, 2, 4, 5, 7, 9, 11],
  'Dorian':                [0, 2, 3, 5, 7, 9, 10],
  'Phrygian':              [0, 1, 3, 5, 7, 8, 10],
  'Lydian':                [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian':            [0, 2, 4, 5, 7, 9, 10],
  'Aeolian':               [0, 2, 3, 5, 7, 8, 10],
  'Locrian':               [0, 1, 3, 5, 6, 8, 10],

  // Minor variants
  'Harmonic Minor':        [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor':         [0, 2, 3, 5, 7, 9, 11],

  // Pentatonic & blues
  'Major Pentatonic':      [0, 2, 4, 7, 9],
  'Minor Pentatonic':      [0, 3, 5, 7, 10],
  'Blues':                 [0, 3, 5, 6, 7, 10],
  'Major Blues':           [0, 2, 3, 4, 7, 9],

  // Advanced jazz / world scales
  'Altered':               [0, 1, 3, 4, 6, 8, 10],
  'Half-Whole Diminished': [0, 1, 3, 4, 6, 7, 9, 10],
  'Whole-Half Diminished': [0, 2, 3, 5, 6, 8, 9, 11],
  'Whole Tone':            [0, 2, 4, 6, 8, 10],
  'Lydian Dominant':       [0, 2, 4, 6, 7, 9, 10],
  'Phrygian Dominant':     [0, 1, 4, 5, 7, 8, 10],

  // Bebop scales — 8 tones with a chromatic passing note added to a
  // diatonic mode, designed so a strict 8th-note line places chord
  // tones on the strong beats. Used for jazz-flavored fill / passing.
  'Bebop Dominant':        [0, 2, 4, 5, 7, 9, 10, 11],   // Mixolydian + M7 passing
  'Bebop Major':           [0, 2, 4, 5, 7, 8, 9, 11],    // Ionian + b6 passing
  'Bebop Dorian':          [0, 2, 3, 4, 5, 7, 9, 10],    // Dorian + M3 passing
  'Bebop Melodic Minor':   [0, 2, 3, 5, 7, 8, 9, 11],    // Melodic Minor + b6 passing

  // Soul / R&B / pop modal hybrids
  'Mixolydian b6':         [0, 2, 4, 5, 7, 8, 10],       // Stevie Wonder / D'Angelo / Beatles
  'Lydian #9':             [0, 3, 4, 6, 7, 9, 11],       // Pop ballad lift (Adele-style)
  'Harmonic Major':        [0, 2, 4, 5, 7, 8, 11],       // Jazz/pop modal interchange

  // Blues hybrids
  'Composite Blues':       [0, 3, 4, 5, 6, 7, 10],       // Blues with both b3 + M3 (full blues palette)
  'Country Blues':         [0, 2, 3, 4, 7, 9, 10],       // Major Blues + b7 (country-blues fusion)
};
// ------------------------------------------------------------------
// Modal characteristic notes — 调式特征音字典 (相对 scale root 的半音数).
// 在调式 (modal) 场域下, 这些音免疫物理避讳法则 — 它们是调式的灵魂,
// 必须强拍悬挂 (Dorian 死磕 大6度 / Lydian 死磕 #11 / Mixolydian 死磕 b7).
// 调性 (tonal) 场域下回归严格 — 特征音只能短经过, 否则三全音泄露成 V7.
// ------------------------------------------------------------------

export const MODAL_CHARACTERISTIC_NOTES: Record<string, number[]> = {
  'Dorian': [9],                // 大六度 (♮6) — Dorian 唯一特征
  'Phrygian': [1],              // 小二度 (b2 / b9)
  'Lydian': [6],                // 增四度 (#4 / #11)
  'Mixolydian': [10],           // 小七度 (b7)
  'Locrian': [1, 6],            // b2, b5
  'Aeolian': [8],               // 小六度 (b6)
  'Harmonic Minor': [8, 11],    // b6, ♮7
  'Melodic Minor': [9, 11],     // ♮6, ♮7
  'Blues': [3, 6, 10],          // b3, b5, b7 — 蓝调三连
  'Major Blues': [3],           // b3 — 大调 blues 的"crush" 音
  'Lydian Dominant': [6, 10],   // #11, b7 — Lydian b7
  'Phrygian Dominant': [1, 8],  // b9, b13
  'Altered': [1, 3, 6, 8],      // Altered scale 全色彩
  'Bebop Dominant': [10, 11],   // b7 + nat 7 双经过
  'Bebop Major': [8, 9],        // b6 + nat 6 双经过
};

// ------------------------------------------------------------------
// 大一统物理避讳音判定 (Universal Avoid-Note Calculus)
// 完全取代旧 AVOID_NOTE_TABLE — 用 3 大物理法则推算任何和弦的避讳音:
//   法则 1: 小九度碰撞 — 1/3/5 上方半音 = avoid (声学摩擦)
//   法则 2: 三全音泄露 — 非属和弦上小和弦避大6度 (篡位为 V7)
//   法则 3: 属和弦例外 — D 函数全张力放行 (除纯4度 + maj7)
// + 调式特征音免死: isModalContext 时, scale 的 characteristic notes
//   豁免所有物理法则.
// ------------------------------------------------------------------

export function isAvoidNote(
  interval: number,
  chordType: string,
  scaleName: string = '',
  isModalContext: boolean = false,
  func: 'T' | 'S' | 'D' | string = 'T'
): boolean {
  const pc = ((interval % 12) + 12) % 12;
  const chordIvs = CHORD_TYPES[chordType] || [0, 4, 7];

  // 0. Chord literal 永远绝对安全 (chord type 自己声明的音)
  if (chordIvs.some(iv => (iv % 12) === pc)) return false;

  // Chord quality 分类
  const isHalfDim = chordType === 'm7b5' || chordType === 'm9b5';
  const isDim = chordType === 'dim' || chordType === 'dim7';
  const isMinor = !isHalfDim && !isDim
      && (chordType === 'min' || (chordType.startsWith('m') && !chordType.startsWith('maj')));
  const isDom = !isMinor && !isHalfDim && !isDim
      && (chordType === '7' || chordType === 'dom7'
          || chordType.startsWith('7') || chordType === '9' || chordType === '11'
          || chordType === '13' || chordType.includes('alt'));
  const isSus = chordType.includes('sus');
  const isAug = chordType === 'aug' || chordType.includes('#5');

  // Chord backbone (1/3/5) intervals — 法则 1 用
  const third = isSus ? 5 : ((isMinor || isHalfDim || isDim) ? 3 : 4);
  const fifth = (isHalfDim || isDim) ? 6 : (isAug ? 8 : 7);

  // 1. Modal exemption — 特征音免死金牌
  if (isModalContext && scaleName && MODAL_CHARACTERISTIC_NOTES[scaleName]) {
    if (MODAL_CHARACTERISTIC_NOTES[scaleName].includes(pc)) {
      return false;
    }
  }

  // 2. 属和弦例外 (法则 3) — D 函数全张力合法, 但避两条:
  //   - 纯 4 度 (非 sus): 跟 chord 3 形成小二度 + 提前解决感
  //   - maj7: 跟 b7 形成半音冲突, 破坏 dom 性质
  if (isDom || func === 'D') {
    if (pc === 5 && !isSus) return true;
    if (pc === 11) return true;
    return false;
  }

  // 3. 破坏和弦性质的核心音 — Destroyer Notes
  if (isSus && (pc === 3 || pc === 4)) return true;            // sus 避大小三
  if (!isMinor && !isHalfDim && !isSus && !isDim && pc === 3) return true;  // 大调避 b3
  if ((isMinor || isHalfDim) && !isSus && pc === 4) return true;  // 小调避 maj3

  // 4. 物理法则 1: 小九度碰撞定理
  //    1/3/5 上方半音 = avoid (声学摩擦, 大脑判定为"踩到下方骨干")
  const backbones = [0, third, fifth];
  for (const bone of backbones) {
    if (pc === (bone + 1) % 12) return true;
  }

  // 5. 物理法则 2: 三全音泄露定理
  //    调性场 + 非 D 函数 + 小和弦上: 大 6 度 (pc 9) 跟 chord 3 (pc 3)
  //    形成三全音, 听感坍塌成无根 V7. 调式场不受此约束 (Dorian 6 死磕).
  if (!isModalContext && func !== 'D' && (isMinor || isHalfDim)) {
    if (pc === 9) return true;
  }

  return false;
}

// ------------------------------------------------------------------
// Note role classification — 老师"音的角色表"哲学落地.
// 把一个候选音相对当前和弦+音阶+调式上下文, 分到 5 类角色之一,
// 供 soft score 按"角色 × 位置"评分使用 (替代旧的 binary avoid).
//   chord_tone     — pc ∈ chord type literal intervals (1/3/5/7,
//                    含 chord type 自带的扩展 9/11/13 if baked)
//   stable_tension — admissible color (chord quality 容许的张力)
//   characteristic — modal context 下当前 scale 的特征音
//   avoid          — 物理法则判 avoid (小九度碰撞 / 三全音泄露 / etc.)
//   chromatic      — 非 scale 内 + 非上述
// 优先级 1→5: chord_tone 先, avoid 优先于 stable/characteristic,
// modal characteristic 在 isModalContext 时高于普通 stable_tension.
// ------------------------------------------------------------------

export type NoteRole = 'chord_tone' | 'stable_tension' | 'characteristic' | 'avoid' | 'chromatic';

export function classifyNoteRole(
  pc: number,
  chordType: string,
  chordRootPc: number,
  scaleName: string = '',
  isModalContext: boolean = false,
  func: 'T' | 'S' | 'D' | string = 'T',
  scaleRootPc: number = -1,
  runScalePcs: Set<number> | null = null,
): NoteRole {
  const normPc = ((pc % 12) + 12) % 12;
  const rootPc = ((chordRootPc % 12) + 12) % 12;
  const intervalFromRoot = (((normPc - rootPc) % 12) + 12) % 12;

  // 1. Chord literal — chord type 自己声明的音 (含 baked extensions)
  const chordIvs = CHORD_TYPES[chordType] || [0, 4, 7];
  if (chordIvs.some(iv => (iv % 12) === intervalFromRoot)) {
    return 'chord_tone';
  }

  // 2. 物理法则 avoid — 优先于 stable_tension / characteristic
  //    (avoid 的优先级最高, 因为它们是声学摩擦, 不该当稳定落点)
  //    Modal exemption 内嵌在 isAvoidNote 内 — 特征音会被排除 avoid 判定.
  if (isAvoidNote(intervalFromRoot, chordType, scaleName, isModalContext, func)) {
    return 'avoid';
  }

  // 3. Modal characteristic — isModalContext 且 scale 特征音名单内
  //    (走到这里说明物理 avoid 已经通过, 但可能是 scale 的特征音)
  if (isModalContext && scaleName && MODAL_CHARACTERISTIC_NOTES[scaleName]) {
    const scaleRootResolved = scaleRootPc >= 0 ? scaleRootPc : rootPc;
    const intervalFromScale = (((normPc - scaleRootResolved) % 12) + 12) % 12;
    if (MODAL_CHARACTERISTIC_NOTES[scaleName].includes(intervalFromScale)) {
      return 'characteristic';
    }
  }

  // 4. Stable tension — chord quality 容许的 admissible color
  const { pcs: admissiblePcs } = computeGlobalContract(chordType, chordRootPc);
  if (admissiblePcs.has(normPc)) {
    return 'stable_tension';
  }

  // 5. Scale 内但非上述 → stable_tension 弱版 (scale-borrowed)
  //    Scale 外 → chromatic (半音装饰)
  if (runScalePcs && runScalePcs.has(normPc)) {
    return 'stable_tension';
  }
  return 'chromatic';
}

// ------------------------------------------------------------------
// Scale helpers (concrete MIDI ranges centred on a key root).
// ------------------------------------------------------------------

/**
 * Snap a target MIDI to the nearest entry in a scale array, optionally
 * shifted by `stepOffset` scale degrees. Used by the engine when an
 * arbitrary calculated pitch must land on a permissible scale tone.
 */
export function getClosestScaleMidi(targetMidi: number, scaleMidis: number[], stepOffset: number): number {
  if (scaleMidis.length === 0) return targetMidi;
  let bestIdx = 0; let minDiff = 1000;
  scaleMidis.forEach((sm, i) => {
      if (Math.abs(sm - targetMidi) < minDiff) { minDiff = Math.abs(sm - targetMidi); bestIdx = i;}
  });
  let newIdx = Math.max(0, Math.min(scaleMidis.length - 1, bestIdx + stepOffset));
  return scaleMidis[newIdx];
}

// ------------------------------------------------------------------
// MIDI ↔ pcs general utilities (tonal `@tonaljs/midi` MIT pattern).
// More generic than getClosestScaleMidi above: take a Set<number> pcs
// (no pre-built MIDI array needed) and return a closure for repeated
// queries. Useful when the pcs set comes from arbitrary contexts
// (chord-scale, mode pool, user-input motif, etc.).
// ------------------------------------------------------------------

/**
 * Build a "snap to nearest pcs member" function. Walks outward from
 * input MIDI 1 semitone at a time, returning the first match. Returns
 * null only if pcs is empty.
 *
 *   const snap = pcsetNearest(new Set([0, 2, 4, 5, 7, 9, 11])); // C major
 *   snap(60) // 60 (C — already in set)
 *   snap(61) // 62 (Db → D, prefer up)
 *   snap(63) // 64 (Eb → E, prefer up)
 *
 * "Prefer up": when both up and down distances are equal, returns the
 * upper choice. Matches tonal's behavior.
 */
export function pcsetNearest(pcs: Set<number>): (midi: number) => number | null {
  const chromaSet = new Set(Array.from(pcs).map(p => ((p % 12) + 12) % 12));
  return (midi: number): number | null => {
    if (chromaSet.size === 0) return null;
    const ch = ((midi % 12) + 12) % 12;
    if (chromaSet.has(ch)) return midi;
    for (let i = 1; i < 12; i++) {
      if (chromaSet.has((ch + i) % 12)) return midi + i;
      if (chromaSet.has((((ch - i) % 12) + 12) % 12)) return midi - i;
    }
    return null;
  };
}

/**
 * Build a "scale step → MIDI" function. Index 0 = tonic; positive
 * steps go up the pcs (in chroma-ascending order from tonic); negative
 * go down. Wraps with octave shifts.
 *
 *   const steps = pcsetSteps(new Set([0, 2, 3, 5, 7, 9, 10]), 62); // D Dorian
 *   [-2, -1, 0, 1, 2, 3].map(steps); // [57, 58, 62, 64, 65, 67]
 */
export function pcsetSteps(pcs: Set<number>, tonicMidi: number): (step: number) => number {
  const tonicPc = ((tonicMidi % 12) + 12) % 12;
  const sortedSteps = Array.from(pcs)
    .map(p => (((p - tonicPc) % 12) + 12) % 12)
    .sort((a, b) => a - b);
  const len = sortedSteps.length;
  if (len === 0) return () => tonicMidi;
  return (step: number): number => {
    const index = step < 0
      ? ((len - (((-step) % len) || len)) % len)
      : step % len;
    const octaves = Math.floor(step / len);
    return sortedSteps[index] + octaves * 12 + tonicMidi;
  };
}

/**
 * Like pcsetSteps but 1-indexed (degree 1 = tonic). Degree 0 returns
 * null (no zeroth degree musically).
 */
export function pcsetDegrees(pcs: Set<number>, tonicMidi: number):
    (degree: number) => number | null {
  const steps = pcsetSteps(pcs, tonicMidi);
  return (degree: number): number | null => {
    if (degree === 0) return null;
    return steps(degree > 0 ? degree - 1 : degree);
  };
}

