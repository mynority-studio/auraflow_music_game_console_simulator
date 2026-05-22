// ------------------------------------------------------------------
// Motif transformations — safe permutation generator.
//
// What: given a motif (sequence of MotifNote), permute the PITCH
// components (diatonicStep / chromaticOffset) while keeping the
// rhythmic skeleton (t, d) untouched. Filter to permutations that
// preserve "strong-beat chord-tone safety" — every motif note that
// lands on a meter strong beat must project to a pitch class within
// the chord's harmonic contract (literal + admissible extensions).
//
// Why: random permutation can rotate an avoid-note pitch onto a
// strong beat, breaking the chord (e.g. Fa on Cmaj strong beat is
// the classic avoid-note clash). This generator only returns
// permutations whose accent positions remain consistent with the
// chord type.
//
// Currently a pure utility — not wired into the engine. Available
// for future motifMutator extensions / user motif transformation
// features.
// ------------------------------------------------------------------

import { MotifNote, DiatonicMotifNote, ChromaticMotifNote } from './styleDictionary';
import { MeterContext, computeGlobalContract } from '../music-theory';

function isOnStrongBeat(t: number, meterContext: MeterContext): boolean {
  const bpm = meterContext.beatsPerMeasure;
  const beatInBar = (((t % bpm) + bpm) % bpm);
  return meterContext.strongBeats.some(sb => Math.abs(beatInBar - sb) < 0.001);
}

/**
 * Check if a diatonic step is safe on a strong beat for the given
 * chord type. Mode-aware via:
 *   - Even steps (0/2/4/6) are ALWAYS chord tones (root/3/5/7 of
 *     whatever chord quality). Always safe.
 *   - Odd steps (1/3/5) are color tones (9/11/13). Safe when the
 *     chord's GLOBAL CONTRACT admits that extension (chord literal
 *     plus quality-appropriate color — computeGlobalContract handles
 *     this: maj7 admits 9/13, m7 admits 9/11, dom admits 9/13, etc.).
 *
 * 9 = pc 2 from root, 11 = pc 5, 13 = pc 9.
 */
function isDiatonicStepSafe(
  diatonicStep: number,
  chordType: string,
  chordRootPc: number,
): boolean {
  const stepMod7 = (((diatonicStep % 7) + 7) % 7);
  if (stepMod7 === 0 || stepMod7 === 2 || stepMod7 === 4 || stepMod7 === 6) return true;
  const contract = computeGlobalContract(chordType, chordRootPc);
  const colorPc = stepMod7 === 1 ? 2 : stepMod7 === 3 ? 5 : 9;
  const absPc = (((chordRootPc + colorPc) % 12) + 12) % 12;
  return contract.pcs.has(absPc);
}

/**
 * Verify that every strong-beat-position motif note is safe:
 *   - DiatonicMotifNote: step is a chord tone (0/2/4/6) OR a color
 *     extension that the chord type admits.
 *   - ChromaticMotifNote: pc-from-root is inside the chord's global
 *     contract (chord literal + admissible color from
 *     computeGlobalContract).
 *
 * Notes with `bypassSnap` are exempt (authors marked them as
 * intentional out-of-contract colors).
 */
export function isMotifStrongBeatSafe(
  motif: MotifNote[],
  chordType: string,
  chordRootPc: number,
  meterContext: MeterContext,
): boolean {
  const contract = computeGlobalContract(chordType, chordRootPc);
  for (const note of motif) {
    if (!isOnStrongBeat(note.t, meterContext)) continue;
    if (note.bypassSnap) continue;
    if ('diatonicStep' in note) {
      if (!isDiatonicStepSafe(note.diatonicStep, chordType, chordRootPc)) return false;
    } else {
      const offset = (note as ChromaticMotifNote).chromaticOffset;
      const pc = (((chordRootPc + offset) % 12) + 12) % 12;
      if (!contract.pcs.has(pc)) return false;
    }
  }
  return true;
}

// Internal: bounded permutation generator. Yields up to `limit`
// permutations of [0..n) using Heap's algorithm with early exit.
function generatePermutations(n: number, limit: number): number[][] {
  const out: number[][] = [];
  const arr = Array.from({ length: n }, (_, i) => i);
  function permute(start: number): void {
    if (out.length >= limit) return;
    if (start === arr.length) {
      out.push([...arr]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
      if (out.length >= limit) return;
    }
  }
  permute(0);
  return out;
}

/**
 * Generate all permutations of the motif's pitch components that
 * preserve strong-beat chord-tone safety.
 *
 * Pitch components (diatonicStep / chromaticOffset / bypassSnap / ref)
 * are reassigned across the motif's (t, d) positions; the original
 * rhythmic skeleton stays intact. Only permutations where every
 * strong-beat-aligned position lands on the chord's harmonic
 * contract make it through.
 *
 * @returns at most `maxResults` safe permutations. Always includes
 *          the identity permutation when it's safe.
 *
 * @example
 *   // 4-note motif over Cmaj7 in 4/4 (strongs [0, 2]):
 *   const motif = [
 *     { t: 0,   d: 0.5, diatonicStep: 0 },  // step 0 = C (chord tone)
 *     { t: 0.5, d: 0.5, diatonicStep: 1 },  // step 1 = D (passing)
 *     { t: 1,   d: 1,   diatonicStep: 3 },  // step 3 = F (avoid in Cmaj7!)
 *     { t: 2,   d: 2,   diatonicStep: 2 },  // step 2 = E (chord tone, strong)
 *   ];
 *   const safe = safeMotifPermutations(motif, 'maj7', 0, ctx);
 *   // Identity is safe (strongs hit C, E). Permutations that put
 *   // step 3 (F) at t=0 or t=2 are filtered out.
 */
export function safeMotifPermutations(
  motif: MotifNote[],
  chordType: string,
  chordRootPc: number,
  meterContext: MeterContext,
  maxResults: number = 24,
): MotifNote[][] {
  if (motif.length === 0) return [[]];
  if (motif.length > 7) {
    // > 5040 permutations — bail to identity only (safe if original is safe).
    return isMotifStrongBeatSafe(motif, chordType, chordRootPc, meterContext) ? [motif] : [];
  }
  // Cap raw permutation generation at ~5x maxResults to bound work.
  const perms = generatePermutations(motif.length, Math.max(maxResults * 5, 120));

  const results: MotifNote[][] = [];
  for (const perm of perms) {
    const candidate: MotifNote[] = motif.map((origNote, i) => {
      const src = motif[perm[i]];
      if ('diatonicStep' in src) {
        const out: DiatonicMotifNote = {
          t: origNote.t,
          d: origNote.d,
          diatonicStep: src.diatonicStep,
        };
        if (src.bypassSnap !== undefined) out.bypassSnap = src.bypassSnap;
        if (src.ref !== undefined) out.ref = src.ref;
        return out;
      }
      const out: ChromaticMotifNote = {
        t: origNote.t,
        d: origNote.d,
        chromaticOffset: src.chromaticOffset,
      };
      if (src.bypassSnap !== undefined) out.bypassSnap = src.bypassSnap;
      if (src.ref !== undefined) out.ref = src.ref;
      return out;
    });
    if (isMotifStrongBeatSafe(candidate, chordType, chordRootPc, meterContext)) {
      results.push(candidate);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}
