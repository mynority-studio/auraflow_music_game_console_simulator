// Melody Preview — project mutatedMotif to real NoteEvent[] BEFORE
// applyTexture runs, so the accompaniment can see actual pitches (not
// noteNumber=-999 placeholders).
//
// Why: prior architecture passed a time-only blueprint with -999 sentinel
// to applyTexture. The texture's close-pitch octave-drop guard (drop
// chord-tone an octave when within ±2 semis of melody) was therefore
// permanently dormant — every comparison against -999 returned huge
// distance. With real midis the guard activates as intended, dramatically
// reducing vertical m2/M2 between melody and texture.
//
// One-step projection rule: pitches come from chord.rootMidi +
// effectiveChromaticOffset(note, chord.type) — same formula the final
// emission loop uses. NO post-projection modification for lick notes
// (lickSource flag honored). For non-lick / develop notes the preview
// midi may differ slightly from the final midi after voice-leading +
// magnetism + cadence corrections (≤ 3 semis typical); texture collision
// is approximate to that bound, which is acceptable.

import type { ChordDef, NoteEvent } from './musicEngine';
import { effectiveChromaticOffset, MELODY_RANGE } from './musicTheory';
import {
  classifyAgainstContract,
  type MelodyChordContract,
  type LickToneCategory,
} from './melodyChordContract';

// mutatedMotif entries — what arrives from generateBarPattern's pre-projection
// stage. degreeLabel is set for lick notes; diatonicStep / chromaticOffset
// are set for motif-derived notes. effectiveChromaticOffset dispatches
// between the two.
export interface MotifEntry {
  t: number;
  d: number;
  degreeLabel?: string;
  diatonicStep?: number;
  chromaticOffset?: number;
  velocity?: number;
}

// Project ONE motif entry to absolute MIDI. Folds into MELODY_RANGE.
function projectMidi(m: MotifEntry, chord: Pick<ChordDef, 'rootMidi' | 'type'>): number {
  const offset = effectiveChromaticOffset(m as any, chord.type);
  let mid = chord.rootMidi + offset;
  while (mid > MELODY_RANGE.HIGH) mid -= 12;
  while (mid < MELODY_RANGE.LOW) mid += 12;
  return mid;
}

export interface BuildPreviewArgs {
  motif: MotifEntry[];
  chord: Pick<ChordDef, 'rootMidi' | 'type'>;
  startBeat: number;
  // The bar's symbol-derived chord contract — used to classify tone
  // category (CT / STABLE_COLOR / CONDITIONAL / AVOID / OTHER) per
  // preview note. If absent, toneCategory is left undefined.
  contract?: MelodyChordContract;
  // Lick triplet-idiom flag — when true, lick notes preserve authored
  // time without swing (triplet figures must stay un-swung). Non-lick
  // notes and straight-idiom lick notes go through applySwing.
  lickIsTripletIdiom?: boolean;
  // Swing function injected by caller (engine's applySwing). Without
  // this we'd need to import engine, creating a circular dep.
  applySwing: (t: number, isShuffle: boolean) => number;
  isShuffle: boolean;
}

// Build a preview NoteEvent for every mutatedMotif entry. Real midi
// + real time + real duration + lickSource flag + optional degree
// + optional toneCategory. The accompaniment / contracts / texture
// consume this directly.
export function buildMelodyPreview(args: BuildPreviewArgs): NoteEvent[] {
  const { motif, chord, startBeat, contract, lickIsTripletIdiom, applySwing, isShuffle } = args;
  const preview: NoteEvent[] = [];
  for (const m of motif) {
    const isLick = !!m.degreeLabel;
    const noteNumber = projectMidi(m, chord);
    const swungT = (isLick && lickIsTripletIdiom) ? m.t : applySwing(m.t, isShuffle);
    let toneCategory: LickToneCategory | undefined;
    if (contract) {
      const pc = ((noteNumber % 12) + 12) % 12;
      toneCategory = classifyAgainstContract(pc, contract);
    }
    // velocity hardcoded 100 — Step 2 dry-run replaces only the
    // noteNumber sentinel (-999 → real MIDI). Velocity / time /
    // duration mirror the original blueprint exactly. Side fields
    // (lickSource / degree / toneCategory) are stored on the
    // preview object for Step 4 consumers but applyTexture's reader
    // only looks at noteNumber + time + duration — no behavior side
    // effect from those fields here.
    preview.push({
      noteNumber,
      time: startBeat + swungT,
      duration: m.d,
      velocity: 100,
      part: 'melody',
      lickSource: isLick || undefined,
      degree: m.degreeLabel,
      toneCategory,
    });
  }
  return preview;
}
