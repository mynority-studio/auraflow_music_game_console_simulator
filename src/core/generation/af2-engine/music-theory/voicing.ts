// ============================================================
// voicing.ts — Voicing pipeline:role types / aesthetics / clash /
//              assembleVoicing / placeVoicingMidi / style presets /
//              hand-tuned style voicing tables
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: NoteFunctionRole / RegisterHint / CHORD_VOICING_AESTHETICS /
// getChordVoicingAesthetics (L1465-1574) + ClashResolution + resolveClash +
// preferredRegisterFor + isBassEligibleFor (L2163-2274) + VoicingStylePreference
// + assembleVoicing + placeVoicingMidi + buildChordVoicing + STYLE_* (L2275-2655) +
// override voicing tables (L3756-3937)。
// ============================================================

import { CHORD_TYPES } from './chord-types';
import { noteToMidi } from './midi';
import { CHORD_RANGE } from './midi';

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
    // === DOMINANT FAMILY (dom7, 9, 13, 7b9, 7#9, 7b13, 7#11, 7alt, etc.) ===
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
    }
};

export function getChordVoicingAesthetics(chordType: string) {
    if (chordType.includes('maj') || chordType === 'add9' || chordType === 'aug') return CHORD_VOICING_AESTHETICS['maj'];
    if (chordType.includes('m7b5') || chordType.includes('dim')) return CHORD_VOICING_AESTHETICS['m7b5'];
    if (chordType.includes('m') || chordType === 'min') return CHORD_VOICING_AESTHETICS['min'];
    if (chordType.includes('7') || chordType.includes('9') || chordType.includes('sus')) return CHORD_VOICING_AESTHETICS['dom7'];
    if (chordType === '6' || chordType === '6/9') return CHORD_VOICING_AESTHETICS['maj'];
    if (chordType === '5' || chordType === 'sus2' || chordType === 'sus4') return CHORD_VOICING_AESTHETICS['maj'];
    if (chordType === 'quartal') return CHORD_VOICING_AESTHETICS['min'];
    return CHORD_VOICING_AESTHETICS['maj']; // generic fallback
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
 */
function dropPriority(role: NoteFunctionRole, tensionLevel: number): number {
  const roleBase = role === 'AVOID_NOTE' ? 0
                 : role === 'AVAILABLE_TENSION' ? 1
                 : role === 'ALTERED_TENSION' ? 2
                 : 3;  // CHORD_TONE
  return roleBase + tensionLevel;
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

  // Step 5: If over density, drop lowest-priority pcs.
  if (pcs.length > style.density) {
    const table = getChordVoicingAesthetics(chordType);
    const scored = pcs.map(pc => {
      const iv = (((pc - chordRootPc) % 12) + 12) % 12;
      const entry = table[iv];
      return {
        pc,
        priority: entry ? dropPriority(entry.role, entry.tensionLevel) : 0,
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
  /** Phase 2(Impro-Visor HandManager):可选自定义 MIDI range。不传 → CHORD_RANGE 默认。
   *  HandPartitioner 调两次 placeVoicingMidi(LH range / RH range)实现分手。 */
  range?: { low: number; high: number },
): number[] {
  if (pcs.length === 0) return [];

  const effectiveLow = range?.low ?? CHORD_RANGE.LOW;
  const effectiveHigh = range?.high ?? CHORD_RANGE.HIGH;

  // Build candidate MIDI list for each pc — all octaves within range.
  const pcModNormalize = (pc: number): number => (((pc % 12) + 12) % 12);
  const candidates: number[][] = pcs.map(pc => {
    const pcMod = pcModNormalize(pc);
    const out: number[] = [];
    for (let m = pcMod; m <= 127; m += 12) {
      if (m < effectiveLow || m > effectiveHigh) continue;
      out.push(m);
    }
    // If empty (range too narrow for some pc), include closest in-range MIDI as fallback.
    if (out.length === 0) {
      const center = (effectiveLow + effectiveHigh) / 2;
      let best = pcMod + 60;
      let bestDist = Math.abs(best - center);
      for (let m = pcMod; m <= 127; m += 12) {
        const d = Math.abs(m - center);
        if (d < bestDist) { best = m; bestDist = d; }
      }
      out.push(best);
    }
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

// One-shot helper: assembleVoicing + placeVoicingMidi
export function buildChordVoicing(
  chordType: string,
  chordRootPc: number,
  bassMidi: number,
  prevVoicingMidi: number[],
  style: VoicingStylePreference,
): number[] {
  const pcs = assembleVoicing(chordType, chordRootPc, style);
  return placeVoicingMidi(pcs, prevVoicingMidi, bassMidi, chordType, chordRootPc);
}

// POP-only style presets(JAZZ ROOTLESS / RNB CLUSTER / BLUES 已退役)。
// STYLE_FULL / STYLE_SHELL 是通用 voicing 模式语义,保留。
export const STYLE_SHELL: VoicingStylePreference = {
  rootPolicy: 'include',
  density: 4,
  addColorOnTriad: false,
};
export const STYLE_FULL: VoicingStylePreference = {
  rootPolicy: 'include',
  density: 5,
  addColorOnTriad: false,
};

// JAZZ_ROOTLESS_VOICINGS 已退役(POP-only flat 化,2026-05-25)。

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
  // '11' = [0, 4, 7, 10, 14, 17]: the natural 11 sits a minor-9 above
  // the 3rd (E to F) — a classic pop avoid clash. Convention is to
  // drop the 3 and treat it as a sus11. Other chord types accept
  // CHORD_TYPES as-is in 'full' mode.
  '11':        [0, 5, 7, 10, 14],
};

// RNB_VOICINGS / BLUES_VOICINGS 已退役(POP-only flat 化,2026-05-25)。

// ------------------------------------------------------------------
// Global-harmony contract — under the divisi model, "stable" expands
// from 1/3/5 backbone to chord literal + admissible color extensions
// per quality (maj→9, min→9/11, dom→9/13, dim/aug stay narrow). Used
// by color magnetism (candidate pool for non-cadence structural notes)
// and by classifyCadenceTier downstream of the engine.
