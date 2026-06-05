// ============================================================
// newEngine · knowledge · MgMusicTheoryTables(MG strict 移植 Loop 4)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/musicTheory.ts 的旋律引擎子集忠实港(逐值提取):
//   MELODY_RANGE · CHORD_TYPES · SCALE_TYPES · ChordQuality · classifyEngineChordType ·
//   degree arrays · chordToDegreeArray · LITERAL_DEGREE_SEMITONES · resolveDegree。
// KB 合规:纯数据 + 纯函数,零 import,无 NoteIR / RNG / 音符生成。
// PitchClassSets(chord/scale 间隔)+ NoteChooser(MELODY_RANGE clamp / X 度数解析)消费。
// ============================================================

// ── MELODY_RANGE(musicTheory.ts:100)──
export const MELODY_RANGE = {
  LOW: 60,   // C4 (middle C) — below this is bass / comping territory
  HIGH: 86,  // D6 — soprano upper limit. Previously 89 (F6 / whistle
             // register) which produced uncalled-for Mariah-style highs
             // on pop/jazz melodies. D6 sits at the top of trained
             // soprano range and is the practical melodic ceiling for
             // mainstream pop/jazz vocal/lead-instrument idiom.
};

// ── SCALE_TYPES(musicTheory.ts:1163)──
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

// ── CHORD_TYPES(musicTheory.ts:4548)──
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

// ── ChordQuality + degree 解析(musicTheory.ts:3767-3907 + 4176)──
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
