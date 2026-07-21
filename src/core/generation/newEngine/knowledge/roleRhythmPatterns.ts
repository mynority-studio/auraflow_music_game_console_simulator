// ============================================================
// newEngine · knowledge · Role Rhythm Patterns
// ------------------------------------------------------------
// Reusable, role-specific rhythm material.  Every pattern is expressed on a
// quarter-note beat clock; Arranger materializes a private snapshot per
// section before any renderer chooses pitches or voicings.
//
// The first 5/4 family is a normalized phase analysis of the supplied MIDI.
// It is intentionally not a song transcription: Bass/Comp retain reusable
// cells, while Lead retains only a phrase-grammar marker so melody generation
// remains generative and preserves intentional rests.
// ============================================================

export const TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256 =
  '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1' as const;

export const BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID =
  'bass.jazz-five-four-ostinato.v1' as const;
export const COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID =
  'comp.jazz-five-four-piano-interlock.v1' as const;
export const LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID =
  'lead.jazz-five-four-phrase.v1' as const;

export const ROLE_RHYTHM_PATTERN_IDS = [
  BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
  COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
  LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
] as const;

export type RoleRhythmPatternId = typeof ROLE_RHYTHM_PATTERN_IDS[number];
export type RoleRhythmRole = 'bass' | 'comp' | 'lead';
export type CompRoleRhythmVoiceAction = 'foundation' | 'chord';

export interface RoleRhythmPatternSource {
  kind: 'midi-phase-analysis';
  /** Content identity, never a machine-local attachment path. */
  sha256: string;
}

interface RoleRhythmPatternBase {
  id: RoleRhythmPatternId;
  role: RoleRhythmRole;
  /** Quarter-note beats in one bar. */
  beatsPerBar: number;
  source: RoleRhythmPatternSource;
}

export interface BassRoleRhythmCell {
  /** Quarter-note phase inside the bar. */
  phaseBeats: number;
  durationBeats: number;
  /** Reference MIDI attack velocity; Performance may scale it later. */
  velocity: number;
}

export interface BassRoleRhythmPattern extends RoleRhythmPatternBase {
  id: typeof BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID;
  role: 'bass';
  realization: 'timed-cells';
  cells: readonly BassRoleRhythmCell[];
}

export interface CompRoleRhythmCell {
  /** Quarter-note phase inside the bar. */
  phaseBeats: number;
  /** Attack-level representative duration; chord tones may release separately. */
  durationBeats: number;
  /**
   * Optional low-to-high releases for a chord attack. The reference piano
   * releases individual fingers independently; keeping those gates here
   * prevents a later instrument gesture from inventing a different rhythm.
   */
  voiceDurationBeats?: readonly number[];
  /** Reference MIDI attack velocity; Performance may scale it later. */
  velocity: number;
  /** Foundation = single low anchor; chord = voiced harmonic response. */
  voiceAction: CompRoleRhythmVoiceAction;
}

export interface CompRoleRhythmPattern extends RoleRhythmPatternBase {
  id: typeof COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID;
  role: 'comp';
  realization: 'timed-cells';
  cells: readonly CompRoleRhythmCell[];
}

export interface LeadRoleRhythmPattern extends RoleRhythmPatternBase {
  id: typeof LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID;
  role: 'lead';
  realization: 'grammar-marker';
  /** Renderer-facing marker; deliberately no fixed Lead onset cells. */
  grammarMarker: typeof LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID;
  /** Lead shares the song clock but keeps phrase pickups and composed gaps. */
  useGlobalBarOrigin: true;
  preserveIntentionalRests: true;
  subdivisionGrammar: 'triplet-sixteenth';
}

export type RoleRhythmPattern =
  | BassRoleRhythmPattern
  | CompRoleRhythmPattern
  | LeadRoleRhythmPattern;

export interface RoleRhythmPatternReferenceByRole {
  bass?: string;
  comp?: string;
  lead?: string;
}

export interface RoleRhythmPatternByRole {
  bass?: BassRoleRhythmPattern;
  comp?: CompRoleRhythmPattern;
  lead?: LeadRoleRhythmPattern;
}

const SOURCE: RoleRhythmPatternSource = {
  kind: 'midi-phase-analysis',
  sha256: TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256,
};

const PATTERNS = {
  [BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID]: {
    id: BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
    role: 'bass',
    beatsPerBar: 5,
    realization: 'timed-cells',
    source: SOURCE,
    cells: [
      { phaseBeats: 0, durationBeats: 86 / 192, velocity: 76 },
      { phaseBeats: 157 / 96, durationBeats: 60 / 192, velocity: 94 },
      { phaseBeats: 3, durationBeats: 278 / 192, velocity: 90 },
    ],
  },
  [COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID]: {
    id: COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
    role: 'comp',
    beatsPerBar: 5,
    realization: 'timed-cells',
    source: SOURCE,
    // When Comp owns the foundation (and Bass is inactive), one role carries
    // the piano's full low-anchor/chord-shell interlock.
    cells: [
      { phaseBeats: 0, durationBeats: 86 / 192, velocity: 76, voiceAction: 'foundation' },
      {
        phaseBeats: 61 / 96,
        durationBeats: 30 / 192,
        voiceDurationBeats: [30 / 192, 16 / 192, 32 / 192],
        velocity: 81,
        voiceAction: 'chord',
      },
      { phaseBeats: 157 / 96, durationBeats: 60 / 192, velocity: 94, voiceAction: 'foundation' },
      {
        phaseBeats: 2,
        durationBeats: 46 / 192,
        voiceDurationBeats: [46 / 192, 22 / 192, 26 / 192],
        velocity: 81,
        voiceAction: 'chord',
      },
      { phaseBeats: 3, durationBeats: 278 / 192, velocity: 90, voiceAction: 'foundation' },
      {
        phaseBeats: 4,
        durationBeats: 64 / 192,
        voiceDurationBeats: [64 / 192, 64 / 192, 66 / 192],
        velocity: 85,
        voiceAction: 'chord',
      },
    ],
  },
  [LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID]: {
    id: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
    role: 'lead',
    beatsPerBar: 5,
    realization: 'grammar-marker',
    source: SOURCE,
    grammarMarker: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
    useGlobalBarOrigin: true,
    preserveIntentionalRests: true,
    subdivisionGrammar: 'triplet-sixteenth',
  },
} as const satisfies Record<RoleRhythmPatternId, RoleRhythmPattern>;

export function roleRhythmPattern(id: string | undefined): RoleRhythmPattern | undefined {
  return id && Object.prototype.hasOwnProperty.call(PATTERNS, id)
    ? PATTERNS[id as RoleRhythmPatternId]
    : undefined;
}

export function bassRoleRhythmPattern(id: string | undefined): BassRoleRhythmPattern | undefined {
  const pattern = roleRhythmPattern(id);
  return pattern?.role === 'bass' ? pattern : undefined;
}

export function compRoleRhythmPattern(id: string | undefined): CompRoleRhythmPattern | undefined {
  const pattern = roleRhythmPattern(id);
  return pattern?.role === 'comp' ? pattern : undefined;
}

export function leadRoleRhythmPattern(id: string | undefined): LeadRoleRhythmPattern | undefined {
  const pattern = roleRhythmPattern(id);
  return pattern?.role === 'lead' ? pattern : undefined;
}
