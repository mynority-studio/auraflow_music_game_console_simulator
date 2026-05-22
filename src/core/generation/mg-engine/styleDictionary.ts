// Reference frame for motif projection.
//
//   'chord_root' (default) — motif's diatonicStep / chromaticOffset is
//     interpreted relative to the CURRENT CHORD ROOT. This is what the
//     existing curated motif data assumes (e.g. RNB ends[5] comment
//     "Let the 11th ring" meaning the 11 of the chord). Step N maps to
//     scale degree N from chord root via runScale.
//
//   'global_key' (opt-in) — motif's offset is interpreted relative to
//     the SONG KEY's scale (key-traced horizontal melody). Useful for
//     specific pop / classical melodies that have a single underlying
//     contour with chord changes happening UNDER the line. The engine
//     applies a vertical shield (snap-to-non-avoid) when key-traced
//     pitches collide with the current chord's avoid notes.
//
// Default omitted = 'chord_root'. Existing motif data without `ref`
// behaves exactly as before (chord-relative).
export type MotifRef = 'chord_root' | 'global_key';

/**
 * G5: Bass role for a chord in a progression template. Default 'root'
 * (back-compat with pre-G5 templates). Non-root values represent
 * intentional inversions (Pachelbel descent, gospel walk-up, slash
 * chord syntax). Bass Planner resolves to actual bass pc via
 * isBassEligibleFor + the chord's intervals.
 */
export type BassRole = 'root' | '3rd' | '5th' | '7th' | 'pedal';

export interface ChordSkeletonSlot {
  roman: string;
  type: string;
  scaleDegree: number;
  rootOffset: number;
  /** Optional. Default 'root'. */
  bassRole?: BassRole;
  /** Required iff bassRole='pedal'. Pitch class 0..11. */
  bassPedalPc?: number;
  /**
   * Optional duration in beats. Defaults to the meter's
   * beatsPerMeasure (= one full bar). Two slots with beats=2 in 4/4
   * pack into a single bar (= harmonic-rhythm split). Beats values
   * inside a single bar should sum to beatsPerMeasure but the engine
   * doesn't enforce that — irregular pickups are allowed.
   *
   * Hand-authored progression templates leave beats undefined (one
   * chord per bar). A downstream Tonicization Planner is the
   * intended writer when it splits a bar to insert a secondary
   * dominant / ii-V approach.
   */
  beats?: number;
}

import { ChordQuality } from '../af2-engine/music-theory';

export interface DiatonicMotifNote {
  t: number;
  d: number;
  diatonicStep: number;
  ref?: MotifRef;
  // Per-note bypass — when true, this note is exempt from the
  // engine's structural-position contract enforcement. Authors use
  // this to protect intentional chromatic colors (e.g. #11 of a
  // Lydian Dominant) that would otherwise be snapped onto contract
  // by the in-chord-contract / no-avoid hard filters. Set via the
  // "!" suffix in defineMotif (e.g. "#11!") or via rule-level
  // bypassStructuralSnap (applies to all notes in the motif).
  bypassSnap?: boolean;
}

export interface ChromaticMotifNote {
  t: number;
  d: number;
  chromaticOffset: number;
  ref?: MotifRef;
  bypassSnap?: boolean;
}

export type MotifNote = DiatonicMotifNote | ChromaticMotifNote;

// =====================================================================
// MotifContextRules + MotifDef + defineMotif() — the "context-aware
// motif" upgrade. Lets motif data carry an explicit context contract
// (which chord qualities / TSD functions it's appropriate for) so the
// engine's pre-filter can reject unsuitable candidates before scoring.
// =====================================================================

export interface MotifContextRules {
  /** Allowed chord qualities (engine's classifyEngineChordType). */
  allowedQualities?: ChordQuality[];
  /** Allowed TSD harmonic functions (chord.effectiveFunc). */
  allowedTSD?: ('T' | 'S' | 'D')[];
  /** Apply bypassSnap to ALL notes in this motif. Use for motifs
   *  whose entire pitch shape is a chromatic statement (Altered lick,
   *  Lydian Dominant motif) and shouldn't be touched by structural
   *  enforcement. */
  bypassStructuralSnap?: boolean;
  /** Pair identifier — couples this motif with a partner. Format:
   *  '<pairName>:<role>' (e.g. 'rocket-feather:rocket' /
   *  'rocket-feather:feather'). When phrase plan picks a motif with
   *  pairId, the next bar (same pairName, opposite role) is preferred
   *  if a matching candidate exists in the next bar's pool. Falls
   *  through to normal pick when no partner is available. */
  pairId?: string;
}

export interface MotifDef {
  description?: string;
  notes: any[];
  rules: MotifContextRules;
}

// Chromatic interval label → semitone offset (literal, not key-aware).
// Used by defineMotif for accidentals and extended labels.
const CHROMATIC_MAP: Record<string, number> = {
  'b2': 1,  '#2': 3,  'b3': 3,  '#4': 6,  'b5': 6,
  '#5': 8,  'b6': 8,  'b7': 10,
  'b9': 13, '9':  14, '#9': 15, '11': 17, '#11': 18,
  'b13': 20, '13': 21,
};

/**
 * Author-friendly motif builder. Smart pitch dispatch:
 *   - Naked digit "1" / "2" / ... / "7" → DIATONIC step (auto-adapts
 *     to chord/mode via runScale rotation; same motif sounds correct
 *     in major / minor / Dorian / etc.)
 *   - Accidental label "b3" / "#11" / "b9" → CHROMATIC offset (literal
 *     semitones from chord root, fixed regardless of mode)
 *   - "c10" / "d4" prefix → explicit chromatic-offset / diatonic-step
 *     escape hatches
 *   - Trailing "!" → set per-note bypassSnap (e.g. "#11!" protects
 *     the #11 from being snapped on structural beats)
 *
 * Time advances automatically by rhythmPattern[i].
 *
 *   defineMotif(["1", "3", "5"], [0.5, 0.5, 1.0],
 *               { allowedQualities: ['major'] },
 *               "C major arpeggio")
 *
 *   defineMotif(["b3", "5", "1"], [0.5, 0.5, 1.0],
 *               { allowedQualities: ['minor'] },
 *               "Minor 1-b3-5 arpeggio")
 *
 *   defineMotif(["#11!", "5", "1"], [1.0, 1.0, 2.0],
 *               { allowedQualities: ['major'], allowedTSD: ['T'] },
 *               "Lydian #11 statement (do not snap the #11)")
 */
export function defineMotif(
  pitchLogic: (string | number)[],
  rhythmPattern: number[],
  rules: MotifContextRules = {},
  description?: string,
): MotifDef {
  if (pitchLogic.length !== rhythmPattern.length) {
    throw new Error(`[defineMotif] Length mismatch: ${pitchLogic.length} pitches vs ${rhythmPattern.length} rhythms.`);
  }

  let t = 0;
  let hasChromatic = false;
  const notes: any[] = pitchLogic.map((p, i) => {
    const d = rhythmPattern[i];
    const note: any = { t, d };
    let pStr = String(p);

    // "!" suffix → bypassSnap on this note
    if (pStr.endsWith('!')) {
      note.bypassSnap = true;
      pStr = pStr.slice(0, -1);
    } else if (rules.bypassStructuralSnap) {
      note.bypassSnap = true;
    }

    // Naked 1-7 → diatonicStep (key-adaptive)
    const diatonicMatch = pStr.match(/^([1-7])$/);
    if (diatonicMatch) {
      note.diatonicStep = parseInt(diatonicMatch[1], 10) - 1;
    } else if (CHROMATIC_MAP[pStr] !== undefined) {
      note.chromaticOffset = CHROMATIC_MAP[pStr];
      hasChromatic = true;
    } else if (pStr.startsWith('c')) {
      note.chromaticOffset = parseInt(pStr.slice(1), 10);
      hasChromatic = true;
    } else if (pStr.startsWith('d')) {
      note.diatonicStep = parseInt(pStr.slice(1), 10);
    } else {
      throw new Error(`[defineMotif] Unknown pitch label: ${p}`);
    }

    t += d;
    return note;
  });

  // Ambiguity warn — if motif uses degree-quality-defining tones
  // (3 / b3 / 7 / b7 / 6 / b6) without allowedQualities, the same
  // motif could play wrong over different chord types.
  if (hasChromatic && (!rules.allowedQualities || rules.allowedQualities.length === 0)) {
    const qualityDefining = pitchLogic.some(p => {
      const s = String(p).replace('!', '');
      return ['3', 'b3', '7', 'b7', '6', 'b6'].includes(s);
    });
    if (qualityDefining) {
      console.warn(`[defineMotif] Motif uses quality-defining accidentals without allowedQualities (${pitchLogic.join(',')}); may clash on incompatible chord types. desc: ${description ?? 'N/A'}`);
    }
  }

  return { description, notes, rules };
}

// Phrase-role classification of motifs. Real-world phrasing has
// "起承合" structure — a phrase opens with a gesture (start), develops
// through running material (flow), and resolves on a landing (end).
// When a sub-style provides this classification, the engine assembles
// a phrase by drawing each bar from the role-appropriate pool instead
// of treating every motif as interchangeable.
//
// Sub-styles that don't provide a motifPool fall back to the legacy
// flat `motifs` array — both fields can coexist on a profile so the
// migration is incremental, not all-or-nothing.
// Each role accepts EITHER a raw motif-note array (legacy / array
// shorthand) OR a MotifDef wrapper (with rules). The selectBestMotif
// pre-filter inspects rules; raw arrays are treated as wildcards.
// Both forms can mix freely within the same pool array.
export interface MotifPool {
  starts: (any[] | MotifDef)[];
  flows:  (any[] | MotifDef)[];
  ends:   (any[] | MotifDef)[];
}

export type StyleCategory = 'Pop & Contemporary' | 'Jazz & Blues' | 'R&B & Soul' | 'Electronic & Beat' | 'macro';

// Public API: four macro styles. Each is a pooled aggregate of its
// constituent sub-styles (see _SUBSTYLES below). The engine and UI
// only ever reference these four names.
export type StyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB';

export interface StyleProfile {
  name: string;
  category: StyleCategory;
  description: string;
  availableModes?: string[];
  defaultMode?: string;
  /**
   * Progression templates. Each chord skeleton carries:
   *   roman / type / scaleDegree / rootOffset — chord identity
   *   bassRole? — intentional inversion (default 'root'). Values:
   *     'root' (default — bass anchors chord root)
   *     '3rd'  (1st inversion — bass plays 3 / b3)
   *     '5th'  (2nd inversion — bass plays 5 / b5)
   *     '7th'  (3rd inversion — bass plays b7 / maj7)
   *     'pedal' — bass holds a fixed pc regardless of chord (use bassPedalPc)
   *   bassPedalPc? — only when bassRole='pedal'. Pitch class 0..11.
   *
   * Bass Planner (G5) reads these to pick bass anchor pc via
   * resolveBassAnchorPc(); BasslineRules then build the actual bass MIDI
   * line on top of that anchor. Templates without bassRole get default
   * 'root' (no behavior change from pre-G5 era).
   */
  progressions?: Record<string, ChordSkeletonSlot[][]>;
  
  // Rhythm & Groove
  tempoRange: [number, number];
  timeSignature: [number, number];
  grooveType: 'straight' | 'swing' | 'shuffle' | 'dilla'; 
  accentMode: 'downbeat' | 'backbeat' | 'syncopated' | 'fourOnTheFloor' | 'clave';
  syncopationLevel: number; 

  // Harmony & Melody
  harmonyComplexity: number; 
  colorLevelProbabilities: { level0: number, level1: number, level2: number };
  scalePreference: string[]; 
  characteristicNotes: string[]; 
  avoidNotesRule: 'STRICT' | 'RELAXED' | 'JAZZ' | 'MODAL';

  // Arrangement & Texture
  primaryTextures: string[];
  
  // Phrasing & Motif
  phraseLengths: number[];    
  rhythmicDensity: number;    
  motifStyle: string;         
  recommendedBars: number;
  motifs: (any[] | MotifDef)[];

  // Optional phrase-role-classified motif pool. When present and
  // strategy='regular', the engine assembles each 4-bar chunk as
  // start → flow → flow|derive(start) → end. When absent, the engine
  // falls back to the legacy flat `motifs` array.
  motifPool?: MotifPool;

  // Harmony & Scales
  scaleMapping: {
    T: Record<string, string[]>; // Tonic chord types -> possible scales
    S: Record<string, string[]>; // Subdominant chord types -> possible scales
    D: Record<string, string[]>; // Dominant chord types -> possible scales
  };

  // Optional fill-scale palette per macro per chord function. Used by
  // Run Generator and in-bar passing-tone insertion to inject style
  // flavor into FILL notes (passing/connecting tones). Backbone notes
  // (strong beat / long / phrase end) still go through scaleMapping
  // and the chord-color contract — this is fill-only.
  //
  // POP defaults to natural major/minor modes (per user direction);
  // Pentatonic is available as an extra option. RNB centers on
  // Pentatonic + Mixolydian b6 for the soul flavor. JAZZ uses Bebop
  // scales (8-tone with chromatic passing built in). BLUES retains
  // its existing Blues / Major Blues palette anchored on key root.
  fillScales?: {
    T: Record<string, string[]>;
    S: Record<string, string[]>;
    D: Record<string, string[]>;
  };

  // Tension & Resolution
  tensionResolutionStrategy: {
    preference: 'immediate' | 'delayed' | 'chromatic' | 'modal';
    description: string;
  };

  // Global Scale Mapping for Melody (Logic Pro style global chord track mapping)
  globalMelodyScaleMapping?: Record<string, string[]>;

  // ----- Optional declarative fields. Undefined disables the feature. -----

  // Per-roman color substitution map keyed by colorLevel. The engine reads
  // this in decorateChordType to pick a chord type for each scale degree
  // at the rolled colorLevel; styles without an entry fall back to Pop
  // Ballad's map.
  colorChoices?: Record<string, Record<number, string[]>>;

  // Bassline technique references. Each entry points to a rule registered
  // in COMMON_TECHNIQUES.basslines. Weights drive a weighted random pick
  // of one rule for the whole song. Undefined → DEFAULT_BASSLINE_RULE.
  basslineRules?: { ref: string; weight: number }[];

  // Per-phrase probability of inserting a V/<target> tonicization plus
  // governor parameters. Undefined → tonicization disabled (locked-loop /
  // drone styles depend on this).
  tonicizationRule?: {
    allowed: boolean;
    probabilityPerPhrase?: number;
    maxPerSong?: number;
    allowedTargets?: string[]; // roman numerals that may receive a V/X
  };

  // Motif repetition strategy. 'regular' restates the canonical motif every
  // N bars; 'functional' restates it whenever a harmonic function (T/S/D)
  // recurs. Picked once per song from the seed::emotion fork. Undefined →
  // 50/50 random + N drawn from [2..8].
  motifRepeatStrategy?: {
    preferred: 'regular' | 'functional';
    N?: { preferred: number; range: [number, number] };
  };

  // Cadence resolution gate. enabled=false disables phrase-end cadence
  // rewriting entirely (ambient styles where constant floating is the
  // aesthetic). probabilityPerPhrase adds randomness at non-final phrase
  // ends; the song's final bar always fires when enabled. The cadence
  // target itself is picked by musicTheory.classifyCadenceTier — not a
  // per-style choice.
  returnRule?: {
    enabled: boolean;
    probabilityPerPhrase?: number;
  };

  // 0.0 to 1.0 — density of melodic ornaments (mordents, turns, slides).
  // Currently a placeholder; ornament generation is not yet wired.
  ornamentationLevel?: number;

  // 0.0 to 1.0 — how aggressively the engine forces tension resolutions.
  // 0 lets tensions hang (jazz / ambient aesthetic), 1 always resolves on
  // strong beats (pop / cadence-driven). Default 0.5 when undefined.
  // Sacred motif bars are exempt regardless of this value.
  tensionResolutionStrictness?: number;

  // Scale-Gravity strictness (0.0 to 1.0). How aggressively the
  // engine OBEYS the scale's built-in resolution physics
  // (SCALE_GRAVITY, defined in musicTheory.ts). 1.0 = always
  // resolves on next structural beat (POP / cadence-driven);
  // 0.0 = ignores gravity (free-floating modal melody).
  //
  // Per architecture: gravity itself (b6→5 in Aeolian, 7→1 in
  // Ionian, etc.) is a UNIVERSAL physics law of the scale —
  // style-independent. Style only chooses how strictly to obey.
  //   POP:   0.85 (radio-friendly clean resolutions)
  //   JAZZ:  0.35 (delays, lay-ins, avoids over-resolution)
  //   BLUES: 0.55 (mid)
  //   RNB:   0.50 (moderate jazz sophistication)
  gravityStrictness?: number;

  // Floating-color authorization. Default false (strict resolve —
  // any 9/11/13/7 in a structural backbone position opens a tension
  // window that must close on chord 1/3/5 within ~ 4 beats). When
  // true, the per-style aesthetic embraces "color as home" — chord
  // types that self-declare extensions (m9 names 9, maj13 names 13,
  // 7alt names altered tones) raise the listener's stable baseline,
  // and melody on chord-baked color is treated as a sustainable
  // landing rather than tension. Cadence resolution still applies
  // unchanged — phrase punctuation overrides floating.
  // Set true on the first sub-style of a macro that wants this
  // aesthetic (mergeStyles uses first-member representative for
  // scalar fields). Currently true only on neo-soul / R&B family
  // — pop / blues / mainstream jazz default false.
  allowFloatingColor?: boolean;

  // Blues hang-tone authorization — separate from floating-color.
  // Blues melody language hangs on the b3 / b7 of the KEY root
  // (the "blues 3rd" and "blues 7th"), regardless of which chord is
  // currently sounding. These are SCALE-baked color (the blues scale
  // owns them as home tones), not CHORD-baked color (which is what
  // allowFloatingColor governs). Open this flag and the per-emit
  // color-line trigger skips structural emits whose pc-from-key-root
  // is 3 (b3) or 10 (b7) — they're treated as scale-level home, not
  // tension that demands resolution.
  // Cadence positions still resolve unchanged.
  // True only on BLUES macro members.
  allowBluesHangTone?: boolean;

  // Comping voicing mode. Controls how realizeProgression derives the
  // chord's audible-comping pitch set from the chord type's full
  // intervals.
  //   'shell' (default): root + 3 + 5 + 7 (drops upper extensions
  //     5+ → top 4; add9 / 6/9 → bare triad). Frees 9/11/13 for the
  //     melody to fill — the 'divisi' design.
  //   'rootless': drops the root, preferring 3 + 5 + 7 + 9 (Bill Evans
  //     A-position) or 7 + 9 + 3 + 13 (B-position). Bass owns the
  //     root; comping owns color tones. JAZZ standard since the 1950s.
  //   'cluster': tight stack of 9-3-11 / 3-5-7-9 within a narrow
  //     octave window. Neo-soul / R&B signature.
  //   'full': keep the chord type's declared intervals verbatim — no
  //     shell stripping. Used by POP where the comping voices the
  //     full chord (add9 keeps its 9, maj9 keeps both 7 + 9) and the
  //     melody is vocal-style rather than divisi-filling. POP_VOICINGS
  //     lookup table provides cleaner pop-idiomatic alternatives for
  //     ambiguous chords (e.g. '11' becomes sus11 to dodge the 3-vs-11
  //     clash) and falls back to raw CHORD_TYPES for everything else.
  //   'blues': boogie-style right-hand comping over a boogie_pattern
  //     bass. Bass owns the 5 (root-3-5-6-b7-5-3-root walk), so the
  //     right hand drops the 5 on dominant chords and emphasizes the
  //     3+b7 guide tones + upper alterations (9 / b9 / #9 / b13).
  //     m7 / maj7 / triads keep their fifths. BLUES_VOICINGS lookup
  //     table.
  // Per-style first-member representative (mergeStyles aggregator).
  compingVoicingMode?: 'shell' | 'rootless' | 'cluster' | 'full' | 'blues';

  // Bass pattern — bar-internal rhythmic line key (老师 4 选项:
  // BASSLINE 允许有自己的线条, 相当于铺底简单旋律). Names a registered
  // BASS_PATTERN_RULES entry. When set, realizeProgression invokes the
  // pattern rule and stores the events on chord.bassPattern; the bass
  // emit in applyTexture is replaced by these events. Decoupled from
  // basslineRules (anchor-only, single midi) — both can coexist on
  // a profile but bassPattern (if defined) wins for bass output.
  // First-member representative.
  bassPattern?: string;
}

// ==========================================================
// Internal sub-style dictionary. Each entry is a fully-specified
// StyleProfile with its own progressions / motifs / textures /
// scaleMapping etc. Not exported — the public API is the three
// macros (POP / JAZZ / BLUES) defined at the bottom of this file
// via mergeStyles, which pool data from these sub-styles.
// ==========================================================
const _SUBSTYLES: Record<string, StyleProfile> = {
  // ==========================================
  // Category 1: Pop & Contemporary
  // ==========================================
  'Pop Ballad': {
    name: 'Pop Ballad',
    category: 'Pop & Contemporary',
    description: '以抒情感人为主的流行慢歌，强调优美的旋律线与清晰的和声解决。',
    availableModes: ['Major', 'Minor'],
    defaultMode: 'Major',
    tempoRange: [60, 85],
    timeSignature: [4, 4],
    compingVoicingMode: 'full',
    grooveType: 'straight',
    accentMode: 'downbeat',
    syncopationLevel: 0.2,
    harmonyComplexity: 0.3,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    colorChoices: {
      'I':   { 0: ['maj'],  1: ['add9'],          2: ['maj7', 'maj9'] },
      'ii':  { 0: ['min'],  1: ['m7'],            2: ['m9', 'm7sus4'] },
      'iii': { 0: ['min'],  1: ['m7'],            2: ['m7'] },
      'IV':  { 0: ['maj'],  1: ['add9', 'maj7'],  2: ['maj9', '6'] },
      'V':   { 0: ['maj'],  1: ['7', 'sus4'],     2: ['9sus4', '11'] },
      'vi':  { 0: ['min'],  1: ['m7'],            2: ['m9'] },
      'III': { 0: ['7'],    1: ['7'],             2: ['7b13', '7#5'] },
      'VI':  { 0: ['7'],    1: ['7'],             2: ['7b9'] },
      'II':  { 0: ['7'],    1: ['7'],             2: ['9'] },
    },
    progressions: {
      Major: [
          [{ roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }],
          [{ roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'IV', type: 'maj7', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: '7', scaleDegree: 5, rootOffset: 7 }, { roman: 'iii', type: 'm7', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'ii', type: 'm7', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: '7sus4', scaleDegree: 5, rootOffset: 7 }, { roman: 'I', type: 'maj9', scaleDegree: 1, rootOffset: 0 }, { roman: 'iii', type: 'm7', scaleDegree: 3, rootOffset: 4 }],
          // Secondary dominant templates — bring borrowing into POP per
          // user direction. These create natural mid-phrase pivot
          // moments where the scale switches (Phrygian Dominant for V/X
          // → minor target, Mixolydian/Lydian Dominant for major
          // target). Engine's getScaleForStyle has built-in branch for
          // chord.roman.includes('/') that picks the borrowed scale.
          //
          // I → V/vi → vi → IV  (Coldplay-style "lift" with V/vi)
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'V/vi', type: '7', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }],
          // I → IV → V/V → V  (climbing into V via its dominant)
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'V/V', type: '7', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: '7', scaleDegree: 5, rootOffset: 7 }],
          // vi → V/iii → iii → IV  (subtle pivot through V/iii)
          [{ roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'V/iii', type: '7', scaleDegree: 7, rootOffset: 11 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }]
      ],
      Minor: [
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 3 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }],
          [{ roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'i', type: 'add9', scaleDegree: 1, rootOffset: 0 }, { roman: 'iv', type: 'm9', scaleDegree: 4, rootOffset: 5 }, { roman: 'VII', type: '7', scaleDegree: 7, rootOffset: 10 }, { roman: 'III', type: 'maj7', scaleDegree: 3, rootOffset: 3 }]
      ]
    },
    scalePreference: ['Ionian', 'Aeolian', 'Major Pentatonic'],
    characteristicNotes: ['3', '5', '7'],
    avoidNotesRule: 'STRICT',
    primaryTextures: ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'],
    phraseLengths: [4, 8],
    rhythmicDensity: 0.4,
    motifStyle: '平稳起伏的延音，注重正拍上的和弦内音，弱拍经过音。',
    recommendedBars: 8,
    motifs: [],
    scaleMapping: {
      T: { 'maj': ['Ionian', 'Major Pentatonic'], 'maj7': ['Ionian'], 'add9': ['Ionian'] },
      S: { 'maj': ['Lydian', 'Ionian'], 'maj7': ['Lydian'], 'min': ['Dorian'] },
      D: { 'maj': ['Mixolydian'], '7': ['Mixolydian'], '9': ['Mixolydian'] }
    },
    tensionResolutionStrategy: {
      preference: 'immediate',
      description: '严格遵循二度解决原则，不和谐音迅速回归到临近的和弦内音（如4->3, 7->1）。'
    },
    tensionResolutionStrictness: 0.7,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.30,
      maxPerSong: 2,
      allowedTargets: ['vi', 'IV', 'ii', 'iv', 'VI']
    },
    motifRepeatStrategy: {
      preferred: 'regular',
      N: { preferred: 4, range: [4, 8] }
    },
    returnRule: {
      enabled: true,
      probabilityPerPhrase: 0.6,
    },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 5 },
      { ref: 'fifth_drop', weight: 2 },
    ],
    globalMelodyScaleMapping: {
      'Major': ['Major Pentatonic', 'Ionian'], // 限制大调7音的滥用，多用五声音阶
      'Minor': ['Minor Pentatonic', 'Aeolian']
    }
  },
  'Synth Pop': {
    name: 'Synth Pop',
    category: 'Pop & Contemporary',
    description: '80年代复古或现代电子合成器流行，节奏紧凑明艳，强调洗脑的Hook。',
    availableModes: ['Minor', 'Major'],
    defaultMode: 'Minor',
    tempoRange: [105, 128],
    timeSignature: [4, 4],
    grooveType: 'straight',
    accentMode: 'fourOnTheFloor',
    syncopationLevel: 0.6,
    harmonyComplexity: 0.2,
    colorLevelProbabilities: { level0: 0.6, level1: 0.3, level2: 0.1 },
    colorChoices: {
      'I':  { 0: ['maj'], 1: ['add9'], 2: ['maj7'] },
      'ii': { 0: ['min'], 1: ['m7'],   2: ['m9'] },
      'IV': { 0: ['maj'], 1: ['add9'], 2: ['maj7'] },
      'V':  { 0: ['maj'], 1: ['7'],    2: ['9'] },
      'vi': { 0: ['min'], 1: ['m7'],   2: ['m7'] },
    },
    progressions: {
      Major: [
          [{ roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }]
      ],
      Minor: [
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 3 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }],
          [{ roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }]
      ]
    },
    scalePreference: ['Dorian', 'Aeolian', 'Mixolydian'],
    characteristicNotes: ['1', 'b3', 'b7'],
    avoidNotesRule: 'STRICT',
    primaryTextures: ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse', 'Pop_Ostinato_Rock'],
    phraseLengths: [2, 4],
    rhythmicDensity: 0.6,
    motifStyle: '切分明显的短句，结合合成器Arp一样的16分音符几何感连复段。',
    recommendedBars: 4,
    motifs: [],
    scaleMapping: {
      T: { 'maj': ['Ionian'], 'maj7': ['Ionian', 'Lydian'], 'min': ['Aeolian', 'Dorian'], 'm7': ['Dorian', 'Aeolian'] },
      S: { 'maj': ['Lydian', 'Ionian'], 'min': ['Dorian'] },
      D: { 'maj': ['Mixolydian'], '7': ['Mixolydian'] }
    },
    tensionResolutionStrategy: {
      preference: 'immediate',
      description: '解决简练，通常在强拍上直接跳回根音或五音，避免复杂的装饰性解决。'
    },
    tensionResolutionStrictness: 0.6,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.15,
      maxPerSong: 1,
      allowedTargets: ['vi', 'IV', 'iv', 'VI']
    },
    motifRepeatStrategy: {
      preferred: 'regular',
      N: { preferred: 2, range: [2, 4] }
    },
    returnRule: {
      enabled: true,
      probabilityPerPhrase: 0.5,
    },
    basslineRules: [
      { ref: 'octave_alternate', weight: 6 },
      { ref: 'stepwise_descent', weight: 1 },
    ],
    globalMelodyScaleMapping: {
      'Major': ['Ionian', 'Mixolydian'],
      'Minor': ['Dorian', 'Aeolian']
    }
  },

  // ==========================================
  // Category 2: Jazz & Blues
  // ==========================================
  'Jazz Swing': {
    name: 'Jazz Swing',
    category: 'Jazz & Blues',
    description: '标准爵士摇摆乐，充满2-5-1进行与密集的属七变化音色彩，强调即兴感。',
    availableModes: ['Major', 'Minor'],
    defaultMode: 'Major',
    tempoRange: [120, 180],
    timeSignature: [4, 4],
    compingVoicingMode: 'rootless',
    bassPattern: 'stride_pattern',
    grooveType: 'swing',
    accentMode: 'syncopated',
    syncopationLevel: 0.8,
    harmonyComplexity: 0.9,
    colorLevelProbabilities: { level0: 0.0, level1: 0.1, level2: 0.9 },
    colorChoices: {
      'I':   { 0: ['maj7'], 1: ['maj7', '6'],     2: ['maj9', '6/9'] },
      'ii':  { 0: ['m7'],   1: ['m7'],            2: ['m9', 'm11'] },
      'iii': { 0: ['m7'],   1: ['m7'],            2: ['m7', 'm7b5'] },
      'IV':  { 0: ['maj7'], 1: ['maj7'],          2: ['maj9', 'maj13', '6/9'] },
      'V':   { 0: ['7'],    1: ['9', '13'],       2: ['7b13', '7#9', '7alt'] },
      'vi':  { 0: ['m7'],   1: ['m7'],            2: ['m9', 'm11'] },
      'III': { 0: ['7'],    1: ['7b13', '7#9'],   2: ['7alt'] },
      'VI':  { 0: ['7'],    1: ['7b13', '7#9'],   2: ['7alt'] },
      'II':  { 0: ['7'],    1: ['9'],             2: ['13', '7#11'] },
    },
    progressions: {
      Major: [
          [{ roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 9 }, { roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }]
      ],
      Minor: [
          [{ roman: 'ii', type: 'm7b5', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'ii', type: 'm7b5', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'ii', type: 'm7b5', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 3 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }]
      ]
    },
    scalePreference: ['Dorian', 'Mixolydian', 'Lydian', 'Altered'],
    characteristicNotes: ['#11', 'b9', '#9', 'b13'],
    avoidNotesRule: 'JAZZ',
    primaryTextures: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'],
    phraseLengths: [4],
    rhythmicDensity: 0.8,
    motifStyle: 'Bebop式的包围音(Enclosure)，连续的八分音符摇摆句式，长短不一的乐句呼吸。',
    recommendedBars: 8,
    motifs: [],
    scaleMapping: {
      T: { 'maj7': ['Ionian', 'Lydian'], 'maj9': ['Lydian'], '6/9': ['Major Pentatonic', 'Lydian'] },
      S: { 'maj7': ['Lydian'], 'm7': ['Dorian'], 'm9': ['Dorian'], 'm11': ['Dorian'] },
      D: { '7': ['Mixolydian', 'Lydian Dominant'], '9': ['Mixolydian'], '13': ['Mixolydian'], '7alt': ['Altered'], '7#11': ['Lydian Dominant'], '13b9': ['Half-Whole Diminished'] }
    },
    tensionResolutionStrategy: {
      preference: 'chromatic',
      description: '使用半音趋近（Chromatic Approach）和转向解决，张力常在解决前进行半音包围。'
    },
    tensionResolutionStrictness: 0.55,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.60,
      maxPerSong: 4,
      allowedTargets: ['ii', 'iii', 'vi', 'IV', 'iv']
    },
    motifRepeatStrategy: {
      preferred: 'functional',
      N: { preferred: 4, range: [2, 8] }
    },
    returnRule: {
      enabled: true,
    },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 4 },
      { ref: 'walking_bass', weight: 6 },
    ],
    globalMelodyScaleMapping: {
      'Major': ['Mixolydian', 'Lydian'],
      'Minor': ['Dorian', 'Altered']
    }
  },
  'Blues': {
    name: 'Blues',
    category: 'Jazz & Blues',
    description: '重拍摇摆的布鲁斯钢琴（Blues Piano），强烈的I-IV-V框架，核心在右手密集的碎音阶与左手Shuffle贝斯的互动。',
    availableModes: ['Major Blues', 'Minor Blues'],
    defaultMode: 'Major Blues',
    tempoRange: [60, 110],
    timeSignature: [4, 4],
    compingVoicingMode: 'blues',
    grooveType: 'shuffle',
    accentMode: 'backbeat',
    syncopationLevel: 0.85,
    harmonyComplexity: 0.4,
    allowBluesHangTone: true,
    bassPattern: 'boogie_pattern',
    colorLevelProbabilities: { level0: 0.0, level1: 0.8, level2: 0.2 },
    colorChoices: {
      'I':  { 0: ['dom7'], 1: ['dom7', '9'], 2: ['13'] },
      'ii': { 0: ['m7'],   1: ['m7'],        2: ['m9'] },
      'IV': { 0: ['dom7'], 1: ['dom7', '9'], 2: ['9'] },
      'V':  { 0: ['dom7'], 1: ['7', '9'],    2: ['7#9', '7alt', '7b13'] },
      'VI': { 0: ['dom7'], 1: ['7', '9'],    2: ['7#9'] },
      'II': { 0: ['dom7'], 1: ['9'],         2: ['13'] },
    },
    progressions: {
      'Major Blues': [
        [
          { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'dom7', scaleDegree: 4, rootOffset: 5 }, 
          { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 }, { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 },
          { roman: 'IV', type: 'dom7', scaleDegree: 4, rootOffset: 5 }, { roman: 'IV', type: 'dom7', scaleDegree: 4, rootOffset: 5 }, 
          { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 }, { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 },
          { roman: 'V', type: 'dom7', scaleDegree: 5, rootOffset: 7 }, { roman: 'IV', type: 'dom7', scaleDegree: 4, rootOffset: 5 }, 
          { roman: 'I', type: 'dom7', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'dom7', scaleDegree: 5, rootOffset: 7 }
        ]
      ],
      'Minor Blues': [
        [
          { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, 
          { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 },
          { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, 
          { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 },
          { roman: 'V', type: 'dom7', scaleDegree: 5, rootOffset: 7 }, { roman: 'IV', type: 'dom7', scaleDegree: 4, rootOffset: 5 }, 
          { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'dom7', scaleDegree: 5, rootOffset: 7 }
        ]
      ]
    },
    scalePreference: ['Blues', 'Major Blues'],
    characteristicNotes: ['b3', 'b5', 'b7', '3'],
    avoidNotesRule: 'RELAXED',
    primaryTextures: ['Blues_Slow_12_8_Arp', 'Blues_Tremolo_Comp', 'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Slow_Chops'],
    phraseLengths: [2],
    rhythmicDensity: 0.7,
    motifStyle: '钢琴双音(Double Stops)，大小三度的碎音滑音，密集的三连音下行，强烈的右手段落式切分。',
    recommendedBars: 12,
    motifs: [],
    scaleMapping: {
      T: { '7': ['Blues', 'Major Blues'], 'maj': ['Major Blues'] },
      S: { '7': ['Blues'], 'maj': ['Major Blues'] },
      D: { '7': ['Blues'], 'maj': ['Major Blues'] }
    },
    tensionResolutionStrategy: {
      preference: 'modal',
      description: '蓝调音（b3, b5）常倾向于滑向自然音程，或作为一种持续的“稳定不和谐”存在而不急于解决。'
    },
    tensionResolutionStrictness: 0.4,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.30,
      maxPerSong: 2,
      allowedTargets: ['IV', 'V']
    },
    motifRepeatStrategy: { preferred: 'functional', N: { preferred: 4, range: [2, 4] } },
    returnRule: { enabled: true },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 3 },
      { ref: 'fifth_drop', weight: 2 },
      { ref: 'boogie_root_fifth', weight: 5 },
    ],
    globalMelodyScaleMapping: {
      'Major Blues': ['Major Blues', 'Blues'],
      'Minor Blues': ['Blues', 'Minor Pentatonic']
    }
  },
  'Bossa Nova': {
    name: 'Bossa Nova',
    category: 'Jazz & Blues',
    description: '巴西拉丁爵士，律动放松而复杂，和弦极其丰富绚丽（常带9、11、13音）。',
    availableModes: ['Major', 'Minor'],
    defaultMode: 'Major',
    tempoRange: [70, 140],
    timeSignature: [4, 4],
    grooveType: 'straight', 
    accentMode: 'clave',
    syncopationLevel: 0.9,
    harmonyComplexity: 0.8,
    colorLevelProbabilities: { level0: 0.0, level1: 0.2, level2: 0.8 },
    colorChoices: {
      'I':   { 0: ['maj7'],  1: ['maj9', '6/9'],            2: ['maj13', 'maj9#11'] },
      'ii':  { 0: ['m7'],    1: ['m9'],                     2: ['m11', 'm9b5'] },
      'iii': { 0: ['m7'],    1: ['m7b5'],                   2: ['m11'] },
      'IV':  { 0: ['maj7'],  1: ['maj9'],                   2: ['maj13', 'maj9#11'] },
      'V':   { 0: ['7'],     1: ['9', '13', '7b13'],        2: ['7alt', '7#11', '13b9'] },
      'vi':  { 0: ['m7'],    1: ['m9'],                     2: ['m11'] },
      'III': { 0: ['7alt'],  1: ['7b9', '7b13'],            2: ['7alt'] },
      'VI':  { 0: ['7b9'],   1: ['7alt'],                   2: ['7b13'] },
      'II':  { 0: ['9'],     1: ['13'],                     2: ['7#11'] },
    },
    progressions: {
      Major: [
          [{ roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 9 }, { roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }],
          [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }]
      ],
      Minor: [
          [{ roman: 'ii', type: 'm7b5', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'ii', type: 'm7b5', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }]
      ]
    },
    scalePreference: ['Lydian', 'Dorian', 'Mixolydian'],
    characteristicNotes: ['9', '#11', '13'],
    avoidNotesRule: 'JAZZ',
    primaryTextures: ['Bossa_Piano_Arp', 'Jazz_Waltz_Hemiola'],
    phraseLengths: [2, 4],
    rhythmicDensity: 0.6,
    motifStyle: '慵懒平稳的八分音符流动，多依靠和弦变化提供色彩，旋律线起伏较小。',
    recommendedBars: 8,
    motifs: [],
    scaleMapping: {
      T: { 'maj7': ['Lydian', 'Ionian'], 'maj9': ['Lydian'], 'maj13': ['Lydian', 'Major Pentatonic'], 'm7': ['Dorian'], 'm9': ['Dorian'] },
      S: { 'maj7': ['Lydian'], 'maj9': ['Lydian'], 'm7': ['Dorian'], 'm9': ['Dorian'], 'm11': ['Dorian'] },
      D: { '7': ['Mixolydian', 'Lydian Dominant'], '9': ['Mixolydian'], '13': ['Mixolydian'], '7alt': ['Altered'], '7#11': ['Lydian Dominant'] }
    },
    tensionResolutionStrategy: {
      preference: 'delayed',
      description: '张力音（如扩展音）常长时间悬停，随和弦平滑过渡到下一个和弦的色彩音，而非垂直解决。'
    },
    tensionResolutionStrictness: 0.4,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.50,
      maxPerSong: 3,
      allowedTargets: ['ii', 'iii', 'vi', 'IV']
    },
    motifRepeatStrategy: {
      preferred: 'functional',
      N: { preferred: 4, range: [2, 8] }
    },
    returnRule: { enabled: true, probabilityPerPhrase: 0.4 },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 6 },
      { ref: 'fifth_drop', weight: 2 },
    ],
    globalMelodyScaleMapping: {
      'Major': ['Lydian', 'Ionian'],
      'Minor': ['Dorian']
    }
  },

  // ==========================================
  // Category 3: R&B & Soul
  // ==========================================
  'Neo Soul R&B': {
    name: 'Neo Soul R&B',
    category: 'R&B & Soul',
    description: '带有爵士和弦色彩的现代R&B，强调Dilla式的微推拉律动（Dilla Feel）和九、十一和弦。',
    compingVoicingMode: 'cluster',
    bassPattern: 'dilla_pocket',
    availableModes: ['Minor', 'Major'],
    defaultMode: 'Minor',
    tempoRange: [75, 95],
    timeSignature: [4, 4],
    grooveType: 'dilla',
    accentMode: 'backbeat',
    syncopationLevel: 0.7,
    harmonyComplexity: 0.7,
    allowFloatingColor: true,
    colorLevelProbabilities: { level0: 0.0, level1: 0.2, level2: 0.8 },
    colorChoices: {
      'I':   { 0: ['maj7'], 1: ['maj9'],          2: ['maj13', '6/9'] },
      'ii':  { 0: ['m7'],   1: ['m9'],            2: ['m11'] },
      'iii': { 0: ['m7'],   1: ['m7'],            2: ['m11'] },
      'IV':  { 0: ['maj7'], 1: ['maj9'],          2: ['maj13'] },
      'V':   { 0: ['7'],    1: ['9sus4'],         2: ['13', '7#9', '7b13', '11'] },
      'vi':  { 0: ['m7'],   1: ['m9'],            2: ['m11'] },
      'III': { 0: ['7#9'],  1: ['7alt'],          2: ['7b13'] },
      'VI':  { 0: ['7#9'],  1: ['7alt', '7b13'],  2: ['7alt'] },
      'II':  { 0: ['9'],    1: ['13'],            2: ['13', '7#11'] },
    },
    progressions: {
      Major: [
          [{ roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'vii', type: 'min', scaleDegree: 7, rootOffset: 11 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }],
          [{ roman: 'ii', type: 'min', scaleDegree: 2, rootOffset: 2 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 3 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }],
          [{ roman: 'vi', type: 'min', scaleDegree: 6, rootOffset: 9 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'iii', type: 'min', scaleDegree: 3, rootOffset: 4 }]
      ],
      Minor: [
          [{ roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }],
          [{ roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'iv', type: 'min', scaleDegree: 4, rootOffset: 5 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'III', type: 'maj', scaleDegree: 3, rootOffset: 3 }],
          [{ roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'VII', type: 'maj', scaleDegree: 7, rootOffset: 10 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 }]
      ]
    },
    scalePreference: ['Minor Pentatonic', 'Dorian', 'Aeolian'],
    characteristicNotes: ['9', '11', 'b7'],
    avoidNotesRule: 'RELAXED',
    primaryTextures: ['RnB_Neo_Soul_Roll', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove'],
    phraseLengths: [2],
    rhythmicDensity: 0.5,
    motifStyle: '转音(Runs/Riffs)，五声音阶的快速滑落，延迟在拍子的半后慵懒唱腔。',
    recommendedBars: 4,
    motifs: [],
    scaleMapping: {
      T: { 'm7': ['Dorian', 'Minor Pentatonic'], 'm9': ['Dorian'], 'maj7': ['Ionian'], 'maj9': ['Ionian', 'Major Pentatonic'] },
      S: { 'm7': ['Minor Pentatonic', 'Dorian'], 'm9': ['Dorian'], 'm11': ['Dorian'] },
      D: { '7sus4': ['Mixolydian'], '9': ['Mixolydian'], '7': ['Mixolydian'], '13': ['Mixolydian'] }
    },
    tensionResolutionStrategy: {
      preference: 'delayed',
      description: '使用大量的属七悬留(sus)和二度堆叠，通过装饰性的旋律跑句(Runs)最后落在九音或十一音上。'
    },
    tensionResolutionStrictness: 0.4,
    tonicizationRule: {
      allowed: true,
      probabilityPerPhrase: 0.40,
      maxPerSong: 2,
      allowedTargets: ['vi', 'IV', 'ii', 'iv', 'VI']
    },
    motifRepeatStrategy: {
      preferred: 'functional',
      N: { preferred: 4, range: [2, 4] }
    },
    returnRule: { enabled: true, probabilityPerPhrase: 0.4 },
    basslineRules: [
      { ref: 'fifth_drop', weight: 4 },
      { ref: 'stepwise_descent', weight: 3 },
      { ref: 'walking_bass', weight: 2 },
    ],
    globalMelodyScaleMapping: {
      'Major': ['Minor Pentatonic', 'Ionian'],
      'Minor': ['Dorian', 'Minor Pentatonic']
    }
  },
  'Max Martin Pop': {
    name: 'Max Martin Pop', category: 'Pop & Contemporary', description: '旋律数学极简主义。强烈的预期管理，节奏死死咬住网格。',
    availableModes: ['Minor', 'Major'], defaultMode: 'Minor', tempoRange: [100, 120], timeSignature: [4, 4],
    grooveType: 'straight', accentMode: 'downbeat', syncopationLevel: 0.3, harmonyComplexity: 0.2,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Minor: [[ { roman: 'VI', type: 'maj', scaleDegree: 6, rootOffset: 8 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'v', type: 'min', scaleDegree: 5, rootOffset: 7 } ]] },
    scalePreference: ['Minor Pentatonic', 'Aeolian'], characteristicNotes: ['1', '3', '5'], avoidNotesRule: 'STRICT',
    primaryTextures: ['Block_Chord', 'Broken_Chord'], phraseLengths: [2], rhythmicDensity: 0.5,
    motifStyle: '同音反复连发加上尾音跳跃。', recommendedBars: 4,
    motifs: [],
    scaleMapping: { T: { 'min': ['Aeolian'] }, S: { 'maj': ['Ionian'] }, D: { 'min': ['Aeolian'] } },
    tensionResolutionStrategy: { preference: 'immediate', description: '直接解决到骨干音' },
    tensionResolutionStrictness: 0.7,
    motifRepeatStrategy: { preferred: 'regular', N: { preferred: 4, range: [2, 4] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.50 },
    tonicizationRule: { allowed: true, probabilityPerPhrase: 0.20, maxPerSong: 1, allowedTargets: ['vi', 'IV'] },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 4 },
      { ref: 'fifth_drop', weight: 2 },
    ],
  },
  'Gospel Neo-Soul': {
    name: 'Gospel Neo-Soul', category: 'R&B & Soul', description: '和声极为丰富，大量经过和弦，极度滞后 (Behind the beat)。',
    availableModes: ['Major'], defaultMode: 'Major', tempoRange: [70, 85], timeSignature: [4, 4],
    grooveType: 'dilla', accentMode: 'backbeat', syncopationLevel: 0.8, harmonyComplexity: 0.9,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Major: [[ { roman: 'vii', type: 'm7b5', scaleDegree: 7, rootOffset: 11 }, { roman: 'III', type: '7#9', scaleDegree: 3, rootOffset: 4 }, { roman: 'vi', type: 'm11', scaleDegree: 6, rootOffset: 9 }, { roman: 'bVI', type: 'dim7', scaleDegree: 6, rootOffset: 8 } ]] },
    scalePreference: ['Altered', 'Dorian', 'Harmonic Minor'], characteristicNotes: ['#9', 'b9', '11'], avoidNotesRule: 'RELAXED',
    primaryTextures: ['RnB_Neo_Soul_Roll', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove'], phraseLengths: [4], rhythmicDensity: 0.6,
    motifStyle: '滑音、滞后的弱拍强音。', recommendedBars: 8,
    motifs: [],
    scaleMapping: { T: { 'm11': ['Dorian'] }, S: { 'm7b5': ['Locrian'] }, D: { '7#9': ['Altered'], 'dim7': ['Half-Whole Diminished'] } },
    tensionResolutionStrategy: { preference: 'delayed', description: '复杂的经过和弦解决' },
    tensionResolutionStrictness: 0.4,
    motifRepeatStrategy: { preferred: 'functional', N: { preferred: 4, range: [2, 8] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.40 },
    tonicizationRule: { allowed: true, probabilityPerPhrase: 0.50, maxPerSong: 3, allowedTargets: ['ii', 'iii', 'vi', 'IV'] },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 4 },
      { ref: 'fifth_drop', weight: 3 },
    ],
  },
  'Asian Pop Walkdown': {
    name: 'Asian Pop Walkdown', category: 'Pop & Contemporary', description: '无敌的根音下行线条，旋律大跳后级进解决。',
    availableModes: ['Major'], defaultMode: 'Major', tempoRange: [68, 85], timeSignature: [4, 4],
    grooveType: 'straight', accentMode: 'downbeat', syncopationLevel: 0.3, harmonyComplexity: 0.6,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Major: [[ { roman: 'I', type: 'add9', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'vi', type: 'm7', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'maj9', scaleDegree: 4, rootOffset: 5 } ]] },
    scalePreference: ['Ionian', 'Major Pentatonic'], characteristicNotes: ['2', '3', '5'], avoidNotesRule: 'STRICT',
    primaryTextures: ['Pop_Piano_Arp_16ths', 'Pop_Broken_8ths_Sync', 'Pop_Ballad_158_Sweep'], phraseLengths: [4], rhythmicDensity: 0.6,
    motifStyle: '1-7-5-1大跳跨度旋律。', recommendedBars: 8,
    motifs: [],
    scaleMapping: { T: { 'add9': ['Ionian'], 'm7': ['Aeolian'] }, S: { 'maj9': ['Lydian'] }, D: { 'maj': ['Mixolydian'] } },
    tensionResolutionStrategy: { preference: 'immediate', description: '级进下行解决' },
    tensionResolutionStrictness: 0.6,
    motifRepeatStrategy: { preferred: 'regular', N: { preferred: 4, range: [4, 8] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.60 },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 10 },
    ],
  },
  'Motown Soul': {
    name: 'Motown Soul', category: 'R&B & Soul', description: '切分贝斯线条，反拍的吉他/钢琴短击，大调五声音阶的阳光感。',
    availableModes: ['Major'], defaultMode: 'Major', tempoRange: [95, 115], timeSignature: [4, 4],
    grooveType: 'straight', accentMode: 'backbeat', syncopationLevel: 0.7, harmonyComplexity: 0.4,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Major: [[ { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'vi', type: 'm', scaleDegree: 6, rootOffset: 9 }, { roman: 'ii', type: 'm7', scaleDegree: 2, rootOffset: 2 }, { roman: 'V', type: '7', scaleDegree: 5, rootOffset: 7 } ]] },
    scalePreference: ['Major Pentatonic', 'Mixolydian'], characteristicNotes: ['1', '3', '5', '6'], avoidNotesRule: 'STRICT',
    primaryTextures: ['RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp'], phraseLengths: [2], rhythmicDensity: 0.7,
    motifStyle: '蛇形大调五声律动。', recommendedBars: 4,
    motifs: [],
    scaleMapping: { T: { 'maj': ['Ionian'], 'm': ['Aeolian'] }, S: { 'm7': ['Dorian'] }, D: { '7': ['Mixolydian'] } },
    tensionResolutionStrategy: { preference: 'immediate', description: '回到大三和弦' },
    tensionResolutionStrictness: 0.6,
    motifRepeatStrategy: { preferred: 'regular', N: { preferred: 4, range: [2, 4] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.50 },
    tonicizationRule: { allowed: true, probabilityPerPhrase: 0.30, maxPerSong: 2, allowedTargets: ['vi', 'ii'] },
    basslineRules: [
      { ref: 'fifth_drop', weight: 4 },
      { ref: 'stepwise_descent', weight: 3 },
    ],
  },
  'Modern Trap': {
    name: 'Modern Trap', category: 'Electronic & Beat', description: '冰冷的合成器，低频 808 滑音和密集的打击乐三连音。',
    availableModes: ['Minor'], defaultMode: 'Minor', tempoRange: [130, 160], timeSignature: [4, 4],
    grooveType: 'straight', accentMode: 'fourOnTheFloor', syncopationLevel: 0.8, harmonyComplexity: 0.2,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Minor: [[ { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'i', type: 'min', scaleDegree: 1, rootOffset: 0 }, { roman: 'bII', type: 'maj', scaleDegree: 2, rootOffset: 1 } ]] },
    scalePreference: ['Phrygian', 'Harmonic Minor'], characteristicNotes: ['b2', '5'], avoidNotesRule: 'RELAXED',
    primaryTextures: ['Arpeggio_Flow'], phraseLengths: [2], rhythmicDensity: 0.8,
    motifStyle: '密集的八分/十六分三连音。', recommendedBars: 4,
    motifs: [],
    scaleMapping: { T: { 'min': ['Phrygian'] }, S: { 'maj': ['Lydian'] }, D: { 'maj': ['Phrygian Dominant'] } },
    motifRepeatStrategy: { preferred: 'regular', N: { preferred: 2, range: [2, 4] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.4 },
    basslineRules: [
      { ref: 'root_lock', weight: 6 },
      { ref: 'octave_alternate', weight: 2 },
    ],
    tensionResolutionStrategy: { preference: 'immediate', description: '小二度解决到根音' },
    tensionResolutionStrictness: 0.5
  },
  'Modern Stadium Pop': {
    name: 'Modern Stadium Pop', category: 'Pop & Contemporary', description: '万能四和弦 + 顶部持续音死锁 + 5-3 洗脑旋律。',
    availableModes: ['Major'], defaultMode: 'Major', tempoRange: [100, 128], timeSignature: [4, 4],
    grooveType: 'straight', accentMode: 'fourOnTheFloor', syncopationLevel: 0.4, harmonyComplexity: 0.2,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Major: [[ { roman: 'I', type: 'add9', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: 'sus4', scaleDegree: 5, rootOffset: 7 }, { roman: 'vi', type: 'm7', scaleDegree: 6, rootOffset: 9 }, { roman: 'IV', type: 'add9', scaleDegree: 4, rootOffset: 5 } ]] },
    scalePreference: ['Major Pentatonic'], characteristicNotes: ['1', '5'], avoidNotesRule: 'STRICT',
    primaryTextures: ['Pop_Broken_8ths_Sync', 'Pop_Anthem_Pulse', 'Pop_Ostinato_Rock'], phraseLengths: [2], rhythmicDensity: 0.5,
    motifStyle: '5音和3音的大跳交替，死锁在五声音阶内。', recommendedBars: 8,
    motifs: [],
    scaleMapping: { T: { 'add9': ['Ionian'], 'm7': ['Aeolian'] }, S: { 'add9': ['Lydian'] }, D: { 'sus4': ['Mixolydian'] } },
    tensionResolutionStrategy: { preference: 'delayed', description: '五声音阶无强张力' },
    tensionResolutionStrictness: 0.7,
    motifRepeatStrategy: { preferred: 'regular', N: { preferred: 4, range: [4, 8] } },
    returnRule: { enabled: true, probabilityPerPhrase: 0.40 },
    basslineRules: [
      { ref: 'octave_alternate', weight: 5 },
      { ref: 'root_lock', weight: 2 },
    ],
  },
  'Jazz Chromatic Drop': {
    name: 'Jazz Chromatic Drop', category: 'Jazz & Blues', description: '三全音替代引发的丝滑半音阶贝斯下降。',
    availableModes: ['Major'], defaultMode: 'Major', tempoRange: [120, 150], timeSignature: [4, 4],
    grooveType: 'swing', accentMode: 'syncopated', syncopationLevel: 0.8, harmonyComplexity: 0.9,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { Major: [
      // Tritone-sub cadence (chromatic drop)
      [ { roman: 'ii', type: 'm9', scaleDegree: 2, rootOffset: 2 }, { roman: 'bII', type: '7#11', scaleDegree: 2, rootOffset: 1 }, { roman: 'I', type: 'maj9', scaleDegree: 1, rootOffset: 0 }, { roman: 'I', type: 'maj9', scaleDegree: 1, rootOffset: 0 } ],
      // Constant structures — ascending M3 maj7 cycle (Coltrane "Giant
      // Steps" flavor). Same chord type (maj7) on tonic / III / bVI →
      // each chord is its own "I" of a transient key center, no
      // functional resolution between adjacent chords. Resolves back
      // to home I via direct return at the end.
      [ { roman: 'I',   type: 'maj7', scaleDegree: 1, rootOffset: 0 },
        { roman: 'III', type: 'maj7', scaleDegree: 3, rootOffset: 4 },
        { roman: 'bVI', type: 'maj7', scaleDegree: 6, rootOffset: 8 },
        { roman: 'I',   type: 'maj7', scaleDegree: 1, rootOffset: 0 } ],
      // Constant structures — parallel m7 ascending m2 (Herbie Hancock
      // "Maiden Voyage" / D'Angelo modal vamp). All m7 chords sliding
      // chromatically — pure modal texture, no V/I cadence.
      [ { roman: 'i',   type: 'm9', scaleDegree: 1, rootOffset: 0 },
        { roman: 'bii', type: 'm9', scaleDegree: 1, rootOffset: 1 },
        { roman: 'ii',  type: 'm9', scaleDegree: 2, rootOffset: 2 },
        { roman: 'i',   type: 'm9', scaleDegree: 1, rootOffset: 0 } ],
    ] },
    scalePreference: ['Lydian Dominant', 'Dorian'], characteristicNotes: ['#11', '13'], avoidNotesRule: 'JAZZ',
    primaryTextures: ['Jazz_Drop_2_Comp', 'Jazz_Charleston_Comp', 'Jazz_Red_Garland_Block'], phraseLengths: [4], rhythmicDensity: 0.7,
    motifStyle: '平滑半音经过音，连续下落。', recommendedBars: 4,
    motifs: [],
    scaleMapping: { T: { 'maj9': ['Ionian', 'Lydian'] }, S: { 'm9': ['Dorian'] }, D: { '7#11': ['Lydian Dominant'] } },
    tensionResolutionStrategy: { preference: 'chromatic', description: '半音阶丝滑解决' },
    tensionResolutionStrictness: 0.55,
    motifRepeatStrategy: { preferred: 'functional', N: { preferred: 4, range: [2, 8] } },
    returnRule: { enabled: true },
    tonicizationRule: { allowed: true, probabilityPerPhrase: 0.70, maxPerSong: 4, allowedTargets: ['ii', 'iii', 'IV', 'V', 'I'] },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 10 },
    ],
  },
  'Blues Turnaround': {
    name: 'Blues Turnaround', category: 'Jazz & Blues', description: '12小节末尾的经典回转半音收敛与爆发。',
    availableModes: ['Major Blues'], defaultMode: 'Major Blues', tempoRange: [80, 110], timeSignature: [4, 4],
    grooveType: 'shuffle', accentMode: 'backbeat', syncopationLevel: 0.8, harmonyComplexity: 0.6,
    colorLevelProbabilities: { level0: 0.4, level1: 0.4, level2: 0.2 },
    progressions: { 'Major Blues': [[ { roman: 'I', type: '7', scaleDegree: 1, rootOffset: 0 }, { roman: 'I', type: 'aug', scaleDegree: 1, rootOffset: 0 }, { roman: 'I', type: '6', scaleDegree: 1, rootOffset: 0 }, { roman: 'V', type: '7#9', scaleDegree: 5, rootOffset: 7 } ]] },
    scalePreference: ['Blues', 'Mixolydian'], characteristicNotes: ['b3', 'b7'], avoidNotesRule: 'RELAXED',
    primaryTextures: ['Blues_Slow_12_8_Arp', 'Blues_Tremolo_Comp', 'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Slow_Chops'], phraseLengths: [1], rhythmicDensity: 0.8,
    motifStyle: '双音震音与收缩。', recommendedBars: 4,
    motifs: [],
    scaleMapping: { T: { '7': ['Mixolydian'], 'aug': ['Whole Tone'], '6': ['Mixolydian'] }, S: {}, D: { '7#9': ['Altered'] } },
    tensionResolutionStrategy: { preference: 'chromatic', description: '半音回转' },
    tensionResolutionStrictness: 0.4,
    motifRepeatStrategy: { preferred: 'functional', N: { preferred: 4, range: [2, 4] } },
    returnRule: { enabled: true },
    tonicizationRule: { allowed: true, probabilityPerPhrase: 0.40, maxPerSong: 2, allowedTargets: ['IV', 'V'] },
    basslineRules: [
      { ref: 'stepwise_descent', weight: 6 },
      { ref: 'fifth_drop', weight: 2 },
    ],
  },
};


// ==========================================================
// Macro style aggregation. The engine and UI consume only the
// three public macros (POP / JAZZ / BLUES); each is built by
// pooling the relevant sub-style entries above. Pool semantics
// per field:
//   - progressions, motifs, primaryTextures, scalePreference,
//     characteristicNotes, phraseLengths, availableModes:
//     concat / dedupe-union from member sub-styles
//   - scaleMapping (per T/S/D function): per chord type, union
//     scale candidates across members
//   - basslineRules: union by ref, sum weights
//   - tempoRange: span [min(mins), max(maxes)]
//   - syncopationLevel / harmonyComplexity / rhythmicDensity /
//     tensionResolutionStrictness: averaged across members
//   - all other scalar fields (grooveType, accentMode, defaultMode,
//     timeSignature, avoidNotesRule, colorLevelProbabilities,
//     tensionResolutionStrategy, motifRepeatStrategy, returnRule,
//     tonicizationRule): take the first member's value as the
//     macro's representative
// recommendedBars is hardcoded by macro: BLUES → 12 (traditional
// 12-bar form), POP / JAZZ → 16.
// ==========================================================

function mergeStyles(name: StyleName, members: string[], description: string): StyleProfile {
  const profiles = members.map((m) => _SUBSTYLES[m]).filter(Boolean);
  if (profiles.length === 0) {
    throw new Error(`mergeStyles(${name}): no valid sub-styles in [${members.join(', ')}]`);
  }
  const base = profiles[0];

  // Pool progressions per mode.
  const progressions: Record<string, { roman: string; type: string; scaleDegree: number; rootOffset: number }[][]> = {};
  for (const p of profiles) {
    if (!p.progressions) continue;
    for (const [mode, templates] of Object.entries(p.progressions)) {
      progressions[mode] = (progressions[mode] || []).concat(templates);
    }
  }

  // Pool scaleMapping per function, per chord type.
  const scaleMapping = { T: {}, S: {}, D: {} } as StyleProfile['scaleMapping'];
  for (const p of profiles) {
    for (const fn of ['T', 'S', 'D'] as const) {
      const fmap = p.scaleMapping[fn];
      for (const [chordType, scales] of Object.entries(fmap)) {
        const acc = new Set(scaleMapping[fn][chordType] ?? []);
        for (const s of scales) acc.add(s);
        scaleMapping[fn][chordType] = Array.from(acc);
      }
    }
  }

  const dedupe = <T,>(arr: T[]): T[] => Array.from(new Set(arr));
  const motifs = profiles.flatMap((p) => p.motifs);

  // Pool motifPool across members. A macro gets a phrase-role pool
  // when ANY member sub-style provides one; non-providing members
  // contribute nothing here (their motifs are still in the flat
  // pool above as fallback). Migration is incremental — sub-styles
  // can opt into role-classified motifs one at a time without
  // breaking the rest.
  const poolStarts: (any[] | MotifDef)[] = [];
  const poolFlows:  (any[] | MotifDef)[] = [];
  const poolEnds:   (any[] | MotifDef)[] = [];
  for (const p of profiles) {
    if (!p.motifPool) continue;
    poolStarts.push(...p.motifPool.starts);
    poolFlows.push(...p.motifPool.flows);
    poolEnds.push(...p.motifPool.ends);
  }
  const motifPool: MotifPool | undefined =
    (poolStarts.length > 0 && poolFlows.length > 0 && poolEnds.length > 0)
      ? { starts: poolStarts, flows: poolFlows, ends: poolEnds }
      : undefined;
  const primaryTextures = dedupe(profiles.flatMap((p) => p.primaryTextures));
  const scalePreference = dedupe(profiles.flatMap((p) => p.scalePreference));
  const characteristicNotes = dedupe(profiles.flatMap((p) => p.characteristicNotes));
  const phraseLengths = dedupe(profiles.flatMap((p) => p.phraseLengths));
  const availableModes = dedupe(profiles.flatMap((p) => p.availableModes ?? []));

  const tempoRange: [number, number] = [
    Math.min(...profiles.map((p) => p.tempoRange[0])),
    Math.max(...profiles.map((p) => p.tempoRange[1])),
  ];

  const avg = (sel: (p: StyleProfile) => number | undefined): number => {
    const vals = profiles.map(sel).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  // Bassline rules: union by ref, sum weights.
  const blMap: Record<string, number> = {};
  for (const p of profiles) {
    for (const r of p.basslineRules ?? []) {
      blMap[r.ref] = (blMap[r.ref] ?? 0) + r.weight;
    }
  }
  const basslineRules = Object.entries(blMap).map(([ref, weight]) => ({ ref, weight }));

  // Color choices: per roman, per color level, union chord-type pool.
  // Roman numerals appear with mixed case across sub-styles; the pool
  // preserves the case-distinction (e.g. 'VI' is dominant-tonicization
  // of vi, while 'vi' is the diatonic submediant).
  const colorChoices: Record<string, Record<number, string[]>> = {};
  for (const p of profiles) {
    if (!p.colorChoices) continue;
    for (const [roman, levels] of Object.entries(p.colorChoices)) {
      colorChoices[roman] = colorChoices[roman] ?? {};
      for (const [levelStr, types] of Object.entries(levels)) {
        const level = Number(levelStr);
        const acc = new Set(colorChoices[roman][level] ?? []);
        for (const t of types as string[]) acc.add(t);
        colorChoices[roman][level] = Array.from(acc);
      }
    }
  }

  return {
    name,
    category: 'macro',
    description,
    availableModes,
    defaultMode: base.defaultMode,
    progressions,
    tempoRange,
    timeSignature: base.timeSignature,
    grooveType: base.grooveType,
    accentMode: base.accentMode,
    syncopationLevel: avg((p) => p.syncopationLevel),
    harmonyComplexity: avg((p) => p.harmonyComplexity),
    colorLevelProbabilities: base.colorLevelProbabilities,
    scalePreference,
    characteristicNotes,
    avoidNotesRule: base.avoidNotesRule,
    primaryTextures,
    phraseLengths,
    rhythmicDensity: avg((p) => p.rhythmicDensity),
    motifStyle: profiles.map((p) => p.motifStyle).filter(Boolean).join(' / '),
    recommendedBars: name === 'BLUES' ? 12 : 16,
    motifs,
    motifPool,
    scaleMapping,
    tensionResolutionStrategy: base.tensionResolutionStrategy,
    tensionResolutionStrictness: avg((p) => p.tensionResolutionStrictness),
    motifRepeatStrategy: base.motifRepeatStrategy,
    returnRule: base.returnRule,
    tonicizationRule: base.tonicizationRule,
    basslineRules,
    colorChoices: Object.keys(colorChoices).length > 0 ? colorChoices : undefined,
    allowFloatingColor: base.allowFloatingColor,
    allowBluesHangTone: base.allowBluesHangTone,
    compingVoicingMode: base.compingVoicingMode,
    bassPattern: base.bassPattern,
  };
}

// Macro-level motif pools — phrase-role classified motifs keyed by
// the public StyleName. These OVERRIDE whatever mergeStyles produces
// from sub-style aggregation so the data lives at the macro level
// (one curated pool per genre family) rather than being scattered
// across sub-styles. Each pool was hand-curated against three engine-
// safety constraints:
//   1. No 0.33 triplets — the engine's QUANTIZED_DURATIONS snaps
//      0.33 to 0.25 or 0.5; pure 0.5/0.25 inputs let applySwing
//      handle shuffle conversion correctly.
//   2. flows are stepwise or tight arpeggios (≤ 5 semitones / step)
//      so the voice-leading clamp never has to fire on motif-projected
//      pitches.
//   3. ends start at t ∈ {0, 0.5} so the phrase opens against the
//      grid downbeat and Cadence Resolution lands the last note
//      audibly at phrase-end.
export const MACRO_MOTIF_POOLS: Record<StyleName, MotifPool> = {
  POP:   { starts: [], flows: [], ends: [] },
  JAZZ:  { starts: [], flows: [], ends: [] },
  BLUES: { starts: [], flows: [], ends: [] },
  RNB:   { starts: [], flows: [], ends: [] },
};

// Macro-level fill-scale palette. See StyleProfile.fillScales doc.
// Used ONLY by Run Generator + in-bar passing tone insertion to add
// style flavor into fill notes; backbone-determining paths (motif
// projection, anchor scoring, magnetism, cadence) untouched.
//
// POP defaults to natural Ionian/Aeolian per user direction; Major/
// Minor Pentatonic listed as alternatives. JAZZ centers on Bebop
// scales (8-tone, chromatic passing built in). BLUES uses its
// existing Blues / Major Blues / Composite Blues palette anchored
// on KEY (preserves blues special handling). RNB combines Pentatonic
// with Mixolydian b6 for the Stevie Wonder / D'Angelo soul language.
export const MACRO_FILL_SCALES: Record<StyleName, NonNullable<StyleProfile['fillScales']>> = {
  POP: {
    T: {
      'maj':   ['Ionian', 'Major Pentatonic'],
      'maj7':  ['Ionian', 'Lydian'],
      'add9':  ['Ionian', 'Major Pentatonic'],
      'min':   ['Aeolian', 'Minor Pentatonic'],
      'm7':    ['Aeolian', 'Dorian'],
    },
    S: {
      'maj':   ['Lydian', 'Ionian'],
      'maj7':  ['Lydian'],
      'min':   ['Dorian', 'Minor Pentatonic'],
    },
    D: {
      '7':     ['Mixolydian b6', 'Mixolydian'],
      '9':     ['Mixolydian'],
      'maj':   ['Mixolydian'],
    },
  },
  JAZZ: {
    T: {
      'maj7':  ['Bebop Major', 'Lydian'],
      'maj9':  ['Lydian', 'Bebop Major'],
      '6/9':   ['Major Pentatonic', 'Bebop Major'],
      'm7':    ['Bebop Dorian', 'Dorian'],
      'm9':    ['Bebop Dorian', 'Dorian'],
    },
    S: {
      'maj7':  ['Lydian', 'Bebop Major'],
      'm7':    ['Bebop Dorian', 'Dorian'],
      'm9':    ['Bebop Dorian'],
      'm11':   ['Bebop Dorian', 'Dorian'],
    },
    D: {
      '7':     ['Bebop Dominant', 'Mixolydian', 'Lydian Dominant'],
      '9':     ['Bebop Dominant', 'Mixolydian'],
      '13':    ['Bebop Dominant', 'Mixolydian'],
      '7alt':  ['Altered'],
      '7#11':  ['Lydian Dominant'],
      '13b9':  ['Half-Whole Diminished'],
    },
  },
  BLUES: {
    T: {
      '7':     ['Blues', 'Composite Blues', 'Major Blues'],
      'maj':   ['Major Blues', 'Country Blues'],
      '6':     ['Major Blues', 'Mixolydian'],
    },
    S: {
      '7':     ['Blues', 'Composite Blues'],
      'maj':   ['Major Blues'],
    },
    D: {
      '7':     ['Blues', 'Mixolydian'],
      '7#9':   ['Altered'],
    },
  },
  RNB: {
    T: {
      'm7':    ['Minor Pentatonic', 'Dorian'],
      'm9':    ['Dorian', 'Minor Pentatonic'],
      'maj7':  ['Major Pentatonic', 'Ionian'],
      'maj9':  ['Major Pentatonic', 'Ionian'],
      'm11':   ['Dorian', 'Minor Pentatonic'],
      'maj':   ['Major Pentatonic', 'Ionian'],
      'm':     ['Aeolian', 'Minor Pentatonic'],
    },
    S: {
      'm7':    ['Minor Pentatonic', 'Dorian'],
      'm9':    ['Dorian'],
      'm11':   ['Dorian'],
      'm7b5':  ['Locrian'],
    },
    D: {
      '7':     ['Mixolydian b6', 'Mixolydian'],
      '9':     ['Mixolydian b6', 'Mixolydian'],
      '13':    ['Mixolydian'],
      '7sus4': ['Mixolydian'],
      '7#9':   ['Altered'],
    },
  },
};

// gravityStrictness per macro — controls how aggressively the engine
// obeys SCALE_GRAVITY's resolution physics. Architecture: gravity is
// the SCALE's universal property (defined in musicTheory.ts), style
// only chooses how strictly to follow.
const POP_GRAVITY_STRICTNESS = 0.85;   // radio clean — strict resolutions
const JAZZ_GRAVITY_STRICTNESS = 0.35;  // delays + tensions hang
const BLUES_GRAVITY_STRICTNESS = 0.55; // mid
const RNB_GRAVITY_STRICTNESS = 0.50;   // moderate

export const STYLE_DICTIONARY: Record<StyleName, StyleProfile> = {
  POP:   { ...mergeStyles('POP', [
    'Pop Ballad', 'Synth Pop', 'Max Martin Pop',
    'Asian Pop Walkdown', 'Modern Stadium Pop', 'Modern Trap',
  ], 'POP family — pooled from 6 sub-styles (Pop Ballad, Synth Pop, Max Martin Pop, Asian Pop Walkdown, Modern Stadium Pop, Modern Trap). Motown Soul moved to RNB macro where it natively belongs.'), motifPool: MACRO_MOTIF_POOLS.POP, fillScales: MACRO_FILL_SCALES.POP, gravityStrictness: POP_GRAVITY_STRICTNESS },
  JAZZ:  { ...mergeStyles('JAZZ', [
    'Jazz Swing', 'Jazz Chromatic Drop', 'Bossa Nova',
  ], 'JAZZ family — pooled from 3 sub-styles (Jazz Swing, Jazz Chromatic Drop, Bossa Nova). Neo Soul R&B and Gospel Neo-Soul moved to RNB macro for clean genre separation.'), motifPool: MACRO_MOTIF_POOLS.JAZZ, fillScales: MACRO_FILL_SCALES.JAZZ, gravityStrictness: JAZZ_GRAVITY_STRICTNESS },
  BLUES: { ...mergeStyles('BLUES', [
    'Blues', 'Blues Turnaround',
  ], 'BLUES family — pooled from 2 sub-styles (Blues, Blues Turnaround).'), motifPool: MACRO_MOTIF_POOLS.BLUES, fillScales: MACRO_FILL_SCALES.BLUES, gravityStrictness: BLUES_GRAVITY_STRICTNESS },
  RNB:   { ...mergeStyles('RNB', [
    'Neo Soul R&B', 'Gospel Neo-Soul', 'Motown Soul',
  ], 'RNB family — pooled from 3 sub-styles (Neo Soul R&B, Gospel Neo-Soul, Motown Soul). Houses the soul / R&B / neo-soul lineage with its rich extended-chord vocabulary distinct from straight-ahead jazz.'), motifPool: MACRO_MOTIF_POOLS.RNB, fillScales: MACRO_FILL_SCALES.RNB, gravityStrictness: RNB_GRAVITY_STRICTNESS },
};


// ==========================================
// COMMON_TECHNIQUES — shared technique pool. Per the architecture
// agreement, individual styles reference these by name with a low weight,
// and the engine performs weighted random selection. M3d populated the
// basslines slot from src/lib/basslineRules.ts; textures and ornaments
// are reserved for later M3 phases.
// ==========================================

import { BASSLINE_RULES } from './basslineRules';

export const COMMON_TECHNIQUES: {
    basslines: Record<string, unknown>;
    textures: Record<string, unknown>;
    ornaments: Record<string, unknown>;
} = {
    basslines: BASSLINE_RULES,
    textures: {},
    ornaments: {}
};
