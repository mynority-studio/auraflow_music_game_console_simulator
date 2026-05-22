// ============================================================
// mode.ts — Emotion / mode resolution + key-family classification
// ============================================================
//
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(原 L137-262 + L1224-1231)。
//
// 90% of runs:emotion → mainstream partner mode(bright→Ionian / sad→Aeolian)
// 10% of runs:random EXOTIC_MODES pick
// ============================================================

export type Emotion = 'bright' | 'sad';

export const MAINSTREAM_EMOTION_TO_MODE: Record<Emotion, string> = {
  bright: 'Ionian',
  sad: 'Aeolian',
};

export const EXOTIC_MODES: readonly string[] = [
  'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian',
  'Harmonic Minor', 'Melodic Minor',
];

/**
 * Probability (0..1) that resolveGeneration's auto-mode path swaps in
 * one of EXOTIC_MODES instead of the mainstream Ionian / Aeolian.
 * 0.10 → ~1 in 10 songs picks one of seven EXOTIC_MODES.
 * Set to 0 to revert to mainstream-only.
 */
export const EXOTIC_MODE_PROBABILITY = 0.10;

// Modes that share a major-flavour tonic (raised 3rd from root).
export const MAJOR_FLAVOR_MODES: readonly string[] = [
  'Ionian', 'Lydian', 'Mixolydian',
];

export function modeProgressionTemplate(mode: string): 'Major' | 'Minor' {
  if (mode === 'Major') return 'Major';
  if (mode === 'Minor') return 'Minor';
  return MAJOR_FLAVOR_MODES.includes(mode) ? 'Major' : 'Minor';
}

// Resolve 'Major'/'Minor' aliases to canonical SCALE_TYPES name.
export function normalizeModeName(mode: string): string {
  if (mode === 'Major') return 'Ionian';
  if (mode === 'Minor') return 'Aeolian';
  return mode;
}

// ============================================================
// Mode distance + relative tonic
//
// Modes that share a parent scale have their tonics offset by fixed
// semitones. C Ionian and D Dorian both use C-major pcs but C Ionian's
// tonic is C (pc 0), D Dorian's is D (pc 2). modeDistance('Dorian',
// 'Ionian') = 2 (semitones up).
//
// Only Greek modes + Major/Minor aliases supported. Harmonic Minor /
// Melodic Minor are NOT modes of any single parent scale → null.
// ============================================================

// Tonic semitone offset from Ionian, when modes share the same parent scale.
const GREEK_MODE_TONIC_OFFSETS: Record<string, number> = {
  'Ionian':     0,
  'Major':      0,
  'Dorian':     2,
  'Phrygian':   4,
  'Lydian':     5,
  'Mixolydian': 7,
  'Aeolian':    9,
  'Minor':      9,
  'Locrian':    11,
};

/**
 * Semitone distance (mod 12) from source mode's tonic to destination
 * mode's tonic when they share the same parent scale.
 *
 *   modeDistance('Dorian', 'Ionian') = 2
 *   modeDistance('Aeolian', 'Ionian') = 9
 *   modeDistance('Ionian', 'Aeolian') = 3
 *
 * Returns null for modes outside the Greek family.
 */
export function modeDistance(destMode: string, srcMode: string): number | null {
  const dst = GREEK_MODE_TONIC_OFFSETS[destMode];
  const src = GREEK_MODE_TONIC_OFFSETS[srcMode];
  if (dst === undefined || src === undefined) return null;
  return (((dst - src) % 12) + 12) % 12;
}

/**
 * Compute the destination mode's tonic pc given the source mode's
 * tonic pc, when both share the same parent scale.
 *
 *   relativeTonic('Aeolian', 'Ionian', 0) = 9 (A is C major's relative-minor)
 *   relativeTonic('Mixolydian', 'Ionian', 0) = 7 (G is C major's Mixolydian)
 *
 * Returns null for modes outside the Greek family.
 */
export function relativeTonic(
  destMode: string,
  srcMode: string,
  srcTonicPc: number,
): number | null {
  const dist = modeDistance(destMode, srcMode);
  if (dist === null) return null;
  return (((srcTonicPc + dist) % 12) + 12) % 12;
}

/**
 * Mode-name → key family for INTERVAL_AESTHETICS lookup. Major-family
 * modes(Ionian / Lydian / Mixolydian)→ major profile;minor-family
 * modes(Aeolian / Dorian / Phrygian / Locrian / Harmonic / Melodic
 * minor / Minor Blues / Phrygian Dominant / Half-Whole Diminished)→ minor.
 */
export function modeToKeyFamily(mode: string): 'major' | 'minor' {
    const MINOR_MODES = new Set([
        'Minor', 'Aeolian', 'Dorian', 'Phrygian', 'Locrian',
        'Harmonic Minor', 'Melodic Minor', 'Minor Blues',
        'Phrygian Dominant', 'Half-Whole Diminished',
    ]);
    return MINOR_MODES.has(mode) ? 'minor' : 'major';
}
