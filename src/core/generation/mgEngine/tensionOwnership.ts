// Per-bar tension ownership planner — the core fix for dissonance.
//
// Decides who plays the upper extensions in this bar:
//   - melody owns color → comp goes shell (root + 3 + 7 only)
//   - comp owns color   → melody shouldn't long-stop on tension
//   - altered dominant  → comp keeps 3 + b7 ONLY unless melody avoids
//                         altered tones
//   - sus chord         → comp + melody can't both hit 3 and 4 hard
//
// Consumes:
//   - HarmonicSlot (Step 1)        — chord contract, sounding pcs
//   - melody preview events (Step 2) — real pitches with toneCategory
//   - texture metadata (Step 3)    — defaultCompingMode (for fallback)
//
// Produces:
//   TensionOwnership prescription per bar, consumed by the engine to
//   override CompingMode + filter altered tensions out of the texture
//   when appropriate. Pure function — no random consumption.

import type { HarmonicSlot } from './harmonicSlot';
import type { NoteEvent } from './musicEngine';
import type { CompingMode } from './rhythmContract';
import { CHORD_TYPES } from './musicTheory';

export type TensionOwner = 'melody' | 'comp' | 'shared' | 'neither';

export interface TensionOwnership {
  colorOwner: TensionOwner;
  /** Strip 9/11/13 from comp this bar — keep root/3/5/7 shell only. */
  stripExtensions: boolean;
  /** For altered dom: strip altered tensions from comp (keep just 3 + b7). */
  stripAlteredTensions: boolean;
  /** Sus chord + melody hitting the 3rd → comp goes shell to avoid 3↔4 mutex. */
  susConflict: boolean;
  /** Override the CompingMode dispatch — force shell_only when any
   *  of the above fires. Decided at planner; engine just reads. */
  forceCompingMode: CompingMode | null;
  /** Diagnostic — names the rule that fired (or 'none' / 'fallback'). */
  reason: string;
}

// Long-stop threshold — a melody note is considered sustained when its
// duration ≥ 1 beat. Shorter durations are passing/decoration; they don't
// declare ownership of the color even if they hit a STABLE_COLOR pc.
const SUSTAIN_BEAT_THRESHOLD = 1.0;

// Pattern detection on chord type names. Engines that use chord.type names
// like '7alt', 'sus4', '9sus', '7b9', '7#11', '13b9', etc.
function isAlteredDominant(chordType: string): boolean {
  // Altered tones in name: alt, b9, #9, b5, #5, #11, b13, b6
  // Excludes 'maj7' / 'add9' (NOT altered) — those don't carry an alteration
  // character; the regex requires one of the alteration tokens.
  if (/maj/.test(chordType)) return false;
  return /(alt|b9|#9|b5|#5|#11|b13|b6)/.test(chordType);
}

function isSusChord(chordType: string): boolean {
  return /sus/.test(chordType);
}

// pc helpers
const pcOf = (m: number) => ((m % 12) + 12) % 12;

// Altered-tension intervals for dom-family chords: anything that ISN'T a
// natural chord tone or natural extension.
//   Naturals: root(0) / 9(2) / 3(4) / 11(5) / 5(7) / 13(9) / b7(10)
//   Altered:  b9(1) / #9(3 — only when not the minor 3 of a min chord) /
//             #11=b5(6) / b13=#5(8)
// Given a chord type name + its declared interval list, return the set of
// chord-relative semitone offsets that are ALTERED. Empty if not altered.
function getAlteredIntervals(chordType: string): number[] {
  if (!isAlteredDominant(chordType)) return [];
  const ivs = CHORD_TYPES[chordType] ?? [];
  const NATURAL = new Set([0, 2, 4, 5, 7, 9, 10]);
  return ivs.filter(iv => !NATURAL.has(iv % 12));
}

export function decideTensionOwnership(
  slot: HarmonicSlot,
  melodyInBar: NoteEvent[],
): TensionOwnership {
  const chordType = slot.chord.type;
  const altered = isAlteredDominant(chordType);
  const sus = isSusChord(chordType);

  // Identify sustained vs decoration notes. Sustained = duration ≥ 1 beat.
  const sustained = melodyInBar.filter(e => e.duration >= SUSTAIN_BEAT_THRESHOLD);

  // Color ownership: does melody hold a STABLE_COLOR for ≥ 1 beat?
  const melodyHoldsColor = sustained.some(e => e.toneCategory === 'STABLE_COLOR');
  // Did melody hold a chord tone (CT)? Useful for shared-color cases.
  const melodyHoldsCT = sustained.some(e => e.toneCategory === 'CT');

  // sus 3-vs-4 mutex: chord is sus, melody hits pc=3rd at any moment.
  // Major-3rd-from-root = root+4; minor-3rd = root+3 (rare for sus types
  // but include for robustness).
  let susConflict = false;
  if (sus) {
    const rootPc = pcOf(slot.chord.rootMidi);
    const maj3 = (rootPc + 4) % 12;
    const min3 = (rootPc + 3) % 12;
    susConflict = melodyInBar.some(e => {
      const pc = pcOf(e.noteNumber);
      return pc === maj3 || pc === min3;
    });
  }

  // Color owner verdict
  const colorOwner: TensionOwner =
    melodyHoldsColor ? 'melody' :
    melodyHoldsCT    ? 'shared' :
                       'neither';

  // Altered dom: shell only WHEN melody is also on altered (= both
  // voices stacking dissonance). When melody is on naturals or chord
  // tones, comp can carry the altered colors without competing —
  // listener gets the harmonic info from comp while lick provides
  // a clean melodic line.
  let melodyTouchesAltered = false;
  if (altered) {
    const alteredIvs = getAlteredIntervals(chordType);
    const rootPc = pcOf(slot.chord.rootMidi);
    const alteredPcs = new Set(alteredIvs.map(iv => (rootPc + iv) % 12));
    melodyTouchesAltered = melodyInBar.some(e => alteredPcs.has(pcOf(e.noteNumber)));
  }

  // Strip prescriptions
  const stripExtensions = melodyHoldsColor;
  const stripAlteredTensions = altered && melodyTouchesAltered;

  // CompingMode override decision tree.
  // Priority: sus mutex > altered both-stacking > melody owns color.
  // Each fires shell_only; reason field tells which rule triggered.
  let forceCompingMode: CompingMode | null = null;
  let reason = 'none';
  if (susConflict) {
    forceCompingMode = 'shell_only';
    reason = 'sus_3_mutex';
  } else if (stripAlteredTensions) {
    forceCompingMode = 'shell_only';
    reason = 'altered_dom_both_on_altered';
  } else if (stripExtensions) {
    forceCompingMode = 'shell_only';
    reason = 'melody_owns_color';
  }

  return {
    colorOwner,
    stripExtensions,
    stripAlteredTensions,
    susConflict,
    forceCompingMode,
    reason,
  };
}
