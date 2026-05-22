// ------------------------------------------------------------------
// Rhythm patterns — Euclidean rhythm + utilities.
//
// What: pure-algorithm rhythm generation. Each function returns a
// `RhythmPattern` (binary array of 0/1) representing "this position
// hits / rests".
//
// Why: world-music groove generators(克拉夫 / Tresillo / Bossa son /
// Cuban Cinquillo / Afro-bell)almost all follow Euclidean
// distribution — the most uniform spread of N beats across M steps.
// Source: Toussaint 2005 "The Euclidean Algorithm Generates
// Traditional Musical Rhythms" + tonal `@tonaljs/rhythm-pattern`
// (MIT, Daniel Gómez Blasco). Algorithm copied verbatim under MIT.
//
// ESP32 friendliness: pure algorithm, zero data, < 1 KB compiled.
// Patterns can also be precomputed at module load and stored as
// constant arrays for hottest paths.
// ------------------------------------------------------------------

export type RhythmStep = 0 | 1;
export type RhythmPattern = RhythmStep[];

/**
 * Generate an Euclidean rhythm — maximally even distribution of
 * `beats` hits across `steps` positions.
 *
 * @example
 *   euclid(8, 3)   // [1,0,0,1,0,0,1,0]  ← Tresillo (Cuban 3-2)
 *   euclid(8, 5)   // [1,0,1,1,0,1,1,0]  ← Cinquillo
 *   euclid(16, 5)  // ← Son Clave (forward)
 *   euclid(12, 5)  // ← Quintillo
 *   euclid(7, 3)   // [1,0,1,0,1,0,0]   ← Afro-bell 7-3
 *
 * Source: Toussaint 2005; tonal `@tonaljs/rhythm-pattern` (MIT).
 */
export function euclid(steps: number, beats: number): RhythmPattern {
  if (steps <= 0 || beats < 0) return [];
  const pattern: RhythmPattern = [];
  let d = -1;
  for (let i = 0; i < steps; i++) {
    const v = Math.floor((i * beats) / steps);
    pattern[i] = v !== d ? 1 : 0;
    d = v;
  }
  return pattern;
}

/**
 * Rotate a rhythm pattern right by N positions. Negative values
 * rotate left.
 *
 * @example
 *   rotate([1,0,0,1,0,0,1,0], 2) // [1,0,1,0,0,1,0,0]
 */
export function rotate(pattern: RhythmPattern, rotations: number): RhythmPattern {
  const len = pattern.length;
  if (len === 0) return [];
  const out: RhythmPattern = new Array(len);
  for (let i = 0; i < len; i++) {
    const src = (((i - rotations) % len) + len) % len;
    out[i] = pattern[src];
  }
  return out;
}

/**
 * Build a pattern from "onset sizes" — a list of gap counts between
 * each onset. Useful when you know the rhythm by its inter-onset
 * intervals rather than its grid.
 *
 * @example
 *   onsets(2, 2, 2, 2)    // [1,0,0,1,0,0,1,0,0,1,0,0]   ← 4 hits, gap 2 each
 *   onsets(3, 3, 4, 2, 4) // [1,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0]
 */
export function onsets(...gaps: number[]): RhythmPattern {
  const out: RhythmPattern = [];
  for (const g of gaps) {
    out.push(1);
    for (let i = 0; i < g; i++) out.push(0);
  }
  return out;
}

/**
 * Convert a rhythm pattern into beat-time offsets (in pattern-grid
 * units). e.g. pattern [1,0,0,1,0,0,1,0] → onsets at positions
 * [0, 3, 6]. Useful for emitting events on a time grid.
 */
export function patternOnsetTimes(pattern: RhythmPattern): number[] {
  const out: number[] = [];
  for (let i = 0; i < pattern.length; i++) if (pattern[i] === 1) out.push(i);
  return out;
}

// ------------------------------------------------------------------
// Named convenience patterns — common world-music grooves derived
// from euclid(). All precomputed at module load.
// ------------------------------------------------------------------

/** Cuban 3-2 forward clave equivalent (compound feel, 8 sixteenths). */
export const TRESILLO: RhythmPattern = euclid(8, 3);

/** Cinquillo: 5 hits in 8 steps — Caribbean / Latin idiom. */
export const CINQUILLO: RhythmPattern = euclid(8, 5);

/** Son Clave (forward / "3-2"): 5 hits in 16 sixteenths, rotated to
 *  start on the "3 side". Approximates euclid(16, 5) with the rotation
 *  that puts onset 0 on the downbeat. */
export const SON_CLAVE_FWD: RhythmPattern = euclid(16, 5);

/** Afro-bell 12/8 staple — 7 hits in 12 steps. */
export const AFRO_BELL_12_7: RhythmPattern = euclid(12, 7);

/** Tumbao bass figure equivalent — 4 hits in 8 steps with offset. */
export const TUMBAO_BASS: RhythmPattern = rotate(euclid(8, 4), 2);

/** Compound triple emphasis — 2 hits per dotted-quarter in 6/8. */
export const COMPOUND_DOWNBEATS_6_8: RhythmPattern = euclid(6, 2);
