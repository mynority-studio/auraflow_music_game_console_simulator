// ============================================================
// newEngine · knowledge · Groove Bass Patterns
// ------------------------------------------------------------
// Small, reusable rhythm cells selected by GrooveContract.bassPattern.
// These are not song transcriptions. They encode production principles from
// bass pedagogy: strong root anchors, intentional 16th-note syncopation,
// triplet grouping for gospel, space in neo-soul, and sustained half-time 808s.
//
// Research basis:
// - TalkingBass, "The 6 Essential 16th Note Rhythms"
//   https://www.talkingbass.net/6-essential-16th-note-rhythms-you-need-to-learn/
// - Smart Bass Guitar, "Unsung Bass Heroes: J Dilla"
//   https://smartbassguitar.com/unsung-bass-heroes-j-dilla/
// - StudyBass, "The Eighth Note Triplet Subdivision"
//   https://www.studybass.com/lessons/rhythm/the-eighth-note-triplet-subdivision/
// - Houston Symphony, "The Sound that Changed America: Motown"
//   https://houstonsymphony.org/the-sound-that-changed-america-the-history-of-motown/
// ============================================================

import type { BassPatternFamily } from '../intent/MusicIntentPlan';
import {
  BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
  bassRoleRhythmPattern,
} from './roleRhythmPatterns';

export type GrooveBassVoice = 'root' | 'third' | 'fifth';
export type GrooveBassRegisterPolicy = 'voice-led' | 'root-fifth-frame';

export interface GrooveBassPatternHit {
  /** Beat within the bar. */
  beat: number;
  durationBeats: number;
  /** Normalized touch, converted to MIDI velocity by the renderer. */
  velocity: number;
  voice: GrooveBassVoice;
}

export interface GrooveBassPattern {
  id: GrooveBassPatternId;
  /** Quarter-note beats in one bar. The registry is not limited to 4/4. */
  beatsPerBar: number;
  family: BassPatternFamily;
  /**
   * Register is still rendered centrally.  A groove may, however, require a
   * stable per-chord frame instead of the generic cross-span voice-leading
   * used by melodic bass cells.
   */
  registerPolicy?: GrooveBassRegisterPolicy;
  hits: readonly GrooveBassPatternHit[];
}

/** Registered pass-through reference for the existing generic 4/4 walking engine. */
export const JAZZ_WALKING_BASS_PATTERN_ID = 'bass.jazz-walking.v1' as const;
export const JAZZ_FIVE_FOUR_BASS_PATTERN_ID = BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID;

export const GROOVE_BASS_PATTERN_IDS = [
  'rnb_neo_soul_sparse',
  'dilla_pocket',
  'rnb_gospel_triplet',
  'rnb_motown_syncopated',
  'rnb_trap_soul_halftime',
  JAZZ_FIVE_FOUR_BASS_PATTERN_ID,
] as const;

export type GrooveBassPatternId = typeof GROOVE_BASS_PATTERN_IDS[number];

const PATTERNS = {
  rnb_neo_soul_sparse: {
    id: 'rnb_neo_soul_sparse',
    beatsPerBar: 4,
    family: 'broken',
    hits: [
      { beat: 0, durationBeats: 1.15, velocity: 0.92, voice: 'root' },
      { beat: 1.75, durationBeats: 0.22, velocity: 0.62, voice: 'fifth' },
      { beat: 2.5, durationBeats: 0.62, velocity: 0.72, voice: 'third' },
      { beat: 3.75, durationBeats: 0.2, velocity: 0.64, voice: 'fifth' },
    ],
  },
  dilla_pocket: {
    id: 'dilla_pocket',
    beatsPerBar: 4,
    family: 'syncopated',
    hits: [
      { beat: 0, durationBeats: 0.7, velocity: 0.88, voice: 'root' },
      { beat: 0.75, durationBeats: 0.28, velocity: 0.6, voice: 'fifth' },
      { beat: 1.5, durationBeats: 0.4, velocity: 0.67, voice: 'third' },
      { beat: 2.5, durationBeats: 0.68, velocity: 0.78, voice: 'root' },
      { beat: 3.75, durationBeats: 0.2, velocity: 0.64, voice: 'fifth' },
    ],
  },
  rnb_gospel_triplet: {
    id: 'rnb_gospel_triplet',
    beatsPerBar: 4,
    family: 'broken',
    hits: [
      { beat: 0, durationBeats: 0.58, velocity: 0.92, voice: 'root' },
      { beat: 2 / 3, durationBeats: 0.28, velocity: 0.66, voice: 'fifth' },
      { beat: 4 / 3, durationBeats: 0.3, velocity: 0.72, voice: 'third' },
      { beat: 2, durationBeats: 0.58, velocity: 0.84, voice: 'root' },
      { beat: 8 / 3, durationBeats: 0.28, velocity: 0.68, voice: 'fifth' },
      { beat: 10 / 3, durationBeats: 0.34, velocity: 0.76, voice: 'third' },
    ],
  },
  rnb_motown_syncopated: {
    id: 'rnb_motown_syncopated',
    beatsPerBar: 4,
    family: 'syncopated',
    hits: [
      { beat: 0, durationBeats: 0.48, velocity: 0.94, voice: 'root' },
      { beat: 0.75, durationBeats: 0.22, velocity: 0.7, voice: 'fifth' },
      { beat: 1.5, durationBeats: 0.34, velocity: 0.76, voice: 'third' },
      { beat: 2, durationBeats: 0.48, velocity: 0.88, voice: 'root' },
      { beat: 2.75, durationBeats: 0.22, velocity: 0.72, voice: 'fifth' },
      { beat: 3.5, durationBeats: 0.38, velocity: 0.8, voice: 'third' },
    ],
  },
  rnb_trap_soul_halftime: {
    id: 'rnb_trap_soul_halftime',
    beatsPerBar: 4,
    family: 'pedal',
    hits: [
      { beat: 0, durationBeats: 1.55, velocity: 0.96, voice: 'root' },
      { beat: 2.5, durationBeats: 0.72, velocity: 0.72, voice: 'fifth' },
      { beat: 3.75, durationBeats: 0.2, velocity: 0.62, voice: 'third' },
    ],
  },
  [JAZZ_FIVE_FOUR_BASS_PATTERN_ID]: {
    id: JAZZ_FIVE_FOUR_BASS_PATTERN_ID,
    beatsPerBar: 5,
    family: 'pedal',
    registerPolicy: 'root-fifth-frame',
    // Timing/dynamics come from the same typed role-rhythm asset consumed by
    // GrooveScore. This adapter adds only pitch-function semantics required by
    // BassRenderer; it does not duplicate a second onset table.
    hits: bassRoleRhythmPattern(JAZZ_FIVE_FOUR_BASS_PATTERN_ID)!.cells.map((cell, index): GrooveBassPatternHit => ({
      beat: cell.phaseBeats,
      durationBeats: cell.durationBeats,
      // BassRenderer maps normalized touch with 48 + x*58.
      velocity: Math.max(0, Math.min(1, (cell.velocity - 48) / 58)),
      voice: index === 2 ? 'fifth' : 'root',
    })),
  },
} as const satisfies Record<GrooveBassPatternId, GrooveBassPattern>;

export function grooveBassPattern(id: string | undefined): GrooveBassPattern | undefined {
  return id && Object.prototype.hasOwnProperty.call(PATTERNS, id)
    ? PATTERNS[id as GrooveBassPatternId]
    : undefined;
}

export function bassPatternFamilyForId(id: string | undefined): BassPatternFamily | undefined {
  return grooveBassPattern(id)?.family;
}

/** See isRegisteredCompPatternReference: pass-through algorithms are explicit registry entries too. */
export function isRegisteredBassPatternReference(id: string | undefined): boolean {
  return id === undefined || id === JAZZ_WALKING_BASS_PATTERN_ID || grooveBassPattern(id) !== undefined;
}
