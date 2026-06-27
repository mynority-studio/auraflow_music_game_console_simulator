// ============================================================
// newEngine · knowledge · MgMusicTheory(MG strict 移植 Loop 6)
// Provenance: ../melodygenerative/src/lib/musicTheory.ts 逐字节复制(5244 行,零 static import)。
// 唯一改动:① 末尾加 StyleName(localScaleResolver/melodyShaper 需);② getMelodyChordSemantics 内
//   require('./improvisorVocab')→'./improvisorChordVocab'(该函数不在旋律塑形闭包内)。
// 乐理 source-of-truth:CHORD_TYPES/SCALE_TYPES/MELODY_RANGE/resolveDegree/evaluateNoteInChordContext/
//   computeGlobalContract/noteToMidi/normalizeChordType… 全表 byte 复制 → 零转译风险。取代 mgMusicTheory。
// ============================================================

// ==========================================
// musicTheory.ts — Source of truth for music-theory primitives.
//
// This module owns: scale interval definitions, note ↔ MIDI conversion,
// chord-interval aesthetics (CHORD_VOICING_AESTHETICS), interval
// tension/resolution rules (INTERVAL_AESTHETICS), avoid-note tables,
// the TensionTracker, and per-mode chord legality (CHORD_COLOR_DICTIONARY).
// styleDictionary.ts may reference scale names defined here.
// musicEngine.ts is the only orchestrator allowed to call into this module.
// ==========================================

// ------------------------------------------------------------------
// Note name ↔ MIDI conversion
//
// noteToMidi parses note strings as letter + accidental + octave so
// every enharmonic spelling round-trips correctly:
//
//   C#4 / Db4    → 61    F##3 / G3    → 55
//   B#3 → 60  (B-letter octave 3 + 1 = same pitch as C4)
//   Cb4 → 59  (C-letter octave 4 - 1 = same pitch as B3)
//   Bbb3 → 57 (B-letter octave 3 - 2 = same pitch as A3)
//
// The octave digit is anchored to the natural letter, not the spelled
// pitch class — B#3 is "B in octave 3 raised one semitone", which
// crosses the C boundary into C4 pitch. Same logic for Cb / Fb / B#.
//
// Source-of-truth roundtrip rule: every chord-voicing MIDI value must
// satisfy noteToMidi(midiToNoteInChord(m, ...)) === m. Sharp-key chords
// (F#m7 in D major) and chord-relative spellings (b5 of Fm9 = Cb)
// route through this parser before reaching the audio renderer.
// ------------------------------------------------------------------

const _LETTER_NATURAL_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export function noteToMidi(note: string): number {
  if (!note) return 60;
  const m = note.match(/^([A-G])(##|#|bb|b)?(-?\d+)?$/);
  if (!m) return 60;
  const letter = m[1];
  const acc = m[2] ?? '';
  const octave = m[3] !== undefined ? parseInt(m[3], 10) : 4;
  const natural = _LETTER_NATURAL_PC[letter];
  if (natural === undefined) return 60;
  let adj = 0;
  if (acc === '#') adj = 1;
  else if (acc === '##') adj = 2;
  else if (acc === 'b') adj = -1;
  else if (acc === 'bb') adj = -2;
  return (octave + 1) * 12 + natural + adj;
}

export function midiToNote(midi: number): string {
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = names[(midi % 12 + 12) % 12];
  return `${pitchClass}${octave}`;
}

// ------------------------------------------------------------------
// Melody pitch range. Notes outside this window become physically
// uncomfortable on a piano sample bank — the upper bound (E6 = MIDI 88)
// avoids shrill upper-register screams that fight the comping voice
// leading; the lower bound (A1 = MIDI 33) stops the melody from
// dropping into bass territory where the sampler's body resonance
// muddies the line.
// Universal — applies to every melody note including sacred motif
// projections, since octave-shifting preserves the interval structure
// the motif was authored to deliver.
// ------------------------------------------------------------------

// Standard pitch ranges by role. Anchored to typical piano /
// vocal-led genre practice:
//
//   Bass    A1 (33) — G3 (55)   — piano LH / bass guitar core zone.
//                                 Below A1 sounds sub-musical on most
//                                 systems and conflicts with the
//                                 melody/comping registers.
//   Chord   C3 (48) — A5 (81)   — comping voicing window. Sits above
//                                 the bass anchor and below the melody
//                                 lead. Octave-drop fallbacks must not
//                                 push chord events below this floor.
//   Melody  G3 (55) — F6 (89)   — vocal-lead / instrumental lead range.
//                                 G3 is tenor low; F6 is the high end
//                                 of pop / jazz lead writing. Octave-
//                                 shift clamp wraps notes back into
//                                 this window without changing pitch
//                                 class.
//
// MELODY_RANGE bottom = C4 (middle C). Below C4 is the bass / comping
// register: bass plays in BASS_RANGE [33, 55] and comping shell
// voicings sit in CHORD_RANGE [48, 81]. Letting melody drop into
// G3-B3 (the [55, 60) overlap zone) puts the listener's "main voice"
// in the same octave as the bass anchor, blurring the divisi role
// split — the bass and the melody appear to share register, and the
// listener can no longer tell which line is the song's "lead".
// Per user direction: chord low notes are for bass + accompaniment
// texture only, not melody backbone.
export const MELODY_RANGE = {
  LOW: 60,   // C4 (middle C) — below this is bass / comping territory
  HIGH: 86,  // D6 — soprano upper limit. Previously 89 (F6 / whistle
             // register) which produced uncalled-for Mariah-style highs
             // on pop/jazz melodies. D6 sits at the top of trained
             // soprano range and is the practical melodic ceiling for
             // mainstream pop/jazz vocal/lead-instrument idiom.
};

export const BASS_RANGE = {
  // C2 (36) is the practical low for piano LH bass. Below C2 enters
  // sub-bass / kick territory where pitch perception is mushy and
  // bassline doesn't anchor harmony — listener hears "thumping" not
  // "bass note". Real jazz piano (Bill Evans / McCoy / Hancock) almost
  // never goes below C2 except for one-off effects.
  // Previously LOW=33 (A1) — bass distribution showed many events at
  // A1 (= 33), which on piano sounds rumbly rather than musical.
  LOW: 36,
  HIGH: 55,
};

export const CHORD_RANGE = {
  LOW: 48,
  HIGH: 81,
};

// ------------------------------------------------------------------
// Emotion → Mode resolution
//
// The user-facing input to the generation pipeline is an emotion (or
// 'auto' for SEED-derived extraction). The engine resolves it to a
// concrete mode using these tables:
//
//   - 90% of runs: emotion → its mainstream partner mode
//        bright → Ionian, sad → Aeolian
//   - 10% of runs (regardless of emotion): a random EXOTIC_MODES pick
//
// When an exotic mode is selected, styleDictionary.progressions
// usually has no exact match. The engine falls back to the nearest
// Major/Minor template (modeProgressionTemplate) for chord skeletons,
// while the actual exotic mode name is still used to select melody
// scales via SCALE_TYPES.
// ------------------------------------------------------------------

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
 * one of EXOTIC_MODES instead of the mainstream Ionian / Aeolian
 * pairing for the chosen emotion. EXOTIC_MODES and their SCALE_TYPES
 * entries stay available to any caller that names an exotic mode
 * directly via `GenerationConfig.mode`.
 *
 * Set to 0 — tonal music (POP / JAZZ / RNB) is locked to Ionian /
 * Aeolian only. Modal modes (Dorian / Phrygian / Lydian / Mixolydian
 * / Locrian / Harmonic Minor / Melodic Minor) belong to MODAL music,
 * which is a different harmonic universe with its own scale-color
 * rules — mixing them into a tonal pipeline produces tonal-context-
 * blind generation (e.g. Locrian songs getting "borrowed chord"
 * labels for what are actually Locrian-diatonic chords).
 *
 * BLUES is handled separately in resolveGeneration with its own
 * Major Blues / Minor Blues mainstream pair. Set explicit
 * config.mode to override (snapshot tests use this).
 *
 * Set > 0 to re-enable modal-mode gambling for auto-mode pipelines.
 */
export const EXOTIC_MODE_PROBABILITY = 0;

// Modes that share a major-flavour tonic (raised 3rd from root).
// Used by modeProgressionTemplate to pick the nearest template
// when an exotic mode lacks a direct progression entry.
export const MAJOR_FLAVOR_MODES: readonly string[] = [
  'Ionian', 'Lydian', 'Mixolydian',
];

export function modeProgressionTemplate(mode: string): 'Major' | 'Minor' {
  // Literal 'Major' / 'Minor' from explicit GenerationConfig.mode
  // overrides (snapshot tests, advanced callers). MAJOR_FLAVOR_MODES
  // only lists mode-name variants ('Ionian' / 'Lydian' / 'Mixolydian')
  // so without this guard 'Major' itself would fall through to 'Minor'.
  if (mode === 'Major') return 'Major';
  if (mode === 'Minor') return 'Minor';
  return MAJOR_FLAVOR_MODES.includes(mode) ? 'Major' : 'Minor';
}

// Resolve 'Major' / 'Minor' aliases to their canonical mode name in
// SCALE_TYPES. 'Major' → 'Ionian', 'Minor' → 'Aeolian' (= natural
// minor). Exotic mode names pass through unchanged.
export function normalizeModeName(mode: string): string {
  if (mode === 'Major') return 'Ionian';
  if (mode === 'Minor') return 'Aeolian';
  return mode;
}

// ------------------------------------------------------------------
// Mode distance + relative tonic — modes that share a parent scale
// have their tonics offset by fixed semitones. C Ionian and D Dorian
// both use C-major pcs but C Ionian's tonic is C (pc 0), D Dorian's
// is D (pc 2). modeDistance('Dorian', 'Ionian') = 2 (semitones up).
//
// Source: tonal `@tonaljs/mode` (MIT) — fifth-circle algorithm.
// Adapted to semitone math (we don't track key signatures internally).
// Only the 7 Greek modes + Major/Minor aliases are supported.
// Harmonic Minor / Melodic Minor are NOT modes of any single parent
// scale — they don't fit this concept, function returns null for them.
// ------------------------------------------------------------------

// Tonic semitone offset from Ionian, when both modes share the same
// parent scale. E.g., the C major scale rooted on D is D Dorian, so
// Dorian.offset = 2 (D is 2 semitones above C).
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
 *     (D Dorian and C Ionian both use C-major pcs; D is 2 above C)
 *   modeDistance('Aeolian', 'Ionian') = 9
 *     (A Aeolian = relative minor of C major)
 *   modeDistance('Ionian', 'Aeolian') = 3
 *     (C Aeolian's relative major Eb is 3 above C)
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
 *   relativeTonic('Aeolian', 'Ionian', 0) = 9
 *     (C Ionian's relative-minor tonic is A)
 *   relativeTonic('Ionian', 'Aeolian', 9) = 0
 *     (A Aeolian's relative-major tonic is C)
 *   relativeTonic('Mixolydian', 'Ionian', 0) = 7
 *     (C Ionian's Mixolydian-mode tonic is G)
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

// ------------------------------------------------------------------
// Time signature / meter — pattern borrowed from Impro-Visor's Score +
// ChordPart architecture (read-only architectural review of the GPL-2
// repo; no code copied). Tonal `@tonaljs/time-signature` (MIT) shaped
// the parse / classify utility.
//
// Architectural principle: meter is metadata. All time positions in
// our engine live in quarter-note "beats" (continuous float, our
// equivalent of Impro-Visor's integer slot grid at infinite
// resolution). A meter literal like '6/8' is converted to
// `beatsPerMeasure` (in quarter-note units) so engine arithmetic
// continues working without time-base changes — only the bar
// boundary and strong-beat positions shift.
//
// Phase 13A (this addition) ships parse + helper + context type
// only. No engine code reads them yet. Phase 13B / 13C will retire
// the hardcoded "4" assumptions one site at a time.
// ------------------------------------------------------------------

export type MeterLiteral = string | [number, number];

export interface MeterContext {
  /** `[upper, lower]` from the parse — e.g. [4,4] / [6,8] / [3,4] / [5,4]. */
  meter: [number, number];
  /** Display string — e.g. '4/4'. */
  literal: string;
  /**
   * Beats per measure in QUARTER-NOTE units (matches our engine's
   * `time` field). 4/4 → 4; 3/4 → 3; 6/8 → 3 (6 eighths = 3 quarters);
   * 12/8 → 6; 5/4 → 5.
   */
  beatsPerMeasure: number;
  /**
   * Strong-beat positions within the measure, in quarter-note units.
   * 4/4 → [0, 2] (downbeat + halfway).
   * 3/4 → [0] (downbeat only — waltz).
   * 6/8 → [0, 1.5] (two compound beats of three eighths each).
   * 12/8 → [0, 1.5, 3, 4.5].
   * 5/4 → [0, 3] (3+2 default grouping; future: additive override).
   */
  strongBeats: number[];
  /** lower=8 AND upper divisible by 3 AND upper>=6 — 6/8 / 9/8 / 12/8. */
  isCompound: boolean;
  /** Simple duple / triple / quadruple — 2/4 / 3/4 / 4/4. */
  isSimple: boolean;
  /** 5/4 / 7/8 etc. — neither simple nor compound. */
  isIrregular: boolean;
}

/**
 * Parse a time-signature literal into [upper, lower]. Accepts:
 *   - string like '4/4' / '6/8' / '12/8'
 *   - tuple [4, 4] / [6, 8]
 * Returns null for malformed input.
 */
export function parseTimeSignature(literal: MeterLiteral): [number, number] | null {
  if (Array.isArray(literal)) {
    const [u, l] = literal;
    if (typeof u === 'number' && typeof l === 'number' && u > 0 && l > 0) {
      return [u, l];
    }
    return null;
  }
  const m = /^(\d+)\/(\d+)$/.exec(literal.trim());
  if (!m) return null;
  const u = parseInt(m[1], 10), l = parseInt(m[2], 10);
  if (u <= 0 || l <= 0) return null;
  return [u, l];
}

/**
 * Build a MeterContext from a meter literal. Returns 4/4 default when
 * the literal is unparseable — engine never needs to nullcheck.
 */
export function getMeterContext(literal: MeterLiteral): MeterContext {
  const parsed = parseTimeSignature(literal) ?? [4, 4];
  const [upper, lower] = parsed;
  // Quarter-note beats per measure: upper × (4 / lower).
  // For 4/4 → 4×1=4. For 6/8 → 6×0.5=3. For 12/8 → 12×0.5=6. For 3/4 → 3.
  const beatsPerMeasure = upper * (4 / lower);

  const isCompound = lower === 8 && upper >= 6 && upper % 3 === 0;
  const isSimple = !isCompound && [2, 3, 4].includes(upper) && (lower === 4 || lower === 2);
  const isIrregular = !isCompound && !isSimple;

  let strongBeats: number[];
  if (isCompound) {
    // Strong beat every 3 eighths = every 1.5 quarter-time units.
    const groups = upper / 3;
    strongBeats = Array.from({ length: groups }, (_, i) => i * 1.5);
  } else if (isSimple) {
    // 4/4 → [0, 2] (split halfway); 3/4 / 2/4 → [0] only.
    strongBeats = upper === 4 ? [0, 2] : [0];
  } else {
    // Irregular: default 3+2 / 4+3 grouping. (Additive override deferred.)
    const beatUnit = 4 / lower; // quarter-equiv of one lower-note
    if (upper === 5) strongBeats = [0, 3 * beatUnit];
    else if (upper === 7) strongBeats = [0, 4 * beatUnit];
    else strongBeats = [0];
  }

  return {
    meter: parsed,
    literal: `${upper}/${lower}`,
    beatsPerMeasure,
    strongBeats,
    isCompound,
    isSimple,
    isIrregular,
  };
}

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
 * Modal-mixture detector. Returns a short label naming the borrowed
 * chord family when the chord matches one of the standard modal-
 * interchange patterns (Berklee Contemporary Harmony):
 *
 *   In MAJOR key:
 *     iv          (parallel minor's iv)         e.g. Fm / Fm7  in C major
 *     bVI         (parallel minor's bVI)        e.g. Ab / Abmaj7
 *     bVII        (Mixolydian / parallel minor) e.g. Bb / Bb7
 *     bIII        (parallel minor's bIII)       e.g. Eb / Ebmaj7
 *     iim7b5      (parallel minor's iiø)        e.g. Dm7b5
 *     ivm6        (Melodic minor's iv)          e.g. Fm6 / Fmmaj7
 *     bII         (Phrygian / Neapolitan)       e.g. Db / Dbmaj7
 *     i           (parallel minor's i, rare)    e.g. Cm
 *     v           (parallel minor's v, rare)    e.g. Gm
 *
 *   In MINOR key:
 *     IV          (Dorian)                       e.g. F major   in C minor
 *     bII         (Phrygian / Neapolitan)        e.g. Db major
 *     V (dom7)    (harmonic minor / blues sub)   e.g. G7 — often
 *                                                  treated as the
 *                                                  standard minor-key
 *                                                  dominant, not
 *                                                  flagged unless
 *                                                  context specifically
 *                                                  signals mixture.
 *
 * IMPORTANT — secondary-dominant filter:
 *   A dominant-7 chord on a degree OTHER than the home mode's V is
 *   frequently a secondary dominant V7/X (e.g. C7 in C major is
 *   V7/IV, not a "borrowed Mixolydian I7"). The detector takes the
 *   next chord as context: when the current chord is a dom7 and the
 *   next chord's root sits a perfect fourth above the current root,
 *   we treat it as a secondary dominant (return null), not as
 *   modal mixture. Same handling for V/X labels (roman contains '/').
 *
 * The earlier pcs-subset detector returned the first parallel mode
 * containing the chord's pcs — that mis-labeled every dom7 in major
 * as "Mixolydian borrow", every dom7 in minor as "harmonic minor
 * borrow", and so on. The pattern-driven approach below only fires
 * on chords that real-world theorists actually call modal mixture.
 */
export function detectModeBorrowing(
  chordRootPc: number,
  chordType: string,
  keyRootPc: number,
  homeMode: string,
  // Optional context — when provided, filters out secondary-dominant
  // and V/X explicit-borrowing cases that should NOT be flagged as
  // modal mixture.
  roman?: string,
  nextChordRootPc?: number,
): string | null {
  const intervals = CHORD_TYPES[chordType];
  if (!intervals) return null;
  // Skip explicit secondary dominants / sub-V (different mechanism).
  if (roman && roman.includes('/')) return null;
  // CRITICAL — Diatonic-to-home check. A chord whose pitch classes are
  // a subset of the home mode's scale is by definition NOT a borrowed
  // chord; it's diatonic. Earlier versions of this detector ignored
  // this check and applied major-mode mixture patterns to exotic-mode
  // home keys (e.g. Locrian's diatonic i (m7b5) was flagged "i
  // (parallel minor)" — completely wrong, since Locrian's i IS m7b5
  // by definition). Without this guard, ANY chord-quality match in
  // the rule table fires regardless of whether the chord is actually
  // outside the home scale.
  const chordPcs = pcsFromIntervals(chordRootPc, intervals);
  const homePcsForCheck = scalePcsForMode(keyRootPc, normalizeModeName(homeMode));
  if (homePcsForCheck.size > 0 && pcsIsSubsetOf(chordPcs, homePcsForCheck)) {
      return null;  // diatonic — not borrowed
  }
  const degree = ((chordRootPc - keyRootPc) % 12 + 12) % 12;
  const isMinorQuality = chordType.startsWith('m')
      && !chordType.startsWith('maj');
  const isMajQuality = chordType === 'maj' || chordType === 'maj7'
      || chordType === 'maj9' || chordType === 'maj13'
      || chordType === '6' || chordType === '6/9' || chordType === 'add9';
  const isDomQuality = chordType === '7' || chordType === '9'
      || chordType === '11' || chordType === '13'
      || chordType === '7b9' || chordType === '7#9'
      || chordType === '7b13' || chordType === '7#11' || chordType === '7alt';
  // Secondary-dominant filter: dom7 chord whose next chord sits a
  // perfect fourth above (= the chord is V7/next). Skip flagging as
  // modal mixture in that case.
  if (isDomQuality && nextChordRootPc !== undefined) {
      const next = ((nextChordRootPc % 12) + 12) % 12;
      const rootMod = ((chordRootPc % 12) + 12) % 12;
      if (((next - rootMod + 12) % 12) === 5) return null;
  }
  const canonicalHome = normalizeModeName(homeMode);
  const isMinorHome = canonicalHome === 'Aeolian'
      || canonicalHome === 'Harmonic Minor' || canonicalHome === 'Melodic Minor'
      || canonicalHome === 'Minor Blues';

  if (!isMinorHome) {
      // MAJOR key — borrowed from parallel minor / Mixolydian / Phrygian.
      // (chord-type quality has to fit the position; minor iv on degree 5
      // = real mixture; dom7 on degree 5 = diatonic V7, not mixture.)
      if (degree === 5 && isMinorQuality) {
          // ivm6 / ivmmaj7 — Melodic-minor specialty
          if (chordType === 'm6' || chordType === 'mmaj7') return 'iv (Melodic Minor)';
          return 'iv (parallel minor)';
      }
      if (degree === 8 && (isMajQuality)) return 'bVI (parallel minor)';
      // bVII can be analyzed either as Mixolydian VII (rock/blues view)
      // or as parallel minor's bVII (华语流行 / Neo-Soul view). Berklee
      // Contemporary Harmony defaults to "parallel minor" when the song
      // sits in a lyrical context — the same source supplies iv / bVI
      // / bIII as a coherent mixture set. Mixolydian-only labeling is
      // reserved for cases where bVII is the SOLE non-diatonic
      // borrowing (rock anthem idiom); we don't currently context-
      // discriminate, so use the more general "parallel minor" label.
      if (degree === 10 && (isMajQuality || isDomQuality)) return 'bVII (parallel minor)';
      if (degree === 3 && isMajQuality) return 'bIII (parallel minor)';
      if (degree === 2 && (chordType === 'm7b5' || chordType === 'm9b5')) return 'iiø (parallel minor)';
      if (degree === 0 && isMinorQuality) return 'i (parallel minor)';
      if (degree === 7 && isMinorQuality) return 'v (parallel minor)';
      if (degree === 1 && isMajQuality) return 'bII (Phrygian)';
      return null;
  } else {
      // MINOR key — borrowed from parallel major / Dorian / Phrygian.
      if (degree === 5 && isMajQuality) return 'IV (Dorian)';
      if (degree === 1 && isMajQuality) return 'bII (Phrygian)';
      if (degree === 9 && isMajQuality) return 'VI (Dorian)';
      if (degree === 0 && isMajQuality) return 'I (Picardy)';
      // V dom7 in minor is the standard harmonic-minor dominant — not
      // flagged unless a more specific context signals true mixture.
      return null;
  }
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
  if (chordType === '7'
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

/**
 * Audit: what fraction of a melody's pcs fit the chord's recommended
 * scale. Returns { scale, inScale, outOfScale, conformance }.
 *
 *   conformance = 1.0  完全在 scale 内
 *   conformance = 0.8  允许少量 chromatic / blue notes
 *   conformance < 0.5  跑调
 */
export interface ChordScaleAudit {
  scale: string;
  inScale: number;
  outOfScale: number;
  conformance: number;  // 0..1
}

export function auditChordScaleConformance(
  melodyPcs: Set<number> | number[],
  chordRootPc: number,
  keyTonicPc: number,
  keyMode: string,
  chordType?: string,
): ChordScaleAudit {
  const scale = chordScaleFor(chordRootPc, keyTonicPc, keyMode, chordType);
  const scalePcs = scalePcsForMode(chordRootPc, scale);
  const pcs = Array.isArray(melodyPcs)
    ? new Set(melodyPcs.map(p => ((p % 12) + 12) % 12))
    : melodyPcs;
  let inScale = 0, outOfScale = 0;
  for (const pc of pcs) {
    if (scalePcs.has(pc)) inScale++;
    else outOfScale++;
  }
  const total = inScale + outOfScale;
  return {
    scale,
    inScale,
    outOfScale,
    conformance: total > 0 ? inScale / total : 1,
  };
}

// ------------------------------------------------------------------
// Harmonic Perception Audit — 闭环审计:把每 bar sounding pcs
// (bass + comping + 结构位旋律)合起来反推 detectChord,跟 declared
// chord 对照,看耳朵实际听到的跟我们声明的一致吗。
//
// 这是 chord-detect 的最高价值用例 — 不是"用户输入解析",而是
// "engine self-mirror"。每首歌都能自动 surface:
//   - 旋律意外加了 9/13 → 'extension-added' (健康的 divisi)
//   - 旋律加了 chromatic 色彩 → 'extension-added' 或 'mismatch'
//   - 旋律踩 avoid note 在强拍 → 'mismatch' / 'no-match'
//   - voicing 没传达 declared chord type → 'extension-removed'
//   - bass 让 chord 听感变了根音 → 'polychord' / 'inversion-shift'
// ------------------------------------------------------------------

/** 最小型的 chord 描述(给 audit 用,避免循环依赖 musicEngine) */
export interface AuditChordLike {
  rootMidi: number;
  bassMidi: number;
  type: string;
  duration: number;
  notes: string[];  // MIDI note strings (e.g. ['C4','E4','G4'])
}

/** 最小型的 event 描述 */
export interface AuditEventLike {
  time: number;
  duration: number;
  noteNumber: number;
  part: 'melody' | 'chord' | 'bass';
}

export type PerceptionDrift =
  | 'exact'             // declared == perceived (chord-type + root)
  | 'extension-added'   // perceived 是 declared 的真超集(旋律加了色彩)
  | 'extension-removed' // perceived 是 declared 的真子集(declared 的色彩没真听到)
  | 'inversion-shift'   // 同 type 同 root,但听感变了 bass
  | 'polychord'         // perceived root 跟 declared root 不一致(产生新 chord)
  | 'mismatch'          // 既非超集也非子集,完全不一致
  | 'no-match';         // detectChord 没找到任何匹配(chord-type 字典里没此 chroma)

export interface BarPerception {
  barIdx: number;
  declared: { type: string; rootPc: number; bassPc: number };
  perceived: ChordDetection | null;
  drift: PerceptionDrift;
  soundingPcs: number[];  // 反向审计时合并的 pcs(展开 Set 给 JSON)
}

export interface HarmonicPerceptionAudit {
  byBar: BarPerception[];
  summary: {
    total: number;
    exactCount: number;
    extensionAddedCount: number;
    extensionRemovedCount: number;
    inversionShiftCount: number;
    polychordCount: number;
    mismatchCount: number;
    noMatchCount: number;
    /** exact + extension-added 算 "健康"(因为 divisi 加色彩属意图)。 */
    healthyPct: number;
  };
}

// 提取 note string 的 pc(e.g. 'C4' → 0, 'F#5' → 6)。
// 我们其他地方有 noteToMidi 但其参数解析格式有自己 quirks。这里独立
// 实现以避免 audit 误用。
function noteStringToPc(noteStr: string): number {
  const m = /^([A-Ga-g])([#b♯♭]?)(\d+)$/.exec(noteStr.trim());
  if (!m) return 0;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] ?? 0;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : (m[2] === 'b' || m[2] === '♭' ? -1 : 0);
  return (((base + acc) % 12) + 12) % 12;
}

function intervalSetMod12(chordType: string): Set<number> {
  const ivs = CHORD_TYPES[chordType] ?? [0, 4, 7];
  return new Set(ivs.map(iv => (((iv % 12) + 12) % 12)));
}

function classifyDrift(
  declaredType: string,
  declaredRootPc: number,
  declaredBassPc: number,
  perceived: ChordDetection | null,
): PerceptionDrift {
  if (!perceived) return 'no-match';

  if (perceived.tonicPc === declaredRootPc) {
    if (perceived.name === declaredType) return 'exact';
    // 同 root,不同 chord type — 看 interval set 关系
    const decIvs = intervalSetMod12(declaredType);
    const perIvs = intervalSetMod12(perceived.name);
    let decSubsetOfPer = true; for (const i of decIvs) if (!perIvs.has(i)) { decSubsetOfPer = false; break; }
    let perSubsetOfDec = true; for (const i of perIvs) if (!decIvs.has(i)) { perSubsetOfDec = false; break; }
    if (decSubsetOfPer && !perSubsetOfDec) return 'extension-added';
    if (perSubsetOfDec && !decSubsetOfPer) return 'extension-removed';
    return 'mismatch';
  }
  // 不同 root — 区分真转位 vs polychord:
  //   真转位:declared bass 在 perceived chord 的 interval 集合内
  //          (e.g. Cmaj7/E — bass=E 是 Cmaj7 的 3rd)
  //   polychord:declared bass 在 perceived chord 之外
  //          (e.g. Cmaj7/F — bass=F 不在 Cmaj7 里 → polychord)
  const perIvs = intervalSetMod12(perceived.name);
  const bassRelToPerTonic = (((declaredBassPc - perceived.tonicPc) % 12) + 12) % 12;
  if (perIvs.has(bassRelToPerTonic)) return 'inversion-shift';
  return 'polychord';
}

function declaredPerceptionFallback(
  declaredType: string,
  declaredRootPc: number,
  soundingPcs: Set<number>,
): PerceptionDrift | null {
  const declared = intervalSetMod12(declaredType);
  const allowed = expandedPerceptionIntervals(declaredType);
  const rels = new Set(Array.from(soundingPcs).map(pc => (((pc - declaredRootPc) % 12) + 12) % 12));
  if (rels.size === 0) return null;
  for (const rel of rels) {
    if (!allowed.has(rel)) return null;
  }
  if (!hasDeclaredIdentity(declaredType, rels)) return null;

  let allDeclared = true;
  for (const rel of rels) {
    if (!declared.has(rel)) {
      allDeclared = false;
      break;
    }
  }
  return allDeclared ? 'extension-removed' : 'extension-added';
}

function expandedPerceptionIntervals(chordType: string): Set<number> {
  const base = intervalSetMod12(chordType);
  const type = chordType.toLowerCase();
  const allowed = new Set(base);
  const add = (...ivs: number[]) => ivs.forEach(iv => allowed.add((((iv % 12) + 12) % 12)));
  if (/alt|7|9|11|13|sus/.test(type)) {
    add(0, 4, 7, 10, 1, 2, 3, 5, 6, 8, 9);
  } else if (/^m|min/.test(type)) {
    add(0, 3, 7, 10, 2, 5, 9);
  } else if (/maj|^6|add/.test(type)) {
    add(0, 4, 7, 11, 2, 6, 9);
  }
  return allowed;
}

function hasDeclaredIdentity(chordType: string, rels: Set<number>): boolean {
  const type = chordType.toLowerCase();
  if (/sus/.test(type)) return rels.has(5) && rels.has(10);
  if (/alt|7|9|11|13/.test(type)) return rels.has(4) && rels.has(10);
  if (/^m|min/.test(type)) return rels.has(3) && (rels.has(0) || rels.has(7) || rels.has(10));
  return rels.has(4) && (rels.has(0) || rels.has(7) || rels.has(11));
}

export function auditHarmonicPerception(
  chords: AuditChordLike[],
  events: AuditEventLike[],
  meterContext: MeterContext,
): HarmonicPerceptionAudit {
  const byBar: BarPerception[] = [];
  const strongs = meterContext.strongBeats;
  let tStart = 0;
  for (let bi = 0; bi < chords.length; bi++) {
    const c = chords[bi];
    const barDur = c.duration;
    const declaredRootPc = (((c.rootMidi % 12) + 12) % 12);
    const declaredBassPc = (((c.bassMidi % 12) + 12) % 12);

    // 集合所有这个 bar 在响的 pcs
    const sounding = new Set<number>();
    sounding.add(declaredBassPc);
    for (const n of c.notes) sounding.add(noteStringToPc(n));

    // 旋律 — 加结构位(强拍或长音 ≥ 1 beat)
    const melHere = events.filter(
      e => e.part === 'melody' && e.time >= tStart && e.time < tStart + barDur,
    );
    for (const m of melHere) {
      const local = m.time - tStart;
      const beatInBar = (((local % meterContext.beatsPerMeasure) + meterContext.beatsPerMeasure) % meterContext.beatsPerMeasure);
      const isStrong = strongs.some(sb => Math.abs(beatInBar - sb) < 0.05);
      const isLong = m.duration >= 1.0;
      if (isStrong || isLong) {
        sounding.add((((m.noteNumber % 12) + 12) % 12));
      }
    }

    const detections = detectChord(sounding, {
      bassPc: declaredBassPc,
      assumePerfectFifth: true,
    });
    const top = detections[0] ?? null;
    const drift = top
      ? classifyDrift(c.type, declaredRootPc, declaredBassPc, top)
      : declaredPerceptionFallback(c.type, declaredRootPc, sounding) ?? classifyDrift(c.type, declaredRootPc, declaredBassPc, top);

    byBar.push({
      barIdx: bi,
      declared: { type: c.type, rootPc: declaredRootPc, bassPc: declaredBassPc },
      perceived: top,
      drift,
      soundingPcs: Array.from(sounding).sort((a, b) => a - b),
    });
    tStart += barDur;
  }

  const total = byBar.length;
  const cnt = (d: PerceptionDrift) => byBar.filter(b => b.drift === d).length;
  const exactCount = cnt('exact');
  const extensionAddedCount = cnt('extension-added');
  const extensionRemovedCount = cnt('extension-removed');
  const inversionShiftCount = cnt('inversion-shift');
  const polychordCount = cnt('polychord');
  const mismatchCount = cnt('mismatch');
  const noMatchCount = cnt('no-match');
  const healthy = exactCount + extensionAddedCount;
  return {
    byBar,
    summary: {
      total,
      exactCount,
      extensionAddedCount,
      extensionRemovedCount,
      inversionShiftCount,
      polychordCount,
      mismatchCount,
      noMatchCount,
      healthyPct: total === 0 ? 0 : healthy / total,
    },
  };
}

// ------------------------------------------------------------------
// detectChord — given a set of sounding pitch classes, reverse-derive
// which chord type(s) match. Used as a self-audit oracle: pipe the
// combined comping + melody pcs through this, compare against the
// declared chord — drift between the two reveals emergent harmonic
// behavior (intentional polychord, modal interchange, unintended
// extensions).
//
// Algorithm borrowed from tonal `@tonaljs/chord-detect` (MIT,
// bitmask + 12 rotations). Adapted to our Set<number> + CHORD_TYPES.
// 12-bit chroma string convention: chroma[i] = '1' if pc i present.
// MSB-first ordering compatible with tonal — bit 0 of the int form
// corresponds to chroma[11] (pc B / M7).
//
// `assumePerfectFifth` (default true) accepts rootless voicings:
// jazz left-hand frequently drops the 5, so {3, 6, 10, 14} should
// still detect as Dom7-family by implying the 5. Only kicks in for
// candidates that have 3 + 5 + 7 in the dictionary entry.
// ------------------------------------------------------------------

export interface ChordDetection {
  /** Canonical CHORD_TYPES key (`'maj7'` / `'m7b5'` / etc.). */
  name: string;
  /** Pitch class 0..11 of the detected chord root. */
  tonicPc: number;
  /** True when caller-supplied bassPc differs from the detected tonic. */
  isInversion: boolean;
  /** 1.0 root-position, 0.5 inversion. Caller sorts by this. */
  weight: number;
}

function pcsToChroma(pcs: Set<number>): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += pcs.has(i) ? '1' : '0';
  return s;
}

function rotateChroma(chroma: string, by: number): string {
  const n = ((by % 12) + 12) % 12;
  return chroma.slice(n) + chroma.slice(0, n);
}

// Bitmask convention: chroma is parsed left-to-right as MSB-first int.
// chroma[7] (pc 7 = P5) → bit 4 (value 16).
// chroma[3] | chroma[4] (pc 3, pc 4 = thirds) → bits 8 | 7 (value 384).
// chroma[6] | chroma[8] (pc 6, pc 8 = b5, #5) → bits 5 | 3 (value 40).
// chroma[10] | chroma[11] (pc 10, pc 11 = sevenths) → bits 1 | 0 (value 3).
const _BIT_THIRDS = 384;
const _BIT_P5 = 16;
const _BIT_NON_P5 = 40;
const _BIT_SEVENTHS = 3;

function chromaHas(chroma: string, bitmask: number): boolean {
  return (parseInt(chroma, 2) & bitmask) !== 0;
}

function chromaWithP5(chroma: string): string {
  if (chromaHas(chroma, _BIT_NON_P5)) return chroma;
  const n = parseInt(chroma, 2) | _BIT_P5;
  return n.toString(2).padStart(12, '0');
}

function chordTypeIsCompleteTriad7(name: string): boolean {
  const ivs = CHORD_TYPES[name];
  if (!ivs) return false;
  const chroma = pcsToChroma(new Set(ivs.map(iv => ((iv % 12) + 12) % 12)));
  return chromaHas(chroma, _BIT_THIRDS)
      && chromaHas(chroma, _BIT_P5)
      && chromaHas(chroma, _BIT_SEVENTHS);
}

// Reverse lookup: chroma_string → [canonical chord type names].
// Module-load constant. Multiple types can share a chroma (e.g. inversions
// of dim7 all share the same pcs); all matching names are returned.
let _CHORD_CHROMA_INDEX: Record<string, string[]> | null = null;
function getChordChromaIndex(): Record<string, string[]> {
  if (_CHORD_CHROMA_INDEX) return _CHORD_CHROMA_INDEX;
  const idx: Record<string, string[]> = {};
  for (const [name, ivs] of Object.entries(CHORD_TYPES)) {
    const pcs = new Set(ivs.map(iv => ((iv % 12) + 12) % 12));
    const chroma = pcsToChroma(pcs);
    (idx[chroma] = idx[chroma] || []).push(name);
  }
  _CHORD_CHROMA_INDEX = idx;
  return idx;
}

export function detectChord(
  pcs: Set<number> | number[],
  options: { bassPc?: number; assumePerfectFifth?: boolean } = {},
): ChordDetection[] {
  const inputArr = Array.isArray(pcs) ? pcs : Array.from(pcs);
  const inputPcs = new Set(inputArr.map(p => ((p % 12) + 12) % 12));
  if (inputPcs.size === 0) return [];

  const baseChroma = pcsToChroma(inputPcs);
  const assumeP5 = options.assumePerfectFifth ?? true;
  const bassPc = options.bassPc !== undefined
    ? ((options.bassPc % 12) + 12) % 12
    : undefined;

  const index = getChordChromaIndex();
  const results: ChordDetection[] = [];
  const seen = new Set<string>();  // dedupe (name|tonicPc)

  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    if (!inputPcs.has(tonicPc)) continue;
    const rotated = rotateChroma(baseChroma, tonicPc);

    const exactMatches = index[rotated] ?? [];
    for (const name of exactMatches) {
      const key = `${name}|${tonicPc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isInversion = bassPc !== undefined && bassPc !== tonicPc;
      results.push({ name, tonicPc, isInversion, weight: isInversion ? 0.5 : 1.0 });
    }

    if (assumeP5) {
      const withP5 = chromaWithP5(rotated);
      if (withP5 !== rotated) {
        const extraMatches = (index[withP5] ?? []).filter(chordTypeIsCompleteTriad7);
        for (const name of extraMatches) {
          const key = `${name}|${tonicPc}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const isInversion = bassPc !== undefined && bassPc !== tonicPc;
          // Slight weight penalty since 5 was implied not heard
          results.push({ name, tonicPc, isInversion, weight: isInversion ? 0.45 : 0.9 });
        }
      }
    }
  }

  results.sort((a, b) => b.weight - a.weight);
  return results;
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

  // IV vocab additions — needed to round-trip the My.voc scale names
  // without info loss. Used by improvisor/PitchClassSets's mapIvScaleName.
  'Chromatic':             [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'Augmented':             [0, 3, 4, 7, 8, 11],          // 1 b3 3 5 #5 7 — symmetric
  'In-Sen':                [0, 1, 5, 7, 10],             // Japanese pentatonic: 1 b2 4 5 b7
  'Double Harmonic Major': [0, 1, 4, 5, 7, 8, 11],       // 1 b2 3 4 5 b6 7 — Byzantine
  'Mixolydian Pentatonic': [0, 4, 5, 7, 10],             // 1 3 4 5 b7 — dom blues stripped
  'Lydian Pentatonic':     [0, 4, 6, 9, 11],             // 1 3 #4 6 7 — Lydian skeleton
  'Locrian Pentatonic':    [0, 3, 5, 6, 10],             // 1 b3 4 b5 b7 — m7b5 essence
  'Minor Six Pentatonic':  [0, 3, 5, 7, 9],              // 1 b3 4 5 6 — minor with M6
};

// ------------------------------------------------------------------
// Krumhansl-Kessler probe-tone profile (1982).
//
// 实验数据来源:Krumhansl & Kessler (1982), "Tracing the Dynamic
// Changes in Perceived Tonal Organization in a Spatial Representation
// of Musical Keys", Psychological Review 89(4), 334-368.
//
// 用真人 probe-tone 实验测得 12 个 pc 在大调 / 小调下的"稳定度感受
// 强度"。raw values 2.23-6.35 是被试评分均值。这是认知音乐心理学
// 这块最被广泛引用的客观数据,替代手调 tensionAmount 数值。
//
// 注:K-K 是 key-relative 稳定度(被试听完调性 cadence 后判断 probe
// 音的契合度)。本项目 INTERVAL_AESTHETICS 主要在 key-relative 上下
// 文使用(TensionTracker.addTension 接收 pcFromKey);chord-relative
// 调用点(isTension 检查)被 globalPcs 合约前置 guard,K-K 的语义偏
// 移不会失效。MAJOR / MINOR 两个 profile 都接入,TensionTracker 按
// 构造时传入的 modeFamily(modeProgressionTemplate 派生)分发。
// INTERVAL_AESTHETICS.tensionAmount 字段保持 K-K MAJOR 派生(模块
// 加载时常量),其 function / expectedResolutions 是 mode-agnostic
// 语义标签 — TensionTracker 在 minor 上下文里只覆盖 tension 数值,
// 不动 function 字段。
// ------------------------------------------------------------------

const KK_STABILITY_MAJOR: readonly number[] = [
  // C    Db    D     Eb    E     F     Gb    G     Ab    A     Bb    B
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

// K-K 1982 minor probe-tone profile。注意 b3 (Eb, pc=3) 5.38 — 在小调
// 里是骨干(i 和弦的 3rd),major profile 里仅 2.33。同样 b6 (pc=8) 在
// minor 是稳定色彩 3.98(major 仅 2.39),b7 (pc=10) 3.34 是自然小调的
// 下中音(major 2.29 是迫切张力)。这些反转就是 minor 案例(jazz_minor_D
// / pop_minor_A 等)需要独立 profile 的根因。
const KK_STABILITY_MINOR: readonly number[] = [
  // C    Db    D     Eb    E     F     Gb    G     Ab    A     Bb    B
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// 归一化:tension = 1 - (stability - min) / (max - min). 最稳 (root)
// → 0, 最不稳 (b2) → 1. 模块加载时一次性算好,运行时不重复计算。
const KK_TENSION_MAJOR: readonly number[] = (() => {
  const minS = Math.min(...KK_STABILITY_MAJOR);
  const maxS = Math.max(...KK_STABILITY_MAJOR);
  const range = maxS - minS;
  return KK_STABILITY_MAJOR.map(s => 1 - (s - minS) / range);
})();

const KK_TENSION_MINOR: readonly number[] = (() => {
  const minS = Math.min(...KK_STABILITY_MINOR);
  const maxS = Math.max(...KK_STABILITY_MINOR);
  const range = maxS - minS;
  return KK_STABILITY_MINOR.map(s => 1 - (s - minS) / range);
})();

export function kkTensionMajor(pc: number): number {
  return KK_TENSION_MAJOR[((pc % 12) + 12) % 12];
}

export function kkTensionMinor(pc: number): number {
  return KK_TENSION_MINOR[((pc % 12) + 12) % 12];
}

// ------------------------------------------------------------------
// Interval aesthetics — tension and expected resolution per pitch class
// (relative to the key root). Drives TensionTracker and per-note
// stability decisions during melody generation.
//
// tensionAmount 数值现派生自 K-K 1982 major probe-tone profile(见
// 上方 KK_STABILITY_MAJOR)。每条 K-K 派生值在注释中标 "(K-K: x.xxx)"
// 作为可追溯锚点。原手调值的相对排序(b2 > 7 > b6 > 4 > b7 > 6 > ...)
// 跟 K-K 主要趋势一致,具体数值由实验数据校准。
// expectedResolutions / function / degreeName 字段保持原值(K-K
// 不涉及这些)。
// ------------------------------------------------------------------

type IntervalFunction = 'Home' | 'Anchor' | 'Color' | 'Active' | 'Leading' | 'Tension';

interface IntervalRule {
   semitones: number;
   degreeName: string;
   function: IntervalFunction;
   tensionAmount: number;          // 0.0 to 1.0 (urgency to resolve)
   expectedResolutions: number[];  // semitone offsets relative to key root
   description: string;
}

// Major-mode key-relative interval aesthetics. tensionAmount sourced
// from K-K 1982 probe-tone profile (KK_TENSION_MAJOR); function /
// expectedResolutions / degreeName encode the functional-harmony
// role and the canonical resolution targets for melody scoring.
const INTERVAL_AESTHETICS_MAJOR: Record<number, IntervalRule> = {
    0:  { semitones: 0,  degreeName: '1',     function: 'Home',    tensionAmount: kkTensionMajor(0),  expectedResolutions: [],       description: '主音，绝对稳定，旅途的终起点与归宿。(K-K: 0.000)' },
    1:  { semitones: 1,  degreeName: 'b2',    function: 'Tension', tensionAmount: kkTensionMajor(1),  expectedResolutions: [0],      description: '极度不协和（小二度），具有极其强烈的向下解决至1的倾向。(K-K: 1.000)' },
    2:  { semitones: 2,  degreeName: '2',     function: 'Active',  tensionAmount: kkTensionMajor(2),  expectedResolutions: [0, 4],   description: '流动的经过音，通常平缓解决至1或被带向3。(K-K: 0.697)' },
    3:  { semitones: 3,  degreeName: 'b3',    function: 'Color',   tensionAmount: kkTensionMajor(3),  expectedResolutions: [2, 0],   description: '小调色彩基干或大调中的Blues音，带有忧郁色彩。(K-K: 0.976)' },
    4:  { semitones: 4,  degreeName: '3',     function: 'Home',    tensionAmount: kkTensionMajor(4),  expectedResolutions: [],       description: '大调色彩音，相对稳定，旅途中的"中转站"（未完全结束）。(K-K: 0.478)' },
    5:  { semitones: 5,  degreeName: '4',     function: 'Active',  tensionAmount: kkTensionMajor(5),  expectedResolutions: [4, 0],   description: '强烈的游离感，倾向解决到3（半音下行）或回归1，具体由当前和弦字面音决定。(K-K: 0.549)' },
    6:  { semitones: 6,  degreeName: '#4/b5', function: 'Tension', tensionAmount: kkTensionMajor(6),  expectedResolutions: [7, 5],   description: '三全音，极度游离，Lydian或Blues张力，通常作为经过音解决到5或4。(K-K: 0.930)' },
    7:  { semitones: 7,  degreeName: '5',     function: 'Anchor',  tensionAmount: kkTensionMajor(7),  expectedResolutions: [0],      description: '属音，仅次于主音的强支持点，"山中露营"，旅途未结，最终需回归1。(K-K: 0.282)' },
    8:  { semitones: 8,  degreeName: 'b6',    function: 'Active',  tensionAmount: kkTensionMajor(8),  expectedResolutions: [7],      description: '暗色主导倾向，强烈的半音下行解决至5音。(K-K: 0.961)' },
    9:  { semitones: 9,  degreeName: '6',     function: 'Active',  tensionAmount: kkTensionMajor(9),  expectedResolutions: [7, 4],   description: '明亮且自由的挂留音（五声音阶常用），常作为阶梯解决到5或3。(K-K: 0.653)' },
    10: { semitones: 10, degreeName: 'b7',    function: 'Active',  tensionAmount: kkTensionMajor(10), expectedResolutions: [9, 4, 0],description: '属七和弦色彩音，倾向下行解决至下一个和弦的3音（稳定音）。(K-K: 0.985)' },
    11: { semitones: 11, degreeName: '7',     function: 'Leading', tensionAmount: kkTensionMajor(11), expectedResolutions: [0],      description: '导音，极度迫切需半音上行解决至1。可有延迟解决（中间穿插经过音），但一个进行周期内必须"归宗"。(K-K: 0.842)' }
};

// Minor-mode (Aeolian-based) key-relative interval aesthetics.
// tensionAmount sourced from K-K 1982 minor probe-tone profile
// (KK_TENSION_MINOR — Krumhansl & Kessler 1982, "Tracing the dynamic
// changes in perceived tonal organization in a spatial representation
// of musical keys"). Function / expectedResolutions reflect minor-mode
// idiom (b3/b6/b7 are native chord-scale, harmonic-minor leading tone
// at pc 11 still functions as V→i leading).
//
// Key differences from major profile:
//   pc 3 (b3):  was Color/0.976 → now Home/low (minor's i-chord 3rd)
//   pc 4 (nat3): was Home/0.478 → now Tension/high (mMaj intrusion)
//   pc 8 (b6):  was Active/0.961 → now Color/low (Aeolian native b6)
//   pc 10 (b7): was Active/0.985 → now Active/low (Aeolian native b7)
//
// Source: Krumhansl & Kessler 1982 (probe-tone) + Berklee functional-
// harmony minor-mode chord-scale (Mark Levine 1995).
const INTERVAL_AESTHETICS_MINOR: Record<number, IntervalRule> = {
    0:  { semitones: 0,  degreeName: '1',     function: 'Home',    tensionAmount: kkTensionMinor(0),  expectedResolutions: [],       description: '主音，绝对稳定，小调的根基。(K-K minor: 0.000)' },
    1:  { semitones: 1,  degreeName: 'b2',    function: 'Tension', tensionAmount: kkTensionMinor(1),  expectedResolutions: [0],      description: 'Phrygian 色彩 b2，紧迫向 1 解决。(K-K minor: 0.968)' },
    2:  { semitones: 2,  degreeName: '2',     function: 'Active',  tensionAmount: kkTensionMinor(2),  expectedResolutions: [0, 3],   description: '小调上行温和经过，向 b3 或 1。(K-K minor: 0.746)' },
    3:  { semitones: 3,  degreeName: 'b3',    function: 'Home',    tensionAmount: kkTensionMinor(3),  expectedResolutions: [],       description: '小调骨架，i 和弦的 3 音，稳定。(K-K minor: 0.251)' },
    4:  { semitones: 4,  degreeName: '3',     function: 'Tension', tensionAmount: kkTensionMinor(4),  expectedResolutions: [3],      description: '大三度入侵，破坏 minor 质感（mMaj7 / picardy），强解决回 b3。(K-K minor: 0.989)' },
    5:  { semitones: 5,  degreeName: '4',     function: 'Active',  tensionAmount: kkTensionMinor(5),  expectedResolutions: [3, 0],   description: 'iv 和弦根，向 b3 或 1。(K-K minor: 0.749)' },
    6:  { semitones: 6,  degreeName: '#4/b5', function: 'Tension', tensionAmount: kkTensionMinor(6),  expectedResolutions: [7],      description: '三全音，向 5 解决。(K-K minor: 1.000)' },
    7:  { semitones: 7,  degreeName: '5',     function: 'Anchor',  tensionAmount: kkTensionMinor(7),  expectedResolutions: [0],      description: '属音，最终回归 1。(K-K minor: 0.418)' },
    8:  { semitones: 8,  degreeName: 'b6',    function: 'Color',   tensionAmount: kkTensionMinor(8),  expectedResolutions: [7],      description: 'Aeolian native b6，色彩稳定，弱引力向 5。(K-K minor: 0.621)' },
    9:  { semitones: 9,  degreeName: '6',     function: 'Active',  tensionAmount: kkTensionMinor(9),  expectedResolutions: [7],      description: 'Melodic minor 上行 6，破坏 Aeolian 倾向 G 大调感，向 5 收。(K-K minor: 0.962)' },
    10: { semitones: 10, degreeName: 'b7',    function: 'Color',   tensionAmount: kkTensionMinor(10), expectedResolutions: [0],      description: 'Aeolian native b7，色彩稳定，弱引力向 1。(K-K minor: 0.791)' },
    11: { semitones: 11, degreeName: '7',     function: 'Leading', tensionAmount: kkTensionMinor(11), expectedResolutions: [0],      description: 'Harmonic minor 导音（V→i），向 1 解决。(K-K minor: 0.835)' }
};

// Mode-aware dispatch. Major-family modes (Ionian / Lydian /
// Mixolydian) read the major profile; minor-family modes (Aeolian /
// Dorian / Phrygian / Locrian / harmonic / melodic minor) read the
// minor profile. The evaluator's globalMode parameter selects.
//
// Backwards-compat export: INTERVAL_AESTHETICS without mode index
// returns the major profile (historical default). New consumers
// should pass globalMode to selectIntervalAesthetics() instead.
export const INTERVAL_AESTHETICS: Record<number, IntervalRule> = INTERVAL_AESTHETICS_MAJOR;

export function selectIntervalAesthetics(globalMode: 'major' | 'minor'): Record<number, IntervalRule> {
    return globalMode === 'minor' ? INTERVAL_AESTHETICS_MINOR : INTERVAL_AESTHETICS_MAJOR;
}

/**
 * Mode-name → key family for the Layer B profile lookup. Major-family
 * modes (Ionian / Lydian / Mixolydian) read INTERVAL_AESTHETICS_MAJOR;
 * minor-family modes (Aeolian / Dorian / Phrygian / Locrian / harmonic
 * / melodic minor / Minor Blues) read the minor profile.
 */
export function modeToKeyFamily(mode: string): 'major' | 'minor' {
    const MINOR_MODES = new Set([
        'Minor', 'Aeolian', 'Dorian', 'Phrygian', 'Locrian',
        'Harmonic Minor', 'Melodic Minor', 'Minor Blues',
        'Phrygian Dominant', 'Half-Whole Diminished',
    ]);
    return MINOR_MODES.has(mode) ? 'minor' : 'major';
}

// ------------------------------------------------------------------
// Lerdahl Tonal Pitch Space attraction formula (2001).
//
// 数据来源:Lerdahl, F. (2001). Tonal Pitch Space. Oxford UP. Ch. 4.
//
// α(p1 → p2) = (s(p2) / s(p1)) × (1 / n²)
//   s = anchoring strength (basic-space level)
//   n = 半音距离 (1-6, 用最短 mod-12 距离)
//
// scale-intrinsic anchoring(scale 内部的稳定度层级):
//   tonic       → 5  (octave level)
//   fifth       → 4  (fifth level)
//   third       → 3  (triadic level, scale 内的 3rd above root)
//   diatonic    → 2  (其他 scale tone)
//   chromatic   → 1  (scale 外)
//
// 跟 K-K 不同:K-K 是 perceived stability (实验数据);Lerdahl 是
// derived stability (按 basic space 层级理论推导)。两者协同 —
// K-K 校准 INTERVAL_AESTHETICS 张力值,Lerdahl 推导 SCALE_GRAVITY
// 引力目标。
// ------------------------------------------------------------------

function lerdahlScaleStrength(pc: number, scaleRoot: number, scaleName: string): number {
  const scaleIntervals = SCALE_TYPES[scaleName];
  if (!scaleIntervals) return 1;
  const ivFromRoot = ((pc - scaleRoot) % 12 + 12) % 12;
  if (!scaleIntervals.includes(ivFromRoot)) return 1; // chromatic
  if (ivFromRoot === 0) return 5;                      // tonic
  if (ivFromRoot === 7) return 4;                      // fifth
  // 3rd-of-scale — 优先 major-3 (4),fallback minor-3 (3),否则取 scale 里第一个 3-4 半音的音
  if (scaleIntervals.includes(4)) {
    if (ivFromRoot === 4) return 3;
  } else if (scaleIntervals.includes(3)) {
    if (ivFromRoot === 3) return 3;
  }
  return 2; // diatonic (other scale tone)
}

/**
 * Compute SCALE_GRAVITY rules for a scale entirely from Lerdahl
 * attraction. For each scale tone fromIv, find the candidate toIv
 * within ±2 semitones (in scale, MORE stable than fromIv) with
 * highest α. Returns rules with score = round(α × 10) — keeps
 * compatibility with engine's 0-30 score range (threshold 18 for
 * scale-gravity-line hard filter, /25 normalization for soft score).
 *
 * Only scale tones get rules (chromatic pcs are not in the scale's
 * "physics", matching original SCALE_GRAVITY semantics).
 *
 * Type heuristic:
 *   - resolve_up   if toIv > fromIv (mod 12 short-distance up)
 *   - resolve_down if toIv < fromIv
 *   - hang         when no clear pull (α < 0.5)
 */
export function computeLerdahlScaleGravity(scaleName: string): ScaleGravityRule[] {
  const scaleIntervals = SCALE_TYPES[scaleName];
  if (!scaleIntervals) return [];
  const rules: ScaleGravityRule[] = [];
  for (const fromIv of scaleIntervals) {
    if (fromIv === 0) continue; // tonic has no pull target
    // Candidate targets: scale tones within ±2 semitones, MORE stable than from
    let bestToIv = -1;
    let bestAlpha = 0;
    const sFrom = lerdahlScaleStrength(fromIv, 0, scaleName);
    for (const toIv of scaleIntervals) {
      if (toIv === fromIv) continue;
      // mod-12 shortest distance
      const rawDist = ((toIv - fromIv) % 12 + 12) % 12;
      const n = Math.min(rawDist, 12 - rawDist);
      if (n > 2) continue; // ±2 半音内才算 "gravity pull"
      const sTo = lerdahlScaleStrength(toIv, 0, scaleName);
      if (sTo <= sFrom) continue; // 只解决到更稳定的音
      const alpha = (sTo / sFrom) * (1 / (n * n));
      if (alpha > bestAlpha) {
        bestAlpha = alpha;
        bestToIv = toIv;
      }
    }
    if (bestToIv < 0) continue;
    // up vs down direction (mod-12 shortest)
    const upDist = ((bestToIv - fromIv) % 12 + 12) % 12;
    const downDist = 12 - upDist;
    const isUp = upDist <= downDist;
    const score = Math.round(bestAlpha * 10);
    const type: ScaleGravityRule['type'] =
      bestAlpha < 0.5 ? 'hang' : (isUp ? 'resolve_up' : 'resolve_down');
    rules.push({ fromInterval: fromIv, toInterval: bestToIv, score, type });
  }
  return rules;
}

// ------------------------------------------------------------------
// SCALE_GRAVITY — universal physics of half-step / whole-step
// resolution embedded in each scale (mode). Indexed by scale name;
// each rule says "when the melody emits a note at fromInterval (from
// the scale's tonic), the listener feels gravity toward toInterval".
//
// Style is NOT in this table — physics is style-independent. Per
// user direction:
// "无论流行还是爵士,只要用自然小调,b6→5的引力不可避免。
//  Style 只决定引擎对引力的服从度 (gravityStrictness)。"
//
// Score: relative magnitude (0-30); used for soft scoring weight.
//   - Lerdahl-derived entries: round(α × 10), α from
//     computeLerdahlScaleGravity (Lerdahl 2001 TPS ch.4)
//   - Manual override entries: hand-tuned for idioms Lerdahl's pure
//     in-scale 1/n² model doesn't capture (Blues b5, Phrygian b2,
//     modal sub-leading b7→1, secondary-dominant family scales)
//
// Type:
//   resolve_down — half/whole step downward (b6→5, 4→3)
//   resolve_up   — half/whole step upward (7→1, #4→5)
//   hang         — characteristic hang tone (Dorian's natural 6 等)
//
// Intervals are SEMITONES from the scale's tonic (0-11).
// ------------------------------------------------------------------

export interface ScaleGravityRule {
  fromInterval: number;
  toInterval: number;
  score: number;
  type: 'resolve_down' | 'resolve_up' | 'hang';
}

export const SCALE_GRAVITY: Record<string, ScaleGravityRule[]> = {
    // ---- Major Family — Lerdahl-derived (computeLerdahlScaleGravity at module init) ----
    // 自动派生自 Lerdahl 2001 TPS ch.4 attraction formula α = (s_to/s_from)×(1/n²)。
    // 跟原手调表对比:
    //   Ionian   4→3=15 (exact)、7→1=22→25 (+3)、2→1=6 (exact)、6→5=4→5 (+1)
    //   Lydian   #4→5=18→20、7→1=22→25、2→3 manual → 2→1 Lerdahl (主流向 1 而非 3)
    //   Mixol.   4→3=15 (exact)、新增 9→7(6→5)+ 11→0(7→1);
    //            原 10→9 / 10→7 (b7→6/5) 被 Lerdahl 排除 (b7/6 等稳, 无 pull)。
    'Ionian':     computeLerdahlScaleGravity('Ionian'),
    'Mixolydian': computeLerdahlScaleGravity('Mixolydian'),
    'Lydian':     computeLerdahlScaleGravity('Lydian'),
    // ---- Minor Family ----
    'Aeolian': [
        { fromInterval: 8,  toInterval: 7,  score: 25, type: 'resolve_down' }, // b6→5 minor sigh (strongest)
        { fromInterval: 10, toInterval: 0,  score: 18, type: 'resolve_up' },   // b7→1 modal leading sub
        { fromInterval: 2,  toInterval: 3,  score: 10, type: 'resolve_up' },   // 2→b3 dark up
        { fromInterval: 5,  toInterval: 3,  score: 12, type: 'resolve_down' }, // 4→b3 minor sub-down (raised)
    ],
    'Dorian': [
        { fromInterval: 9,  toInterval: 7,  score: 5,  type: 'hang' },          // ♮6 hangs (NOT pulled down strongly)
        { fromInterval: 9,  toInterval: 10, score: 6,  type: 'resolve_up' },    // 6→b7 cool
        { fromInterval: 2,  toInterval: 3,  score: 9,  type: 'resolve_up' },    // 2→b3
        { fromInterval: 5,  toInterval: 3,  score: 6,  type: 'resolve_down' },  // 4→b3
        { fromInterval: 10, toInterval: 0,  score: 10, type: 'resolve_up' },    // b7→1
    ],
    'Phrygian': [
        { fromInterval: 1,  toInterval: 0,  score: 22, type: 'resolve_down' }, // b2→1 dark Phrygian
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b6→5
    ],
    'Locrian': [
        { fromInterval: 1,  toInterval: 0,  score: 18, type: 'resolve_down' }, // b2→1
        { fromInterval: 6,  toInterval: 7,  score: 5,  type: 'resolve_up' },   // b5→? weak
    ],
    'Harmonic Minor': [
        { fromInterval: 11, toInterval: 0,  score: 25, type: 'resolve_up' },   // 7→1 raised leading
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b6→5 sigh kept
        { fromInterval: 2,  toInterval: 3,  score: 10, type: 'resolve_up' },   // 2→b3
    ],
    'Melodic Minor': [
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1 leading
        { fromInterval: 9,  toInterval: 11, score: 8,  type: 'resolve_up' },   // 6→7 (smooth ascent)
        { fromInterval: 2,  toInterval: 3,  score: 9,  type: 'resolve_up' },   // 2→b3
    ],
    // ---- Dominant family extensions for V/X borrowing ----
    'Phrygian Dominant': [
        { fromInterval: 1,  toInterval: 0,  score: 25, type: 'resolve_down' }, // b9→1 dark sub-tonic
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1 strong leading
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b13→5
        { fromInterval: 5,  toInterval: 4,  score: 12, type: 'resolve_down' }, // 4→3
    ],
    'Lydian Dominant': [
        { fromInterval: 6,  toInterval: 7,  score: 16, type: 'resolve_up' },   // #4→5
        { fromInterval: 10, toInterval: 9,  score: 10, type: 'resolve_down' }, // b7→6
    ],
    'Altered': [
        // Altered scale's gravity is mostly CROSS-CHORD (resolves into
        // next chord's tones). Within-scale tendencies are weaker;
        // engine should use cross-chord pcA/pcB closest-pair logic
        // for proper Altered resolution. Placeholder rules:
        { fromInterval: 1,  toInterval: 0,  score: 18, type: 'resolve_down' }, // b9→1
        { fromInterval: 8,  toInterval: 7,  score: 15, type: 'resolve_down' }, // b13→5
    ],
    'Bebop Dominant': [
        { fromInterval: 11, toInterval: 0,  score: 16, type: 'resolve_up' },   // natural 7 → 1 (added passing)
        { fromInterval: 10, toInterval: 9,  score: 10, type: 'resolve_down' }, // b7→6
        { fromInterval: 5,  toInterval: 4,  score: 14, type: 'resolve_down' }, // 4→3
    ],
    'Bebop Major': [
        { fromInterval: 5,  toInterval: 4,  score: 15, type: 'resolve_down' }, // 4→3
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1
        { fromInterval: 8,  toInterval: 7,  score: 12, type: 'resolve_down' }, // added b6→5
    ],
};

// Look up scale gravity for a given scale name, returning rules
// keyed by fromInterval for fast pendingResolve dispatch.
export function getScaleGravity(scaleName: string): Map<number, ScaleGravityRule> {
  const out = new Map<number, ScaleGravityRule>();
  const rules = SCALE_GRAVITY[scaleName];
  if (!rules) return out;
  // If multiple rules share fromInterval, prefer highest score.
  for (const rule of rules) {
    const existing = out.get(rule.fromInterval);
    if (!existing || rule.score > existing.score) {
      out.set(rule.fromInterval, rule);
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Chord voicing aesthetics — per-chord-type, what role each interval
// plays (chord tone / available tension / avoid).
// ------------------------------------------------------------------

export type NoteFunctionRole = 'CHORD_TONE' | 'AVAILABLE_TENSION' | 'AVOID_NOTE' | 'ALTERED_TENSION';

/**
 * Vertical register preference for placement in a voicing.
 *   'low'  — guide tones (3 / b7 / maj7) — bottom of voicing
 *   'mid'  — structural 5 / shell tones — middle
 *   'high' — color tensions (9 / 11 / 13 / b9 / #9 / b13 / #11) — top
 *   'flex' — root / avoid (placement is style-driven or shouldn't appear)
 *
 * Used by voicing assembly's octave placer to decide which pc goes
 * which octave under the bass→voicing→top progression.
 */
export type RegisterHint = 'low' | 'mid' | 'high' | 'flex';

interface ChordIntervalAesthetic {
    interval: number; // 0-11
    role: NoteFunctionRole;
    tensionLevel: number; // 0.0 (Consonant/Stable) to 1.0 (Highly dissonant/Avoid)
    /** Where this interval naturally sits in a 3-4 voice voicing. */
    preferredRegister: RegisterHint;
    /** True when this interval is acceptable as a bass note (root / inversions).
     *  Used by Bass Planner to map progression's bassRole field to actual pc. */
    isBassEligible: boolean;
    description: string;
}

// G1: per-interval extended with preferredRegister + isBassEligible.
// Consumer roadmap:
//   - clash resolver (G2): role + tensionLevel
//   - voicing octave placer (G3): preferredRegister
//   - bass planner (G5): isBassEligible
const CHORD_VOICING_AESTHETICS: Record<string, Record<number, ChordIntervalAesthetic>> = {
    // === MAJOR FAMILY (maj, maj7, add9, 6, 6/9, sus2) ===
    'maj': {
        0:  { interval: 0,  role: 'CHORD_TONE',        tensionLevel: 0.0,  preferredRegister: 'flex', isBassEligible: true,  description: 'Root (1). Ultimate stability.' },
        1:  { interval: 1,  role: 'AVOID_NOTE',        tensionLevel: 1.0,  preferredRegister: 'flex', isBassEligible: false, description: 'Minor 2nd (b9). Extreme harsh clash with root.' },
        2:  { interval: 2,  role: 'AVAILABLE_TENSION', tensionLevel: 0.3,  preferredRegister: 'high', isBassEligible: false, description: 'Major 2nd (9). Warm, colorful extension.' },
        3:  { interval: 3,  role: 'AVOID_NOTE',        tensionLevel: 0.9,  preferredRegister: 'flex', isBassEligible: false, description: 'Minor 3rd (#9). Clashes with major 3rd.' },
        4:  { interval: 4,  role: 'CHORD_TONE',        tensionLevel: 0.1,  preferredRegister: 'low',  isBassEligible: true,  description: 'Major 3rd (3). Defines major quality. Stable.' },
        5:  { interval: 5,  role: 'AVOID_NOTE',        tensionLevel: 0.85, preferredRegister: 'flex', isBassEligible: false, description: 'Perfect 4th (11). Classic avoid note, clashes with 3rd.' },
        6:  { interval: 6,  role: 'AVAILABLE_TENSION', tensionLevel: 0.6,  preferredRegister: 'high', isBassEligible: false, description: 'Aug 4th (#11). Bright Lydian color. Dreamy.' },
        7:  { interval: 7,  role: 'CHORD_TONE',        tensionLevel: 0.05, preferredRegister: 'mid',  isBassEligible: true,  description: 'Perfect 5th (5). Solid harmonic support.' },
        8:  { interval: 8,  role: 'AVOID_NOTE',        tensionLevel: 0.85, preferredRegister: 'flex', isBassEligible: false, description: 'Minor 6th (b13). Clashes with 5th.' },
        9:  { interval: 9,  role: 'AVAILABLE_TENSION', tensionLevel: 0.4,  preferredRegister: 'high', isBassEligible: false, description: 'Major 6th (13). Sweet major 6th color.' },
        10: { interval: 10, role: 'AVOID_NOTE',        tensionLevel: 0.75, preferredRegister: 'flex', isBassEligible: false, description: 'Minor 7th (b7). Turns chord into dominant, muddying major function.' },
        11: { interval: 11, role: 'CHORD_TONE',        tensionLevel: 0.2,  preferredRegister: 'low',  isBassEligible: true,  description: 'Major 7th (7). Beautiful romantic tension within major.' },
    },
    // === MINOR FAMILY (min, m7, m9, m11, m13, mMaj7) ===
    'min': {
        0:  { interval: 0,  role: 'CHORD_TONE',        tensionLevel: 0.0,  preferredRegister: 'flex', isBassEligible: true,  description: 'Root (1). Stable base.' },
        1:  { interval: 1,  role: 'AVOID_NOTE',        tensionLevel: 0.9,  preferredRegister: 'flex', isBassEligible: false, description: 'Minor 2nd (b9). Phrygian color, usually avoided due to severe clash.' },
        2:  { interval: 2,  role: 'AVAILABLE_TENSION', tensionLevel: 0.35, preferredRegister: 'high', isBassEligible: false, description: 'Major 2nd (9). Rich minor 9th color.' },
        3:  { interval: 3,  role: 'CHORD_TONE',        tensionLevel: 0.1,  preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 3rd (b3). Defines minor quality. Stable.' },
        4:  { interval: 4,  role: 'AVOID_NOTE',        tensionLevel: 0.95, preferredRegister: 'flex', isBassEligible: false, description: 'Major 3rd (3). Destroys minor quality.' },
        5:  { interval: 5,  role: 'AVAILABLE_TENSION', tensionLevel: 0.4,  preferredRegister: 'high', isBassEligible: false, description: 'Perfect 4th (11). Great minor extension, no clash with m3.' },
        6:  { interval: 6,  role: 'AVOID_NOTE',        tensionLevel: 0.8,  preferredRegister: 'flex', isBassEligible: false, description: 'Dim 5th (b5). Blues note, but clashes with natural 5.' },
        7:  { interval: 7,  role: 'CHORD_TONE',        tensionLevel: 0.05, preferredRegister: 'mid',  isBassEligible: true,  description: 'Perfect 5th (5). Solid support.' },
        8:  { interval: 8,  role: 'AVOID_NOTE',        tensionLevel: 0.75, preferredRegister: 'flex', isBassEligible: false, description: 'Minor 6th (b13). Aeolian tension, highly dissonant against 5th.' },
        9:  { interval: 9,  role: 'AVAILABLE_TENSION', tensionLevel: 0.5,  preferredRegister: 'high', isBassEligible: false, description: 'Major 6th (13). Dorian brightness, classic jazz minor color.' },
        10: { interval: 10, role: 'CHORD_TONE',        tensionLevel: 0.2,  preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 7th (b7). Standard structural tone.' },
        11: { interval: 11, role: 'AVAILABLE_TENSION', tensionLevel: 0.65, preferredRegister: 'low',  isBassEligible: false, description: 'Major 7th (7). Melodic minor mystery / spy chord color.' },
    },
    // === DOMINANT FAMILY (7, 9, 13, 7b9, 7#9, 7b13, 7#11, 7alt, etc.) ===
    // Key 'dom7' is the internal family label, not a chord type.
    'dom7': {
        0:  { interval: 0,  role: 'CHORD_TONE',        tensionLevel: 0.0,  preferredRegister: 'flex', isBassEligible: true,  description: 'Root (1). Stable base.' },
        1:  { interval: 1,  role: 'ALTERED_TENSION',   tensionLevel: 0.8,  preferredRegister: 'high', isBassEligible: false, description: 'Minor 2nd (b9). Dark, dramatic tension pulling to passing chord.' },
        2:  { interval: 2,  role: 'AVAILABLE_TENSION', tensionLevel: 0.4,  preferredRegister: 'high', isBassEligible: false, description: 'Major 2nd (9). Bright, standard dominant extension.' },
        3:  { interval: 3,  role: 'ALTERED_TENSION',   tensionLevel: 0.85, preferredRegister: 'high', isBassEligible: false, description: 'Minor 3rd (#9). Bluesy, aggressive dominant tension.' },
        4:  { interval: 4,  role: 'CHORD_TONE',        tensionLevel: 0.1,  preferredRegister: 'low',  isBassEligible: true,  description: 'Major 3rd (3). Provides dominant drive.' },
        5:  { interval: 5,  role: 'AVOID_NOTE',        tensionLevel: 0.95, preferredRegister: 'flex', isBassEligible: false, description: 'Perfect 4th (11). Clashes fatally with 3rd. Avoid.' },
        6:  { interval: 6,  role: 'ALTERED_TENSION',   tensionLevel: 0.75, preferredRegister: 'high', isBassEligible: false, description: 'Aug 4th (#11). Lydian Dominant / Altered color.' },
        7:  { interval: 7,  role: 'CHORD_TONE',        tensionLevel: 0.1,  preferredRegister: 'mid',  isBassEligible: true,  description: 'Perfect 5th (5). Can be omitted, stable.' },
        8:  { interval: 8,  role: 'ALTERED_TENSION',   tensionLevel: 0.8,  preferredRegister: 'high', isBassEligible: false, description: 'Minor 6th (b13). Altered dominant drive, rich tension.' },
        9:  { interval: 9,  role: 'AVAILABLE_TENSION', tensionLevel: 0.5,  preferredRegister: 'high', isBassEligible: false, description: 'Major 6th (13). Cheerful, standard Mixolydian extension.' },
        10: { interval: 10, role: 'CHORD_TONE',        tensionLevel: 0.15, preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 7th (b7). Crucial dominant motor.' },
        11: { interval: 11, role: 'AVOID_NOTE',        tensionLevel: 1.0,  preferredRegister: 'flex', isBassEligible: false, description: 'Major 7th (7). Fatally destroys dominant function.' },
    },
    // === HALF-DIMINISHED FAMILY (m7b5, m9b5, dim, dim7) ===
    'm7b5': {
        0:  { interval: 0,  role: 'CHORD_TONE',        tensionLevel: 0.0, preferredRegister: 'flex', isBassEligible: true,  description: 'Root (1).' },
        1:  { interval: 1,  role: 'AVAILABLE_TENSION', tensionLevel: 0.7, preferredRegister: 'high', isBassEligible: false, description: 'Minor 2nd (b9). Usable in Locrian.' },
        2:  { interval: 2,  role: 'AVAILABLE_TENSION', tensionLevel: 0.6, preferredRegister: 'high', isBassEligible: false, description: 'Major 2nd (9). Locrian Natural 2 color.' },
        3:  { interval: 3,  role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 3rd (b3).' },
        4:  { interval: 4,  role: 'AVOID_NOTE',        tensionLevel: 1.0, preferredRegister: 'flex', isBassEligible: false, description: 'Major 3rd (3). Clashes.' },
        5:  { interval: 5,  role: 'AVAILABLE_TENSION', tensionLevel: 0.5, preferredRegister: 'high', isBassEligible: false, description: 'Perfect 4th (11). Classic extension for m7b5.' },
        6:  { interval: 6,  role: 'CHORD_TONE',        tensionLevel: 0.3, preferredRegister: 'mid',  isBassEligible: true,  description: 'Dim 5th (b5). Defining structural tone.' },
        7:  { interval: 7,  role: 'AVOID_NOTE',        tensionLevel: 0.9, preferredRegister: 'flex', isBassEligible: false, description: 'Perfect 5th (5). Clashes with b5.' },
        8:  { interval: 8,  role: 'AVAILABLE_TENSION', tensionLevel: 0.6, preferredRegister: 'high', isBassEligible: false, description: 'Minor 6th (b13). Standard Locrian color.' },
        9:  { interval: 9,  role: 'AVOID_NOTE',        tensionLevel: 0.8, preferredRegister: 'flex', isBassEligible: false, description: 'Major 6th (13). Clashes.' },
        10: { interval: 10, role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 7th (b7).' },
        11: { interval: 11, role: 'AVOID_NOTE',        tensionLevel: 1.0, preferredRegister: 'flex', isBassEligible: false, description: 'Major 7th (7). Clashes.' },
    },
    // === SUS FAMILY (sus2, sus4, 7sus4, 9sus4) — no 3rd, 4 (or 2) replaces it ===
    // Routes 4 / 11 to CHORD_TONE (sus chord literal) and the nat3 (4)
    // to AVOID_NOTE (adding 3 breaks the sus character). For 7sus4 /
    // 9sus4 the b7 / 9 are chord literal too.
    'sus': {
        0:  { interval: 0,  role: 'CHORD_TONE',        tensionLevel: 0.0, preferredRegister: 'flex', isBassEligible: true,  description: 'Root (1). Stable base.' },
        1:  { interval: 1,  role: 'ALTERED_TENSION',   tensionLevel: 0.7, preferredRegister: 'high', isBassEligible: false, description: 'Minor 2nd (b9). Tense color over sus.' },
        2:  { interval: 2,  role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'mid',  isBassEligible: true,  description: 'Major 2nd (9 / sus2). Chord literal for sus2 / 9sus4.' },
        3:  { interval: 3,  role: 'ALTERED_TENSION',   tensionLevel: 0.7, preferredRegister: 'high', isBassEligible: false, description: 'Minor 3rd (b3 / #9). Tense — sus rejects defined 3rd.' },
        4:  { interval: 4,  role: 'AVOID_NOTE',        tensionLevel: 0.95,preferredRegister: 'flex', isBassEligible: false, description: 'Major 3rd (3). Destroys the suspension by defining it major.' },
        5:  { interval: 5,  role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'mid',  isBassEligible: true,  description: 'Perfect 4th (4 / 11 / sus4). Chord literal — the suspension.' },
        6:  { interval: 6,  role: 'AVAILABLE_TENSION', tensionLevel: 0.6, preferredRegister: 'high', isBassEligible: false, description: 'Aug 4th (#11). Lydian color over sus.' },
        7:  { interval: 7,  role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'mid',  isBassEligible: true,  description: 'Perfect 5th (5). Stable.' },
        8:  { interval: 8,  role: 'ALTERED_TENSION',   tensionLevel: 0.7, preferredRegister: 'high', isBassEligible: false, description: 'Minor 6th (b13). Altered color.' },
        9:  { interval: 9,  role: 'AVAILABLE_TENSION', tensionLevel: 0.4, preferredRegister: 'high', isBassEligible: false, description: 'Major 6th (6 / 13). Bright color.' },
        10: { interval: 10, role: 'CHORD_TONE',        tensionLevel: 0.1, preferredRegister: 'low',  isBassEligible: true,  description: 'Minor 7th (b7). Chord literal for 7sus4 / 9sus4.' },
        11: { interval: 11, role: 'AVOID_NOTE',        tensionLevel: 0.9, preferredRegister: 'flex', isBassEligible: false, description: 'Major 7th (7). Clashes with b7 in 7sus4 / 9sus4.' },
    },
};

export function getChordVoicingAesthetics(chordType: string) {
    // sus family first — '7sus4' / '9sus4' both contain '7'/'9' so the
    // dom route would otherwise win and mark interval 5 (the sus 4th)
    // as AVOID, which is wrong: in a sus chord the 4th is chord literal.
    if (chordType.includes('sus')) return CHORD_VOICING_AESTHETICS['sus'];
    if (chordType.includes('maj') || chordType === 'add9' || chordType === 'aug') return CHORD_VOICING_AESTHETICS['maj'];
    // Half-diminished family — m7b5 / m9b5 / m11b5 / dim / dim7. The
    // earlier substring guard missed m9b5 (doesn't contain 'm7b5'),
    // routing it to 'min' where interval 6 is AVOID — but b5 IS the
    // chord literal of half-diminished. Match any minor+b5 spelling
    // before the generic minor route.
    if (chordType.includes('m7b5') || chordType.includes('m9b5')
        || chordType.includes('m11b5') || chordType.includes('dim')
        || (chordType.startsWith('m') && chordType.includes('b5')))
        return CHORD_VOICING_AESTHETICS['m7b5'];
    if (chordType.includes('m') || chordType === 'min') return CHORD_VOICING_AESTHETICS['min'];
    // Dom-family detection — '7' / '9' substring catches '7' / '9' /
    // 'm7' (already handled above) / '7b9' / '7#9' / '7alt' / '7b13' /
    // '9sus4' (handled above as sus) etc. But '11' / '13' (and bare
    // '6' / '6/9' which are dom-extension territory in jazz but maj
    // family in pop — handled by maj route already) DON'T contain '7'
    // or '9' as a substring. Those are also dom-family by interval
    // structure (root + 3 + b7 + extension), so dispatch them to
    // dom7. Without explicit catch, '13'.includes('7')=false routes
    // to the maj fallback where interval 10 (b7) is AVOID_NOTE; the
    // density-cap dropPriority then ejects b7 first, destroying dom
    // identity (audited: G13 emitted as D-G-A-B-E with no F = b7).
    if (chordType === '11' || chordType === '13'
        || chordType.includes('7') || chordType.includes('9'))
        return CHORD_VOICING_AESTHETICS['dom7'];
    if (chordType === '6' || chordType === '6/9') return CHORD_VOICING_AESTHETICS['maj'];
    if (chordType === '5') return CHORD_VOICING_AESTHETICS['maj'];
    if (chordType === 'quartal') return CHORD_VOICING_AESTHETICS['min'];
    return CHORD_VOICING_AESTHETICS['maj']; // generic fallback
}

// ------------------------------------------------------------------
// Unified harmonic assessment — the engine's only authoritative
// "is this note consonant in context, and where should it go" query.
//
// Why this exists: prior to this primitive, six independent call
// sites each consulted a different table (INTERVAL_AESTHETICS for
// key-relative function, CHORD_VOICING_AESTHETICS for chord-family
// role, isAvoidNote for chord-type avoid table, computeGlobalContract
// for chord-literal pcs, getResolutionTargets for key-tendency
// targets, plus the pendingResolve ghost state machine). They
// produced contradictory verdicts — e.g. G7's F was simultaneously
// flagged as CHORD_TONE (role) AND high tensionAmount (key) AND
// Leading-tone of D function. No fusion logic existed, so each call
// site invented its own ad-hoc combination.
//
// Design principle (user's first principle): "consonance depends on
// the harmonic environment." Chord-context judgement is authoritative;
// key-context provides resolution-target backstop only.
//
// Inputs are flat numbers (no ChordDef dependency) so this primitive
// can live in the theory module without circular imports.
// ------------------------------------------------------------------

export interface NoteHarmonicAssessment {
  /** chord-context consonance verdict — the authoritative read. */
  consonance: 'consonant' | 'colortone' | 'tension' | 'avoid';
  /**
   * Resolution urgency in [0, 1]. TSD-weighted:
   *   - D function tensions: high urgency (V7's b7 / leading-tone)
   *   - T function tensions: moderate (sets up the next phrase)
   *   - S function tensions: low — sus / 11 may hang waiting for D
   */
  urgency: number;
  /**
   * Absolute pcs (mod 12) where this note "wants to go." Priority
   * blend: same-chord literal anchor tones > next-chord anchor tones
   * (root / 3 / 5) > key-relative INTERVAL_AESTHETICS targets. The
   * note's own pc is excluded so the consumer can't trivially "resolve"
   * by staying.
   */
  resolutionTargets: number[];
  /** Note pc ∈ current chord's literal interval set (root/3/5/7/etc). */
  isInChordContract: boolean;
  /** Note pc ∈ admissible color extensions (9/11/13 per chord family). */
  isInChordExtension: boolean;
  /** Note pc ∈ next chord's 1/3/5 — anticipatory-resolution candidate. */
  isInNextChordAnchor: boolean;
}

/**
 * Detects dom-family chord types (root + 4-or-3 + 7 + …). Used to
 * decide whether the chord's 7-interval is a tension-bearing tendency
 * tone (dom b7 makes the tritone with 3) or a structural color
 * (m7's b7 is stable, maj7's 7 is mostly stable but slightly tense).
 */
function isDomFamilyChord(chordType: string, intervals: readonly number[]): boolean {
  if (chordType.startsWith('maj')) return false;
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) return false;
  // dom: has b7 (10) AND major 3rd (4). sus chords also count for our
  // purpose — they carry the same b7 → tritone-pending feel.
  return intervals.includes(10) && (intervals.includes(4) || intervals.includes(5));
}

// ------------------------------------------------------------------
// Tendency table — chord-scenario × interval-from-chord-root.
//
// What: authoritative melody-side tension data. 6 scenarios capture
// the chord's base quality combined with its TSD function in the key
// (M7T = maj-base at Tonic, M7S = maj-base at Subdominant, m7T / m7S
// for min, 7D for any dom, SUS for sus chords). Each scenario's
// 12-entry row encodes per-pcFromChordRoot:
//   - state: CT (chord tone, fully consonant) / T (tension, may hang
//            or resolve) / A (avoid, must resolve)
//   - gravity: 0..1 resolution urgency (0 = none, 1 = imperative)
//   - targets: pcs-from-chord-root the note WANTS to resolve onto
//
// Why two M7 entries (M7T vs M7S) and two m7 entries (m7T vs m7S):
// because functional position changes the legality of the same
// chord-relative interval. The clearest cases:
//   - #11 (pc 6) on Cmaj7 (M7T) = T 0.5 (deliberate Lydian color)
//                  on Fmaj7 (M7S) = T 0.2 (Lydian is IV's birthright)
//   - 11 (pc 5)  on Cmaj7 (M7T) = A 0.95 (textbook fatal avoid)
//                  on Fmaj7 (M7S) = A 0.7 (IV tolerates more)
//   - M6 / 13 (pc 9) on Am7 (m7T) = A 0.8 (kills Aeolian = G major leak)
//                       on Dm7 (m7S) = T 0.4 (Dorian's signature tone)
//   - b6 / b13 (pc 8) on Am7 (m7T) = CT 0.2 (Aeolian b6 = legal scale tone)
//                       on Dm7 (m7S) = A 0.7 (kills Dorian)
//   - 11 (pc 5)  on Am7 (m7T) = A 0.8 (Aeolian 11 is heavy)
//                  on Dm7 (m7S) = T 0.3 (Dorian 11 = modern m11 chord)
//
// Without this T/S split the engine treats Am7 and Dm7 as "the same
// m7" and misses the Dorian-vs-Aeolian distinction that ii and vi
// have always carried in functional harmony.
//
// Extensions (9 / 11 / 13 / 6 / add) do NOT change scenario —
// Cmaj9, C6, Cadd9, Cmaj13 are all M7T (maj-base at T). Likewise
// for the minor and dom families. SUS is the only "type swaps
// scenario" case because sus chords reject the 3rd that defines
// maj / min quality.
//
// Source: derived from user's explicit chord-scenario tendency table
// (Levine 1995 / Berklee functional-harmony curriculum) plus a SUS
// row derived from sus-chord theory (4 / 11 = chord tone, 3 = avoid).
// ------------------------------------------------------------------

export type ChordScenario = 'M7T' | 'M7S' | 'm7S' | 'm7T' | '7D' | 'SUS';
export type TendencyState = 'CT' | 'T' | 'A';

export interface TendencyEntry {
  state: TendencyState;
  gravity: number;       // 0..1 — resolution urgency
  targets: readonly number[];  // pcs FROM CHORD ROOT (mod 12)
  note?: string;
}

export const TENDENCY_TABLE: Record<ChordScenario, readonly TendencyEntry[]> = {
  // M7T — Maj base at Tonic (Cmaj7 / Cmaj / Cmaj9 / Cadd9 / C6 / C6/9 in I)
  M7T: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 4] },
    /*  3 #9  */ { state: 'A',  gravity: 0.9,  targets: [4, 2],  note: 'm9 clash with M3' },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  5 11  */ { state: 'A',  gravity: 0.95, targets: [4],     note: 'textbook fatal avoid (vs M3)' },
    /*  6 #11 */ { state: 'T',  gravity: 0.5,  targets: [7, 4],  note: 'deliberate Lydian color' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.9,  targets: [7],     note: 'm9 clash with 5' },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 11] },
    /* 10 b7  */ { state: 'A',  gravity: 0.9,  targets: [11],    note: 'destroys maj7 → reads as dom7' },
    /* 11 7   */ { state: 'CT', gravity: 0.0,  targets: [] },
  ],
  // M7S — Maj base at Subdominant (Fmaj7 / F / Fmaj9 / F6 in IV; bVII7 borrowed maj)
  M7S: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0] },
    /*  2 9   */ { state: 'T',  gravity: 0.1,  targets: [0, 4],  note: 'freer under Lydian' },
    /*  3 #9  */ { state: 'A',  gravity: 0.9,  targets: [4, 2] },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  5 11  */ { state: 'A',  gravity: 0.7,  targets: [4],     note: 'IV tolerates 11 better than I' },
    /*  6 #11 */ { state: 'T',  gravity: 0.2,  targets: [7, 4],  note: 'Lydian signature — IV birthright' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.9,  targets: [7] },
    /*  9 13  */ { state: 'T',  gravity: 0.2,  targets: [7, 11] },
    /* 10 b7  */ { state: 'A',  gravity: 0.9,  targets: [11] },
    /* 11 7   */ { state: 'CT', gravity: 0.0,  targets: [] },
  ],
  // m7S — Min base at Subdominant (Dm7 / Dm / Dm9 / Dm11 in ii; Dorian birthright)
  m7S: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 0.95, targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 3] },
    /*  3 #9  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'enharmonic with m3 chord tone' },
    /*  4 3   */ { state: 'A',  gravity: 0.95, targets: [3],     note: 'destroys minor quality' },
    /*  5 11  */ { state: 'T',  gravity: 0.3,  targets: [3, 7],  note: 'Dorian 11 — modern m11 birthright' },
    /*  6 #11 */ { state: 'A',  gravity: 0.8,  targets: [7],     note: 'breaks Dorian (= m7b5 leak)' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.7,  targets: [7],     note: 'kills Dorian' },
    /*  9 13  */ { state: 'T',  gravity: 0.4,  targets: [7, 10], note: 'Dorian signature M6' },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [] },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10],    note: 'makes mMaj7 — destroys Dorian' },
  ],
  // m7T — Min base at Tonic (Am7 / Am / Am9 in vi / i; Aeolian)
  m7T: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0] },
    /*  2 9   */ { state: 'T',  gravity: 0.3,  targets: [0, 3],  note: 'Aeolian 9 — slightly conservative' },
    /*  3 #9  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'enharmonic with m3 chord tone' },
    /*  4 3   */ { state: 'A',  gravity: 0.95, targets: [3],     note: 'destroys minor quality' },
    /*  5 11  */ { state: 'A',  gravity: 0.8,  targets: [3],     note: 'Aeolian 11 is heavy / chord-busting' },
    /*  6 #11 */ { state: 'A',  gravity: 0.8,  targets: [7] },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'CT', gravity: 0.2,  targets: [7],     note: 'Aeolian b6 — legal scale tone (sus-ish)' },
    /*  9 13  */ { state: 'A',  gravity: 0.8,  targets: [7],     note: 'M6 kills Aeolian (→ Dorian leak)' },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [] },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10],    note: 'mMaj7 — destroys Aeolian' },
  ],
  // 7D — Dom base at Dominant (G7 in V; V/X secondary dom; subV/X tritone sub).
  // Altered tensions (b9 / #9 / #11 / b13) are TENSION not AVOID — melodic
  // minor 5th mode (= altered scale) makes them legit dom7 vocabulary.
  '7D': [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'T',  gravity: 0.7,  targets: [0, 4],  note: 'altered tension — V7b9 standard' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 4] },
    /*  3 #9  */ { state: 'T',  gravity: 0.75, targets: [4],     note: 'Hendrix blues tension' },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'leading-tone — strong V→I draw' },
    /*  5 11  */ { state: 'A',  gravity: 0.9,  targets: [4],     note: 'sus only — clashes with M3' },
    /*  6 #11 */ { state: 'T',  gravity: 0.55, targets: [7, 4],  note: 'Lydian dominant signature' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'T',  gravity: 0.65, targets: [7, 10], note: 'V7b13 / altered #5' },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 10] },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'tritone partner with 3' },
    /* 11 7   */ { state: 'A',  gravity: 0.95, targets: [10, 0], note: 'destroys dom function (m2 with b7)' },
  ],
  // SUS — Suspended (sus2 / sus4 / 7sus4 / 9sus). No 3rd → 4 (11) AND 2 (9)
  // are chord tones; the M3 is the avoid (it cancels the suspension). 7sus4's
  // b7 is CT (it's chord literal), not a dom tendency tone — the suspension
  // softens the tritone. Position-independent: sus character outweighs TSD
  // function for melody choice.
  SUS: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 0.95, targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'sus2 chord tone' },
    /*  3 #9  */ { state: 'T',  gravity: 0.5,  targets: [2, 5] },
    /*  4 3   */ { state: 'A',  gravity: 0.8,  targets: [5, 2],  note: 'M3 cancels the suspension' },
    /*  5 11  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'sus4 chord tone — the soul of sus' },
    /*  6 #11 */ { state: 'T',  gravity: 0.4,  targets: [7, 5] },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'T',  gravity: 0.5,  targets: [7] },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 0] },
    /* 10 b7  */ { state: 'CT', gravity: 0.1,  targets: [],      note: '7sus4 chord literal — softens tritone' },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10, 0] },
  ],
};

/**
 * Map a chord type string to its base quality family — determines
 * which scenario family (maj / min / dom / sus) the chord belongs to.
 * Extensions (9 / 11 / 13 / 6 / add) DO NOT change the family.
 *
 * Returns null for chord types this resolver doesn't classify
 * (dim / aug / m7b5 / etc.) — caller should fall back to existing
 * chord-family logic in those cases.
 */
export function detectChordBaseQuality(chordType: string): 'maj' | 'min' | 'dom' | 'sus' | null {
  if (!chordType) return 'maj';
  // Sus family — explicit sus tokens AND bare '11' (IV vocab spells '11'
  // as sus11; CHORD_TYPES['11'] = [0,5,7,10,14] matches).
  if (chordType.includes('sus') || chordType === '11') return 'sus';
  if (chordType.startsWith('maj')) return 'maj';
  if (chordType === '6' || chordType === '6/9' || chordType === 'add9'
      || chordType === '' || chordType === 'add2') return 'maj';
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) {
    // m / m7 / m9 / m11 / m13 / m6 — but NOT m7b5 / mMaj7
    if (chordType === 'm7b5' || chordType === 'm9b5' || chordType.startsWith('mMaj')) return null;
    return 'min';
  }
  // Dom family: bare numeric chord type ('7', '9', '13'), altered
  // ('7alt', '7b9', '7#9', '7b13', '7#11'), '7#5', '7b5'.
  if (/^(7|9|13)/.test(chordType) || chordType === '7alt'
      || /^7[#b]/.test(chordType)) return 'dom';
  // dim / aug / quartal / etc. — not classified
  return null;
}

/**
 * Resolve a chord's tendency-table scenario given its base quality and
 * effective TSD function in the song key. The 5-entry M7/m7/7D matrix
 * + 1-entry SUS gives 6 total scenarios; combinations not in the matrix
 * (e.g. dom at T position, maj at D) fall back to the nearest neighbor.
 *
 * Pure function — no random / chord-instance dependency beyond the
 * type string and effectiveFunc parameter.
 */
export function resolveChordScenario(
  chordType: string,
  effectiveFunc: 'T' | 'S' | 'D',
): ChordScenario | null {
  const base = detectChordBaseQuality(chordType);
  if (base === null) return null;
  if (base === 'sus') return 'SUS';
  if (base === 'dom') return '7D';  // dom always uses 7D regardless of position
  if (base === 'maj') return effectiveFunc === 'S' ? 'M7S' : 'M7T';  // D-position maj falls back to T
  if (base === 'min') return effectiveFunc === 'S' ? 'm7S' : 'm7T';
  return null;
}

/**
 * Tendency lookup for a melody pitch against the current chord context.
 * Returns null when the scenario can't be resolved (caller should fall
 * back to the chord-family CHORD_VOICING_AESTHETICS path).
 */
export function getMelodyTendency(
  melodyPc: number,
  chordRootPc: number,
  scenario: ChordScenario,
): TendencyEntry {
  const npc = (((melodyPc % 12) + 12) % 12);
  const rpc = (((chordRootPc % 12) + 12) % 12);
  const pcFromChord = (((npc - rpc) % 12) + 12) % 12;
  return TENDENCY_TABLE[scenario][pcFromChord];
}

// ------------------------------------------------------------------
// Unified melody-side chord semantics — one primitive that returns
// EVERY chord-context classification a melody-pipeline consumer needs.
//
// Why this exists: prior to this primitive there were four independent
// classification functions in this file, each with its own
// substring-matching logic that drifted apart over time:
//   - detectChordBaseQuality (maj/min/dom/sus)
//   - classifyLickPolicyFamily (LICK_DEGREE_POLICY key)
//   - resolveChordScenario (TENDENCY_TABLE key)
//   - classifyEngineChordType (ChordQuality enum)
// They occasionally disagreed — notably '11' was 'sus' to one,
// 'dom' to another, 'dominant_sus' to a third. The audit pass found
// the divergence as melody-side dissonance.
//
// Now: getMelodyChordSemantics(type, effectiveFunc) wraps them in one
// call. Future melody code should consult this primitive instead of
// the underlying functions to avoid re-introducing divergence. The
// underlying functions stay exported for callers that genuinely need
// just one slice.
// ------------------------------------------------------------------

export interface MelodyChordSemantics {
  /** Original chord type string. */
  type: string;
  /** Base quality from detectChordBaseQuality. */
  base: 'maj' | 'min' | 'dom' | 'sus' | null;
  /** TSD-aware tendency scenario for TENDENCY_TABLE lookup. null when
   *  effectiveFunc is omitted or chord doesn't map to one of the six
   *  scenarios (m7b5 / dim / dim7 / aug / quartal — caller should fall
   *  back to CHORD_VOICING_AESTHETICS). */
  scenario: ChordScenario | null;
  /** LICK_DEGREE_POLICY key for token-pool avoid filtering. */
  lickPolicyFamily: keyof typeof LICK_DEGREE_POLICY;
  /** IV vocab family ('major' / 'minor' / 'minor7' / 'dominant' /
   *  'sus4' / 'augmented' / 'diminished'). null when no vocab entry. */
  vocabFamily: string | null;
  /** Chord literal intervals from CHORD_TYPES (with [0,4,7] fallback). */
  intervals: readonly number[];
  /** Sus chord (any suspension variant or bare '11'). */
  isSus: boolean;
  /** Minor base + S function — Dorian (ii-context). */
  isMinorS: boolean;
  /** Minor base + T function — Aeolian (i / vi context). */
  isMinorT: boolean;
  /** Major-family (maj / maj7 / add9 / 6 / 6/9 / maj9 / etc.). */
  isMajFamily: boolean;
  /** Dom-family (7 / 9 / 13 / 7alt / 7b9 / etc., NOT sus dominants). */
  isDomFamily: boolean;
}

export function getMelodyChordSemantics(
  chordType: string,
  effectiveFunc?: 'T' | 'S' | 'D',
): MelodyChordSemantics {
  const base = detectChordBaseQuality(chordType);
  const scenario = effectiveFunc !== undefined
    ? resolveChordScenario(chordType, effectiveFunc)
    : null;
  const lickPolicyFamily = classifyLickPolicyFamily(chordType);
  // Inline-import the vocab def to avoid a top-level cycle through
  // improvisorVocab (which imports nothing from musicTheory but pulls
  // a heavy JSON blob). Resolve lazily; the require call is cached
  // by node and the cost is amortized.
  let vocabFamily: string | null = null;
  try {
    const mod = require('./improvisorChordVocab') as { lookupChordDef(t: string): { family: string } | null };
    vocabFamily = mod.lookupChordDef(chordType)?.family ?? null;
  } catch { /* vocab not available — fall back to null */ }

  const intervals = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const isSus = base === 'sus';
  const isMinor = base === 'min';
  return {
    type: chordType,
    base,
    scenario,
    lickPolicyFamily,
    vocabFamily,
    intervals,
    isSus,
    isMinorS: isMinor && effectiveFunc === 'S',
    isMinorT: isMinor && effectiveFunc === 'T',
    isMajFamily: base === 'maj',
    isDomFamily: base === 'dom',
  };
}

export function evaluateNoteInChordContext(
  notePc: number,
  chordType: string,
  chordRootPc: number,
  effectiveFunc: 'T' | 'S' | 'D',
  nextChordType: string | null,
  nextChordRootPc: number | null,
  keyRootPc: number,
  scaleNameForBar?: string,
  isModalContext?: boolean,
  /**
   * Bar's currently-active runScale pitch classes. When provided, the
   * evaluator becomes scale-aware:
   *   - pcs IN the scale never degrade past 'colortone' (in-scale
   *     coloration is by definition legal — Phrygian-Dominant's b9
   *     over V/X-minor is the scale's signature, not a clash).
   *   - pcs OUT of the scale upgrade at least to 'tension' (out-of-
   *     scale pitches are outside the bar's tonal context regardless
   *     of chord-relative role).
   * Omit when caller has no scale context — evaluator falls back to
   * chord-context-only judgement.
   */
  localScalePcs?: Set<number>,
  /**
   * Song-level tonal character — 'tonal' (functional-harmony,
   * tensions must resolve) or 'modal' (scale-color, tensions hang).
   * Default 'tonal' preserves existing behavior for callers that
   * don't pass this. Under 'modal':
   *   - tension urgency halved (typically drops below the unified-
   *     tension-resolution hard constraint threshold → hard resolve
   *     stops firing → blues b3/b5/b7 may hang as scale color)
   *   - in-scale 'tension' upgrades to 'colortone' (functional
   *     tendency-tones become legitimate mode color when the bar's
   *     runScale embraces them)
   */
  tonalCharacter: 'tonal' | 'modal' = 'tonal',
  /**
   * Local tonal center pc — decided at harmony layer (realizeProgression)
   * when secondary dominants / borrowed chords are filled in. The
   * evaluator does NOT re-derive borrowing; it only consumes this pc
   * as the reference frame for INTERVAL_AESTHETICS lookup (the
   * key-relative expectedResolutions backstop). When omitted, falls
   * back to keyRootPc — matches "no borrowing" behavior.
   */
  localTonalCenterPc?: number,
  /**
   * Global key mode family — 'major' or 'minor'. Selects which
   * INTERVAL_AESTHETICS profile (K-K major or K-K minor) the Layer B
   * key-relative consultation reads from. Default 'major' preserves
   * pre-existing behavior. For minor songs, passing 'minor' makes the
   * evaluator correctly identify b3 as native CT (not borrowed Color),
   * nat3 as the mMaj intrusion (high tension), b6/b7 as native Aeolian
   * colors (low gravity), etc.
   */
  globalMode: 'major' | 'minor' = 'major',
): NoteHarmonicAssessment {
  const npc = (((notePc % 12) + 12) % 12);
  const rpc = (((chordRootPc % 12) + 12) % 12);
  const kpc = (((keyRootPc % 12) + 12) % 12);
  const pcFromChord = (((npc - rpc) % 12) + 12) % 12;

  // --- Local tonal center (set at harmony layer; evaluator only consumes) ---
  // The chord-realization stage (realizeProgression) decides borrowing
  // when it fills V/X secondary dominants and subV/X tritone
  // substitutions, and tags the chord with localTonalCenterPc. The
  // evaluator just reads it. No parallel borrow-detection logic here.
  const literalIntervals = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const isDom = isDomFamilyChord(chordType, literalIntervals);
  const localKeyRootPc = localTonalCenterPc !== undefined
    ? (((localTonalCenterPc % 12) + 12) % 12)
    : kpc;
  const pcFromLocalKey = (((npc - localKeyRootPc) % 12) + 12) % 12;

  // --- chord-relative role / tensionLevel ---
  const chordTable = getChordVoicingAesthetics(chordType);
  const chordEntry = chordTable[pcFromChord];
  const role = chordEntry?.role ?? 'AVOID_NOTE';
  const chordTensionLevel = chordEntry?.tensionLevel ?? 1.0;

  // --- chord literal & extension contract ---
  const isInChordContract = literalIntervals.some(iv => (rpc + iv) % 12 === npc);
  const globalContract = computeGlobalContract(chordType, rpc);
  const isInChordExtension = globalContract.pcs.has(npc) && !isInChordContract;

  // --- next chord anchor pcs (1/3/5 from next root, chord-quality-aware) ---
  let isInNextChordAnchor = false;
  const nextAnchorPcs: number[] = [];
  if (nextChordType !== null && nextChordRootPc !== null) {
    const nrpc = (((nextChordRootPc % 12) + 12) % 12);
    const nextIvs = CHORD_TYPES[nextChordType] ?? [0, 4, 7];
    nextAnchorPcs.push(nrpc);
    if (nextIvs.includes(3)) nextAnchorPcs.push((nrpc + 3) % 12);
    if (nextIvs.includes(4)) nextAnchorPcs.push((nrpc + 4) % 12);
    if (nextIvs.includes(7)) nextAnchorPcs.push((nrpc + 7) % 12);
    isInNextChordAnchor = nextAnchorPcs.includes(npc);
  }

  // --- consonance verdict (chord-context-first) ---
  //
  // Two-tier consultation:
  //   1. TENDENCY_TABLE (preferred) — when resolveChordScenario produces
  //      a 6-scenario verdict (M7T / M7S / m7T / m7S / 7D / SUS), the
  //      table's state / gravity / targets are the AUTHORITATIVE source.
  //      This is the only path that distinguishes ii (Dm7 = m7S, Dorian)
  //      from vi (Am7 = m7T, Aeolian), I (Cmaj7 = M7T) from IV (Fmaj7 =
  //      M7S, Lydian), etc.
  //   2. CHORD_VOICING_AESTHETICS fallback — for chord types tendency
  //      can't classify (m7b5 / dim / dim7 / aug / quartal / etc.).
  let consonance: NoteHarmonicAssessment['consonance'];
  let tendencyGravity: number | null = null;
  let tendencyTargets: readonly number[] | null = null;
  const scenario = resolveChordScenario(chordType, effectiveFunc);
  if (scenario !== null) {
    const tendency = getMelodyTendency(npc, rpc, scenario);
    tendencyGravity = tendency.gravity;
    tendencyTargets = tendency.targets;
    // State → consonance. T splits by gravity: weak T (<0.5) is
    // colortone (hangable), strong T (≥0.5) is tension (must resolve).
    if (tendency.state === 'CT') {
      consonance = 'consonant';
    } else if (tendency.state === 'T') {
      consonance = tendency.gravity >= 0.5 ? 'tension' : 'colortone';
    } else { // 'A'
      consonance = 'avoid';
    }
  } else {
    // Fallback for chord types outside the 6-scenario coverage.
    if (role === 'AVOID_NOTE') {
      consonance = 'avoid';
    } else if (role === 'CHORD_TONE') {
      if (isDom && pcFromChord === 10) {
        consonance = 'tension';
      } else if (chordType.startsWith('maj') && pcFromChord === 11) {
        consonance = 'tension';
      } else {
        consonance = 'consonant';
      }
    } else if (role === 'AVAILABLE_TENSION') {
      consonance = 'colortone';
    } else { // ALTERED_TENSION
      consonance = 'tension';
    }
  }

  // --- Layer B: key-relative gravity (max-merge with Layer A) ---
  //
  // The note carries TWO independent tension stories simultaneously:
  //   Layer A = chord-context (TENDENCY_TABLE) — "what role am I in
  //             the current chord?"
  //   Layer B = key-context (INTERVAL_AESTHETICS, mode-aware) —
  //             "what role am I in the song's key?"
  //
  // The canonical case where they diverge: B on G7 in C major.
  //   Layer A (7D)[4] = CT 0.0 — chord 3rd of dom7, harmless
  //   Layer B (major)[11] = Leading 0.842 — key's 7th, must go to 1
  // Without consulting Layer B, the engine treats B as a plain chord
  // tone (melody stabs it 6× without resolving — audited as the
  // pop_gc1z2g bar 2 cluster).
  //
  // Resolution rule (Mark Levine / Berklee functional harmony):
  // take the STRONGER tension verdict.
  //   finalGravity = max(layerA.gravity, layerB.gravity)
  //   finalState   = harshest(layerA.state, layerB.state)
  //   finalTargets = union(layerA.targets, layerB.targets) at absolute pcs
  //
  // This generalizes the prior leading-tone-on-V special case to
  // every two-layer-divergence case (e.g. F-on-G7 = CT chord-tone
  // but key-relative 4 0.55 → must go to E; #11 on Cmaj7 vs C major
  // tritone 0.93 → tension overrides chord's mild T 0.5 etc.).
  const layerBProfile = selectIntervalAesthetics(globalMode);
  const layerBRule = layerBProfile[pcFromLocalKey];
  const layerBGravity = layerBRule?.tensionAmount ?? 0;
  const layerBTargetsAbs = (layerBRule?.expectedResolutions ?? [])
    .map(t => ((localKeyRootPc + t) % 12 + 12) % 12);
  // Layer A gravity = tendencyGravity (from TENDENCY_TABLE) when
  // scenario fired; else derived from chord tensionLevel (mild).
  const layerAGravity = tendencyGravity ?? (chordTensionLevel * 0.5);
  // Merge: take max. If Layer B is strictly harsher, upgrade
  // consonance accordingly and override tendencyGravity so urgency
  // computation picks it up.
  if (layerBGravity > layerAGravity) {
    tendencyGravity = layerBGravity;
    // Layer B is harsher — escalate consonance. STRICTLY one-way: a Layer
    // A 'avoid' verdict (e.g. m7T's M7 = mMaj7 dissonance) never falls
    // back to a milder Layer B reading just because the same pc is a
    // 'Color' / 'Active' rather than 'Tension' in the key profile. The
    // bug fixed here: G# on Am7-T was reading 'avoid' from m7T[11], then
    // Layer B (G# = b6 in C, function='Active' gravity 0.961) overwrote
    // it down to 'tension' — the guard then saw 'tension' and let the
    // note ring, missing the mMaj7 dissonance.
    const consonanceRank = { consonant: 0, colortone: 1, tension: 2, avoid: 3 } as const;
    if (layerBGravity >= 0.85) {
      const layerBVerdict: NoteHarmonicAssessment['consonance'] =
        layerBRule?.function === 'Tension' ? 'avoid' : 'tension';
      if (consonanceRank[layerBVerdict] > consonanceRank[consonance]) {
        consonance = layerBVerdict;
      }
    } else if (layerBGravity >= 0.5) {
      if (consonance === 'consonant' || consonance === 'colortone') {
        consonance = 'tension';
      }
    }
  }
  // Always make Layer B targets available downstream (even when Layer A
  // dominated — anchor-scoring soft cross-chord bonus reads them too).
  const mergedLayerTargets: number[] = [];
  if (tendencyTargets !== null) {
    for (const offset of tendencyTargets) mergedLayerTargets.push(((rpc + offset) % 12 + 12) % 12);
  }
  for (const pc of layerBTargetsAbs) mergedLayerTargets.push(pc);

  // Style-aware avoid-note rule overrides — mode-aware exemptions
  // (modal characteristic notes get a pass even when the table flags
  // them as avoid). Only escalate to 'avoid' here; never downgrade.
  if (consonance !== 'avoid'
      && isAvoidNote(pcFromChord, chordType, scaleNameForBar, isModalContext ?? false, effectiveFunc)) {
    consonance = 'avoid';
  }

  // --- scale awareness (when localScalePcs provided) ---
  // The runScale defines the bar's currently-legal pitch pool —
  // including borrowed scales like Phrygian Dominant / Lydian Dominant
  // / Altered that the engine swaps in on secondary dominants. Without
  // this consultation, evaluator would judge those chords' chord-3rd
  // (e.g. C♯ on A7 / V/ii in C major) using ONLY chord-relative
  // (consonant ✓) but miss that C♯ is also a member of A Phrygian
  // Dominant — confirming it as a legitimate landing tone — and would
  // misjudge B♭ (b9 of A7 = legal in Phrygian Dominant) versus G♯
  // (not in any V/ii borrowed scale) the same way.
  //
  // Rule: in-scale pcs cannot be 'avoid'; out-of-scale pcs cannot be
  // 'consonant' (force at least 'tension'). Chord-context still wins
  // when stricter — an in-scale dom-7 b7 stays 'tension', not relaxed
  // to consonant.
  //
  // Under MODAL tonalCharacter, the scale's role is structurally
  // elevated: in-scale notes are not just "legal color" but the
  // genre's identity (blues b3/b7, Dorian's M6, Phrygian's b2). So
  // we further upgrade in-scale 'tension' to 'colortone' — these
  // notes don't demand resolution; they ARE the music.
  if (localScalePcs !== undefined && localScalePcs.size > 0) {
    const inScale = localScalePcs.has(npc);
    if (inScale) {
      if (consonance === 'avoid') consonance = 'colortone';
      if (tonalCharacter === 'modal' && consonance === 'tension') consonance = 'colortone';
    } else {
      if (consonance === 'consonant' || consonance === 'colortone') consonance = 'tension';
    }
  }

  // --- urgency ---
  // When tendency table fired (scenario resolved), urgency = tendency.gravity
  // verbatim — the table already encodes all the chord-context judgement.
  // When fallback fired, derive from consonance + chord tensionLevel + TSD
  // as before. In either case, modal tonalCharacter halves urgency at the
  // end so blues b3/b7 etc. drop below the hard-constraint threshold.
  let urgency: number;
  if (tendencyGravity !== null) {
    urgency = tendencyGravity;
  } else {
    switch (consonance) {
      case 'consonant':
        urgency = 0;
        break;
      case 'colortone':
        urgency = 0.15;
        break;
      case 'tension':
        urgency = Math.min(1, 0.5
          + chordTensionLevel * 0.3
          + (effectiveFunc === 'D' ? 0.2 : effectiveFunc === 'T' ? 0.1 : 0));
        break;
      case 'avoid':
        urgency = 1.0;
        break;
    }
  }
  // Modal songs relax resolution pressure — tensions become long-form
  // scale color rather than imperative pulls. Halving drops typical
  // chord-7 / leading-tone urgency below the unified-tension-resolution
  // threshold (0.5) so blues b7 etc. may hang.
  if (tonalCharacter === 'modal' && urgency > 0) {
    urgency = Math.min(1, urgency * 0.5);
  }

  // --- resolution targets (priority blend) ---
  // 1. TENDENCY_TABLE targets (when scenario resolved) — the most
  //    chord-context-precise targets, converted from chord-relative
  //    offsets to absolute pcs.
  // 2. Same-chord literal anchors (root/3/5/7) — closest landings
  // 3. Next-chord 1/3/5 — anticipatory resolution (Harmonic Catch path)
  // 4. LOCAL-key INTERVAL_AESTHETICS.expectedResolutions — backstop,
  //    sourced from the borrowed key when V-borrowing is active, else
  //    from the global key. This is the lookup that flips C♯-resolves-
  //    to-D under V/ii instead of C♯-resolves-to-C.
  const targets = new Set<number>();
  // mergedLayerTargets contains both TENDENCY_TABLE (Layer A) and
  // INTERVAL_AESTHETICS[mode] (Layer B) targets at absolute pcs.
  for (const pc of mergedLayerTargets) targets.add(pc);
  // Chord literal anchors as near-targets.
  for (const iv of literalIntervals) targets.add(((rpc + iv) % 12 + 12) % 12);
  // Next-chord 1/3/5 as anticipatory landing.
  for (const pc of nextAnchorPcs) targets.add(pc);
  targets.delete(npc);  // landing on self is not a resolution

  return {
    consonance,
    urgency,
    resolutionTargets: Array.from(targets),
    isInChordContract,
    isInChordExtension,
    isInNextChordAnchor,
  };
}

// ------------------------------------------------------------------
// G1: Aesthetic-table query functions — pure utility, consumed by:
//   resolveClash: G2 (clash-arbitrate)
//   preferredRegisterFor: G3 (voicing octave placer)
//   isBassEligibleFor: G5 (Bass Planner)
// ------------------------------------------------------------------

export type ClashResolution =
  | { keep: 'both'; reason: string }
  | { drop: number; reason: string };  // drop = pc to remove

/**
 * Given two pcs that form a minor-2nd / minor-9th clash on the same
 * chord, decide which to drop. Reads CHORD_VOICING_AESTHETICS for
 * role + tensionLevel, applies priority:
 *
 *   1. AVOID_NOTE → drop first (it shouldn't be there at all)
 *   2. Between CHORD_TONE + ALTERED_TENSION → drop the CHORD_TONE
 *      with lower tensionLevel ("Can be omitted, stable" — 5 of dom7)
 *   3. Between two CHORD_TONE → drop lower tensionLevel
 *   4. Otherwise → keep both, flag with reason
 */
export function resolveClash(
  pcA: number, pcB: number,
  chordType: string, chordRootPc: number,
): ClashResolution {
  const table = getChordVoicingAesthetics(chordType);
  const intervalA = (((pcA - chordRootPc) % 12) + 12) % 12;
  const intervalB = (((pcB - chordRootPc) % 12) + 12) % 12;
  const a = table[intervalA];
  const b = table[intervalB];
  if (!a || !b) return { keep: 'both', reason: 'no aesthetic entry' };

  // Rule 1: AVOID is always dropped — it shouldn't be in any voicing.
  if (a.role === 'AVOID_NOTE' && b.role !== 'AVOID_NOTE') {
    return { drop: pcA, reason: `pc${pcA} is AVOID_NOTE in ${chordType}` };
  }
  if (b.role === 'AVOID_NOTE' && a.role !== 'AVOID_NOTE') {
    return { drop: pcB, reason: `pc${pcB} is AVOID_NOTE in ${chordType}` };
  }

  // Rule 2: the Perfect 5 (interval 7) yields when it clashes with an
  // ALTERED_TENSION. Jazz convention: bass implies 5 via overtone
  // series, so the 5 in upper voicing is redundant when it clashes
  // with b5/b13/#11 alterations. This is the V7b13 / Lydian-dom rule.
  // Sus chords retain their 4 (the structural identity).
  const PERFECT_FIFTH = 7;
  const isSusFamily = chordType.includes('sus');
  if (!isSusFamily) {
    if (intervalA === PERFECT_FIFTH && a.role === 'CHORD_TONE' && b.role === 'ALTERED_TENSION') {
      return { drop: pcA, reason: `5 yields to ${b.description}` };
    }
    if (intervalB === PERFECT_FIFTH && b.role === 'CHORD_TONE' && a.role === 'ALTERED_TENSION') {
      return { drop: pcB, reason: `5 yields to ${a.description}` };
    }
  }

  // Rule 3: all other PC-distance-1 pairs are KEPT — they're voicing
  // conventions where the lower pc is voiced an octave below the
  // higher pc in MIDI space, producing an M7 (or compound M7) sound,
  // not a clash:
  //   - b3 + 9 (m7 chord) → Bill Evans rootless m9 (Eb low, D high)
  //   - root + maj7 (maj7 chord) → standard maj7 voicing (C low, B high)
  //   - root + b9 (dom7b9) → altered tension octave-stacked
  //   - 3 + #9 (7#9) → "Hendrix chord" octave-separated
  //   - 13 + b7 (13 chord) → 13 above b7 by M9 in voicing
  // The voicing placer (G3) handles octave-separation; the clash
  // resolver only intervenes when one pc MUST be dropped.
  return { keep: 'both', reason: `${a.role} / ${b.role} kept — voicing placer octave-separates` };
}

/** Look up an interval's preferred register in a chord context. */
export function preferredRegisterFor(
  pc: number, chordType: string, chordRootPc: number,
): RegisterHint {
  const table = getChordVoicingAesthetics(chordType);
  const interval = (((pc - chordRootPc) % 12) + 12) % 12;
  return table[interval]?.preferredRegister ?? 'flex';
}

/** Look up whether an interval can be used as bass (for inversions). */
export function isBassEligibleFor(
  pc: number, chordType: string, chordRootPc: number,
): boolean {
  const table = getChordVoicingAesthetics(chordType);
  const interval = (((pc - chordRootPc) % 12) + 12) % 12;
  return table[interval]?.isBassEligible ?? false;
}

// ------------------------------------------------------------------
// G2: Voicing Assembly — principled pcs selection from CHORD_TYPES
// literal + aesthetic-table-driven clash / density arbitration.
//
// This is the SINGLE source of truth for voicing-side pcs decisions.
// Replaces the previous hand-coded heuristics in realizeProgression's
// compingMode branches (when their lookup tables don't cover a chord
// type).
//
// Algorithm:
//   1. Pull chord literal intervals from CHORD_TYPES → pcs candidates
//   2. (optionally) augment with style-preferred extensions
//   3. Detect pair-wise minor-2nd (m9) clashes, resolve via aesthetic
//      table — drops AVOID first, then 5 of dom-family, then yields
//      AVAILABLE to CHORD_TONE/ALTERED. Two essentials clashing kept.
//   4. Apply rootPolicy (include / omit / keep_if_open)
//   5. If over density, drop lowest-priority pcs (AVOID first,
//      AVAILABLE before CHORD_TONE, lower-tension before higher).
//
// Output: ordered list of pcs (ascending). MIDI octave placement is
// G3's job (handles preferredRegister + bass distance).
// ------------------------------------------------------------------

export interface VoicingStylePreference {
  /** Include the chord root in the comping voicing? */
  rootPolicy: 'include' | 'omit' | 'keep_if_open';
  /** Target voice count (capped by available chord literal cardinality). */
  density: number;
  /**
   * When true, add the 9 (interval 2) to plain triads / 7-chords that
   * don't already have it. Bill Evans' rootless style adds 9 to all
   * m7/maj7/min triads. Cluster style also adds 9.
   * For shell / full / blues this is typically false.
   */
  addColorOnTriad?: boolean;
}

/**
 * Priority for "which pcs to drop when over density".
 * Lower priority = more droppable.
 *   AVOID         → 0.0 + tensionLevel (very droppable)
 *   AVAILABLE     → 1.0 + tensionLevel
 *   ALTERED       → 2.0 + tensionLevel
 *   CHORD_TONE    → 3.0 + tensionLevel
 * For chord-tones, dom-family's 5 (tensionLevel 0.05-0.1) is lower
 * than 3 / b7 (also tensionLevel ~0.1-0.2) — naturally drops first.
 *
 * isIdentityTone overrides everything — chord-identity-defining tones
 * get priority 1000 (effectively undroppable). The set is chord-type
 * specific (computed by chordIdentityIntervals).
 */
function dropPriority(role: NoteFunctionRole, tensionLevel: number, isIdentityTone: boolean = false): number {
  if (isIdentityTone) return 1000;
  const roleBase = role === 'AVOID_NOTE' ? 0
                 : role === 'AVAILABLE_TENSION' ? 1
                 : role === 'ALTERED_TENSION' ? 2
                 : 3;  // CHORD_TONE
  return roleBase + tensionLevel;
}

/**
 * Chord-identity intervals — the pcs (mod 12, from chord root) that
 * a voicing CANNOT drop without destroying the chord's identity.
 *
 *   maj / triad         → 0 (root in voicing optional via rootPolicy, but
 *                          chord identity needs 3 if it's a triad)
 *   m / min             → 3 (b3 defines minor)
 *   maj7 / maj9 / maj13 → 4 (3), 11 (maj7) — both required
 *   m7 / m9 / m11       → 3 (b3), 10 (b7) — both required
 *   m7b5 / m9b5 / dim7  → 3 (b3), 6 (b5), 10 (b7) — full half-dim shell
 *   dom-family (7/9/13/etc.) → 4 (3), 10 (b7) — defining tritone
 *   sus / 7sus4 / 9sus4 → 5 (4 sus) — 4 IS chord identity
 *   13 / 11             → also include the named extension (13 or 11)
 *
 * Lookup is by raw chord type string so callers can stay simple.
 * The function returns absolute pcs (chord root + interval mod 12)
 * for direct membership checks against assembleVoicing's pcs array.
 */
function chordIdentityIntervals(chordType: string): Set<number> {
  const result = new Set<number>();
  // Maj-family
  if (chordType === 'maj' || chordType === 'add9' || chordType === '6' || chordType === '6/9') {
    result.add(4); // 3
    return result;
  }
  if (chordType.includes('maj')) {
    result.add(4);  // 3
    result.add(11); // maj7
    return result;
  }
  // Half-dim / dim
  if (chordType === 'm7b5' || chordType === 'm9b5' || chordType === 'm11b5'
      || chordType.includes('dim')
      || (chordType.startsWith('m') && chordType.includes('b5'))) {
    result.add(3);  // b3
    result.add(6);  // b5
    if (!chordType.includes('dim') || chordType === 'dim7') result.add(10); // b7 (dim adds dim7 = 9, dim7 already 9 not 10)
    return result;
  }
  // Sus
  if (chordType === 'sus2') { result.add(2); return result; }
  if (chordType === 'sus4') { result.add(5); return result; }
  if (chordType === '7sus4' || chordType === '9sus4') {
    result.add(5);  // 4 (sus)
    result.add(10); // b7
    return result;
  }
  // Minor family (m7 / m9 / m11)
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) {
    result.add(3); // b3
    if (chordType !== 'm' && chordType !== 'min') result.add(10); // b7 for m7/m9/m11
    if (chordType === 'm11') result.add(17 % 12); // 11
    return result;
  }
  // Dom-family — 3 + b7 + named extension
  if (chordType === '11') {
    // sus11 — 4 acts as the 11; M3 omitted (m9 clash with 11 / 4).
    // Matches IV vocab '11' spell [0,7,10,2,5] = root + 5 + b7 + 9 + 4.
    result.add(5);  // 4 (= 11 mod 12)
    result.add(10); // b7
    return result;
  }
  if (chordType === '13' || chordType.startsWith('13')) {
    result.add(4);  // 3
    result.add(10); // b7
    result.add(21 % 12); // 13 (= pc 9)
    return result;
  }
  if (chordType.includes('7') || chordType.includes('9') || chordType === 'aug') {
    result.add(4);  // 3
    result.add(10); // b7
    return result;
  }
  // Default — just root quality
  result.add(4);
  return result;
}

export function assembleVoicing(
  chordType: string,
  chordRootPc: number,
  style: VoicingStylePreference,
): number[] {
  const intervals = CHORD_TYPES[chordType] ?? [0, 4, 7];

  // Step 1: pcs from chord literal (mod 12, dedupe)
  let pcs = Array.from(new Set(
    intervals.map(iv => (((chordRootPc + iv) % 12) + 12) % 12),
  ));

  // Step 2: addColorOnTriad — Bill Evans / cluster style adds 9 to
  // 3-4 note chord types (m7 / maj7 / triads). Skip when chord type
  // already has 9 (e.g. m9 / maj9 already have it).
  if (style.addColorOnTriad) {
    const ninthPc = (((chordRootPc + 2) % 12) + 12) % 12;
    if (!pcs.includes(ninthPc) && pcs.length <= 4) {
      pcs.push(ninthPc);
    }
  }

  // Step 3: Pair-wise m9 clash detection and resolution.
  // Re-evaluate after each drop in case it surfaces new clashes.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pcs.length; i++) {
      for (let j = i + 1; j < pcs.length; j++) {
        const a = pcs[i], b = pcs[j];
        const dist = Math.min(
          (((a - b) % 12) + 12) % 12,
          (((b - a) % 12) + 12) % 12,
        );
        if (dist !== 1) continue;
        const res = resolveClash(a, b, chordType, chordRootPc);
        if ('drop' in res) {
          pcs = pcs.filter(pc => pc !== res.drop);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Step 4: Apply rootPolicy
  if (style.rootPolicy === 'omit') {
    // Only drop root if doing so leaves at least density-1 pcs
    // (we need enough voices to play the chord).
    if (pcs.length > 1) pcs = pcs.filter(pc => pc !== chordRootPc);
  }

  // Step 5: If over density, drop lowest-priority pcs — chord-identity
  // tones (3 + b7 for dom, b3 + b7 for m7, etc.) get sticky priority
  // 1000 via the isIdentityTone path so density-cap cannot eject the
  // notes that define the chord's quality. Without this guard, dom-
  // family voicings with 4+ extensions (G13 = root/3/5/b7/9/13)
  // would lose b7 first when density caps at 5 (audited: G13 emitted
  // as D-G-A-B-E with no F = b7, identity collapsed to G6/9-add13).
  if (pcs.length > style.density) {
    const table = getChordVoicingAesthetics(chordType);
    const identityIvs = chordIdentityIntervals(chordType);
    const scored = pcs.map(pc => {
      const iv = (((pc - chordRootPc) % 12) + 12) % 12;
      const entry = table[iv];
      const isIdentity = identityIvs.has(iv);
      return {
        pc,
        priority: entry
          ? dropPriority(entry.role, entry.tensionLevel, isIdentity)
          : (isIdentity ? 1000 : 0),
      };
    });
    scored.sort((x, y) => y.priority - x.priority);  // descending — keep top
    pcs = scored.slice(0, style.density).map(s => s.pc);
  }

  return pcs.sort((a, b) => a - b);
}

// ------------------------------------------------------------------
// G3: Voicing octave placement — given the pcs from assembleVoicing,
// the previous chord's voicing (for voice-leading continuity), and
// the current chord's bass MIDI, find optimal MIDI placements.
//
// Multi-objective brute-force search (typically 3-6 voices × 3-4
// candidate octaves = ≤ 1500 combinations, < 1ms):
//
//   1. Bass-to-voicing-bottom gap ≈ 11 semitones (sweet spot)
//      — fixes problem 1 (tenor gap): 84% > 17 semitones currently
//   2. preferredRegister hints: 'low' pcs prefer MIDI < 64, 'high'
//      prefer MIDI > 62 (guide tones bottom, color top)
//   3. Voice-leading from prev: minimize total L1 distance to nearest
//      previous voice pitch
//   4. Voicing span ≤ 24 semitones (no extreme open positions)
//   5. Hard constraint: gap ≥ 4 (voicing must be above bass)
//
// Output: MIDI array sorted ascending. Not yet wired into engine.
// ------------------------------------------------------------------

const VOICING_BOTTOM_GAP_TARGET = 11;  // ideal bass-to-voicing-bottom (semitones)
const VOICING_BOTTOM_GAP_MIN = 4;      // hard floor — voicing must be above bass
const VOICING_BOTTOM_GAP_MAX_SOFT = 17; // beyond this, "tenor gap" — penalize
const VOICING_SPAN_MAX = 24;           // max semitones top-to-bottom

// ------------------------------------------------------------------
// Piano-tuned Low Interval Limits — vertical-registration penalties.
//
// What: per-interval thresholds (lower-voice MIDI) below which the
// pair beats audibly within the cochlear critical band. Adjacent
// voice pairs below the threshold get an extra cost penalty during
// placeVoicingMidi's cost search.
//
// Why piano-tuned (NOT Piston 1955 orchestral): Walter Piston's
// orchestration LIL table is derived from strings+winds spacing in
// ensemble — those thresholds are too aggressive for solo piano LH,
// where stride / boogie / blues idiomatically stomp m3 / M3 around
// F2-Bb2 as the genre signature. Each piano key is an independent
// hammer-strike, so partials align differently than a string section
// and the low-register tolerance for thirds is much wider. Mancini
// (1962) explicitly excludes piano LH from the orchestral LIL.
//
// What's actually muddy on piano:
//   - m2 in the low/mid register (critical-band beating audible)
//   - M2 in the deep bass (overlap with strong partials)
// Everything else (m3 / M3 / P4 / TT / P5+) is stylistically used
// at piano LH depths and not penalized.
//
// Source: Henry Mancini, "Sounds and Scores" (1962), piano LH chapter;
// Bill Evans / Glasper voicing dictionaries (empirical: clusters appear
// above E4, never below).
// ------------------------------------------------------------------
interface PianoLILRule {
  semitones: number;
  // The lower note of the pair must be ≥ this MIDI to escape the
  // penalty. Below the threshold = "muddy" — penalty applied.
  minLowerMidi: number;
  penalty: number;
  reason: string;
}

export const PIANO_LIL_THRESHOLDS: readonly PianoLILRule[] = [
  { semitones: 1, minLowerMidi: 64, penalty: 40, reason: 'm2 below E4: critical-band beating' },
  { semitones: 2, minLowerMidi: 55, penalty: 10, reason: 'M2 below G3: muddy in low/mid register' },
] as const;

const PIANO_LIL_HIGH_REGISTER_M2_PENALTY = 4;  // m2 above E4 — mild upper-structure friction

const REGISTER_PENALTY = {
  'low':  { abovePivot: 64, weight: 0.5 },   // 'low' pcs penalized when > 64
  'high': { belowPivot: 62, weight: 0.5 },   // 'high' pcs penalized when < 62
} as const;

export function placeVoicingMidi(
  pcs: number[],
  prevVoicingMidi: number[],
  bassMidi: number,
  chordType: string,
  chordRootPc: number,
): number[] {
  if (pcs.length === 0) return [];

  // Build candidate MIDI list for each pc — all octaves within CHORD_RANGE.
  const pcModNormalize = (pc: number): number => (((pc % 12) + 12) % 12);
  const candidates: number[][] = pcs.map(pc => {
    const pcMod = pcModNormalize(pc);
    const out: number[] = [];
    for (let m = pcMod; m <= 100; m += 12) {
      if (m < CHORD_RANGE.LOW || m > CHORD_RANGE.HIGH) continue;
      out.push(m);
    }
    // If empty (shouldn't happen for valid pcs in CHORD_RANGE), include
    // closest in-range MIDI as fallback.
    if (out.length === 0) out.push(pcMod + 60);
    return out;
  });

  // Brute-force all combinations
  let best: { midi: number[]; cost: number } | null = null;
  const N = pcs.length;
  const current: number[] = new Array(N);
  function recurse(idx: number): void {
    if (idx === N) {
      const sorted = current.slice().sort((a, b) => a - b);
      const bottom = sorted[0];
      const top = sorted[sorted.length - 1];
      const gap = bottom - bassMidi;

      // Hard constraint: voicing must be above bass with some margin
      if (gap < VOICING_BOTTOM_GAP_MIN) return;

      // Cost components
      let cost = 0;

      // 1. Bass-to-voicing-bottom gap (sweet spot = 11)
      const gapDeviation = Math.abs(gap - VOICING_BOTTOM_GAP_TARGET);
      cost += gapDeviation * 2;
      // Extra penalty if beyond tenor-gap threshold
      if (gap > VOICING_BOTTOM_GAP_MAX_SOFT) {
        cost += (gap - VOICING_BOTTOM_GAP_MAX_SOFT) * 3;
      }

      // 2. preferredRegister hints
      for (let i = 0; i < N; i++) {
        const reg = preferredRegisterFor(pcs[i], chordType, chordRootPc);
        const m = current[i];
        if (reg === 'low' && m > REGISTER_PENALTY.low.abovePivot) {
          cost += (m - REGISTER_PENALTY.low.abovePivot) * REGISTER_PENALTY.low.weight;
        }
        if (reg === 'high' && m < REGISTER_PENALTY.high.belowPivot) {
          cost += (REGISTER_PENALTY.high.belowPivot - m) * REGISTER_PENALTY.high.weight;
        }
      }

      // 3. Voice-leading from prev voicing (greedy nearest-pitch).
      // Coefficient raised from 0.3 to 1.2 so voicing changes prefer
      // common-tone retention and stepwise motion rather than block
      // transpositions. With 0.3 the cost barely registered against
      // the bass-gap target (×2) and tenor-gap penalty (×3) so the
      // search kept emitting "different chord, fresh voicing shape"
      // — audited at 7-19 semi top-voice jumps. 1.2 makes voice-
      // leading dominant in the cost budget without making the bass-
      // gap constraint irrelevant.
      if (prevVoicingMidi.length > 0) {
        for (const m of sorted) {
          let minDist = Infinity;
          for (const p of prevVoicingMidi) {
            const d = Math.abs(m - p);
            if (d < minDist) minDist = d;
          }
          cost += minDist * 1.2;
        }
        // 3a. Top-voice continuity — extra penalty when the highest
        // voice jumps more than a P4 (5 semitones). Top voice is the
        // most perceptually salient in a piano voicing; the listener
        // hears it as the "voicing's melody" and large jumps register
        // as gear-shifts. Cost +20 per semitone beyond 5.
        const currTop = sorted[sorted.length - 1];
        const prevTop = Math.max(...prevVoicingMidi);
        const topJump = Math.abs(currTop - prevTop);
        if (topJump > 5) cost += (topJump - 5) * 20;
      }

      // 3b. Parallel 5ths / 8ves detection. Classical voice-leading
      // bans direct (same-direction) parallel perfect 5ths and 8ves
      // between voices — they collapse the harmonic identity ("hollow
      // doubling"). Stride / boogie LH gleefully ignores this rule by
      // design, so the engine soft-penalizes (not hard-bans) for
      // mainstream piano styles. Cost +25 per parallel-5 pair, +30 per
      // parallel-8 — enough to nudge the search toward contrary motion
      // when alternatives exist, but lets the rule yield when no
      // alternative voicing places the bottom-bass gap correctly.
      //
      // Detection: pair-up prev sorted voicing with current sorted via
      // greedy nearest match, then check each (vp, vc) ↔ (vp', vc')
      // adjacency: prev (vp, vp') interval ∈ {7, 12} AND current
      // (vc, vc') same interval AND both voices moved same direction.
      if (prevVoicingMidi.length >= 2 && sorted.length >= 2) {
        const prevSorted = [...prevVoicingMidi].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length - 1 && i < prevSorted.length - 1; i++) {
          const prevInterval = prevSorted[i + 1] - prevSorted[i];
          const currInterval = sorted[i + 1] - sorted[i];
          if (prevInterval !== currInterval) continue;
          if (prevInterval !== 7 && prevInterval !== 12) continue;
          const dirLower = Math.sign(sorted[i] - prevSorted[i]);
          const dirUpper = Math.sign(sorted[i + 1] - prevSorted[i + 1]);
          if (dirLower === 0 || dirUpper === 0) continue;
          if (dirLower !== dirUpper) continue;
          cost += prevInterval === 7 ? 25 : 30;
        }
      }

      // 4. Voicing span penalty
      const span = top - bottom;
      if (span > VOICING_SPAN_MAX) cost += (span - VOICING_SPAN_MAX) * 2;

      // 5. Cluster prevention — register-conditional via PIANO_LIL_THRESHOLDS.
      // m2 in the low/mid register triggers cochlear critical-band beating
      // (Mancini 1962); above E4 it's idiomatic upper-structure color (Debussy,
      // jazz tensions like b9 on dom7). m3 / M3 / P4 NOT penalized — stride /
      // boogie / blues use those at piano LH depths as a genre signature.
      for (let i = 1; i < sorted.length; i++) {
        const dist = sorted[i] - sorted[i - 1];
        const lower = sorted[i - 1];
        if (dist < 1) {
          cost += 100;  // duplicate MIDI — forbidden
          continue;
        }
        const rule = PIANO_LIL_THRESHOLDS.find(r => r.semitones === dist);
        if (rule) {
          cost += lower < rule.minLowerMidi
            ? rule.penalty
            : (dist === 1 ? PIANO_LIL_HIGH_REGISTER_M2_PENALTY : 0);
        }
      }

      // 6. m9 cluster penalty (bass + voice 13 semi up = octave + m2).
      // Even when the chord type contains b9 (e.g. 7b9, 7b13's b13 reads
      // as m2 of b13's parent), placing it 13 semis above bass creates
      // the most audible muddy cluster. The b9/b13 voice should sit
      // ≥ 25 semis above bass (2 octaves + m2 — distance dilutes beating)
      // or be omitted. Penalty here pushes placement to find a higher
      // octave for that voice when possible.
      //
      // Distance 13 = direct m9 cluster, +80 cost (severe).
      // Distance 25 = 2-octave m9, +20 cost (acceptable jazz upper-structure).
      // Distance > 25 = OK.
      const bassPc = ((bassMidi % 12) + 12) % 12;
      const b9Pc = (bassPc + 1) % 12;
      for (const m of sorted) {
        const upperPc = ((m % 12) + 12) % 12;
        if (upperPc !== b9Pc) continue;
        const intervalToBass = m - bassMidi;
        if (intervalToBass === 13) cost += 80;
        else if (intervalToBass === 25) cost += 20;
      }

      if (!best || cost < best.cost) best = { midi: sorted, cost };
      return;
    }
    for (const m of candidates[idx]) {
      current[idx] = m;
      recurse(idx + 1);
    }
  }
  recurse(0);

  if (!best) {
    // Fallback: naive placement just above bass
    return pcs.map(pc => {
      const pcMod = pcModNormalize(pc);
      let m = pcMod;
      while (m < Math.max(CHORD_RANGE.LOW, bassMidi + VOICING_BOTTOM_GAP_MIN)) m += 12;
      return m;
    }).sort((a, b) => a - b);
  }
  return best.midi;
}

// Style preset constants for the 5 modes used in realizeProgression.
// Wiring (G4) will dispatch via these instead of inline heuristics.
export const STYLE_SHELL: VoicingStylePreference = {
  rootPolicy: 'include',
  density: 4,
  addColorOnTriad: false,
};
export const STYLE_ROOTLESS: VoicingStylePreference = {
  rootPolicy: 'omit',
  density: 4,
  addColorOnTriad: true,  // Bill Evans signature
};
export const STYLE_CLUSTER: VoicingStylePreference = {
  rootPolicy: 'omit',
  density: 4,
  addColorOnTriad: true,
};
export const STYLE_FULL: VoicingStylePreference = {
  rootPolicy: 'include',
  density: 5,
  addColorOnTriad: false,
};
export const STYLE_BLUES: VoicingStylePreference = {
  rootPolicy: 'include',
  density: 4,
  addColorOnTriad: false,
};

// ------------------------------------------------------------------
// Arrangement mode — vertical-spread transformation applied AFTER
// placeVoicingMidi.
//
// Music reference (jazz arrangement standard):
//   close       — 4 voices within 1 octave (root position close, 1st inv close, etc.)
//   drop2       — take the 2nd-from-top voice of a close voicing, drop 1 octave
//                 → "Bill Evans rootless drop-2" / "guitar comp spread"
//   drop3       — take the 3rd-from-top voice, drop 1 octave (less common)
//   spread      — drop-2-and-4: drop BOTH 2nd-from-top and 4th-from-top
//                 → orchestral / piano "open spacing"
//
// Reason these are POST-placement (not pre):
//   placeVoicingMidi already runs brute-force placement under
//   bass-gap / voice-leading / cluster constraints. The output is a
//   physically reasonable close-position voicing. Applying the drop
//   transform as a post-pass keeps the optimization intact and only
//   adds the structural spread. Bass MIDI is NEVER touched — drops
//   only move voices above bass; safety guard refuses any drop that
//   would land at-or-below bass.
//
// Reference frame for "Nth-from-top":
//   Voices sorted ascending by MIDI; index N from top = (length - N).
//   drop2 = index (length - 2). drop3 = index (length - 3).
// ------------------------------------------------------------------

export type ArrangementMode = 'close' | 'drop2' | 'drop3' | 'spread';

const ARRANGEMENT_BASS_SAFETY = 4;     // dropped voice must stay ≥ 4 semis above bass
const ARRANGEMENT_ABSOLUTE_FLOOR = 33; // A1 — sub-musical below this on a piano sampler

// Register thresholds for muddy-interval detection (post-arrangement check).
// Same anchors as PIANO_LIL_THRESHOLDS but reused here to verify the drop
// transform didn't introduce new muddy intervals on its way down.
const MUDDY_M2_BELOW_MIDI = 64;  // E4 — m2 below this is muddy
const MUDDY_M2_GAP_BELOW_MIDI = 50;  // D3 — M2 below this is muddy

/**
 * Detect muddy intervals in a voicing relative to bass. Returns true when
 * any of these patterns is present:
 *
 *   • m2 between adjacent upper voices when the lower is below E4
 *     (cochlear critical-band beating dominates the timbre)
 *   • M2 between adjacent upper voices when the lower is below D3
 *     (deep-bass partial overlap)
 *   • m9 cluster — an upper voice sits exactly 13 / 25 semitones above bass
 *     (= octave + m2; bass + b9 across octave is the harshest cluster)
 *
 * Used by applyArrangement to reject Drop-2/Drop-3/Spread transforms that
 * would degrade timbre. placeVoicingMidi already filters close-position
 * voicings against PIANO_LIL_THRESHOLDS; this post-pass guards against
 * NEW muddy intervals introduced by dropping voices into lower register.
 */
function hasMuddyInterval(midis: number[], bassMidi: number): boolean {
  if (midis.length < 2) return false;
  const sorted = midis.slice().sort((a, b) => a - b);
  // m9 cluster check (bass → upper voice across octave)
  const bassPc = ((bassMidi % 12) + 12) % 12;
  const b9Pc = (bassPc + 1) % 12;
  for (const m of sorted) {
    const intervalToBass = m - bassMidi;
    if (intervalToBass < 8) continue;       // not yet across octave
    if (intervalToBass > 25) continue;      // too high to register as cluster
    const upperPc = ((m % 12) + 12) % 12;
    // Octave + m2 above bass = the m9 cluster (worst case)
    if (upperPc === b9Pc && (intervalToBass === 13 || intervalToBass === 25)) {
      return true;
    }
  }
  // Adjacent voice intervals in low register
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    const lowerMidi = sorted[i - 1];
    if (gap === 1 && lowerMidi < MUDDY_M2_BELOW_MIDI) return true;       // m2 below E4
    if (gap === 2 && lowerMidi < MUDDY_M2_GAP_BELOW_MIDI) return true;   // M2 below D3
  }
  return false;
}

/**
 * Transform a close voicing into drop2 / drop3 / spread by moving
 * specific voice(s) down one octave.
 *
 *   close   — identity (returns sorted copy)
 *   drop2   — index (length-2) ↓ 12.
 *   drop3   — index (length-3) ↓ 12. Requires ≥ 4 voices.
 *   spread  — index (length-2) AND (length-4) ↓ 12. Requires ≥ 4 voices.
 *             Falls back to drop2 if not enough voices.
 *
 * Safety: a drop is REFUSED if it would land below `bassMidi + 4` (clash
 * with bass) OR below MIDI 33 (sub-musical piano range). Otherwise it
 * proceeds — dropped voices ARE allowed to enter the tenor/baritone range
 * (below CHORD_RANGE.LOW = C4), which is the canonical Drop-2 voicing
 * register (G3-B3 for typical close Cmaj7 root position). The function
 * then either tries a partial drop (spread → drop2 fallback) or returns
 * unchanged. Bass MIDI is never modified.
 *
 * Returns a fresh sorted array; input is not mutated.
 */
export function applyArrangement(
  midis: number[],
  mode: ArrangementMode,
  bassMidi?: number,
): number[] {
  const sorted = midis.slice().sort((a, b) => a - b);
  if (mode === 'close' || sorted.length < 3) return sorted;

  const safetyFloor = bassMidi !== undefined
    ? bassMidi + ARRANGEMENT_BASS_SAFETY
    : ARRANGEMENT_ABSOLUTE_FLOOR;

  const tryDrop = (arr: number[], idx: number): number[] | null => {
    if (idx < 0 || idx >= arr.length) return null;
    const dropped = arr[idx] - 12;
    if (dropped < safetyFloor) return null;
    if (dropped < ARRANGEMENT_ABSOLUTE_FLOOR) return null;
    const out = arr.slice();
    out[idx] = dropped;
    const result = out.sort((a, b) => a - b);
    // Muddy-interval safety: drop may have created a m9 cluster against
    // bass (e.g. dropping maj7 voice creates bass+b9), or pushed a voice
    // into low register where it forms m2/M2 with adjacent voice. Reject
    // the drop in those cases so caller falls back to close.
    if (bassMidi !== undefined && hasMuddyInterval(result, bassMidi)) return null;
    return result;
  };

  if (mode === 'drop2') {
    return tryDrop(sorted, sorted.length - 2) ?? sorted;
  }
  if (mode === 'drop3') {
    if (sorted.length < 4) return sorted;  // drop3 needs 4+ voices
    return tryDrop(sorted, sorted.length - 3) ?? sorted;
  }
  if (mode === 'spread') {
    if (sorted.length < 4) {
      // Fall back to drop2 for 3-voice case
      return tryDrop(sorted, sorted.length - 2) ?? sorted;
    }
    // Drop-2-and-4: drop BOTH 2nd and 4th from top.
    // Apply drop2 first; if it succeeds, then try dropping the new
    // (post-drop2) index (length-4). NOTE: after first drop, indices
    // re-sort, so we re-find the original 4th-from-top by value.
    const fourthFromTopOrig = sorted[sorted.length - 4];
    const afterDrop2 = tryDrop(sorted, sorted.length - 2);
    if (!afterDrop2) return sorted;
    const newIdx4 = afterDrop2.indexOf(fourthFromTopOrig);
    if (newIdx4 < 0) return afterDrop2;
    const afterDrop4 = tryDrop(afterDrop2, newIdx4);
    return afterDrop4 ?? afterDrop2;  // 4-drop refused → keep drop2
  }
  return sorted;
}

// ------------------------------------------------------------------
// TensionTracker — accumulates unresolved high-tension intervals and
// reports the most urgent one for the engine to resolve. Currently the
// engine instantiates this class but does not call its methods; M3
// will wire it into the melody generation loop.
// ------------------------------------------------------------------

export class TensionTracker {
  // count = how many times this pc has appeared without resolution.
  // Capped at MAX_OCCURRENCES (= 2) per the "最多 2 次" rule. The cap
  // serves as a "saturation" flag: once count === MAX, the next
  // structural-position note MUST resolve regardless of style
  // strictness probability.
  public unresolved: { semitone: number; urgency: number; timeAdded: number; count: number }[] = [];

  public static readonly MAX_OCCURRENCES = 2;

  // modeFamily picks between K-K major / minor probe-tone profiles. In
  // minor, b3 / b6 / b7 are backbone (low tension) — major profile would
  // mis-classify them as urgent. Defaults to 'Major' so callers that
  // don't supply mode preserve pre-mode-aware behavior.
  constructor(public readonly modeFamily: 'Major' | 'Minor' = 'Major') {}

  // K-K tension lookup for the active mode family. Source: K-K 1982.
  private kkTension(pc: number): number {
    return this.modeFamily === 'Minor' ? kkTensionMinor(pc) : kkTensionMajor(pc);
  }

  public addTension(semitoneToRoot: number, time: number) {
     const pc = ((semitoneToRoot % 12) + 12) % 12;
     const rule = INTERVAL_AESTHETICS[pc];
     if (!rule) return;
     // Tension threshold + urgency value come from the mode-specific
     // K-K profile, not from INTERVAL_AESTHETICS.tensionAmount (which
     // is K-K major locked at module load).
     const urgency = this.kkTension(pc);
     if (urgency < 0.5) return;
     // Dedupe: consecutive 7-7-7 (or non-consecutive same pc within
     // the same harmonic cycle) increments count instead of pushing
     // separate entries. Cap at MAX_OCCURRENCES so a saturated tension
     // doesn't grow unboundedly between structural notes.
     const existing = this.unresolved.find(t => t.semitone === pc);
     if (existing) {
         if (existing.count < TensionTracker.MAX_OCCURRENCES) existing.count++;
         return;
     }
     this.unresolved.push({ semitone: pc, urgency, timeAdded: time, count: 1 });
  }

  // Resolution must land on a structural-position note (strong beat,
  // long duration, or phrase end) per user direction. Non-structural
  // notes hitting the resolution pc are treated as passing — they
  // don't count as "the listener heard the resolution land".
  //
  // chordLiteralPcs (optional): when provided, ALSO accept any chord-
  // tone of the current chord as a valid resolution target — chord-
  // aware resolution per "倾向解决到4或者0这个要根据当前和弦决定". For
  // pc=5 (4 of key) over Cmaj, both 4 (E) and 0 (C) are chord tones
  // and either resolves the F.
  public checkResolution(semitoneToRoot: number, isStructural: boolean = false, chordLiteralPcs: Set<number> | null = null) {
     if (!isStructural) return;
     const pc = ((semitoneToRoot % 12) + 12) % 12;
     this.unresolved = this.unresolved.filter(tension => {
         const rule = INTERVAL_AESTHETICS[tension.semitone];
         // Static expected target
         if (rule.expectedResolutions.includes(pc)) return false;
         // Universal home (key root)
         if (pc === 0) return false;
         // Chord-aware: any chord literal of the current chord counts
         if (chordLiteralPcs && chordLiteralPcs.has(pc)) return false;
         return true;
     });
  }

  public getMostUrgentTension(): number | null {
      if (this.unresolved.length === 0) return null;
      return this.unresolved.sort((a, b) => b.urgency - a.urgency)[0].semitone;
  }

  // Returns the pc of any tension that has hit MAX_OCCURRENCES — the
  // next structural-position note MUST resolve it (no probability
  // gate). Highest-urgency pc returned when multiple are saturated.
  public getSaturatedTension(): number | null {
      const saturated = this.unresolved.filter(t => t.count >= TensionTracker.MAX_OCCURRENCES);
      if (saturated.length === 0) return null;
      return saturated.sort((a, b) => b.urgency - a.urgency)[0].semitone;
  }

  // Returns true if pc is currently at MAX_OCCURRENCES and unresolved.
  // Used by the per-note loop to BLOCK a 3rd same-pc emission at the
  // source (magnetize away before push).
  public isSaturated(semitoneToRoot: number): boolean {
      const pc = ((semitoneToRoot % 12) + 12) % 12;
      const t = this.unresolved.find(x => x.semitone === pc);
      return !!t && t.count >= TensionTracker.MAX_OCCURRENCES;
  }

  // Wipes unresolved at a harmonic cycle boundary (= cadence position
  // per CLAUDE.md). Each cycle starts fresh — a tension hanging from
  // the previous progression doesn't carry over.
  public resetCycle() {
      this.unresolved = [];
  }
}

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
      && (chordType === '7'
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

  // 5. 三全音泄露定理 — M6 (pc 9) on a minor chord makes a tritone
  //    against the chord's b3 and the line collapses into a rootless
  //    V7 reading. EXCEPT when func='S' (ii in major = Dorian context):
  //    Dorian's signature M6 is the whole reason the chord is on ii
  //    instead of vi — TENDENCY_TABLE m7S[9] = T 0.4 explicitly marks
  //    it tension-color, not avoid. Without this exemption, Dm7-as-ii
  //    bars get their M6 snapped away every time and the Dorian
  //    color is silently lost.
  //    Modal context (BLUES, exotic modes) bypasses entirely.
  if (!isModalContext && func !== 'D' && func !== 'S' && (isMinor || isHalfDim)) {
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

// ------------------------------------------------------------------
// Per-mode chord legality dictionary. Wired in commit 6d356d2 (M3c)
// via getModeAwareSubstitutions / chordTypeFitsMode — exotic modes
// (Mixolydian / Dorian / Phrygian / ...) use this to constrain the
// per-style substitutionMap so a Mixolydian I lands on dominant-
// family rather than a Pop-Ballad-flavoured maj7.
// ------------------------------------------------------------------

export const CHORD_COLOR_DICTIONARY = {
  'Maj/Ionian': {
    chords: { I: 'Imaj7', II: 'II-7', III: 'III-7', IV: 'IVmaj7', V: 'V7', VI: 'VI-7', VII: 'VII-7b5' },
    substitutes: [],
    progressions: ['I-IV-I'],
    colorDescription: '大调-明亮'
  },
  'minor/Aeolian': {
    chords: { I: 'I-7', II: 'II-7b5', III: 'bIIImaj7', IV: 'IV-7', V: 'V-7', VI: 'bVImaj7', VII: 'bVII7' },
    substitutes: ['2', '6', '7'],
    progressions: ['i-bVI'],
    colorDescription: '小调-暗淡'
  },
  'Dorian': {
    chords: { I: 'I-7', II: 'II-7', III: 'bIIImaj7', IV: 'IV7', V: 'V-7', VI: 'VI-7b5', VII: 'bVIImaj7' },
    substitutes: ['3', '4'],
    progressions: ['i-IV-i'],
    colorDescription: '神秘、空灵、深沉'
  },
  'Phrygian': {
    chords: { I: 'I-7', II: 'bIImaj7', III: 'bIII7', IV: 'IV-7', V: 'V-7b5', VI: 'bVImaj7', VII: 'bVII-7' },
    substitutes: ['2', '7'],
    progressions: ['i-bII-i'],
    colorDescription: '诡异、幽暗、冷酷'
  },
  'Lydian': {
    chords: { I: 'Imaj7', II: 'II7', III: 'III-7', IV: '#IV-7b5', V: 'Vmaj7', VI: 'VI-7', VII: 'VII-7' },
    substitutes: ['2', '4'],
    progressions: ['I-II'],
    colorDescription: '奇幻、梦幻、缥缈'
  },
  'Mixolydian': {
    chords: { I: 'I7', II: 'II-7', III: 'III-7b5', IV: 'IVmaj7', V: 'V-7', VI: 'VI-7', VII: 'bVIImaj7' },
    substitutes: ['5', '7'],
    progressions: ['I-bVII'],
    colorDescription: '奇妙、开阔、超然'
  },
  'Locrian': {
    chords: { I: 'I-7b5', II: 'bIImaj7', III: 'bIII-7', IV: 'IV-7', V: 'bVmaj7', VI: 'bVI7', VII: 'bVII-7' },
    substitutes: ['5'],
    progressions: ['I°-bV', 'I-bV'],
    colorDescription: '压抑、紧张、怪诞'
  },
  'Harmonic Minor': {
    chords: { I: 'Imaj7', II: 'II-7b5', III: 'bIII+maj7', IV: 'IV-7', V: 'V7', VI: 'bVImaj7', VII: 'VII°7' },
    substitutes: ['7'],
    progressions: [],
    colorDescription: '和声小调'
  },
  'Melodic Minor': {
    chords: { I: 'Imaj7', II: 'II-7', III: 'bIII+maj7', IV: 'IV7', V: 'V7', VI: 'VI-7b5', VII: 'VII-7b5' },
    substitutes: ['1'],
    progressions: [],
    colorDescription: '旋律小调'
  }
};

// ------------------------------------------------------------------
// Melody audit reporter.
//
// Pure analysis pass — does not mutate input. Walks the generated
// melody events and reports each note's role against the active chord
// (chord-tone / available-tension / avoid-note / altered-tension) plus
// summary counts split by origin tag (motif / develop / return).
//
// Read by the App diagnostics panel and the snapshot fixture.
// Sacred motif notes show up in the report but are not corrected by
// the engine elsewhere — the audit only describes; it does not act.
// ------------------------------------------------------------------

interface AuditChordWindow {
  startBeat: number;
  endBeat: number;
  rootPc: number;
  type: string;
}

interface MelodyEventLike {
  noteNumber: number;
  time: number;
  duration: number;
  part: 'melody' | 'chord' | 'bass';
  origin?: 'motif' | 'develop' | 'return';
}

interface ChordLike {
  rootMidi: number;
  type: string;
  duration: number;
}

export interface MelodyAuditSummary {
  total: number;
  byRole: Partial<Record<NoteFunctionRole, number>>;
  avgTensionByOrigin: { motif: number; develop: number; return: number };
  countByOrigin: { motif: number; develop: number; return: number; untagged: number };
  avoidNotesOnMotif: number;     // sacred — reported but unfixable by engine
  avoidNotesOnDevelop: number;   // total develop-role avoid hits — sums structural + passing
  avoidNotesOnReturn: number;    // unexpected — return targets a chord tone
  // Sub-split of avoid-on-develop. Structural-position avoids are the
  // ones the engine's no-avoid hard filter is responsible for catching;
  // they SHOULD stay near zero. Passing-position avoids (chromatic
  // passing tones, neighbor tones, 16th-note runs through clash regions)
  // are musically idiomatic and NOT bugs — they're the bridges that
  // make melodic lines breathe. The total count alone is misleading
  // without this split (~90% of develop-avoid hits are passing).
  avoidNotesOnDevelopStructural: number;
  avoidNotesOnDevelopPassing: number;
}

export function auditMelody(events: MelodyEventLike[], chords: ChordLike[]): MelodyAuditSummary {
  // Chord windows: each chord plays for `duration` beats starting at the
  // accumulated offset.
  const windows: AuditChordWindow[] = [];
  let acc = 0;
  for (const ch of chords) {
    windows.push({
      startBeat: acc,
      endBeat: acc + ch.duration,
      rootPc: ((ch.rootMidi % 12) + 12) % 12,
      type: ch.type,
    });
    acc += ch.duration;
  }

  const findWindow = (t: number): AuditChordWindow | undefined => {
    for (const w of windows) {
      if (t >= w.startBeat && t < w.endBeat) return w;
    }
    // Past the last chord (e.g. very last note tail) → snap to last window.
    return windows[windows.length - 1];
  };

  const summary: MelodyAuditSummary = {
    total: 0,
    byRole: {},
    avgTensionByOrigin: { motif: 0, develop: 0, return: 0 },
    countByOrigin: { motif: 0, develop: 0, return: 0, untagged: 0 },
    avoidNotesOnMotif: 0,
    avoidNotesOnDevelop: 0,
    avoidNotesOnReturn: 0,
    avoidNotesOnDevelopStructural: 0,
    avoidNotesOnDevelopPassing: 0,
  };

  const tensionSums = { motif: 0, develop: 0, return: 0 };

  for (const ev of events) {
    if (ev.part !== 'melody') continue;
    const w = findWindow(ev.time);
    if (!w) continue;
    const interval = ((ev.noteNumber - w.rootPc) % 12 + 12) % 12;
    const aestheticTable = getChordVoicingAesthetics(w.type);
    const aesthetic = aestheticTable[interval];
    if (!aesthetic) continue;

    summary.total++;
    summary.byRole[aesthetic.role] = (summary.byRole[aesthetic.role] ?? 0) + 1;

    const origin = ev.origin;
    if (origin === 'motif') { summary.countByOrigin.motif++; tensionSums.motif += aesthetic.tensionLevel; }
    else if (origin === 'develop') { summary.countByOrigin.develop++; tensionSums.develop += aesthetic.tensionLevel; }
    else if (origin === 'return') { summary.countByOrigin.return++; tensionSums.return += aesthetic.tensionLevel; }
    else summary.countByOrigin.untagged++;

    if (aesthetic.role === 'AVOID_NOTE') {
      if (origin === 'motif') summary.avoidNotesOnMotif++;
      else if (origin === 'develop') {
        summary.avoidNotesOnDevelop++;
        // Structural-position predicate — mirrors generateBarPattern's
        // isStructuralNote logic at a coarse audit-side level: strong
        // beat (even integer offset from bar start) OR long duration
        // (≥ 1.5 beats). Phrase-end is omitted here because audit
        // doesn't track motif boundaries; the strong/long pair catches
        // ~95% of structural positions in practice.
        const barOffset = ev.time - w.startBeat;
        const isStrong = Math.abs(barOffset - Math.round(barOffset)) < 0.05
          && (Math.round(barOffset) % 2 === 0);
        const isLong = ev.duration >= 1.5;
        if (isStrong || isLong) summary.avoidNotesOnDevelopStructural++;
        else                    summary.avoidNotesOnDevelopPassing++;
      }
      else if (origin === 'return') summary.avoidNotesOnReturn++;
    }
  }

  // Average tension per origin (rounded to 3 decimals so snapshot diff
  // stays readable).
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  summary.avgTensionByOrigin = {
    motif: summary.countByOrigin.motif > 0 ? round3(tensionSums.motif / summary.countByOrigin.motif) : 0,
    develop: summary.countByOrigin.develop > 0 ? round3(tensionSums.develop / summary.countByOrigin.develop) : 0,
    return: summary.countByOrigin.return > 0 ? round3(tensionSums.return / summary.countByOrigin.return) : 0,
  };

  return summary;
}

// ------------------------------------------------------------------
// Chord-quality classifier and per-mode legality lookup.
//
// classifyEngineChordType maps the engine's chord-type strings
// ('maj7', 'm7', '7', 'm7b5', ...) onto a coarse quality enum.
// CHORD_COLOR_DICTIONARY entries are parsed once at module load into
// MODE_DEGREE_QUALITY[mode][scaleDegree] = quality, letting
// decorateChordType filter style-driven candidates to those the
// chosen mode allows on that scale degree.
//
// The engine and dictionary use different vocabularies — engine type
// strings are explicit ('maj7', 'm7'), dictionary entries are
// Berklee-style ('Imaj7', 'V-7', 'bIII+maj7'). Both sides classify
// into ChordQuality and compare there.
// ------------------------------------------------------------------

export type ChordQuality = 'major' | 'minor' | 'minor7' | 'dominant' | 'halfDim' | 'diminished' | 'augmented';

export function classifyEngineChordType(type: string): ChordQuality {
  if (type === 'm7b5' || type === '7b5') return 'halfDim';
  if (type === 'dim' || type === 'dim7') return 'diminished';
  if (type === 'aug') return 'augmented';
  // Major variants — explicit 'maj' prefix or extension-marker names.
  if (/^maj/.test(type)) return 'major';
  if (type === 'add9' || type === 'add4' || type === '6' || type === '6/9' || type === 'sus4' || type === 'sus2') return 'major';
  // Minor families: split by whether the chord has a b7.
  //   minor7 (Dorian-flavored): m7 / m9 / m11 / m13 — chord's 7 IS b7 (10
  //     semis). degreeLabel '7' on these resolves to b7, NOT mMaj7.
  //     This matches the universal jazz convention ("the 7 of Dm7 is C")
  //     and Impro-Visor's minor7ScaleDegrees array.
  //   minor (melodic-minor-flavored): m / m6 / mMaj7 — chord has no b7
  //     (or has M7 = mMaj7). degreeLabel '7' resolves to 11 (M7 / natural).
  //
  // Order matters: longer prefixes first (mMaj7 must be matched before
  // m7 keyword check; we use suffix anchors to disambiguate).
  if (type === 'm' || type === 'm6' || /^mMaj/i.test(type) || type === 'madd9' || type === 'madd4') return 'minor';
  if (/^m/.test(type)) return 'minor7';
  // Dominant family: starts with a 7/9/11/13 number. 7sus / 9sus
  // inherit dominant character.
  if (/^(7|9|11|13)/.test(type)) return 'dominant';
  return 'major';
}

// ─────────────────────────────────────────────────────────────────────
// Chord-family degree resolver (Impro-Visor style).
// ─────────────────────────────────────────────────────────────────────
//
// Each chord family has a 12-position array indexed by semitones-above-
// root. Position N holds the canonical degree label for a note N semis
// above the chord root, INTERPRETED FROM THAT FAMILY'S PERSPECTIVE.
//
// Example: position 3 (= 3 semis above root) is:
//   Major family   : "b3"  (lowered 3rd — blue note relative to major 3)
//   Minor family   : "3"   (THE 3rd — small 3rd IS the family-default 3)
//   Dominant family: "b3"  (lowered 3rd — same blue note over dom)
//
// So "(X 3 8)" in a BillEvans grammar lick resolves DIFFERENTLY per
// chord family at play time — same lick fits major and minor chords
// without rewriting the grammar.
//
// Reverse lookup `resolveDegree(label, chordType) → semitones`: search
// the family's array for the first occurrence of `label`. This is the
// Impro-Visor NoteConverter.scaleDegreeToPitchClass mechanism.
//
// Sources:
//   - Impro-Visor (Robert M. Keller, Harvey Mudd College, GPL-2)
//     /imp/lickgen/NoteConverter.java::chordToArray + scaleDegreeToPitchClass
//     Mechanism studied, not code-copied.
//   - Levine 1995 — chord-family voicing default 3rds.
//
// The arrays are sparse: positions that don't have a canonical degree
// in that family are left as 'x' (no canonical label). Reverse-lookup
// of an explicit accidental like "b3" / "#11" finds it in any family
// that lists it; if absent the resolver falls back to the literal
// chromatic interpretation (b3 = 3 semis, 3 = 4 semis, etc.).

const MAJOR_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3     4    5    6     7    8     9    10    11
  '1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7',
];

// Minor family — for m / m6 / mMaj7 (no b7 in the chord, or M7 = mMaj7).
// degreeLabel '7' resolves to 11 (M7), matching mMaj7's chord 7th. The
// chromatic b7 is labeled 'b7' at position 10.
const MINOR_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3    4     5    6     7    8     9    10    11
  '1', 'b2', '2', '3', '#3', '4', '#4', '5', 'b6', '6', 'b7', '7',
//                  ↑ minor family: '3' is the SMALL 3rd (3 semis)
];

// Minor7 family — for m7 / m9 / m11 / m13 (chord 7 IS b7). degreeLabel
// '7' resolves to 10 (the chord's b7), NOT 11. Lifts the universal jazz
// convention "the 7 of Dm7 is C". The chromatic mMaj7 is labeled '#7'.
// Mirrors Impro-Visor NoteConverter's minor7ScaleDegrees: idx 10 = '7',
// idx 11 = '#7'.
const MINOR7_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3    4     5    6     7    8     9   10   11
  '1', 'b2', '2', '3', '#3', '4', '#4', '5', 'b6', '6', '7', '#7',
];

// Dominant family — chord 7 = b7. degreeLabel '7' resolves to 10 (b7);
// chromatic M7 labeled '#7' at position 11.
const DOMINANT_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3     4    5    6     7    8     9   10   11
  '1', 'b9', '9', '#9', '3', '4', '#11', '5', 'b13', '13', '7', '#7',
//                                                          ↑ dom family: '7' IS b7 (chord 7th)
// 1 = b9; 2 = 9; 3 = #9; 6 = #11; 8 = b13; 9 = 13; 10 = '7' (= b7); 11 = '#7' (= M7 chromatic)
];

// Half-dim family — chord 7 = b7. degreeLabel '7' resolves to 10.
const HALF_DIM_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3     4    5    6     7    8     9   10   11
  '1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', '7', '#7',
//                                  ↑ m7b5 has b5 not 5 / #4
];

const DIM_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3     4    5    6     7    8     9     10    11
  '1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', 'bb7', '6', '7',
//                                                  ↑ dim 7th is bb7 (= M6)
];

const AUG_DEGREE_ARRAY: readonly string[] = [
//  0     1    2    3     4    5    6     7    8    9    10    11
  '1', 'b2', '2', 'b3', '3', '4', '#4', 'b5', '#5', '6', 'b7', '7',
//                                              ↑ aug has #5 not 5
];

function chordToDegreeArray(quality: ChordQuality): readonly string[] {
  switch (quality) {
    case 'major':      return MAJOR_DEGREE_ARRAY;
    case 'minor':      return MINOR_DEGREE_ARRAY;
    case 'minor7':     return MINOR7_DEGREE_ARRAY;
    case 'dominant':   return DOMINANT_DEGREE_ARRAY;
    case 'halfDim':    return HALF_DIM_DEGREE_ARRAY;
    case 'diminished': return DIM_DEGREE_ARRAY;
    case 'augmented':  return AUG_DEGREE_ARRAY;
  }
}

// Literal accidental fallback table — used when degree label isn't
// found in the chord family's array. Lets explicit altered tensions
// (b9 / #11 / #9 / b13) resolve to literal semitones regardless of
// family.
const LITERAL_DEGREE_SEMITONES: Record<string, number> = {
  '1':  0,  'b2': 1, '2':  2, '#2': 3, 'b3': 3, '3':  4, '#3': 5,
  '4':  5,  '#4': 6, 'b5': 6, '5':  7, '#5': 8, 'b6': 8, '6':  9,
  '#6': 10, 'b7': 10, '7': 11,
  'b9': 1,  '9':  2,  '#9': 3,
  '11': 5,  '#11': 6,
  'b13': 8, '13': 9,
  'bb7': 9,
  // Aliases for the M7 / mMaj7 chromatic — when chord-family arrays use
  // '#7' (minor7, dominant, halfDim) for position 11, a lick written
  // 'M7' or 'maj7' must still resolve. All point at 11 semis.
  '#7': 11, 'M7': 11, 'maj7': 11,
};

/**
 * Resolve a BillEvans-style degree label to semitones-above-root,
 * using the chord's family table. Falls back to literal accidental
 * interpretation when the label isn't in the family table.
 *
 * Examples:
 *   resolveDegree("3", "maj7") → 4   (major family: position 4 = "3")
 *   resolveDegree("3", "m7")   → 3   (minor family: position 3 = "3" — small 3rd)
 *   resolveDegree("b3", "maj7") → 3  (literal — major 3rd is "3", b3 is blue note)
 *   resolveDegree("b9", "7")   → 1   (dominant family: position 1 = "b9")
 *   resolveDegree("9", "m7")   → 2   (minor: position 2 = "2"; falls back to literal "9"=2)
 */
// ─────────────────────────────────────────────────────────────────────
// Lick degree policy — per-chord-family allowlists for tone category.
// ─────────────────────────────────────────────────────────────────────
//
// Each chord family defines:
//   stable      — degrees that are CT (chord literal) or STABLE_COLOR
//                 (admissible color); always allowed.
//   conditional — degrees allowed ONLY weak-beat + short + resolves
//                 (chromatic / altered tensions). On strong/long
//                 without resolution → unresolved, lick rejected.
//   avoid       — degrees disallowed even weak-and-short unless they
//                 step-resolve to a CT. On strong/long → rejected.
//
// Rationale: BillEvans/Lovano licks were authored for SPECIFIC chord
// contexts. When the brick-tagged lick lands on a chord type whose
// stable color set differs, the projection produces dissonance that
// the lick author didn't intend. Examples:
//   - lick written for Cm7 (Dorian: b6 = avoid) projected onto Cmadd9
//     (no b6 admissible) → #5/b6 = AVOID
//   - lick written for G7 projected onto G7sus4 → 3 over sus = AVOID
//   - lick written for G7alt projected onto plain G7 → b13/#9 fine
//     on alt, conditional on plain 7
//
// Policy used by:
//   - musicEngine.ts pickMotif (reject licks exceeding style threshold)
//
// Source: Levine 1995 (chord-scale theory) + Caplin 1998 (functional
// dissonance treatment) + user direction "AVD weak+short+resolves OK".

export type LickToneCategory = 'CT' | 'STABLE_COLOR' | 'CONDITIONAL' | 'AVOID' | 'OTHER';

type DegreePolicy = {
  stable: string[];
  conditional: string[];
  avoid: string[];
};

export const LICK_DEGREE_POLICY: Record<string, DegreePolicy> = {
  // Major triads + maj7-family + add9/6/9 — chord 3 is M3 (4 semis),
  // chord 7 (when present) is M7. Avoid 4 (clashes with M3), b2 (root
  // cluster), #5 (= b6, breaks major quality).
  major_add: {
    stable: ['1', '3', '5', '6', '9'],
    conditional: ['7', '#4', '#11'],
    avoid: ['4', 'b2', '#5', 'b3'],
  },
  // Minor 7-family — chord 3 is m3, chord 7 is b7 (m7/m9/m11/m13/Dorian).
  // 11 stable (Dorian native), 9 stable. M6 conditional (Dorian birthright
  // but Aeolian context flag). b6 conditional (Aeolian native, Dorian
  // intrusion). #5 / #7 (= mMaj7) typically avoid on plain m7.
  minor_add: {
    stable: ['1', 'b3', '5', '9', '11', 'b7'],
    conditional: ['6', 'b6'],
    avoid: ['#5', '#7', '3', '7', 'b2'],
  },
  // Dominant 7-family — chord 3 is M3, chord 7 is b7. b9/#9/#11/b13/13
  // are alterations of the dom7 family that the chord MAY explicitly
  // declare (7b9, 7#11, etc.); for plain '7' they're conditional.
  // Avoid: 4 (= 11 natural, clashes with M3); #7 (= M7, breaks dom).
  dominant: {
    stable: ['1', '3', '5', 'b7'],
    conditional: ['b9', '9', '#9', '#11', 'b13', '13'],
    avoid: ['4', '#7'],
  },
  // Dominant sus (7sus4, 9sus4) — replaces 3 with 4. Chord 4 is stable,
  // 3 is conditional (only as 4→3 resolution, never long-stop).
  dominant_sus: {
    stable: ['1', '4', '5', 'b7', '9', '13'],
    conditional: ['3', 'b9', '#9'],
    avoid: ['#7', 'b13'],
  },
  // Half-diminished (m7b5) — chord 3 is m3, 5 is b5, 7 is b7.
  // 11 stable (Locrian #2), b13 conditional. #7/13 avoid.
  half_dim: {
    stable: ['1', 'b3', 'b5', 'b7'],
    conditional: ['b9', '11', 'b13'],
    avoid: ['#7', '13', '5'],
  },
  // Diminished 7 — chord 3 is m3, 5 is b5, 7 is bb7. Symmetric.
  diminished: {
    stable: ['1', 'b3', 'b5', 'bb7'],
    conditional: ['b9', '11', 'b13'],
    avoid: ['7', '5', '3'],
  },
};

/** Classify the engine's chord type string into a policy family. */
export function classifyLickPolicyFamily(chordType: string): keyof typeof LICK_DEGREE_POLICY {
  if (chordType === 'm7b5' || chordType === '9b5') return 'half_dim';
  if (chordType === 'dim' || chordType === 'dim7') return 'diminished';
  // Sus family — every sus-bearing chord routes to dominant_sus. Covers
  // sus2 / sus4 / Msus4 / 7sus4 / 9sus4 / 13sus4 / 7#5sus4 / m7sus4
  // (IV-vocab alias of 7sus4) AND bare '11' (sus11 spelling per IV vocab).
  // Without this, plain sus2/sus4 fall to major_add (where 4 is avoid),
  // m7sus4 falls to minor_add (where 4 is policy-not-stable), and '11'
  // falls to dominant (where 11 vs 3 m9 clash flagged as avoid).
  if (chordType.includes('sus') || chordType === '11') return 'dominant_sus';
  // Maj-prefixed (mMaj7 falls here too) → major_add
  if (/^maj/i.test(chordType) || /mMaj/.test(chordType)) return 'major_add';
  // Minor (m, m7, m9, m11, m13, madd9, m6, m6/9) — starts with 'm' but
  // not 'maj' (handled above) and not '*sus*' (handled above).
  if (/^m/.test(chordType)) return 'minor_add';
  // Dominant 7/9/13/alt — chord 3 is M3, chord 7 is b7. ('11' caught above.)
  if (/^(7|9|13)/.test(chordType)) return 'dominant';
  // Major triads + add9/6/9 → major_add.
  return 'major_add';
}

/** Map degree label to its policy category for the given chord type. */
export function classifyLickToneCategory(
  degreeLabel: string,
  chordType: string,
): LickToneCategory {
  const family = classifyLickPolicyFamily(chordType);
  const policy = LICK_DEGREE_POLICY[family];
  if (!policy) return 'OTHER';
  // Resolve degree to semitones to distinguish CT (in chord literal)
  // from STABLE_COLOR (in stable list but not chord literal).
  const semis = resolveDegree(degreeLabel, chordType);
  const litIvs = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const isCT = litIvs.some(iv => (iv % 12) === (semis % 12));
  if (policy.stable.includes(degreeLabel)) return isCT ? 'CT' : 'STABLE_COLOR';
  if (policy.conditional.includes(degreeLabel)) return 'CONDITIONAL';
  if (policy.avoid.includes(degreeLabel)) return 'AVOID';
  // Unknown label → fall back to CT-if-literal, else OTHER
  return isCT ? 'CT' : 'OTHER';
}

/**
 * Per-style acceptance thresholds for the policy filter. Stricter for
 * mainstream styles, looser for jazz where conditional tensions are
 * expected.
 */
export const LICK_ACCEPT_POLICY: Record<string, { maxUnresolvedAvoid: number; maxUnresolvedConditional: number }> = {
  POP:   { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 1 },
  RNB:   { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 1 },
  LOFI:  { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 0 },
  JAZZ:  { maxUnresolvedAvoid: 1, maxUnresolvedConditional: 3 },
  BLUES: { maxUnresolvedAvoid: 1, maxUnresolvedConditional: 2 },
};

/**
 * Dry-run a lick on a chord and count unresolved violations.
 *
 * Per-note logic:
 *   CT / STABLE_COLOR  → always OK.
 *   CONDITIONAL        → OK if (weak beat AND short) OR resolves to CT
 *                        on next note; otherwise unresolved CONDITIONAL.
 *   AVOID              → OK only if (weak AND duration ≤ 0.25) AND
 *                        resolves to CT; otherwise unresolved AVOID.
 *   OTHER              → counted as unresolved CONDITIONAL.
 *
 * "Resolves" = next note's pc is a chord literal AND step ≤ 2 semitones
 * (half/whole step). The "next note" is the next note in the same lick
 * slice; for the last note of a slice (bar boundary), resolution check
 * uses the next bar's first note's chord (caller wires this).
 *
 * Returns { unresolvedAvoid, unresolvedConditional, total }.
 */
export function evaluateLickOnChord(
  slice: Array<{ t: number; d: number; degreeLabel?: string; chromaticOffset?: number }>,
  chordType: string,
  beatsPerMeasure: number = 4,
  nextNoteAfterSlice: { degreeLabel?: string; chromaticOffset?: number; chordType?: string } | null = null,
): { unresolvedAvoid: number; unresolvedConditional: number; total: number } {
  let unresolvedAvoid = 0;
  let unresolvedConditional = 0;
  const litIvs = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const strongMid = beatsPerMeasure / 2;
  const isStrong = (t: number) => {
    const beat = Math.floor(t);
    const frac = t - beat;
    return (beat === 0 || Math.abs(beat - strongMid) < 0.01) && frac < 0.05;
  };
  for (let i = 0; i < slice.length; i++) {
    const n = slice[i];
    if (!n.degreeLabel) continue;
    const cat = classifyLickToneCategory(n.degreeLabel, chordType);
    if (cat === 'CT' || cat === 'STABLE_COLOR') continue;
    const strong = isStrong(n.t);
    const long = n.d >= 0.5;
    const next = (i + 1 < slice.length) ? slice[i + 1] : nextNoteAfterSlice;
    let resolves = false;
    if (next && next.degreeLabel !== undefined) {
      const currSemis = resolveDegree(n.degreeLabel, chordType);
      const nextChordType = (next as any).chordType ?? chordType;
      const nextSemis = resolveDegree(next.degreeLabel, nextChordType);
      const step = Math.abs(nextSemis - currSemis);
      const nextLitIvs = CHORD_TYPES[nextChordType] ?? litIvs;
      const nextIsCT = nextLitIvs.some(iv => (iv % 12) === (nextSemis % 12));
      resolves = nextIsCT && step <= 2;
    }
    if (cat === 'AVOID') {
      // Allow only weak + d ≤ 0.25 + resolves
      const allowed = !strong && n.d <= 0.25 && resolves;
      if (!allowed) unresolvedAvoid++;
    } else { // CONDITIONAL or OTHER
      // Allow if (weak AND short) OR resolves
      const allowed = (!strong && !long) || resolves;
      if (!allowed) unresolvedConditional++;
    }
  }
  return { unresolvedAvoid, unresolvedConditional, total: slice.length };
}

/**
 * Count "HARD" avoid notes a lick would project on the given chord:
 * an avoid note IS HARD when it lands on the bar's strong beat (0 or
 * mid-bar) AND lasts ≥ 0.5 beat. Short / weak-beat avoid notes are
 * jazz-idiomatic passing tones — not counted.
 *
 * Used by the engine's pre-pick filter to drop licks that would create
 * structural-position dissonance against the current chord. Lick notes
 * stay verbatim (per the one-step-projection rule); the filter only
 * affects WHICH lick is picked from the brick pool.
 *
 * `chordDuration` is the chord's beat length (4 in 4/4 normal bar,
 * 2 in ii-V split bar). Notes whose t falls outside the chord's window
 * are ignored (they belong to the next bar's chord).
 *
 * `beatsPerMeasure` is the song meter's bpm (typically 4). Strong-beat
 * positions are 0 and beatsPerMeasure/2.
 */
export function countLickHardAvoidsForChord(
  lickNotes: Array<{ t: number; d: number; chromaticOffset?: number; degreeLabel?: string }>,
  chordRootPc: number,
  chordType: string,
  chordDuration: number,
  effectiveFunc: 'T' | 'S' | 'D' | string,
  beatsPerMeasure: number = 4,
  isModalContext: boolean = false,
  scaleName: string = '',
): number {
  const rootPc = ((chordRootPc % 12) + 12) % 12;
  const strongBeatMid = beatsPerMeasure / 2;
  let count = 0;
  for (const n of lickNotes) {
    if (n.t >= chordDuration - 0.001) continue;
    if (n.d < 0.5) continue;
    const beat = Math.floor(n.t);
    const frac = n.t - beat;
    const isStrong = (beat === 0 || Math.abs(beat - strongBeatMid) < 0.01) && frac < 0.05;
    if (!isStrong) continue;
    const offset = n.degreeLabel
      ? resolveDegree(n.degreeLabel, chordType)
      : (n.chromaticOffset ?? 0);
    const pc = (((rootPc + offset) % 12) + 12) % 12;
    const interval = (((pc - rootPc) % 12) + 12) % 12;
    if (isAvoidNote(interval, chordType, scaleName, isModalContext, effectiveFunc)) {
      count++;
    }
  }
  return count;
}

export function resolveDegree(label: string, chordType: string): number {
  const quality = classifyEngineChordType(chordType);
  const array = chordToDegreeArray(quality);
  const idx = array.indexOf(label);
  if (idx >= 0) return idx;
  // Family doesn't define this label → fall back to literal accidental
  const literal = LITERAL_DEGREE_SEMITONES[label];
  if (literal !== undefined) return literal;
  // Truly unknown label → root (defensive)
  return 0;
}

/**
 * Get the effective chromatic offset for a motif note in the context of
 * a chord. This is the single dispatch point for chord-family-aware
 * degree resolution:
 *
 *   - If the note has degreeLabel, resolve via chord family
 *     (Impro-Visor mechanism — "3" snaps to small-3rd on minor chords)
 *   - Else fall back to the eagerly-parsed chromaticOffset (literal)
 *
 * Every engine projection site that converts a motif note to a pitch
 * class or MIDI MUST go through this helper instead of reading
 * `note.chromaticOffset` directly — otherwise the family-aware behavior
 * silently bypasses on that path.
 */
export function effectiveChromaticOffset(
  note: { chromaticOffset?: number; degreeLabel?: string },
  chordType: string,
): number {
  if (note.degreeLabel) return resolveDegree(note.degreeLabel, chordType);
  return note.chromaticOffset ?? 0;
}

const ROMAN_TO_DEGREE: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
};

// Parse a CHORD_COLOR_DICTIONARY entry like 'Imaj7' / 'V-7' / 'bIIImaj7'
// / 'V°7' into its scale degree and quality classification.
function parseColorDictEntry(entry: string): { scaleDegree: number; quality: ChordQuality } | null {
  let s = entry;
  if (s[0] === 'b' || s[0] === '#') s = s.slice(1);

  const match = s.match(/^([IVivx]+)/i);
  if (!match) return null;
  const scaleDegree = ROMAN_TO_DEGREE[match[1].toUpperCase()];
  if (!scaleDegree) return null;

  const tail = s.slice(match[1].length);

  let quality: ChordQuality;
  if (tail.includes('°')) quality = 'diminished';
  else if (tail.includes('-7b5') || tail.includes('ø') || tail.startsWith('m7b5')) quality = 'halfDim';
  else if (tail.includes('+')) quality = 'augmented';
  else if (tail.startsWith('-')) quality = 'minor';
  else if (tail.includes('maj')) quality = 'major';
  else if (tail.match(/^\d/)) quality = 'dominant';
  else quality = 'major';

  return { scaleDegree, quality };
}

const RAW_MODE_DEGREE_QUALITY: Record<string, Record<number, ChordQuality>> = (() => {
  const out: Record<string, Record<number, ChordQuality>> = {};
  for (const [modeKey, entry] of Object.entries(CHORD_COLOR_DICTIONARY)) {
    const map: Record<number, ChordQuality> = {};
    for (const chordStr of Object.values(entry.chords)) {
      const parsed = parseColorDictEntry(chordStr as string);
      if (parsed) map[parsed.scaleDegree] = parsed.quality;
    }
    out[modeKey] = map;
  }
  return out;
})();

// Map alternate mode names back into the dictionary keys. styleDictionary's
// progressions table uses 'Major' / 'Minor' as keys, while the dictionary
// uses 'Maj/Ionian' / 'minor/Aeolian'. M3a-resolved exotic modes
// ('Dorian', 'Phrygian', ...) match dictionary keys directly.
const MODE_NAME_NORMALIZE: Record<string, string> = {
  Ionian: 'Maj/Ionian',
  Major: 'Maj/Ionian',
  Aeolian: 'minor/Aeolian',
  Minor: 'minor/Aeolian',
};

export function getModeDegreeQuality(mode: string, scaleDegree: number): ChordQuality | null {
  const normalized = MODE_NAME_NORMALIZE[mode] ?? mode;
  return RAW_MODE_DEGREE_QUALITY[normalized]?.[scaleDegree] ?? null;
}

export function chordTypeFitsMode(mode: string, scaleDegree: number, engineType: string): boolean {
  const expected = getModeDegreeQuality(mode, scaleDegree);
  if (expected === null) return true; // unknown mode → never reject
  return classifyEngineChordType(engineType) === expected;
}

/**
 * Default engine-type representative for each chord quality. Used as a
 * fallback when the style's candidate list contains nothing the active
 * mode allows — playing a mode-correct triad/seventh is preferable to
 * playing a style-flavoured but wrong-quality chord.
 */
export function qualityToDefaultEngineType(q: ChordQuality): string {
  // Default to 7-chord variants (m7 / maj7 / 7) over bare triads.
  // This is the mode-aware fallback when the style's candidate pool
  // doesn't match the diatonic position — at that point we're already
  // beyond the style's preferred triad register, so a richer 7-chord
  // is a closer fit to "jazz-style" idiom. POP / BLUES that genuinely
  // want bare triads get them from explicit colorChoices entries at
  // level 0, NOT from this fallback.
  //
  // Phase F audit discovery: JAZZ.T dictionary only has maj-quality
  // rule, so iii/vi (diatonic minor T) get filtered out → fallback
  // here. Returning 'min' triad disrupted JAZZ idiom (Audit showed
  // 188/320 = 58% 'min' output instead of expected m7/m9/m11).
  switch (q) {
    case 'major':      return 'maj7';
    case 'minor':      return 'm7';
    case 'dominant':   return '7';
    case 'halfDim':    return 'm7b5';
    case 'diminished': return 'dim';
    case 'augmented':  return 'aug';
  }
}

/**
 * Filter style-driven substitution candidates through mode legality.
 *
 * Order of preference:
 *   1. Candidates that pass the mode's quality check (style-flavoured
 *      AND mode-correct).
 *   2. The default engine type for the mode's expected quality
 *      (mode-correct but generic — kicks in when the style's map has
 *      no usable option, e.g. Pop Ballad's I substitutions are all
 *      major-family but Mixolydian needs dominant-family).
 *   3. The original unfiltered candidates as a last-ditch fallback,
 *      used only when the mode + degree pair has no dictionary entry.
 */
export function getModeAwareSubstitutions(
  candidates: string[],
  mode: string,
  scaleDegree: number,
): string[] {
  if (candidates.length === 0) return candidates;
  const filtered = candidates.filter((t) => chordTypeFitsMode(mode, scaleDegree, t));
  if (filtered.length > 0) return filtered;

  const expected = getModeDegreeQuality(mode, scaleDegree);
  if (expected !== null) return [qualityToDefaultEngineType(expected)];

  return candidates;
}

// ------------------------------------------------------------------
// Chord backbone — root + 3rd + 5th of the chord. The architectural
// rule for melody target selection: only backbone tones can land on
// strong beats or phrase ends. Color tones (2/4/6/7/9/11/13) are
// allowed as passing motion on weak beats.
//
// 3rd is minor-or-major depending on chord quality; 5th is b5 for
// dim/m7b5, #5 for aug, otherwise natural P5. The classifier here
// shadows classifyEngineChordType but is more direct since we only
// need the structural triad intervals.
// ------------------------------------------------------------------

export function getChordBackboneIntervals(chordType: string): number[] {
  const isMinor = chordType === 'min'
               || (chordType.startsWith('m') && !chordType.startsWith('maj'))
               || chordType === 'm7b5' || chordType === 'dim' || chordType === 'dim7';
  const isDim = chordType === 'dim' || chordType === 'dim7' || chordType === 'm7b5';
  const isAug = chordType === 'aug';
  const third = isMinor ? 3 : 4;
  const fifth = isDim ? 6 : isAug ? 8 : 7;
  return [0, third, fifth];
}

// ------------------------------------------------------------------
// Theory advisor helpers — pure functions used to ground chord-voicing
// and tension-resolution decisions in classical voice-leading rules.
//
// findCommonTones — pitch classes shared between two chords. Drives
//   voicings that hold shared tones across chord transitions (smoother
//   voice leading, classical/jazz comping principle).
//
// getVoiceLeadingPenalty — numeric roughness score for a voice-by-voice
//   MIDI transition. Higher = rougher. Penalises octave+ leaps and
//   voice-count mismatches. Used as the cost function inside
//   voiceLeadingSmoother when scoring candidate voicings.
//
// getResolutionTargets — typed accessor over INTERVAL_AESTHETICS'
//   expectedResolutions field for a given interval (semitones from key
//   root). Empty array for stable/anchor intervals (1, 3, 5). Used by
//   the engine's tension-driven correction step.
// ------------------------------------------------------------------

export function findCommonTones(chordAPcs: number[], chordBPcs: number[]): number[] {
  const aSet = new Set(chordAPcs.map((pc) => ((pc % 12) + 12) % 12));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const raw of chordBPcs) {
    const pc = ((raw % 12) + 12) % 12;
    if (aSet.has(pc) && !seen.has(pc)) {
      seen.add(pc);
      result.push(pc);
    }
  }
  return result;
}

export function getVoiceLeadingPenalty(prevMidi: number[], nextMidi: number[]): number {
  if (prevMidi.length === 0 || nextMidi.length === 0) return 0;
  const pairs = Math.min(prevMidi.length, nextMidi.length);
  let penalty = 0;
  for (let i = 0; i < pairs; i++) {
    const delta = Math.abs(prevMidi[i] - nextMidi[i]);
    penalty += delta;
    if (delta > 12) penalty += (delta - 12) * 2; // octave+ leaps double-penalised
  }
  // Voice count change (thinning / thickening) is rougher than smooth motion.
  penalty += Math.abs(prevMidi.length - nextMidi.length) * 3;
  return penalty;
}

export function getResolutionTargets(intervalSemitones: number): number[] {
  const pc = ((intervalSemitones % 12) + 12) % 12;
  const rule = INTERVAL_AESTHETICS[pc];
  return rule?.expectedResolutions ?? [];
}

// ------------------------------------------------------------------
// Divisi 2.0 — Harmonic state machine middleware.
//
// Stage 3 of the engine pipeline emits a chord with an upper-voicing
// shell + a real bass MIDI. The bass anchor doesn't always match the
// upper chord's root (voice-leading smoothing or style-driven bass
// rules can move the bass freely), so the actual sounding chord is
// often a slash voicing — Cmaj7/E, Cmaj7/G, F/G, etc. The melody and
// texture engines can't keep treating these like root-position triads
// without producing low-frequency clashes (Smart Omit) or missing
// the suspended-dominant magnetism (Composite virtual extensions).
//
// evaluateTensionState is the pure middleware: takes the upper root,
// the upper-shell pc set, the actual bassPc, the original TSD function
// label, and the song's global key root. Returns one of four tension
// states plus an effective TSD function override and an optional list
// of virtual extension intervals (in SEMITONES from the bass) that
// downstream magnetism is allowed to land on.
//
//   Solid       — bass = root. Standard root-position chord.
//   Flowing     — bass = chord 3rd (major or minor). First inversion;
//                 texture should Smart-Omit the 3rd from chord stabs
//                 to avoid low-freq doubling, and cadence Tier B
//                 should NOT force a 1/3/5 landing (let it flow).
//   Preparation — bass = chord 5th. Second inversion (cadential 6/4);
//                 inject dominant tension by overriding func to D.
//   Composite   — bass is OUTSIDE the upper-shell (real slash chord
//                 like F/G or Bb/C). Functional identity may be
//                 overridden (suspended dominant → D, pedal-on-key
//                 → T, upper-structure → D), and virtual extensions
//                 expose color tones for melody magnetism.
// ------------------------------------------------------------------

// HarmonicState 字符串值的学术对应:
//   'Solid'          — 根位 (root position)
//   'FirstInversion' — 一转位, 3 in bass. 旧名 'Flowing'.
//                      Sources: Schenker; Aldwell-Schachter "Harmony & Voice Leading".
//   'Cadential64'    — 二转位/终止四六, 5 in bass, 强制 D-function.
//                      旧名 'Preparation'. Sources: Rameau 1722;
//                      Caplin 1998 "Classical Form" (cadential dominant).
//   'SlashChord'     — bass 在 upper-shell 之外 (F/G, D/C, pedal).
//                      旧名 'Composite'. Sources: Russell 1953 LCC;
//                      Levine 1995 ch.4 (upper-structure / pedal).
export type TensionState = 'Solid' | 'FirstInversion' | 'SecondInversion' | 'Cadential64' | 'SlashChord';

export interface HarmonicState {
  tensionState: TensionState;
  effectiveFunc: 'T' | 'S' | 'D';
  // Intervals from the BASS pitch class, in semitones (NOT mod-12 —
  // we keep upper-octave values so MIDI candidates can be computed
  // directly via bassMidi + semis). Empty / undefined when the state
  // doesn't introduce virtual color (i.e. Solid / FirstInversion /
  // Cadential64, or SlashChord without a recognized override pattern).
  virtualExtensions?: number[];
}

export function evaluateTensionState(
  upperRootPc: number,
  chordPcs: Set<number>,
  bassPc: number,
  originalFunc: 'T' | 'S' | 'D',
  globalKeyRoot: number,
  roman?: string,
): HarmonicState {
  const upper = ((upperRootPc % 12) + 12) % 12;
  const bass = ((bassPc % 12) + 12) % 12;
  const keyRoot = ((globalKeyRoot % 12) + 12) % 12;

  // Path A — bass IS one of the upper-shell tones (internal inversion).
  if (chordPcs.has(bass)) {
    const bassIntervalToRoot = (bass - upper + 12) % 12;
    if (bassIntervalToRoot === 0) {
      return { tensionState: 'Solid', effectiveFunc: originalFunc };
    }
    if (bassIntervalToRoot === 3 || bassIntervalToRoot === 4) {
      return { tensionState: 'FirstInversion', effectiveFunc: originalFunc };
    }
    if (bassIntervalToRoot === 7) {
      // P5-in-bass = second inversion (6/4 chord). True Cadential64
      // only when the chord is the tonic I/i (Caplin 1998: I64 over
      // V is functionally V's 6/4 suspension resolving to V53). Other
      // T-class chords (iii / vi etc. — T substitutes) get plain
      // SecondInversion since iii64 / vi64 are passing 6/4, not
      // cadential.
      //
      // roman === 'I' / 'i' check is strict — secondary I (e.g. V/X
      // resolving to a borrowed I) is rare in our progressions and
      // wouldn't reach here anyway (slash chord path uses /X notation).
      const isTonicChord = roman !== undefined
        && (roman === 'I' || roman === 'i');
      if (isTonicChord && originalFunc === 'T') {
        return { tensionState: 'Cadential64', effectiveFunc: 'D' };
      }
      return { tensionState: 'SecondInversion', effectiveFunc: originalFunc };
    }
    // 7th in bass (10 / 11 semitones) or other tones — inversion but
    // no functional override.
    return { tensionState: 'FirstInversion', effectiveFunc: originalFunc };
  }

  // Path B — bass is OUTSIDE the upper-shell (real slash chord).
  // deltaFromBass = how far the upper root sits above the bass (mod 12).
  const deltaFromBass = (upper - bass + 12) % 12;
  let newFunc: 'T' | 'S' | 'D' = originalFunc;
  let vExts: number[] = [];

  // Rule 1 — Suspended dominant pattern (F/G, Dm/G, etc.). Upper root
  // sits a m7 (10) or P5 (7) above the bass. The audible chord is
  // a sus-flavored dominant on the BASS pitch; melody is allowed to
  // magnetize onto b7 / 9 / 11 / 13 of that bass.
  if (deltaFromBass === 10 || deltaFromBass === 7) {
    newFunc = 'D';
    vExts = [10, 14, 17, 21]; // b7, 9, 11, 13 in semitones from bass
  }
  // Rule 2 — pedal point on the global tonic. Whatever the upper
  // chord, the bass lock to key root makes it function as T.
  else if (bass === keyRoot) {
    newFunc = 'T';
  }
  // Rule 3 — Upper Structure dominant (D/C: upper root a M2 above the
  // bass). Strong dominant injection with 9 / 13 (= 6) accents.
  // Source: Levine 1995 ch.4.
  else if (deltaFromBass === 2) {
    newFunc = 'D';
    vExts = [14, 21]; // 9 and 13 in semitones from bass
  }

  return {
    tensionState: 'SlashChord',
    effectiveFunc: newFunc,
    ...(vExts.length > 0 ? { virtualExtensions: vExts } : {}),
  };
}

// ------------------------------------------------------------------
// Chord-type interval lookup. Maps engine chord-type names (e.g. 'maj7',
// 'm9', '7alt') to their pitch-class intervals from the chord root.
// Pure data — no engine state. Used by voice leading, melody contract
// computation, cadence resolution, and chord-quality classification.
// ------------------------------------------------------------------

export const CHORD_TYPES: Record<string, number[]> = {
  'maj': [0, 4, 7],
  'min': [0, 3, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
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
  '13sus4': [0, 5, 7, 10, 14, 21],   // root 4 5 b7 9 13 — dom13 with 4 replacing 3 (Dorian raised-6 IV signature)
  '7b13': [0, 4, 7, 10, 14, 20],
  '13': [0, 4, 7, 10, 14, 21],
  '7#9': [0, 4, 7, 10, 15],
  '7alt': [0, 4, 10, 13, 15, 20],
  'm11': [0, 3, 7, 10, 14, 17],
  'maj13': [0, 4, 7, 11, 14, 21],
  '6': [0, 4, 7, 9],
  '6/9': [0, 4, 7, 9, 14],
  // Sus interpretation (matches IV vocab): root + 4 + 5 + b7 + 9. The
  // 4 acts as the 11. NO M3 — keeping 3 would put it a m9 below the 11
  // and make the chord audibly dissonant. Callers wanting a true dom11
  // sound should use '13' (3 implies b7+13, no 11 clash) or stay on '9'.
  '11': [0, 5, 7, 10, 14],
  '13b9': [0, 4, 7, 10, 13, 21],
  '7#11': [0, 4, 7, 10, 18],
  'm9b5': [0, 3, 6, 10, 14],
  'm7sus4': [0, 5, 7, 10],
  '7#5': [0, 4, 8, 10],
  'maj7#11': [0, 4, 7, 11, 18],
  '7b9': [0, 4, 7, 10, 13],
  'maj9#11': [0, 4, 7, 11, 14, 18],

  // ------- Stage D #6 — extras curated from tonal chord-type (MIT) -------
  // Cherry-picked from the ~100-entry tonal dictionary for actual idiom
  // coverage; obscure types (M7b6, sus2add9b5, etc.) intentionally
  // skipped. Voicing tables (JAZZ_ROOTLESS / POP / BLUES / RNB) fall
  // through to default heuristics for these — explicit entries can be
  // added later if listener finds the auto handling off.
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
  // 就是 madd9。之前字典缺这条 → audit 报 'min → (none)' 109 次。补上
  // 后 drift 重新归类为 'extension-added'(健康的 divisi 行为)。
  'madd9':     [0, 3, 7, 14],          // minor add 9 (no 7) — Bill Evans m triad
};

// ------------------------------------------------------------------
// CHORD_TYPE_ALIASES — input-string → canonical chord type mapping.
//
// What: maps the many ways a chord type can be written
// ('Maj7' / '^7' / 'M7' / 'Δ7' / 'major seventh') to our 32 canonical
// chord-type names (the keys of CHORD_TYPES). Used by
// normalizeChordType() to accept user-typed lead-sheet input.
//
// Why: needed when an external surface (UI input, lyric sheet
// parsing, user motif override) accepts chord names. Our internal
// canonical names (`maj7`, `m7`, `7#9` etc.) are a subset of common
// industry usage; without alias normalization a user typing 'Maj7'
// would miss our 'maj7' key.
//
// Source: alias spelling list compiled from tonal `@tonaljs/chord-type`
// data.ts (MIT). Reduced to the 32 types we actually use.
// ------------------------------------------------------------------
export const CHORD_TYPE_ALIASES: Record<string, readonly string[]> = {
  'maj':       ['M', '^', 'maj', 'major'],
  'min':       ['m', 'min', '-', 'minor'],
  'dim':       ['dim', 'o', '°', 'diminished'],
  'aug':       ['aug', '+', 'augmented'],
  'maj7':      ['maj7', 'Maj7', 'M7', '^7', 'Δ', 'Δ7', 'ma7', 'major seventh'],
  'm7':        ['m7', 'min7', 'mi7', '-7', 'minor seventh'],
  '7':         ['7', 'dom7', 'dominant seventh'],
  'm7b5':      ['m7b5', 'ø', 'ø7', 'min7b5', 'half-diminished', 'm7(b5)'],
  'dim7':      ['dim7', 'o7', '°7', 'fully diminished'],
  'add9':      ['add9', 'add2', 'Madd9', 'majadd9'],
  'm9':        ['m9', 'min9', '-9', 'minor ninth'],
  'maj9':      ['maj9', 'Maj9', 'M9', 'Δ9', '^9', 'major ninth'],
  '9':         ['9', 'dom9', 'dominant ninth'],
  'sus4':      ['sus4', 'sus', '4'],
  '7sus4':     ['7sus4', '7sus'],
  '9sus4':     ['9sus4', '9sus'],
  '7b13':      ['7b13', '7(b13)'],
  '13':        ['13', 'dom13'],
  '7#9':       ['7#9', '7(#9)', 'Hendrix'],
  '7alt':      ['7alt', 'alt', '7altered'],
  'm11':       ['m11', 'min11', '-11', 'minor eleventh'],
  'maj13':     ['maj13', 'Maj13', 'M13', 'Δ13', '^13', 'major thirteenth'],
  '6':         ['6', 'M6', 'add6', 'major sixth'],
  '6/9':       ['6/9', '69', '6add9', 'M6/9', 'M69'],
  '11':        ['11', 'dom11'],
  '13b9':      ['13b9', '13(b9)'],
  '7#11':      ['7#11', '7(#11)'],
  'm9b5':      ['m9b5', 'min9b5', 'm9(b5)'],
  'm7sus4':    ['m7sus4', 'msus7'],
  '7#5':       ['7#5', '7(#5)', '7+5'],
  'maj7#11':   ['maj7#11', 'M7#11', '^7#11', 'Δ#11', 'maj7(#11)'],
  '7b9':       ['7b9', '7(b9)'],
  'maj9#11':   ['maj9#11', 'M9#11', '^9#11'],
  // Stage D #6 — new chord types
  'sus2':      ['sus2', '2'],
  '5':         ['5', 'power', 'powerchord'],
  '7b5':       ['7b5', '7(b5)'],
  '9#5':       ['9#5', '9+5', '9(#5)'],
  '9#11':      ['9#11', '9(#11)', '9+11'],
  '13#11':     ['13#11', '13(#11)'],
  '7#9#11':    ['7#9#11', '7(#9#11)', '7#9b5', '7#11#9'],
  'mMaj9':     ['mMaj9', 'mM9', '-Δ9', '-maj9'],
  'm13':       ['m13', 'min13', '-13', 'minor thirteenth'],
  'm6/9':      ['m6/9', 'm69', 'min6/9'],
  'quartal':   ['quartal', '4', 'q4'],
  'madd9':     ['madd9', 'min(add9)', 'm(add9)', 'minor add9'],
};

// Reverse lookup table (alias → canonical). Built once at module
// load. CASE-SENSITIVE on purpose: 'M7' = major-seventh but 'm7' =
// minor-seventh — collapsing case would conflate them. Lowercase
// fallback applies only when no exact case-sensitive match exists.
const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const canonical of Object.keys(CHORD_TYPES)) out[canonical] = canonical;
  for (const [canonical, aliases] of Object.entries(CHORD_TYPE_ALIASES)) {
    for (const a of aliases) out[a] = canonical;
  }
  return out;
})();

/**
 * Resolve a user-typed chord type string to its canonical key in
 * CHORD_TYPES, or null when no alias matches.
 *
 * Case-sensitive on the first pass to preserve the M/m distinction
 * ('M7' = major seventh, 'm7' = minor seventh); falls back to
 * lowercase match only for strings that don't include an uppercase
 * M-followed-by-digit pattern (so 'MAJOR' / 'MAJ7' lowercased still
 * resolve, but 'M7' never becomes 'm7' by accident).
 *
 * @example
 *   normalizeChordType('Maj7')   // => 'maj7'
 *   normalizeChordType('M7')     // => 'maj7'   (NOT 'm7' — case matters)
 *   normalizeChordType('m7')     // => 'm7'
 *   normalizeChordType('Δ')      // => 'maj7'
 *   normalizeChordType('-7')     // => 'm7'
 *   normalizeChordType('7(#11)') // => '7#11'
 *   normalizeChordType('foo')    // => null
 */
export function normalizeChordType(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed in ALIAS_TO_CANONICAL) return ALIAS_TO_CANONICAL[trimmed];
  // Block lowercase-fallback for M<digit> — collapsing case would
  // misroute 'M7' → 'm7'. Same for plain 'M' (major triad alias).
  if (/^M(\d|$)/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  return ALIAS_TO_CANONICAL[lower] ?? null;
}

// ------------------------------------------------------------------
// JAZZ_ROOTLESS_VOICINGS — Bill Evans "A-position" voicing pool.
//
// What: per chord type, the pitch-set the comping should play under
// rootless mode. Semitones from chord root; bass owns the root
// (interval 0 deliberately absent). Used only when a style's
// compingVoicingMode === 'rootless'; other modes never reach this
// table.
//
// Why: the bare "drop root" heuristic just removes interval 0 and
// slices the first four upper intervals. That misses Bill Evans's
// signature moves —
//   - dominants drop 5 (acoustically redundant w/ bass) and add 13
//     (= 6M), so V7 reads as "3 13 b7 9" rather than "3 5 b7 9"
//   - maj7 / m7 always include 9 even when the chord type doesn't
//     spell it (since the bass anchors the literal, the comping
//     gets to extend)
//   - 7b9 / 7b13 substitute b13 (= b6) for the 5
//   - 7#11 (Lydian dominant) stacks 7-9-#11-13 with no 3 — high
//     and bright, the signature
//   - half-dim / dim / aug keep the root for stability (their
//     identity is fragile without it)
//
// Source: tonal voicing-dictionary (Daniel Gómez Blasco et al,
// MIT). `lefthand` table data adapted to our chord-type names.
// See docs/References.md "Tonal voicing-dictionary".
// ------------------------------------------------------------------
export const JAZZ_ROOTLESS_VOICINGS: Record<string, number[]> = {
  // maj family — always include 9
  'maj':       [4, 7, 14],          // 3 5 9
  'maj7':      [4, 7, 11, 14],      // 3 5 7M 9
  'maj9':      [4, 7, 11, 14],
  'maj13':     [4, 7, 11, 14, 21],  // 3 5 7M 9 13
  'maj7#11':   [4, 11, 14, 18],     // 3 7M 9 #11 (drop 5, Lydian color)
  'maj9#11':   [4, 11, 14, 18],
  '6':         [4, 7, 9, 14],       // 3 5 6 9
  '6/9':       [4, 7, 9, 14],
  'add9':      [4, 7, 14],

  // min family — always include 9
  'min':       [3, 7, 14],          // b3 5 9
  'm7':        [3, 7, 10, 14],      // b3 5 b7 9
  'm9':        [3, 7, 10, 14],
  'm11':       [3, 10, 14, 17],     // b3 b7 9 11 (drop 5)

  // dom family — drop 5, lean on 13 (= 6M) and 9
  '7':         [4, 9, 10, 14],      // 3 13 b7 9   (Bill Evans A)
  '9':         [4, 9, 10, 14],
  '13':        [4, 9, 10, 14],      // pc-identical to 9 once 13 is in
  '7b9':       [4, 9, 10, 13],      // 3 13 b7 b9
  '7#9':       [4, 9, 10, 15],      // 3 13 b7 #9
  '13b9':      [4, 9, 10, 13],
  '7b13':      [4, 8, 10, 13],      // 3 b13 b7 b9
  '7#5':       [4, 8, 10, 14],      // 3 #5 b7 9
  '7#11':      [4, 10, 14, 18],     // 3 b7 9 #11 — chord-identity guard: dom needs 3
  '7alt':      [4, 10, 13, 15, 20], // 3 b7 b9 #9 b13 (altered stack)
  // '11' chord — sus interpretation (matches IV vocab + the m9 clash
  // between 3 and 11 cannot be voiced cleanly). 4 b7 9 11 — 4 acts as
  // the sus, 11 octaves up the 4. Callers wanting dom-with-color should
  // use '9' (b7 + 9 with 3 intact) or '13'.
  '11':        [5, 10, 14, 17],     // 4 b7 9 11 — sus11 identity

  // half-dim / dim / aug — keep root; identity is fragile rootless
  'm7b5':      [0, 3, 6, 10],
  'm9b5':      [0, 3, 6, 10, 14],
  'dim':       [0, 3, 6],
  'dim7':      [0, 3, 6, 9],
  'aug':       [0, 4, 8],

  // sus
  'sus4':      [5, 7, 14],          // 4 5 9
  '7sus4':     [5, 10, 14],         // 4 b7 9
  '9sus4':     [5, 10, 14],
  'm7sus4':    [5, 10, 14],
};

// ------------------------------------------------------------------
// POP_VOICINGS — full-extension pop comping idiom.
//
// What: per chord type, the pitch-set comping plays under 'full' mode.
// Semitones from chord root (includes root since POP comping plays
// over the bass rather than dividing labor with it). Used only when
// a style's compingVoicingMode === 'full'.
//
// Why: POP piano idiom does NOT divide labor the way jazz does.
// Vocal melody floats over a comping that voices the full chord —
// add9 keeps its 9, maj9 keeps its 7+9, sus chords keep all notes.
// The 'shell' mode's strip-and-let-melody-fill logic is the wrong
// philosophy here. 'full' mode delivers the chord verbatim.
//
// The table only enumerates chord types where pop idiom DIVERGES
// from raw CHORD_TYPES (currently just '11' to dodge the 11/3 b9
// avoid clash by suspending the 3). Everything else falls through
// to CHORD_TYPES[activeType] unchanged.
//
// Source: standard pop piano lead-sheet practice (Hal Leonard pop
// piano series; Coldplay / Adele / Sara Bareilles transcriptions).
// ------------------------------------------------------------------
export const POP_VOICINGS: Record<string, number[]> = {
  // '11' is voiced via the sus interpretation in CHORD_TYPES (4 b7 9 11,
  // no M3) — no pop-specific override needed.
};

// ------------------------------------------------------------------
// RNB_VOICINGS — Neo-Soul / D'Angelo / Glasper signature voicings.
//
// What: lookup table that augments the 'cluster' compingVoicingMode
// for chord types where the bare cluster heuristic (slice(1, 5))
// would discard the signature Neo-Soul color tone. Semitones from
// chord root.
//
// Why: the cluster heuristic "drop root + take next 4" works fine
// for maj9 / m9 / 6/9 (the upper four ARE 3/5/7/9). But for m11,
// 13, 7b13, 7#11, 7alt, 9sus4 the heuristic drops the very note
// that defines the chord:
//   - m11's 11 (D'Angelo "Untitled" signature) — heuristic gives
//     b3 5 b7 9, missing the 11
//   - 13's 13 (V13 R&B punch) — heuristic gives 3 5 b7 9, missing 13
//   - 7b13's b13 (altered tension) — heuristic keeps natural 5
//   - 9sus4's 11 (Glasper sus voicing) — heuristic gives 4 5 b7 9
//
// This table provides the corrected voicings for those types only;
// chord types not listed fall through to the cluster heuristic.
//
// Source: D'Angelo / Glasper / Erykah Badu transcriptions (Neo-Soul
// piano idiom); NOT copied from any specific transcription — a
// generic Neo-Soul cluster pattern applied across chord types.
// ------------------------------------------------------------------
export const RNB_VOICINGS: Record<string, number[]> = {
  'm11':       [3, 10, 14, 17],       // b3 b7 9 11 — D'Angelo Untitled signature
  '13':        [4, 10, 14, 21],       // 3 b7 9 13 — drop 5 to make room for 13
  '13b9':      [4, 10, 13, 21],
  '7b13':      [4, 10, 13, 20],       // 3 b7 9b b13 — full altered tension
  '7alt':      [4, 10, 13, 15, 20],   // 3 b7 b9 #9 b13
  '7#11':      [4, 10, 14, 18],       // 3 b7 9 #11
  'maj13':     [4, 11, 14, 21],       // 3 7 9 13 — Glasper maj13
  'maj9#11':   [4, 11, 14, 18, 21],   // 3 7 9 #11 13
  '9sus4':     [5, 10, 14, 17],       // 4 b7 9 11 — Glasper sus voicing
  '11':        [5, 10, 14, 17],       // 4 b7 9 11 — sus11 (matches 9sus4)
};

// ------------------------------------------------------------------
// BLUES_VOICINGS — boogie / shuffle piano right-hand comping.
//
// What: per chord type, the pitch-set the right hand plays when the
// left hand is running a boogie_pattern bass (root-3-5-6-b7-5-3-root
// or similar 8th-note walk). Semitones from chord root.
//
// Why: with the left hand owning the 5 in the bass walk, the right
// hand drops the 5 on dominant chords to make room for the blues
// alterations (9 / b9 / #9 / b13) and the 3+b7 guide tones. The
// "horn shout" voicing (root + 3 + b7 + 9) is the boogie / barrelhouse
// signature. Triads / m7 / maj7 keep their fifths since they don't
// need to clear space for tension.
//
// Source: standard boogie-woogie piano comping (Otis Spann / Mose
// Allison / Memphis Slim transcriptions); Hal Leonard blues piano
// series. NOT copied from any specific transcription verbatim —
// a generic boogie/barrelhouse pattern applied across chord types.
// ------------------------------------------------------------------
export const BLUES_VOICINGS: Record<string, number[]> = {
  // Triads / quality 7-chords — keep all (no dominant tension to make room for)
  'maj':       [0, 4, 7],
  'min':       [0, 3, 7],
  'dim':       [0, 3, 6],
  'aug':       [0, 4, 8],
  'maj7':      [0, 4, 7, 11],
  'm7':        [0, 3, 7, 10],
  'maj9':      [0, 4, 7, 11, 14],
  'm9':        [0, 3, 7, 10, 14],
  'm11':       [0, 3, 7, 10, 14, 17],
  'maj13':     [0, 4, 7, 11, 14, 21],
  'm7b5':      [0, 3, 6, 10],
  'm9b5':      [0, 3, 6, 10, 14],
  'dim7':      [0, 3, 6, 9],
  'mM7':       [0, 3, 7, 11],
  'add9':      [0, 4, 7, 14],
  '6':         [0, 4, 7, 9],
  '6/9':       [0, 4, 7, 9, 14],

  // Dominant chords — drop 5, emphasize 3+b7 guide tones + upper color
  '7':         [0, 4, 10],            // root + 3 + b7
  '9':         [0, 4, 10, 14],        // boogie horn-shout: root + 3 + b7 + 9
  '13':        [0, 4, 10, 14, 21],    // + 13
  '7b9':       [0, 4, 10, 13],
  '7#9':       [0, 4, 10, 15],        // Hendrix chord
  '7b13':      [0, 4, 10, 20],
  '7#5':       [0, 4, 8, 10],
  '7#11':      [0, 4, 10, 14, 18],
  '7alt':      [0, 4, 10, 13, 15, 20],
  '13b9':      [0, 4, 10, 13, 21],
  'maj7#11':   [0, 4, 7, 11, 18],
  'maj9#11':   [0, 4, 7, 11, 14, 18],

  // sus — bass owns root, comping has 4 + b7 + extensions
  'sus4':      [0, 5, 7],
  '7sus4':     [0, 5, 10],
  '9sus4':     [0, 5, 10, 14],
  '11':        [0, 5, 10, 14],
  'm7sus4':    [0, 5, 7, 10],
};

// ------------------------------------------------------------------
// Global-harmony contract — under the divisi model, "stable" expands
// from 1/3/5 backbone to chord literal + admissible color extensions
// per quality (maj→9, min→9/11, dom→9/13, dim/aug stay narrow). Used
// by color magnetism (candidate pool for non-cadence structural notes)
// and by classifyCadenceTier downstream of the engine.
// ------------------------------------------------------------------

export function computeGlobalContract(chordType: string, chordRootPc: number): { intervals: number[]; pcs: Set<number> } {
  const literal = CHORD_TYPES[chordType] || CHORD_TYPES['maj'];
  const intervals: number[] = [...literal];
  const isHalfDim = chordType === 'm7b5' || chordType === 'm9b5';
  const isMin = !isHalfDim && (chordType === 'min'
      || (chordType.startsWith('m') && !chordType.startsWith('maj') && chordType !== 'maj'));
  const isDim = chordType === 'dim' || chordType === 'dim7';
  const isDom = !isMin && !isDim && !isHalfDim
      && (chordType === '7' || chordType === '9' || chordType.startsWith('7'));
  const isMaj = !isMin && !isDim && !isHalfDim && !isDom && chordType !== 'aug';
  // Admissible color set (jazz convention — chord quality 决定哪些
  // tensions 是"声音内的色彩"):
  //   maj 家族: + 9 + 13 + #11 (Lydian color)
  //   min 家族: + 9 + 11 + 13 + b7 (m7 implied) + b6 (Aeolian mode 借用)
  //   dom 家族: + 9 + 13 + b9 + #9 + #11 + b13 (altered tensions — 老师
  //              "ALT 和弦不就是 b9/b13?" 哲学; jazz V chord 上 alt
  //              tension 皆合法).
  //   halfDim (m7b5): + 11 + b6 (Locrian — m7b5 的母调).
  //   dim / aug: 保留窄.
  if (isMaj) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(9))  intervals.push(9);    // 13 (mod-12)
      if (!intervals.includes(18)) intervals.push(18);   // #11 (Lydian)
  }
  if (isMin) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(17)) intervals.push(17);   // 11
      if (!intervals.includes(9))  intervals.push(9);    // 13 (mod-12)
      if (!intervals.includes(10)) intervals.push(10);   // b7 (m7 implied)
      // b6 (= pc 8) 抛弃 — 按物理法则跟 chord 5 形成小九度碰撞 (avoid).
      // 之前为 Aeolian mode 借用加宽到 admissible 是妥协, 物理法则下纠正:
      // b6 在小和弦上是 avoid, 仅 modal context + Aeolian/Phrygian/Locrian
      // 等特征音名单内才豁免 (走 MODAL_CHARACTERISTIC_NOTES 路径).
  }
  if (isDom) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(21)) intervals.push(21);   // 13
      // Altered tensions — 老师 ALT 哲学.
      if (!intervals.includes(13)) intervals.push(13);   // b9
      if (!intervals.includes(15)) intervals.push(15);   // #9
      if (!intervals.includes(18)) intervals.push(18);   // #11
      if (!intervals.includes(20)) intervals.push(20);   // b13
  }
  if (isHalfDim) {
      if (!intervals.includes(17)) intervals.push(17);   // 11 (Locrian)
      if (!intervals.includes(20)) intervals.push(20);   // b13 (= Locrian b6)
  }
  const rootPc = ((chordRootPc % 12) + 12) % 12;
  const pcs = new Set(intervals.map((i) => (((rootPc + i) % 12) + 12) % 12));
  return { intervals, pcs };
}

// ------------------------------------------------------------------
// Cadence resolution (Definition 4: dynamic context-aware cadence).
//
// Phrase ends are punctuation marks. Different harmonic functions at
// the cadence position carry different expectations:
//
//   Tier A — Global End on T (剧终绝对回归)
//     Final bar of the song landing on a tonic-function chord.
//     Force the listener home to the GLOBAL key tonic (or 3rd of the
//     key, also stable). Period.
//
//   Tier B — Phrase End on T (句号 / 归宿落地)
//     Authentic / deceptive cadence — the harmonic story has come
//     home. The melody yields to the chord's literal 1/3/5 (no upper
//     extensions). Even if mid-bar magnetism would have allowed a 9 /
//     11 / 13 landing, the cadential moment demands plain backbone.
//
//   Tier C — Phrase End on D or S (问号 / 省略号)
//     Half cadence (V at phrase end) or open S landing — the story is
//     unfinished. Tension is structural, not a defect. If the melody's
//     current pitch is already inside the chord's extended contract,
//     leave it alone (preserve the suspension); if not, snap softly to
//     the contract (extensions allowed).
//
//   none
//     Not a phrase-end position. No cadence resolution applies; magnet
//     and other corrections handle the note normally.
//
// Style-level note: characteristic notes (Blues b3 / b7, Jazz #11, etc)
// are NOT part of cadence candidates. Style flavor lives in passing
// tones and non-cadence color magnetism; cadence is purely chord-driven.
// ------------------------------------------------------------------

export type CadenceTier = 'A_global_T' | 'B_phrase_T' | 'C_phrase_DS' | 'none';

/**
 * Per-bar phrase role from detectPhrases + Period 识别。驱动 Cadence
 * Tier 选择,替代旧的"每 motifInterval bar 一次"硬切。
 *
 *   song_end           — 整曲最后一 bar
 *   antecedent_end     — Period 的 antecedent 末尾 (问号, force C)
 *   consequent_end     — Period 的 consequent 末尾 (句号, B 或 C 按 func)
 *   phrase_end_through — ThroughComposed phrase 末尾 (按 func 默认逻辑)
 *   mid_phrase         — phrase 内部 (无 cadence)
 */
export type PhraseRole = 'song_end' | 'antecedent_end' | 'consequent_end'
                       | 'phrase_end_through' | 'mid_phrase';

export function classifyCadenceTier(opts: {
  isGlobalEnd: boolean;
  isPhraseEndNote: boolean;
  func: 'T' | 'S' | 'D';
  isLastChordT: boolean;
  /** 当传入时,phraseRole 优先于默认 isPhraseEndNote/isGlobalEnd 逻辑。
   * Period antecedent 强制 Tier C (问号 / preserve-tension),
   * consequent + T 落 Tier B (句号 / 1-3-5 force),
   * song_end + T 落 Tier A (剧终)。 */
  phraseRole?: PhraseRole;
}): CadenceTier {
  // phraseRole 驱动路径 (Phase 5 — Caplin period semantics)
  if (opts.phraseRole !== undefined) {
    switch (opts.phraseRole) {
      case 'mid_phrase': return 'none';
      case 'song_end':   return opts.func === 'T' ? 'A_global_T' : 'none';
      case 'antecedent_end': return 'C_phrase_DS';  // 强制问号
      case 'consequent_end': return opts.func === 'T' ? 'B_phrase_T' : 'C_phrase_DS';
      case 'phrase_end_through': /* fall through to default */ break;
    }
  }
  // 默认路径 (无 phraseRole 时 — 兼容外部调用 + ThroughComposed phrase-end)
  if (!opts.isPhraseEndNote) return 'none';
  if (opts.isGlobalEnd && opts.isLastChordT) return 'A_global_T';
  if (opts.func === 'T') return 'B_phrase_T';
  return 'C_phrase_DS';
}

export function cadenceTargetPcs(
  tier: CadenceTier,
  chordType: string,
  chordRootPc: number,
  opts: { keyRootPc: number; keyIsMinor: boolean }
): { pcs: Set<number>; mode: 'force' | 'preserve-tension' } {
  if (tier === 'A_global_T') {
    const keyThird = opts.keyIsMinor ? 3 : 4;
    const keyRoot = ((opts.keyRootPc % 12) + 12) % 12;
    return {
      pcs: new Set([keyRoot, ((keyRoot + keyThird) % 12 + 12) % 12]),
      mode: 'force',
    };
  }
  if (tier === 'B_phrase_T') {
    const backbone = getChordBackboneIntervals(chordType);
    const rootPc = ((chordRootPc % 12) + 12) % 12;
    return {
      pcs: new Set(backbone.map((i) => (((rootPc + i) % 12) + 12) % 12)),
      mode: 'force',
    };
  }
  if (tier === 'C_phrase_DS') {
    return {
      pcs: computeGlobalContract(chordType, chordRootPc).pcs,
      mode: 'preserve-tension',
    };
  }
  return { pcs: new Set<number>(), mode: 'preserve-tension' };
}

// ------------------------------------------------------------------
// Tonic strength classification for Period antecedent/consequent
// detection.
//
// Caplin 1998 "Classical Form" 区分:
//   strong T  — I / i (root position tonic). Period consequent 必落
//               strong T (闭合,句号感).
//   weak T    — iii / vi (mediant / submediant 替代). Period antecedent
//               可落 weak T (开放,逗号感) — 听觉上 "未到家"。
//   nonTonic  — S / D function chords.
//
// 边界情况:
//   - I/3, I/5 (转位)  → 仍归 strong (字面是 tonic chord)
//   - Imaj7 / i7      → strong (chord type 不影响根音强度)
//   - V/X (secondary)  → nonTonic (harmonicFunctionFromRoman → 'D')
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Phrase detection from harmonic flow.
//
// Phrase boundary 不是 bar 计数,是 TSD 循环闭合事件:经过 D 之后
// 落到 T,且下一个 chord 启动新 S/D 循环(或段尾)。Caplin 1998 把
// phrase 定义为以 cadence 收束的功能单元 — phrase length 由和声决
// 定,常见 4 / 8 bar 但 6 / 10 / 13 等不规则也合法。
//
// 例:IV-V-iii-vi-ii-V-I-I (8 bar)
//   S → D → T(弱) → T(过渡) → S → D → T → T
//   bar 4 落 vi (弱 T) 后,bar 5 又起 S = TSD 循环重启
//   ⇒ 切两段:bar 0-3 (antecedent, 开放) + bar 4-7 (consequent, 闭合)
//   ⇒ Period
//
// Period 识别:对称偶数长度 + 中点落 weak T 或 D (开放) + 末尾落
// strong T (闭合)。其他情况归 ThroughComposed (含短 phrase / 不对称 /
// 单 TSD 循环)。
// ------------------------------------------------------------------

export type PhraseType = 'Period' | 'ThroughComposed';

export interface PhraseSegment {
  startBar: number;
  endBar: number;
  type: PhraseType;
  /** 仅 Period 类型有值;= startBar + length/2 - 1 */
  antecedentEndBar?: number;
}

// 结构类型 — 仅需 roman + effectiveFunc。避免引入 musicEngine 依赖。
interface ChordLikeForPhrase {
  roman: string;
  effectiveFunc?: 'T' | 'S' | 'D';
}

// 跟 musicEngine.harmonicFunctionFromRoman 同语义,但 musicTheory 不
// 应反向导入 — 这里独立实现一遍。两处一致性由 phrase 单测保护。
function harmonicFunctionFromRomanLocal(roman: string): 'T' | 'S' | 'D' {
  const base = roman.split('/')[0]
      .replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (['V', 'v', 'vii', 'VII'].includes(base) || roman.includes('/')) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
  return 'T';
}

const funcOf = (c: ChordLikeForPhrase): 'T' | 'S' | 'D' =>
    c.effectiveFunc ?? harmonicFunctionFromRomanLocal(c.roman);

/**
 * 扫描和弦进行的强终止点 (strong cadence),产出 PhraseSegment[]。
 *
 * Phrase 边界规则 (D→strong T):
 *  - 当前 chord 是 strong T (I / i / I7 etc.,排除 iii/vi 等 weak T)
 *  - 此前经过 D-function chord (i.e. 这是一个 authentic cadence)
 *  - 下一个 chord 是 S/D (新循环) 或已是段尾
 *  → 切 phrase 边界。
 *
 * 弱终止 (D→weak T 如 V→vi deceptive) 不切外层 phrase,而是
 * 在 classifyPhrase 中作为 Period antecedent 的内部 cadence 识别。
 *
 * 段尾强制切边 (即使没经过 D),避免悬空。
 */
export function detectPhrases<T extends ChordLikeForPhrase>(chords: T[]): PhraseSegment[] {
  if (chords.length === 0) return [];
  const segments: PhraseSegment[] = [];
  let start = 0;
  let seenD = false;
  for (let i = 0; i < chords.length; i++) {
    const f = funcOf(chords[i]);
    if (f === 'D') seenD = true;
    const isLast = i === chords.length - 1;
    const nextF: 'T' | 'S' | 'D' | null = isLast ? null : funcOf(chords[i + 1]);
    const restart = nextF === 'S' || nextF === 'D';
    const strongTHere = f === 'T' && tonicStrength(chords[i].roman) === 'strong';
    const isStrongCadence = seenD && strongTHere && (restart || isLast);
    if (isStrongCadence || isLast) {
      segments.push(classifyPhrase({ startBar: start, endBar: i }, chords));
      start = i + 1;
      seenD = false;
    }
  }
  return segments;
}

function classifyPhrase<T extends ChordLikeForPhrase>(
  raw: { startBar: number; endBar: number },
  chords: T[],
): PhraseSegment {
  const len = raw.endBar - raw.startBar + 1;
  // Period 必要条件:对称偶数长度 ≥ 4,中点 open,末尾 closed strong T。
  if (len >= 4 && len % 2 === 0) {
    const mid = raw.startBar + len / 2 - 1;
    const midC = chords[mid];
    const lastC = chords[raw.endBar];
    const midF = funcOf(midC);
    const lastF = funcOf(lastC);
    const midOpen = midF === 'D' || (midF === 'T' && tonicStrength(midC.roman) === 'weak');
    const lastClosed = lastF === 'T' && tonicStrength(lastC.roman) === 'strong';
    if (midOpen && lastClosed) {
      return { ...raw, type: 'Period', antecedentEndBar: mid };
    }
  }
  return { ...raw, type: 'ThroughComposed' };
}

export type TonicStrength = 'strong' | 'weak' | 'nonTonic';

export function tonicStrength(roman: string): TonicStrength {
  if (!roman) return 'nonTonic';
  // 同 harmonicFunctionFromRoman 的 base 抽取:剥掉 slash 段 + 类型后缀
  // + 数字。保留大小写以区分大调/小调级数。
  const base = roman.split('/')[0]
      .replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (base === 'I' || base === 'i') return 'strong';
  if (base === 'iii' || base === 'III' || base === 'vi' || base === 'VI'
      || base === 'bIII' || base === 'bVI') return 'weak';
  return 'nonTonic';
}

// Snap a MIDI pitch to the nearest scale tone whose pitch class is in
// targetPcs. Searches across the runScale (which already encodes the
// chord-aware octave coverage) so the result respects the active scale
// AND the cadence target. Falls back to mNoteMidi unchanged when no
// candidate is found (defensive — should not happen with non-empty pcs).

export function snapMidiToNearestPc(mNoteMidi: number, targetPcs: Set<number>, runScale: number[]): number {
  if (targetPcs.size === 0 || runScale.length === 0) return mNoteMidi;
  let best = mNoteMidi;
  let bestDist = Infinity;
  for (const sm of runScale) {
    const pc = (((sm % 12) + 12) % 12);
    if (!targetPcs.has(pc)) continue;
    const d = Math.abs(sm - mNoteMidi);
    if (d < bestDist) { bestDist = d; best = sm; }
  }
  return bestDist === Infinity ? mNoteMidi : best;

}

// —— Loop 6 港追加:StyleName(原在 styleDictionary.ts:372)——
export type StyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
