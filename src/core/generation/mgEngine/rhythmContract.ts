// ==========================================
// rhythmContract.ts
//
// Style/Rhythm contract layer — aligns lick rhythm DNA with accompaniment
// texture feel. Solves: "lick has triplets (8/3 / 4/3) but accompaniment
// is straight 16ths" — listener perceives rhythmic mismatch, the song
// doesn't groove.
//
// Impro-Visor's .sty files achieve this by constraining bass/chord/drum
// patterns to a shared `(swing X)` and `(comp-swing Y)` parameter — the
// whole stack feels the same grid. We don't import their patterns;
// instead, we analyze the picked lick's rhythm and bias texture
// SELECTION to match. Texture DATA stays unchanged.
//
// Read-only adapter:
//   1. analyzeLickRhythm(notes) → LickProfile
//   2. inferSongRhythmFeel(allLicks) → RhythmFeel
//   3. textureFeelOf(textureId) → RhythmFeel  (mapping by name pattern)
//   4. acceptableTextureFeels(songFeel) → Set<RhythmFeel>  (compatibility)
//
// User direction: don't change texture patterns themselves; constrain
// which texture gets picked so accompaniment grid matches lick grid.
// ==========================================

export type RhythmFeel =
  | 'straight_8'
  | 'straight_16'
  | 'swing_8'         // jazz-swing 2:1 long-short 8ths
  | 'triplet_12_8'    // explicit triplet grid (12/8 feel, jazz waltz, slow blues 12/8)
  | 'shuffle'         // blues shuffle (related to swing_8 but heavier)
  | 'rubato_ballad';  // long-note feel, no fixed grid

export interface LickProfile {
  rhythmFeel: RhythmFeel;
  /** Notes per beat (averaged over the lick's total span). */
  density: number;
  /** True when ANY note's onset lands on a triplet position. */
  hasTripletGrid: boolean;
  /** True when most notes have d ≥ 1.0 (long-note ballad feel). */
  isLongNoteDominant: boolean;
  /** True when most notes hit 16th positions (.25 / .75 fractions). */
  is16thDominant: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Lick rhythm analyzer
// ─────────────────────────────────────────────────────────────────────

export function analyzeLickRhythm(notes: Array<{ t: number; d: number }>): LickProfile {
  if (notes.length === 0) {
    return {
      rhythmFeel: 'straight_8',
      density: 0,
      hasTripletGrid: false,
      isLongNoteDominant: false,
      is16thDominant: false,
    };
  }
  let tripletPos = 0;
  let str8Pos = 0;
  let str16Pos = 0;
  let longCount = 0;
  let totalSpan = 0;
  for (const n of notes) {
    const frac = n.t - Math.floor(n.t);
    // Triplet positions: 0.333 / 0.667 (8th-triplet sub) or 0.167 / 0.833 (16th-triplet)
    if (Math.abs(frac - 0.333) < 0.05 || Math.abs(frac - 0.667) < 0.05
        || Math.abs(frac - 0.167) < 0.05 || Math.abs(frac - 0.833) < 0.05) {
      tripletPos++;
    } else if (Math.abs(frac - 0.5) < 0.02) {
      str8Pos++;
    } else if (Math.abs(frac - 0.25) < 0.02 || Math.abs(frac - 0.75) < 0.02) {
      str16Pos++;
    }
    if (n.d >= 1.0) longCount++;
    totalSpan = Math.max(totalSpan, n.t + n.d);
  }
  const density = totalSpan > 0 ? notes.length / totalSpan : 0;
  const hasTripletGrid = tripletPos > 0;
  const isLongNoteDominant = longCount / notes.length > 0.5 && density < 1.0;
  const is16thDominant = str16Pos > str8Pos && str16Pos > tripletPos && !hasTripletGrid;

  let feel: RhythmFeel;
  if (hasTripletGrid) feel = 'triplet_12_8';
  else if (isLongNoteDominant) feel = 'rubato_ballad';
  else if (is16thDominant) feel = 'straight_16';
  else feel = 'straight_8';

  return { rhythmFeel: feel, density, hasTripletGrid, isLongNoteDominant, is16thDominant };
}

// ─────────────────────────────────────────────────────────────────────
// Song-level feel inference — aggregate across all bars' picked licks
// ─────────────────────────────────────────────────────────────────────

/**
 * Pick the dominant feel from the song's lick collection. Voting rule:
 *   - if ANY lick has triplet grid AND > 25% of licks do → triplet_12_8
 *   - else if > 50% are long-note → rubato_ballad
 *   - else if > 50% are 16th-dominant → straight_16
 *   - else → straight_8
 *
 * Style is applied as a tiebreak (jazz prefers swing_8 over straight_8
 * when neutral).
 */
export function inferSongRhythmFeel(
  lickProfiles: LickProfile[],
  style: string,
): RhythmFeel {
  if (lickProfiles.length === 0) {
    return style === 'JAZZ' || style === 'BLUES' ? 'swing_8' : 'straight_8';
  }
  const tripletCount = lickProfiles.filter(p => p.hasTripletGrid).length;
  const longCount = lickProfiles.filter(p => p.isLongNoteDominant).length;
  const sixteenthCount = lickProfiles.filter(p => p.is16thDominant).length;
  const total = lickProfiles.length;

  if (tripletCount / total > 0.25) {
    // Jazz / blues 三连音 → swing_8 or triplet_12_8 depending on density
    const heavyTriplet = tripletCount / total > 0.5;
    if (style === 'BLUES' && heavyTriplet) return 'shuffle';
    if (heavyTriplet) return 'triplet_12_8';
    return style === 'JAZZ' || style === 'BLUES' ? 'swing_8' : 'triplet_12_8';
  }
  if (longCount / total > 0.5) return 'rubato_ballad';
  if (sixteenthCount / total > 0.5) return 'straight_16';
  // Default by style
  if (style === 'JAZZ') return 'swing_8';
  if (style === 'BLUES') return 'shuffle';
  return 'straight_8';
}

// ─────────────────────────────────────────────────────────────────────
// Texture rhythm-feel mapping — by name pattern
// ─────────────────────────────────────────────────────────────────────

/**
 * Infer a texture's rhythm feel from its id. Heuristic by name keywords;
 * each texture is one of: triplet / shuffle / 16th / 8th / ballad / mixed.
 * MIXED textures pass any feel filter.
 *
 * No texture data is modified — this is a read-only classification.
 */
export function textureFeelOf(textureId: string): RhythmFeel | 'mixed' {
  const id = textureId.toLowerCase();
  // Explicit triplet textures
  if (/12.?8|triplet|gospel.?triplet|slow.?12/.test(id)) return 'triplet_12_8';
  // Shuffle / boogie / swing
  if (/shuffle|boogie/.test(id)) return 'shuffle';
  if (/swing|jazz.?drop|charleston|red.?garland|jazz.?waltz|bossa/.test(id)) return 'swing_8';
  // Ballad / long-note
  if (/ballad|158|wave|sweep|pad|ambient/.test(id)) return 'rubato_ballad';
  // 16th grid
  if (/16th|16s|alberti|funk.?stab|wave_16|piano_arp_16|laid.?back|neo.?soul.?roll|classic.?soul.?arp/.test(id)) return 'straight_16';
  // 8th / pulse / broken
  if (/8ths|8th|pulse|broken|anthem|broken.?chord|stride/.test(id)) return 'straight_8';
  // Block / arp generic — mixed
  return 'mixed';
}

// ─────────────────────────────────────────────────────────────────────
// Per-bar comping-mode selection — Impro-Visor's "dense lick → shell
// comp" principle. When the lick is busy, the accompaniment must thin
// out (shell / stab / answer-only) so the listener can hear the lick
// without harmonic mush.
//
// Texture data ITSELF stays unchanged; this just signals the per-bar
// renderer how much to play.
// ─────────────────────────────────────────────────────────────────────

export type CompingMode =
  | 'full_voicing'      // default — full chord with extensions
  | 'shell_only'        // chord literal only (1/3/5/7), no extensions
  | 'answer_only'       // fires only in melodic GAPS (when lick rests)
  | 'bass_plus_shell';  // minimum — bass + thin shell (root + 7)

/** Bar-local lick characteristics that drive comping-mode decision. */
export interface BarLickContract {
  /** Number of note attacks in the bar (after clip to chord.duration). */
  attackCount: number;
  /** Total beats covered by lick activity (sum of d for in-bar notes). */
  occupiedBeats: number;
  /** Bar duration (4 in normal 4/4). */
  barDuration: number;
  /** True when any lick note hits a triplet position. */
  hasTripletGrid: boolean;
}

export function buildBarLickContract(
  notes: Array<{ t: number; d: number }>,
  barDuration: number,
): BarLickContract {
  const inBar = notes.filter(n => n.t < barDuration - 0.001);
  const attackCount = inBar.length;
  const occupiedBeats = inBar.reduce(
    (s, n) => s + Math.min(n.d, barDuration - n.t),
    0,
  );
  let hasTripletGrid = false;
  for (const n of inBar) {
    const frac = n.t - Math.floor(n.t);
    if (Math.abs(frac - 0.333) < 0.05 || Math.abs(frac - 0.667) < 0.05) {
      hasTripletGrid = true;
      break;
    }
  }
  return { attackCount, occupiedBeats, barDuration, hasTripletGrid };
}

/**
 * Decide the bar's comping mode from the lick's attack density.
 * Thresholds per user direction:
 *   ≥ 8 attacks (very dense 16th run) → bass_plus_shell
 *   occupied ≥ 2.5 beats (long hold)  → answer_only
 *   ≥ 5 attacks (busy)                → shell_only
 *   otherwise                         → full_voicing
 */
export function decideCompingModeForLick(lick: BarLickContract): CompingMode {
  if (lick.attackCount >= 8) return 'bass_plus_shell';
  if (lick.occupiedBeats >= 2.5 && lick.attackCount <= 3) return 'answer_only';
  if (lick.attackCount >= 5) return 'shell_only';
  return 'full_voicing';
}

/**
 * Map CompingMode → density modifier (multiplicative).
 *   full_voicing       → 1.00 (no change)
 *   shell_only         → 0.65 (sparser)
 *   answer_only        → 0.40 (very sparse, lots of rests)
 *   bass_plus_shell    → 0.30 (minimum support)
 *
 * Density is the existing applyTexture parameter; modulating it here
 * makes the renderer pick its sparser variants without changing the
 * texture's note vocabulary.
 */
export function densityMultiplierForCompingMode(mode: CompingMode): number {
  switch (mode) {
    case 'full_voicing':     return 1.00;
    case 'shell_only':       return 0.65;
    case 'answer_only':      return 0.40;
    case 'bass_plus_shell':  return 0.30;
  }
}

/**
 * Which texture feels are compatible with a song's lick feel?
 * E.g., if song is triplet_12_8, only triplet/shuffle textures fit;
 * if straight_8, straight_8 + ballad acceptable.
 */
export function acceptableTextureFeels(songFeel: RhythmFeel): Set<RhythmFeel | 'mixed'> {
  switch (songFeel) {
    case 'triplet_12_8':
      return new Set(['triplet_12_8', 'shuffle', 'mixed']);
    case 'shuffle':
      return new Set(['shuffle', 'triplet_12_8', 'swing_8', 'mixed']);
    case 'swing_8':
      return new Set(['swing_8', 'shuffle', 'mixed']);
    case 'straight_16':
      return new Set(['straight_16', 'straight_8', 'mixed']);
    case 'straight_8':
      return new Set(['straight_8', 'straight_16', 'rubato_ballad', 'mixed']);
    case 'rubato_ballad':
      return new Set(['rubato_ballad', 'straight_8', 'mixed']);
  }
}
