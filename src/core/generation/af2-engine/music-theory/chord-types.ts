// ============================================================
// chord-types.ts — CHORD_TYPES / aliases / quality classification /
//                  backbone intervals / mode-aware substitutions /
//                  CHORD_COLOR_DICTIONARY(per-mode chord legality)
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: ChordQuality + classifyEngineChordType + getModeDegreeQuality +
// chordTypeFitsMode + qualityToDefaultEngineType + getModeAwareSubstitutions
// (L3217-3355) + backbone + findCommonTones (L3356-3411) + CHORD_TYPES +
// CHORD_TYPE_ALIASES + normalizeChordType (L3559-3755) + CHORD_COLOR_DICTIONARY
// (L3021-3118 - 挪到此处避免与 chord-color.ts 循环依赖)。
// ============================================================

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
  part: 'melody' | 'chord' | 'bass';
  origin?: 'motif' | 'develop' | 'return';
}

interface ChordLike {
  rootMidi: number;
  type: string;
  duration: number;
}

export type ChordQuality = 'major' | 'minor' | 'dominant' | 'halfDim' | 'diminished' | 'augmented';

export function classifyEngineChordType(type: string): ChordQuality {
  if (type === 'm7b5' || type === '7b5') return 'halfDim';
  if (type === 'dim' || type === 'dim7') return 'diminished';
  if (type === 'aug') return 'augmented';
  // Major variants — explicit 'maj' prefix or extension-marker names.
  if (/^maj/.test(type)) return 'major';
  if (type === 'add9' || type === 'add4' || type === '6' || type === '6/9' || type === 'sus4' || type === 'sus2') return 'major';
  // Minor: starts with 'm' but not 'maj' (already handled above).
  if (/^m/.test(type)) return 'minor';
  // Dominant family: starts with a 7/9/11/13 number, or is the literal
  // 'dom7'. 7sus / 9sus inherit dominant character.
  if (type === 'dom7') return 'dominant';
  if (/^(7|9|11|13)/.test(type)) return 'dominant';
  return 'major';
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

export function isChordBackbone(intervalToRoot: number, chordType: string): boolean {
  const pc = ((intervalToRoot % 12) + 12) % 12;
  return getChordBackboneIntervals(chordType).includes(pc);
}

// ------------------------------------------------------------------
// Theory advisor helpers — pure functions used to ground chord-voicing
// and tension-resolution decisions in classical voice-leading rules.
//
// findCommonTones — pitch classes shared between two chords. Drives
//   voicings that hold shared tones across chord transitions (smoother
//   voice leading, classical/jazz comping principle).
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
  'dom7':      ['dom7', 'dominant seventh'],
  '7':         ['7'],
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
