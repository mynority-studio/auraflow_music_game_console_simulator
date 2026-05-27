// ==========================================
// melodyChordContract.ts
//
// Per-chord-INSTANCE melody interpretation layer.
//
// Purpose: the engine's chord generation + bass + voicing + accompaniment
// texture all stay UNCHANGED — they keep operating on raw ChordDef. This
// module sits AFTER chord generation and PRODUCES a read-only contract
// that the lick / melody selection layer consults to decide:
//   - which pitch classes are STABLE chord tones
//   - which are STABLE_COLOR (long-stop allowed)
//   - which are CONDITIONAL (weak+short OR must resolve)
//   - which are AVOID (only very short + resolves OR rejected)
//
// Critical distinctions (user direction):
//   - Cmadd9 ≠ Cm9         (add9 has no b7; b7 is conditional, not stable)
//   - Cadd9  ≠ Cmaj9       (add has no M7; M7 conditional, not stable)
//   - G7sus  ≠ G7          (sus stable=4; 3 conditional only as 4→3 resolution)
//   - Em7b5/D analyzed by E half-dim from root E; bass D doesn't change
//     chord body. C7/A: A is bass color, NOT a melody chord tone.
//
// The contract does NOT:
//   - rewrite ChordDef
//   - upgrade chord type (Cmadd9 stays Cmadd9, no auto-promote to Cm9)
//   - touch bass / voicing / accompaniment
//
// Sources:
//   - Impro-Visor chord-scale theory (Russell / Levine vocabulary)
//   - Caplin 1998 functional dissonance treatment
//   - user direction (5-seed log review): contract must distinguish
//     instance-specific extensions, not generalize to family
// ==========================================

import { CHORD_TYPES, noteToMidi } from './musicTheory';
import type { ChordDef } from './musicEngine';

// ─────────────────────────────────────────────────────────────────────
// Chord symbol parser — extracts root + extension + slash bass from
// strings like 'Cmaj9', 'Em7b5/D', 'C6/9', 'C6/9/G', 'Db7#11/F'.
//
// Slash detection: only the LAST `/[A-G][#b]?$` is treated as slash
// bass (so `C6/9` parses as ext='6/9', not bass='9'). Used to override
// chord.type when symbol has more specific extension info (e.g., chord.
// type='maj7' but chordSymbol='Cmaj9' → effectiveType='maj9').
// ─────────────────────────────────────────────────────────────────────

interface ParsedChordSymbol {
  rootPc: number;
  ext: string;
  bassPc: number | null;
}

export function parseChordSymbol(symbol: string | undefined): ParsedChordSymbol | null {
  if (!symbol) return null;
  const rootMatch = symbol.match(/^([A-G][#b]?)/);
  if (!rootMatch) return null;
  const rootStr = rootMatch[1];
  let rest = symbol.slice(rootStr.length);

  // Slash bass: matches /[A-G][#b]? at END, NOT followed by anything.
  const slashMatch = rest.match(/\/([A-G][#b]?)$/);
  let bassPc: number | null = null;
  if (slashMatch) {
    try { bassPc = noteToMidi(slashMatch[1] + '0') % 12; } catch { bassPc = null; }
    rest = rest.slice(0, -slashMatch[0].length);
  }

  let rootPc: number;
  try { rootPc = noteToMidi(rootStr + '0') % 12; } catch { return null; }

  return { rootPc, ext: rest, bassPc };
}

const EXT_ALIAS: Record<string, string> = {
  '': 'maj', 'M': 'maj', 'maj': 'maj', 'major': 'maj', 'Δ': 'maj',
  'm': 'min', 'min': 'min', '-': 'min', 'minor': 'min',
  'M7': 'maj7', 'Maj7': 'maj7', 'Δ7': 'maj7',
  'M9': 'maj9', 'Maj9': 'maj9', 'Δ9': 'maj9',
  'M13': 'maj13', 'Maj13': 'maj13', 'Δ13': 'maj13',
  'min7': 'm7', 'mi7': 'm7', '-7': 'm7',
  'min9': 'm9', '-9': 'm9',
  'min11': 'm11', '-11': 'm11',
  'min13': 'm13', '-13': 'm13',
  'Madd9': 'madd9', 'mAdd9': 'madd9', 'min(add9)': 'madd9',
  '7sus': '7sus4', '9sus': '9sus4', '13sus': '13sus4',
  'half-diminished': 'm7b5', 'm7(b5)': 'm7b5', 'ø': 'm7b5',
  'fully diminished': 'dim7', 'o7': 'dim7',
};

export function canonicalChordType(ext: string): string {
  const trimmed = ext.trim();
  if (EXT_ALIAS[trimmed]) return EXT_ALIAS[trimmed];
  if (CHORD_TYPES[trimmed]) return trimmed;
  return trimmed;
}

export type ContractFamily =
  | 'major_triad'      // C, Cadd4 (no 7, no 6, no 9)
  | 'major_add'        // Cadd9 (M3, no 7)
  | 'major_6'          // C6 (M3 + M6, no 7)
  | 'major_6_9'        // C6/9 (M3 + M6 + 9, no 7)
  | 'major_7'          // Cmaj7 / Cmaj9 / Cmaj13
  | 'minor_triad'      // Cm (no 7, no 6, no 9)
  | 'minor_add'        // Cmadd9 (m3, no 7)
  | 'minor_6'          // Cm6 (m3 + M6, no 7)
  | 'minor_7'          // Cm7 / Cm9 / Cm11 / Cm13
  | 'minor_major_7'    // CmMaj7
  | 'dominant'         // C7 / C9 / C13 / C7b9 / C7#11 / C7alt
  | 'dominant_sus'     // C7sus4 / C9sus4
  | 'major_sus'        // Csus2 / Csus4 (no 7)
  | 'half_dim'         // Cm7b5
  | 'dim'              // C dim (triad)
  | 'dim7'             // Cdim7
  | 'aug'              // Caug
  | 'unknown';

export type LickToneCategory =
  | 'CT'             // chord literal (1/3/5/7)
  | 'STABLE_COLOR'   // long-stop admissible (9 for add9, 13 for maj9, etc.)
  | 'CONDITIONAL'    // weak+short OR must resolve
  | 'AVOID'          // very-short-weak + must resolve, else rejected
  | 'OTHER';         // unclassified

export interface MelodyChordContract {
  rawSymbol: string;
  chordType: string;          // canonical type used to build this contract (may = chord.type or symbol-derived)
  rootPc: number;
  /** Set only when bass pc differs from root pc — for voice-leading hints only.
   *  NEVER added to chordTones for melody analysis; bass is bass. */
  bassPc?: number;
  /** True when bass pc is OUTSIDE the chord body's pitch classes (real slash
   *  chord like C7/A). False for inversions (C7/E where E is chord 3). */
  isSlashChord: boolean;

  family: ContractFamily;

  // ── Theoretical layer (from chord symbol parsing) ──
  /** Absolute pitch classes — root + chord-type literal intervals. */
  chordTones: Set<number>;
  /** Long-stop allowed color tones — chord type's stable extensions. */
  stableColors: Set<number>;
  /** Allowed only weak+short OR resolves-to-CT-next. */
  conditionalColors: Set<number>;
  /** Allowed only very-short (≤ 0.25 beat) on weak beat AND resolves. */
  avoidTones: Set<number>;

  // ── Sounding layer (from actual rendered voicing) — OPTIONAL ──
  /** Pitch classes actually sounding in the rendered voicing. Used to
   *  SUPPLEMENT stableColors when an extension-explainable pc is in the
   *  voicing but not declared by the chord type label. Never overrides
   *  avoidTones — voicing can't legitimize a theory avoid. */
  soundingPcs?: Set<number>;
  /** Actual MIDI numbers in the voicing — for register-aware clash
   *  detection (m2 / m9 / cluster), NOT for chord-tone classification. */
  soundingMidis?: number[];

  source: {
    chordSymbol: string;
    declaredType: string;       // chord.type as engine declared it
    effectiveType: string;      // canonical type used for theoretical layer
    typeFromSymbol: boolean;    // true = effectiveType was derived from chordSymbol parsing
    voicingWasUsed: boolean;
  };

  rules: {
    maxUnresolvedAvoid: number;
    maxUnresolvedConditional: number;
  };
}

export interface ContractContext {
  style: 'POP' | 'RNB' | 'JAZZ' | 'BLUES' | 'LOFI';
  mode?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Family inference — looks at WHICH chord-literal intervals are present.
// ─────────────────────────────────────────────────────────────────────

export function inferContractFamily(chordType: string, literalIvs: number[]): ContractFamily {
  const ivs = new Set(literalIvs.map(iv => ((iv % 12) + 12) % 12));
  const hasM3 = ivs.has(4);
  const hasm3 = ivs.has(3);
  const has4  = ivs.has(5);
  const hasb5 = ivs.has(6);
  const has5  = ivs.has(7);
  const hasb6 = ivs.has(8);
  const has6  = ivs.has(9);
  const hasb7 = ivs.has(10);
  const hasM7 = ivs.has(11);
  const has9  = ivs.has(2);

  // Half-dim: m3 + b5 + b7
  if (hasm3 && hasb5 && hasb7) return 'half_dim';
  // Dim7: m3 + b5 + bb7 (= M6 = 9 semis from root)
  if (hasm3 && hasb5 && has6 && !hasb7) return 'dim7';
  // Dim triad: m3 + b5 (no 7)
  if (hasm3 && hasb5 && !hasb7 && !hasM7 && !has6) return 'dim';
  // Aug: M3 + #5 (= b6 = 8) without P5 AND without b7. Adding !hasb7
  // distinguishes pure augmented triad (Caug = C E G#) from augmented
  // DOMINANT (C7#5 / C9#5 / C7alt which all have b7); the latter must
  // route to 'dominant' family or its alterations get classified wrong
  // (Bug: 7alt's #9 = pc 3 = m3 + b13 = pc 8 = b6 would trigger aug
  // even though b7 is present, making guide tones M3+b6 instead of
  // M3+b7 and breaking shell stripping).
  if (hasM3 && hasb6 && !has5 && !hasb7 && !hasM7) return 'aug';
  // Sus dominant: 4 + b7 (no 3)
  if (has4 && hasb7 && !hasM3 && !hasm3) return 'dominant_sus';
  // Sus major: 4 (no 3, no 7) — sus2 / sus4
  if (has4 && !hasM3 && !hasm3 && !hasb7 && !hasM7) return 'major_sus';
  // Dominant: M3 + b7
  if (hasM3 && hasb7) return 'dominant';
  // Major 7: M3 + M7
  if (hasM3 && hasM7) return 'major_7';
  // Major 6/9: M3 + M6 + 9
  if (hasM3 && has6 && has9 && !hasb7 && !hasM7) return 'major_6_9';
  // Major 6: M3 + M6 (no 7, no 9)
  if (hasM3 && has6 && !hasb7 && !hasM7) return 'major_6';
  // Major add: M3 (+ optional 9), no 6, no 7
  if (hasM3 && !has6 && !hasb7 && !hasM7) {
    return has9 ? 'major_add' : 'major_triad';
  }
  // Minor mMaj: m3 + M7
  if (hasm3 && hasM7) return 'minor_major_7';
  // Minor 7: m3 + b7
  if (hasm3 && hasb7) return 'minor_7';
  // Minor 6: m3 + M6 (no 7)
  if (hasm3 && has6 && !hasb7 && !hasM7) return 'minor_6';
  // Minor add: m3 (+ optional 9), no 6, no 7
  if (hasm3 && !has6 && !hasb7 && !hasM7) {
    return has9 ? 'minor_add' : 'minor_triad';
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────
// EXACT chord-type contracts — keyed by engine's chord.type string.
//
// Lookup priority (per user's "contract must be per-instance" rule):
//   1. EXACT_CHORD_CONTRACTS[chord.type]                ← preferred
//   2. CHORD_TYPE_ALIASES[chord.type] → primary entry   ← alias
//   3. inferContractFamily()-based FAMILY_RULES fallback ← debug warning
//
// Degree labels (1, b3, #4, b7, etc.) are interpreted via the
// chord-family-aware resolveDegree() so they map to the right semitones
// regardless of the chord type's specific scale convention.
//
// Critical distinctions enforced here (NOT collapsed into one family):
//   - Cmadd9 ≠ Cm9: b7 is CONDITIONAL on madd9, STABLE on m9.
//   - Cadd9 ≠ Cmaj9: M7 is CONDITIONAL on add9, STABLE on maj9.
//   - C6/9 ≠ Cmaj9: 6/9 has M6 stable, no M7; maj9 has M7, M6 conditional.
//   - G7sus4 ≠ G7: 4 stable on 7sus; 3 ONLY as conditional 4→3 resolution.
//   - G7alt ≠ G7: all alterations stable on alt; 9/5/13 avoid.
// ─────────────────────────────────────────────────────────────────────

interface ExactContract {
  stable: string[];        // degree labels — long-stop OK
  conditional: string[];   // OK weak+short OR resolves
  avoid: string[];         // OK only weak + d ≤ 0.25 + resolves
}

const EXACT_CHORD_CONTRACTS: Record<string, ExactContract> = {
  // ── Major triad family ─────────────────────────────────────────
  'maj':   { stable: ['1', '3', '5'],          conditional: ['9', '6', '7', '#11'],   avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'min':   { stable: ['1', 'b3', '5'],         conditional: ['b7', '9', '11', '6', 'b6'], avoid: ['3', '7', 'b2', '#4'] },

  // ── Major 7-family — 9 and 13 are standard upper colors (Levine).
  // Stable colors give the listener clear chord identity; conditional
  // restricted to less-common alterations.
  'maj7':    { stable: ['1', '3', '5', '7', '9', '13'], conditional: ['#11', '6'],              avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'maj9':    { stable: ['1', '3', '5', '7', '9', '13'], conditional: ['#11', '6'],              avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'maj13':   { stable: ['1', '3', '5', '7', '9', '13'], conditional: ['#11'],                   avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'maj7#11': { stable: ['1', '3', '5', '7', '#11', '9', '13'], conditional: ['6'],              avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'maj9#11': { stable: ['1', '3', '5', '7', '9', '#11', '13'], conditional: ['6'],              avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },

  // ── Major 6 / 6-9 / add ────────────────────────────────────────
  '6':     { stable: ['1', '3', '5', '6'],         conditional: ['9', '#11', '7'],     avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  '6/9':   { stable: ['1', '3', '5', '6', '9'],    conditional: ['#11', '7'],          avoid: ['4', 'b3', 'b2', 'b6', 'b7'] },
  'add9':  { stable: ['1', '3', '5', '9'],         conditional: ['7', '6', '#11', 'b7'], avoid: ['4', 'b3', 'b2', 'b6'] },

  // ── Sus (no 7) ─────────────────────────────────────────────────
  'sus2':  { stable: ['1', '5', '9'],              conditional: ['6', '4', '7'],       avoid: ['b3', '3', 'b2'] },
  'sus4':  { stable: ['1', '4', '5'],              conditional: ['9', '6', '7'],       avoid: ['b3', '3', 'b2'] },

  // ── Minor triad / add / 6 ──────────────────────────────────────
  'madd9':  { stable: ['1', 'b3', '5', '9'],          conditional: ['b7', '11', 'b6', '6'], avoid: ['3', '7', 'b2', '#4'] },
  'm6':     { stable: ['1', 'b3', '5', '6'],          conditional: ['9', 'b7', '11'],       avoid: ['3', '7', 'b6', 'b2', '#4'] },
  'm6/9':   { stable: ['1', 'b3', '5', '6', '9'],     conditional: ['11', 'b7'],            avoid: ['3', '7', 'b6', 'b2', '#4'] },

  // ── Minor 7 family (Dorian-flavored): 9 and 11 standard color, 6 / 13
  // conditional (Dorian native, mixes with Aeolian). b6 conditional.
  'm7':     { stable: ['1', 'b3', '5', 'b7', '9', '11'], conditional: ['6', '13', 'b6'],     avoid: ['3', '7', 'b2', '#4'] },
  'm9':     { stable: ['1', 'b3', '5', 'b7', '9', '11'], conditional: ['6', '13', 'b6'],     avoid: ['3', '7', 'b2', '#4'] },
  'm11':    { stable: ['1', 'b3', '5', 'b7', '9', '11'], conditional: ['6', '13', 'b6'],     avoid: ['3', '7', 'b2', '#4'] },
  'm13':    { stable: ['1', 'b3', '5', 'b7', '9', '11', '13'], conditional: ['b6'],          avoid: ['3', '7', 'b2', '#4'] },
  'm7sus4': { stable: ['1', '4', '5', 'b7', '9'],        conditional: ['b3', '6', 'b6'],     avoid: ['3', '7', 'b2'] },

  // ── Minor-major 7 ──────────────────────────────────────────────
  'mMaj9':  { stable: ['1', 'b3', '5', '7', '9'],     conditional: ['11', '13', '#11', '6'], avoid: ['3', 'b7', 'b2', 'b6'] },

  // ── Dominant family ───────────────────────────────────────────
  '7':       { stable: ['1', '3', '5', 'b7'],            conditional: ['9', '13', 'b9', '#9', '#11', 'b13'], avoid: ['4', '7'] },
  'dom7':    { stable: ['1', '3', '5', 'b7'],            conditional: ['9', '13', 'b9', '#9', '#11', 'b13'], avoid: ['4', '7'] },
  '9':       { stable: ['1', '3', '5', 'b7', '9'],       conditional: ['13', '#11', 'b13'],     avoid: ['4', '7', 'b9'] },
  '11':      { stable: ['1', '5', 'b7', '9', '11'],      conditional: ['3', '13'],              avoid: ['7', 'b9'] },  // 11 chord typically omits 3
  '13':      { stable: ['1', '3', '5', 'b7', '9', '13'], conditional: ['#11'],                  avoid: ['4', '7', 'b9', 'b13'] },
  '7b9':     { stable: ['1', '3', '5', 'b7', 'b9'],      conditional: ['#9', '#11', '13', 'b13'], avoid: ['9', '4', '7'] },
  '7#9':     { stable: ['1', '3', '5', 'b7', '#9'],      conditional: ['b9', '#11', '13', 'b13'], avoid: ['4', '7'] },
  '7#11':    { stable: ['1', '3', '5', 'b7', '#11'],     conditional: ['9', '13', 'b9', '#9'],   avoid: ['4', '7', 'b13'] },
  '7b13':    { stable: ['1', '3', '5', 'b7', 'b13'],     conditional: ['b9', '#9', '#11'],       avoid: ['9', '4', '7', '13'] },
  '13b9':    { stable: ['1', '3', '5', 'b7', 'b9', '13'], conditional: ['#9', '#11'],            avoid: ['9', '4', '7', 'b13'] },
  '7alt':    { stable: ['1', '3', 'b7', 'b9', '#9', '#11', 'b13'], conditional: ['b5'],          avoid: ['9', '4', '7', '5', '13'] },
  '7b5':     { stable: ['1', '3', 'b5', 'b7'],           conditional: ['b9', '#9', '#11', '13', 'b13'], avoid: ['4', '5', '7'] },
  '7#5':     { stable: ['1', '3', '#5', 'b7'],           conditional: ['9', '#9', 'b9', '#11', '13'], avoid: ['4', '7', '5'] },
  '9#5':     { stable: ['1', '3', '#5', 'b7', '9'],      conditional: ['#9', '#11', '13'],       avoid: ['4', '7', '5', 'b9'] },
  '9#11':    { stable: ['1', '3', '5', 'b7', '9', '#11'], conditional: ['13', 'b13'],            avoid: ['4', '7', 'b9'] },
  '13#11':   { stable: ['1', '3', '5', 'b7', '9', '#11', '13'], conditional: ['b13'],            avoid: ['4', '7', 'b9'] },
  '7#9#11':  { stable: ['1', '3', '5', 'b7', '#9', '#11'], conditional: ['13', 'b13', 'b9'],     avoid: ['9', '4', '7'] },

  // ── Dominant sus (7 + sus4) ────────────────────────────────────
  '7sus4':   { stable: ['1', '4', '5', 'b7', '9', '13'], conditional: ['3', 'b9', '#9', 'b13'], avoid: ['7'] },
  '9sus4':   { stable: ['1', '4', '5', 'b7', '9', '13'], conditional: ['3', 'b9', '#9'],        avoid: ['7', 'b13'] },
  '13sus4':  { stable: ['1', '4', '5', 'b7', '9', '13'], conditional: ['3', '#11'],             avoid: ['7', 'b13'] },

  // ── Half-dim / dim ─────────────────────────────────────────────
  'm7b5':   { stable: ['1', 'b3', 'b5', 'b7'],      conditional: ['9', '11', 'b9', 'b13'], avoid: ['5', '7', '3', '13'] },
  'm9b5':   { stable: ['1', 'b3', 'b5', 'b7', '9'], conditional: ['11', 'b13'],            avoid: ['5', '7', '3', '13', 'b9'] },
  'dim':    { stable: ['1', 'b3', 'b5'],            conditional: ['bb7', '9', 'b9', '11'], avoid: ['5', '3', '7', 'b7', '#4'] },
  'dim7':   { stable: ['1', 'b3', 'b5', 'bb7'],     conditional: ['9', 'b9', '11', 'b13'], avoid: ['5', '3', '7', 'b7'] },

  // ── Aug + power ────────────────────────────────────────────────
  'aug':    { stable: ['1', '3', '#5'],          conditional: ['9', 'b7', '#11'],     avoid: ['5', 'b3', '4', '7', '13'] },
  '5':      { stable: ['1', '5'],                conditional: ['9', 'b7', '7', '3', 'b3'], avoid: [] },  // power chord — neutral

  // ── Quartal (modal voicing) ────────────────────────────────────
  'quartal': { stable: ['1', '4', 'b7', 'b3'],   conditional: ['5', '9', '11', '13'], avoid: ['3', '7'] },
};

// Aliases — chord types whose contract should mirror another entry exactly.
const CONTRACT_ALIASES: Record<string, string> = {
  // (none currently — keep slot for future)
};

// Family rule tables — fallback when an exact entry is missing.
// Stays conservative; per-instance accuracy comes from EXACT_CHORD_CONTRACTS.

interface FamilyRule {
  stable: number[];        // additional STABLE_COLOR offsets
  conditional: number[];
  avoid: number[];
}

const FAMILY_RULES: Record<ContractFamily, FamilyRule> = {
  major_triad: {
    // C major triad. 6/9 conditional (could upgrade chord); M7 conditional.
    stable: [],
    conditional: [9 /* M6 */, 2 /* 9 */, 11 /* M7 */, 6 /* #11 Lydian */],
    avoid: [5 /* P4 — clashes M3 */, 3 /* b3 */, 1 /* b2 */, 8 /* #5/b6 */],
  },
  major_add: {
    // Cadd9 = C E G D. 9 in chord. M6 conditional. M7/b7 conditional.
    // Do NOT promote to maj9 — M7 isn't stable here.
    stable: [],
    conditional: [9 /* M6 */, 11 /* M7 */, 6 /* #11 */, 10 /* b7 */],
    avoid: [5 /* P4 — clashes M3 */, 3 /* b3 */, 1 /* b2 */, 8 /* #5 */],
  },
  major_6: {
    // C6 = C E G A. M6 in chord. 9 stable. M7 conditional (could upgrade).
    stable: [2 /* 9 */],
    conditional: [11 /* M7 */, 6 /* #11 */],
    avoid: [5 /* P4 */, 3 /* b3 */, 1 /* b2 */, 8 /* #5/b6 */, 10 /* b7 — destroys 6 character */],
  },
  major_6_9: {
    // C6/9 = C E G A D. Both M6 and 9 in chord. 7 cond, 11 strong avoid.
    stable: [],
    conditional: [11 /* M7 */, 6 /* #11 */],
    avoid: [5 /* P4 — clashes M3 */, 3 /* b3 */, 1 /* b2 */, 8 /* #5 */, 10 /* b7 */],
  },
  major_7: {
    // Cmaj7 / Cmaj9 / Cmaj13. M7 in chord. 9, 13 stable; #11 conditional;
    // P4 still avoid (11 natural over maj is the classic Levine avoid).
    stable: [2 /* 9 */, 9 /* 13 */],
    conditional: [6 /* #11 */],
    avoid: [5 /* P4 */, 3 /* b3 */, 1 /* b2 */, 8 /* b6/#5 */, 10 /* b7 */],
  },

  minor_triad: {
    // Cm = C Eb G. b7 conditional (could upgrade m7), b6 cond (Aeolian).
    // M3 avoid (destroys minor); M7 avoid (mMaj7 specific).
    stable: [],
    conditional: [10 /* b7 */, 2 /* 9 */, 5 /* 11 */, 9 /* M6 Dorian */, 8 /* b6 Aeolian */],
    avoid: [4 /* M3 — breaks minor */, 11 /* M7 — mMaj7 specific */, 1 /* b2 */],
  },
  minor_add: {
    // Cmadd9 = C Eb G D. m3 + 9. b7 conditional (would make Cm9).
    // b6 cond (Aeolian color). M3 avoid. M7 avoid.
    // CRITICAL: do NOT promote to Cm9 — b7 is conditional, NOT stable.
    stable: [],
    conditional: [10 /* b7 */, 5 /* 11 */, 9 /* M6 */, 8 /* b6 */],
    avoid: [4 /* M3 */, 11 /* M7 */, 1 /* b2 */],
  },
  minor_6: {
    // Cm6 = C Eb G A. M6 in chord (Dorian flavor). 9 stable. b7 conditional.
    stable: [2 /* 9 */],
    conditional: [10 /* b7 */, 5 /* 11 */],
    avoid: [4 /* M3 */, 11 /* M7 */, 8 /* b6 — clashes M6 */, 1 /* b2 */],
  },
  minor_7: {
    // Cm7 / Cm9 / Cm11 / Cm13. m3 + b7. Dorian-flavored: M6 conditional
    // (Dorian birthright but mixes with Aeolian). 9, 11 stable; b6 cond
    // (Aeolian native, mixes with Dorian).
    stable: [2 /* 9 */, 5 /* 11 */],
    conditional: [9 /* M6 */, 8 /* b6 */, 9 /* 13 */],
    avoid: [4 /* M3 */, 11 /* M7 */, 1 /* b2 */],
  },
  minor_major_7: {
    // CmMaj7 = C Eb G B. m3 + M7 (melodic minor or harmonic minor).
    stable: [2 /* 9 */, 5 /* 11 */, 9 /* 13 */],
    conditional: [6 /* #11 */, 8 /* b6 */],
    avoid: [4 /* M3 */, 10 /* b7 */, 1 /* b2 */],
  },

  dominant: {
    // C7 / C9 / C13 / C7b9 / C7alt — M3 + b7. Alterations are conditional
    // unless declared in chord type. 11 natural avoid (clashes M3).
    stable: [2 /* 9 */, 9 /* 13 */],
    conditional: [1 /* b9 */, 3 /* #9 */, 6 /* #11 */, 8 /* b13 */],
    avoid: [5 /* P4 = 11 natural */, 11 /* M7 — breaks dom */],
  },
  dominant_sus: {
    // C7sus4 / C9sus4. 4 replaces 3. 9, 13 stable. 3 CONDITIONAL — only
    // as 4→3 resolution, NEVER long-stop on strong beat.
    stable: [2 /* 9 */, 9 /* 13 */],
    conditional: [4 /* M3 — only as 4→3 resolution */, 1 /* b9 */, 3 /* #9 */],
    avoid: [11 /* M7 */, 8 /* b13 */],
  },
  major_sus: {
    // Csus2 / Csus4 (no 7). 9 or 4 in chord (depending). M3 / m3 conditional.
    stable: [2 /* 9 */],
    conditional: [4 /* M3 */, 9 /* M6 */, 11 /* M7 */],
    avoid: [3 /* b3 */, 1 /* b2 */, 8 /* b6 */],
  },

  half_dim: {
    // Cm7b5 = C Eb Gb Bb. m3 + b5 + b7. Locrian #2 mode: 11 stable.
    // P5 avoid (chord has b5). 13 / M7 avoid.
    stable: [2 /* 9 — Locrian #2 */, 5 /* 11 */],
    conditional: [1 /* b9 — Locrian native */, 8 /* b13 */],
    avoid: [7 /* P5 — clashes b5 */, 11 /* M7 */, 9 /* 13 */],
  },
  dim: {
    // C dim (triad) = C Eb Gb. m3 + b5. Diminished scale.
    stable: [],
    conditional: [10 /* bb7 = 9 semis */, 2 /* 9 */, 1 /* b9 */],
    avoid: [11 /* M7 */, 7 /* P5 */, 4 /* M3 */, 10 /* b7 */],
  },
  dim7: {
    // Cdim7 = C Eb Gb Bbb. Symmetric — diminished scale.
    stable: [2 /* 9 */],
    conditional: [1 /* b9 */, 5 /* 11 */, 8 /* b13 */],
    avoid: [11 /* M7 */, 7 /* P5 */, 4 /* M3 */, 10 /* b7 */],
  },
  aug: {
    // Caug = C E G#. M3 + #5. Whole-tone scale.
    stable: [2 /* 9 */, 10 /* b7 — natural in whole-tone */, 6 /* #11 */],
    conditional: [11 /* M7 */],
    avoid: [3 /* b3 */, 7 /* P5 — chord has #5 */, 9 /* 13 — clashes #5 */, 5 /* P4 */],
  },

  unknown: {
    // Conservative fallback — treat as major_add.
    stable: [],
    conditional: [2, 9, 11, 6, 10],
    avoid: [5, 3, 1, 8],
  },
};

// ─────────────────────────────────────────────────────────────────────
// Per-style acceptance thresholds — copied from LICK_ACCEPT_POLICY
// (musicTheory.ts) for backward compat; kept local for readability.
// ─────────────────────────────────────────────────────────────────────

const CONTRACT_ACCEPT_THRESHOLDS: Record<string, { maxUnresolvedAvoid: number; maxUnresolvedConditional: number }> = {
  POP:   { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 1 },
  RNB:   { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 1 },
  LOFI:  { maxUnresolvedAvoid: 0, maxUnresolvedConditional: 0 },
  JAZZ:  { maxUnresolvedAvoid: 1, maxUnresolvedConditional: 3 },
  BLUES: { maxUnresolvedAvoid: 1, maxUnresolvedConditional: 2 },
};

// ─────────────────────────────────────────────────────────────────────
// Builder — ChordDef → MelodyChordContract
// ─────────────────────────────────────────────────────────────────────

// Track family-fallback usage for warnings — emit once per chord type per session.
const _familyFallbackWarned = new Set<string>();
const _devMode = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

/**
 * Build a read-only melody contract from a ChordDef. The ChordDef itself
 * is NOT modified; the bass / voicing / accompaniment are NOT touched.
 *
 * Lookup priority:
 *   1. EXACT_CHORD_CONTRACTS[chord.type] — per-instance precision
 *   2. CONTRACT_ALIASES → primary entry
 *   3. inferContractFamily() family rule — fallback only, dev warning
 */
export function buildMelodyChordContract(
  chord: ChordDef,
  ctx: ContractContext,
): MelodyChordContract {
  const rootPc = ((chord.rootMidi % 12) + 12) % 12;
  const bassPc = ((chord.bassMidi % 12) + 12) % 12;

  // ── Theoretical layer: prefer chord.chordSymbol-derived type. ──
  // chord.type may lag the actual symbol (e.g., chord.type='maj7' but
  // chordSymbol='Cmaj9'). Symbol carries the explicit extensions;
  // contract should use the more specific type when available.
  let effectiveType = chord.type;
  let typeFromSymbol = false;
  if (chord.chordSymbol) {
    const parsed = parseChordSymbol(chord.chordSymbol);
    if (parsed) {
      const canonical = canonicalChordType(parsed.ext);
      // Only override if canonical maps to a known chord type AND it's
      // MORE specific than chord.type (has more literal intervals).
      if (CHORD_TYPES[canonical] && canonical !== chord.type) {
        const declaredIvs = CHORD_TYPES[chord.type]?.length ?? 0;
        const canonicalIvs = CHORD_TYPES[canonical].length;
        if (canonicalIvs >= declaredIvs) {
          effectiveType = canonical;
          typeFromSymbol = true;
        }
      }
    }
  }
  const literalIvs = CHORD_TYPES[effectiveType] ?? CHORD_TYPES[chord.type] ?? [0, 4, 7];

  // Chord tones = root + chord literal intervals ONLY (per effective type).
  // Slash bass NEVER added to chordTones — bass is bass.
  const chordTones = new Set<number>();
  for (const iv of literalIvs) chordTones.add((rootPc + iv) % 12);

  const isSlashChord = bassPc !== rootPc && !chordTones.has(bassPc);
  const family = inferContractFamily(effectiveType, literalIvs);

  const stableColors = new Set<number>();
  const conditionalColors = new Set<number>();
  const avoidTones = new Set<number>();

  const aliasedType = CONTRACT_ALIASES[effectiveType] ?? effectiveType;
  const exact = EXACT_CHORD_CONTRACTS[aliasedType];

  if (exact) {
    for (const deg of exact.stable) {
      const pc = ((rootPc + resolveDegree(deg, effectiveType)) % 12 + 12) % 12;
      if (!chordTones.has(pc)) stableColors.add(pc);
    }
    for (const deg of exact.conditional) {
      const pc = ((rootPc + resolveDegree(deg, effectiveType)) % 12 + 12) % 12;
      if (!chordTones.has(pc) && !stableColors.has(pc)) conditionalColors.add(pc);
    }
    for (const deg of exact.avoid) {
      const pc = ((rootPc + resolveDegree(deg, effectiveType)) % 12 + 12) % 12;
      if (!chordTones.has(pc) && !stableColors.has(pc) && !conditionalColors.has(pc)) {
        avoidTones.add(pc);
      }
    }
  } else {
    if (_devMode && !_familyFallbackWarned.has(effectiveType)) {
      _familyFallbackWarned.add(effectiveType);
      console.warn(`[melodyChordContract] No EXACT_CHORD_CONTRACTS entry for '${effectiveType}'; falling back to family='${family}'.`);
    }
    const rule = FAMILY_RULES[family];
    for (const iv of rule.stable) {
      const pc = (rootPc + iv) % 12;
      if (!chordTones.has(pc)) stableColors.add(pc);
    }
    for (const iv of rule.conditional) {
      const pc = (rootPc + iv) % 12;
      if (!chordTones.has(pc) && !stableColors.has(pc)) conditionalColors.add(pc);
    }
    for (const iv of rule.avoid) {
      const pc = (rootPc + iv) % 12;
      if (!chordTones.has(pc) && !stableColors.has(pc) && !conditionalColors.has(pc)) {
        avoidTones.add(pc);
      }
    }
  }

  // ── Sounding layer: actual voicing pcs/midis. ──
  // Used by classifier to SUPPLEMENT stableColors (only when interval is
  // extension-explainable AND not already in chord/stable/conditional/avoid).
  // Used by ArrangementContract for register-aware m2/m9 clash detection.
  const voicingMidis: number[] = chord.notesMidi ?? (chord.notes?.map((n: string) => noteToMidi(n)) ?? []);
  const soundingPcs = new Set<number>(voicingMidis.map(m => ((m % 12) + 12) % 12));
  const voicingWasUsed = voicingMidis.length > 0;

  const threshold = CONTRACT_ACCEPT_THRESHOLDS[ctx.style] ?? CONTRACT_ACCEPT_THRESHOLDS.JAZZ;

  return {
    rawSymbol: chord.chordSymbol ?? `${chord.type}@${rootPc}`,
    chordType: effectiveType,
    rootPc,
    bassPc: bassPc !== rootPc ? bassPc : undefined,
    isSlashChord,
    family,
    chordTones,
    stableColors,
    conditionalColors,
    avoidTones,
    soundingPcs: voicingWasUsed ? soundingPcs : undefined,
    soundingMidis: voicingWasUsed ? voicingMidis : undefined,
    source: {
      chordSymbol: chord.chordSymbol ?? '',
      declaredType: chord.type,
      effectiveType,
      typeFromSymbol,
      voicingWasUsed,
    },
    rules: { ...threshold },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Classifier — pitch class → tone category against a contract
// ─────────────────────────────────────────────────────────────────────

// Extension intervals — pcs that are theory-explainable as upper chord
// extensions (used by the voicing supplement to upgrade OTHER → STBL).
// Excludes intervals that ARE chord-tone roles (root 0, M3 4, P5 7, M7 11)
// and intervals that are nearly always avoid (P4 5 over dom; b2 1 cluster).
const EXTENSION_INTERVALS = new Set<number>([
  2,   // 9
  3,   // #9 / b3
  5,   // 11
  6,   // #11
  8,   // b13 / #5
  9,   // 13 / M6
  10,  // b7
]);

export function classifyAgainstContract(notePc: number, contract: MelodyChordContract): LickToneCategory {
  const pc = ((notePc % 12) + 12) % 12;
  if (contract.chordTones.has(pc)) return 'CT';
  if (contract.stableColors.has(pc)) return 'STABLE_COLOR';
  if (contract.conditionalColors.has(pc)) return 'CONDITIONAL';
  if (contract.avoidTones.has(pc)) return 'AVOID';
  // Voicing supplement — when pc isn't in any symbol-derived category
  // BUT is actually sounding in the rendered voicing AND the interval
  // is extension-explainable, upgrade to STABLE_COLOR. Never overrides
  // an AVOID verdict (theory still rules).
  if (contract.soundingPcs && contract.soundingPcs.has(pc)) {
    const iv = ((pc - contract.rootPc) % 12 + 12) % 12;
    if (EXTENSION_INTERVALS.has(iv)) return 'STABLE_COLOR';
  }
  return 'OTHER';
}

// ─────────────────────────────────────────────────────────────────────
// Lick dry-run evaluator (chord-instance-aware)
// ─────────────────────────────────────────────────────────────────────

import { resolveDegree } from './musicTheory';

/**
 * Dry-run a lick slice against a per-instance contract.
 *
 *   CT / STABLE_COLOR  → always OK.
 *   CONDITIONAL        → OK if (weak beat AND d < 0.5) OR step-resolves to
 *                        a CT next; else unresolved CONDITIONAL.
 *   AVOID              → OK only if (weak AND d ≤ 0.25 AND resolves to CT
 *                        next); else unresolved AVOID.
 *   OTHER              → unresolved CONDITIONAL.
 */
export function evaluateLickAgainstContract(
  slice: Array<{ t: number; d: number; degreeLabel?: string; chromaticOffset?: number }>,
  contract: MelodyChordContract,
  beatsPerMeasure: number = 4,
  nextNoteAfterSlice: { degreeLabel?: string; chromaticOffset?: number; contract: MelodyChordContract } | null = null,
): { unresolvedAvoid: number; unresolvedConditional: number; total: number } {
  let unresolvedAvoid = 0;
  let unresolvedConditional = 0;
  const strongMid = beatsPerMeasure / 2;
  const isStrong = (t: number) => {
    const beat = Math.floor(t);
    const frac = t - beat;
    return (beat === 0 || Math.abs(beat - strongMid) < 0.01) && frac < 0.05;
  };
  const projectPc = (note: { degreeLabel?: string; chromaticOffset?: number }, c: MelodyChordContract): number => {
    const semis = note.degreeLabel
      ? resolveDegree(note.degreeLabel, c.chordType)
      : (note.chromaticOffset ?? 0);
    return (((c.rootPc + semis) % 12) + 12) % 12;
  };
  for (let i = 0; i < slice.length; i++) {
    const n = slice[i];
    if (!n.degreeLabel && n.chromaticOffset === undefined) continue;
    const pc = projectPc(n, contract);
    const cat = classifyAgainstContract(pc, contract);
    if (cat === 'CT' || cat === 'STABLE_COLOR') continue;

    const strong = isStrong(n.t);
    const long = n.d >= 0.5;
    let resolves = false;
    if (i + 1 < slice.length) {
      const next = slice[i + 1];
      if (next.degreeLabel || next.chromaticOffset !== undefined) {
        const nextPc = projectPc(next, contract);
        const isNextCT = contract.chordTones.has(nextPc);
        const step = Math.abs(((nextPc - pc + 18) % 12) - 6);
        resolves = isNextCT && step <= 2;
      }
    } else if (nextNoteAfterSlice) {
      const nextC = nextNoteAfterSlice.contract;
      const nextPc = projectPc(nextNoteAfterSlice, nextC);
      const isNextCT = nextC.chordTones.has(nextPc);
      const step = Math.abs(((nextPc - pc + 18) % 12) - 6);
      resolves = isNextCT && step <= 2;
    }

    if (cat === 'AVOID') {
      const allowed = !strong && n.d <= 0.25 && resolves;
      if (!allowed) unresolvedAvoid++;
    } else { // CONDITIONAL or OTHER
      const allowed = (!strong && !long) || resolves;
      if (!allowed) unresolvedConditional++;
    }
  }
  return { unresolvedAvoid, unresolvedConditional, total: slice.length };
}
