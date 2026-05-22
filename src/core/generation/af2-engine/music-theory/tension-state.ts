// ============================================================
// tension-state.ts — TensionTracker / TensionState / evaluateTensionState
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: TensionTracker class (L2656-2760) + TensionState + HarmonicState +
// evaluateTensionState (L3461-3558)。
// ============================================================

import { CHORD_TYPES } from './chord-types';
import { INTERVAL_AESTHETICS, kkTensionMajor, kkTensionMinor } from './tendency';

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

