// ==========================================
// arrangementContract.ts
//
// Per-bar contract that COUPLES lick + accompaniment without rewriting
// either system. Both sides read the same contract object:
//
//   lick side  ← reads voicingPcs + voicingMidis → can detect upcoming
//                m2/m9 clashes against actual sounding voicing
//   texture side ← reads attackCount + compingMode + lickActiveTimes
//                  → strips chord voicing to guide tones on dense bars,
//                    drops chord events overlapping melody attacks
//
// Design principle (per user direction): do NOT replace our texture
// pool / voicing engine / bass pattern data. The contract is a
// per-bar OBSERVATION + a small set of POST-EVENT FILTERS applied to
// the texture's output. Texture authoring stays unchanged.
//
// Mirrors Impro-Visor's "style = pattern set shared across bass/chord/
// drum + swing/comp-swing" but applied to OUR existing pattern data
// rather than importing theirs.
// ==========================================

import type { ChordDef, NoteEvent } from './musicEngine';
import { CHORD_TYPES } from './musicTheory';
import {
  MelodyChordContract,
  buildMelodyChordContract,
  inferContractFamily,
} from './melodyChordContract';
import {
  CompingMode,
  decideCompingModeForLick,
  buildBarLickContract,
  BarLickContract,
  RhythmFeel,
} from './rhythmContract';

export interface ArrangementContract {
  barIdx: number;
  startBeat: number;
  duration: number;

  // Lick-side view (read by texture)
  barLick: BarLickContract;
  compingMode: CompingMode;
  lickAttackTimes: number[];      // absolute times where lick fires (for melody-overlap drop)
  lickActiveWindows: Array<{ start: number; end: number }>;
  /** Pairs of (absolute attack time, projected midi) — used by texture
   *  filter to detect m2/m9 clashes between simultaneous lick + chord. */
  lickAttacks: Array<{ time: number; midi: number }>;

  // Chord-side view (read by lick + texture)
  chord: ChordDef;
  melodyContract: MelodyChordContract;
  voicingPcs: Set<number>;        // pcs actually sounding in chord voicing
  voicingMidis: number[];         // actual MIDIs

  // Shared
  songFeel: RhythmFeel;
}

export function buildArrangementContract(args: {
  barIdx: number;
  startBeat: number;
  chord: ChordDef;
  lickNotes: Array<{ t: number; d: number; degreeLabel?: string; chromaticOffset?: number }>;
  lickProjectedMidis?: Array<{ t: number; midi: number }>;
  voicingMidis: number[];
  style: string;
  songFeel: RhythmFeel;
}): ArrangementContract {
  const { barIdx, startBeat, chord, lickNotes, voicingMidis, style, songFeel, lickProjectedMidis } = args;
  const barLick = buildBarLickContract(lickNotes, chord.duration);
  const compingMode = decideCompingModeForLick(barLick);
  const melodyContract = buildMelodyChordContract(chord, { style: style as any });
  const voicingPcs = new Set(voicingMidis.map(m => ((m % 12) + 12) % 12));
  const lickAttackTimes: number[] = [];
  const lickActiveWindows: Array<{ start: number; end: number }> = [];
  const lickAttacks: Array<{ time: number; midi: number }> = [];
  for (let i = 0; i < lickNotes.length; i++) {
    const n = lickNotes[i];
    if (n.t >= chord.duration - 0.001) continue;
    const absTime = startBeat + n.t;
    lickAttackTimes.push(absTime);
    lickActiveWindows.push({ start: absTime, end: absTime + n.d });
    // Use provided projected midi if available; else best-effort estimate from
    // chord root + degree (caller may not have final emit midi yet).
    const projected = lickProjectedMidis?.[i]?.midi;
    if (projected !== undefined) {
      lickAttacks.push({ time: absTime, midi: projected });
    }
  }
  return {
    barIdx, startBeat,
    duration: chord.duration,
    barLick,
    compingMode,
    lickAttackTimes,
    lickActiveWindows,
    lickAttacks,
    chord,
    melodyContract,
    voicingPcs,
    voicingMidis: [...voicingMidis],
    songFeel,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Guide-tone intervals — for shell stripping
// ─────────────────────────────────────────────────────────────────────

/**
 * Return the chord's GUIDE TONES — minimal-vocabulary chord identity:
 *   dominant       → [M3, b7]      (= the tritone, dom signature)
 *   dominant_sus   → [P4, b7]      (= sus replacing M3 + b7)
 *   major_7        → [M3, M7]
 *   major (triad/add/6/6-9) → [M3, P5]
 *   minor_7        → [b3, b7]
 *   minor (triad/add/6) → [b3, P5]
 *   minor_major_7  → [b3, M7]
 *   half_dim       → [b3, b5, b7]
 *   dim/dim7       → [b3, b5]
 *
 * Returned as intervals (semitones from chord root, mod 12).
 */
export function guideToneIntervalsFor(chord: ChordDef): number[] {
  const literalIvs = CHORD_TYPES[chord.type] ?? [0, 4, 7];
  const family = inferContractFamily(chord.type, literalIvs);
  switch (family) {
    case 'dominant':       return [4, 10];
    case 'dominant_sus':   return [5, 10];
    case 'major_7':        return [4, 11];
    case 'major_triad':
    case 'major_add':
    case 'major_6':
    case 'major_6_9':
    case 'major_sus':      return [4, 7];
    case 'minor_7':        return [3, 10];
    case 'minor_triad':
    case 'minor_add':
    case 'minor_6':        return [3, 7];
    case 'minor_major_7':  return [3, 11];
    case 'half_dim':       return [3, 6, 10];
    case 'dim':
    case 'dim7':           return [3, 6];
    case 'aug':            return [4, 8];
    default:               return [4, 7];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Texture event filter — applies compingMode to chord events.
//
// Filters CHORD events only — bass / melody untouched. The filter is a
// READ-ONLY post-process on textureEvents; the underlying texture
// pattern data is unchanged.
//
// Modes:
//   full_voicing       → no change
//   shell_only         → keep only guide tones (M3+b7 / b3+b7 / etc.)
//   bass_plus_shell    → keep only ONE guide tone (the chord 3rd; bass
//                        layer survives separately) → ULTRA-thin comp
//   answer_only        → drop any chord event whose time-window overlaps
//                        a lick attack; chord plays only in melodic gaps
//
// Per user direction: don't replace texture authoring; just gate chord
// events at render time when contract demands sparser comp.
// ─────────────────────────────────────────────────────────────────────

export function applyCompingModeToTextureEvents(
  events: NoteEvent[],
  contract: ArrangementContract,
  melodyOverlapTolerance: number = 0.15,
): NoteEvent[] {
  const rootPc = ((contract.chord.rootMidi % 12) + 12) % 12;
  const guides = guideToneIntervalsFor(contract.chord);
  const primaryGuide = guides[0];

  // Detect overlap with any lick attack window.
  const overlapsLick = (eTime: number, eDur: number): boolean => {
    const eEnd = eTime + eDur;
    for (const win of contract.lickActiveWindows) {
      if (win.start < eEnd - melodyOverlapTolerance && win.end > eTime + melodyOverlapTolerance) {
        return true;
      }
    }
    return false;
  };

  // Melody-active m2 prevention — fires regardless of compingMode.
  // A chord event clashes with a lick attack when:
  //   - lick attack falls within chord event's [start, end) window
  //     (i.e., chord is sounding when lick fires), AND
  //   - the two MIDIs form m2 / m9 / M7 across octaves (chromatic cluster).
  // Drop the chord event in that case. Real pianists alternate voicings.
  const clashesWithSimultaneousLick = (e: NoteEvent): boolean => {
    const eEnd = e.time + e.duration;
    for (const atk of contract.lickAttacks) {
      // Lick attack must fall within the chord event's active window
      // (with small tolerance for grid jitter).
      if (atk.time < e.time - 0.05) continue;
      if (atk.time > eEnd - 0.02) continue;
      const diff = Math.abs(atk.midi - e.noteNumber);
      const mod12 = diff % 12;
      if (diff <= 2 || mod12 === 1 || mod12 === 11) return true;
    }
    return false;
  };

  return events.filter(e => {
    if (e.part !== 'chord') return true;          // bass / melody unaffected
    // Universal: drop chord event that forms m2/m9 with simultaneous lick attack.
    // This applies to ALL compingModes (including full_voicing) — the listener
    // perceives same-beat half-step cluster as harsh regardless of style.
    if (clashesWithSimultaneousLick(e)) return false;

    const pc = ((e.noteNumber % 12) + 12) % 12;
    const iv = ((pc - rootPc) % 12 + 12) % 12;
    if (contract.compingMode === 'shell_only') {
      return guides.includes(iv);
    }
    if (contract.compingMode === 'bass_plus_shell') {
      return iv === primaryGuide;
    }
    if (contract.compingMode === 'answer_only') {
      return !overlapsLick(e.time, e.duration);
    }
    // full_voicing — chord event already passed the m2 check above
    return true;
  });
}
