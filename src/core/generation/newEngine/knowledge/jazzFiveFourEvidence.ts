// ============================================================
// newEngine · knowledge · Jazz 5/4 MIDI evidence oracle
// ------------------------------------------------------------
// Read-only evidence extracted from Take-Five-1.mid. This module deliberately
// contains no filesystem access and no machine-local attachment path. Product
// generation may derive reusable KB from it, but the oracle itself never makes
// arrangement or rendering decisions.
// ============================================================

import { deepFreeze } from '../foundation/deepReadonly';

export const JAZZ_FIVE_FOUR_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const JAZZ_FIVE_FOUR_SOURCE_PPQ = 192 as const;
export const JAZZ_FIVE_FOUR_ENGINE_PPQ = 480 as const;
export const JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS = 960 as const;
export const JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS = 2_400 as const;
export const JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK = 960 as const;

export interface RationalTick {
  readonly numerator: number;
  readonly denominator: number;
}

export type JazzFiveFourEvidenceRole = 'piano' | 'acousticBass' | 'lead' | 'drum';
export type JazzFiveFourCanonicalLane =
  | 'piano-foundation'
  | 'piano-upper-comp'
  | 'acoustic-bass'
  | 'kick'
  | 'ride'
  | 'snare';

export interface JazzFiveFourCanonicalEvent {
  readonly id: string;
  readonly evidenceAuthority: 'midi-observed';
  readonly role: Exclude<JazzFiveFourEvidenceRole, 'lead'>;
  readonly lane: JazzFiveFourCanonicalLane;
  readonly pitch: number;
  readonly velocity: number;
  readonly source: {
    readonly absoluteTick: number;
    readonly barIndex: number;
    readonly phaseTick: number;
    readonly durationTicks: number;
  };
  readonly engineExpected: {
    readonly absoluteTick: RationalTick;
    readonly projectedAbsoluteTick: number;
    readonly phaseTick: RationalTick;
    readonly projectedPhaseTick: number;
    readonly durationTicks: RationalTick;
    readonly projectedDurationTicks: number;
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

function assertIntegerTick(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer tick; received ${value}`);
  }
}

export function rationalTick(numerator: number, denominator: number): RationalTick {
  assertIntegerTick(numerator, 'rational numerator');
  assertIntegerTick(denominator, 'rational denominator');
  if (denominator === 0) throw new RangeError('rational denominator must not be zero');
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  return Object.freeze({
    numerator: sign * numerator / divisor,
    denominator: sign * denominator / divisor,
  });
}

/** Exact PPQ192 -> PPQ480 mapping for a tick delta; no grid quantization. */
export function sourceTickDeltaToEngineRational(sourceTickDelta: number): RationalTick {
  assertIntegerTick(sourceTickDelta, 'source tick delta');
  return rationalTick(
    sourceTickDelta * JAZZ_FIVE_FOUR_ENGINE_PPQ,
    JAZZ_FIVE_FOUR_SOURCE_PPQ,
  );
}

/**
 * Maps one source-absolute tick through the only permitted song-global origin.
 * Role- or section-local reset is intentionally not an option in this API.
 */
export function sourceAbsoluteTickToEngineRational(sourceAbsoluteTick: number): RationalTick {
  assertIntegerTick(sourceAbsoluteTick, 'source absolute tick');
  return sourceTickDeltaToEngineRational(
    sourceAbsoluteTick - JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK,
  );
}

export function rationalTickToNumber(value: RationalTick): number {
  return value.numerator / value.denominator;
}

/** Integer MIDI projection. The exact RationalTick remains the oracle value. */
export function projectRationalTick(value: RationalTick): number {
  return Math.round(rationalTickToNumber(value));
}

const CANONICAL_BAR_INDEX = 8;
const CANONICAL_SOURCE_BAR_START =
  JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK
  + CANONICAL_BAR_INDEX * JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS;

function canonicalEvent(input: {
  id: string;
  role: JazzFiveFourCanonicalEvent['role'];
  lane: JazzFiveFourCanonicalLane;
  phaseTick: number;
  durationTicks: number;
  pitch: number;
  velocity: number;
}): JazzFiveFourCanonicalEvent {
  const absoluteTick = CANONICAL_SOURCE_BAR_START + input.phaseTick;
  const engineAbsolute = sourceAbsoluteTickToEngineRational(absoluteTick);
  const enginePhase = sourceTickDeltaToEngineRational(input.phaseTick);
  const engineDuration = sourceTickDeltaToEngineRational(input.durationTicks);
  return deepFreeze({
    id: input.id,
    evidenceAuthority: 'midi-observed' as const,
    role: input.role,
    lane: input.lane,
    pitch: input.pitch,
    velocity: input.velocity,
    source: {
      absoluteTick,
      barIndex: CANONICAL_BAR_INDEX,
      phaseTick: input.phaseTick,
      durationTicks: input.durationTicks,
    },
    engineExpected: {
      absoluteTick: engineAbsolute,
      projectedAbsoluteTick: projectRationalTick(engineAbsolute),
      phaseTick: enginePhase,
      projectedPhaseTick: projectRationalTick(enginePhase),
      durationTicks: engineDuration,
      projectedDurationTicks: projectRationalTick(engineDuration),
    },
  });
}

const PIANO_FOUNDATION = [
  canonicalEvent({ id: 'piano-foundation-1', role: 'piano', lane: 'piano-foundation', phaseTick: 0, durationTicks: 86, pitch: 39, velocity: 76 }),
  canonicalEvent({ id: 'piano-foundation-2', role: 'piano', lane: 'piano-foundation', phaseTick: 314, durationTicks: 60, pitch: 39, velocity: 94 }),
  canonicalEvent({ id: 'piano-foundation-3', role: 'piano', lane: 'piano-foundation', phaseTick: 576, durationTicks: 278, pitch: 46, velocity: 90 }),
] as const;

const PIANO_UPPER_COMP = [
  canonicalEvent({ id: 'piano-upper-1-low', role: 'piano', lane: 'piano-upper-comp', phaseTick: 122, durationTicks: 30, pitch: 54, velocity: 90 }),
  canonicalEvent({ id: 'piano-upper-1-mid', role: 'piano', lane: 'piano-upper-comp', phaseTick: 122, durationTicks: 16, pitch: 58, velocity: 68 }),
  canonicalEvent({ id: 'piano-upper-1-high', role: 'piano', lane: 'piano-upper-comp', phaseTick: 122, durationTicks: 32, pitch: 63, velocity: 86 }),
  canonicalEvent({ id: 'piano-upper-2-low', role: 'piano', lane: 'piano-upper-comp', phaseTick: 384, durationTicks: 46, pitch: 54, velocity: 90 }),
  canonicalEvent({ id: 'piano-upper-2-mid', role: 'piano', lane: 'piano-upper-comp', phaseTick: 384, durationTicks: 22, pitch: 58, velocity: 86 }),
  canonicalEvent({ id: 'piano-upper-2-high', role: 'piano', lane: 'piano-upper-comp', phaseTick: 384, durationTicks: 26, pitch: 63, velocity: 68 }),
  canonicalEvent({ id: 'piano-upper-3-low', role: 'piano', lane: 'piano-upper-comp', phaseTick: 768, durationTicks: 64, pitch: 53, velocity: 72 }),
  canonicalEvent({ id: 'piano-upper-3-mid', role: 'piano', lane: 'piano-upper-comp', phaseTick: 768, durationTicks: 64, pitch: 56, velocity: 94 }),
  canonicalEvent({ id: 'piano-upper-3-high', role: 'piano', lane: 'piano-upper-comp', phaseTick: 768, durationTicks: 66, pitch: 61, velocity: 90 }),
] as const;

const ACOUSTIC_BASS = [
  canonicalEvent({ id: 'acoustic-bass-1', role: 'acousticBass', lane: 'acoustic-bass', phaseTick: 0, durationTicks: 468, pitch: 39, velocity: 84 }),
  canonicalEvent({ id: 'acoustic-bass-2', role: 'acousticBass', lane: 'acoustic-bass', phaseTick: 576, durationTicks: 146, pitch: 46, velocity: 65 }),
  canonicalEvent({ id: 'acoustic-bass-3', role: 'acousticBass', lane: 'acoustic-bass', phaseTick: 768, durationTicks: 114, pitch: 34, velocity: 65 }),
] as const;

const DRUM = [
  canonicalEvent({ id: 'drum-kick-1', role: 'drum', lane: 'kick', phaseTick: 0, durationTicks: 4, pitch: 35, velocity: 94 }),
  canonicalEvent({ id: 'drum-ride-1', role: 'drum', lane: 'ride', phaseTick: 0, durationTicks: 4, pitch: 51, velocity: 92 }),
  canonicalEvent({ id: 'drum-ride-2', role: 'drum', lane: 'ride', phaseTick: 192, durationTicks: 4, pitch: 51, velocity: 92 }),
  canonicalEvent({ id: 'drum-snare-1', role: 'drum', lane: 'snare', phaseTick: 320, durationTicks: 4, pitch: 40, velocity: 67 }),
  canonicalEvent({ id: 'drum-ride-3', role: 'drum', lane: 'ride', phaseTick: 384, durationTicks: 4, pitch: 51, velocity: 92 }),
  canonicalEvent({ id: 'drum-ride-4', role: 'drum', lane: 'ride', phaseTick: 512, durationTicks: 4, pitch: 51, velocity: 77 }),
  canonicalEvent({ id: 'drum-snare-2', role: 'drum', lane: 'snare', phaseTick: 576, durationTicks: 4, pitch: 40, velocity: 67 }),
  canonicalEvent({ id: 'drum-ride-5', role: 'drum', lane: 'ride', phaseTick: 576, durationTicks: 4, pitch: 51, velocity: 88 }),
  canonicalEvent({ id: 'drum-ride-6', role: 'drum', lane: 'ride', phaseTick: 704, durationTicks: 4, pitch: 51, velocity: 69 }),
  canonicalEvent({ id: 'drum-ride-7', role: 'drum', lane: 'ride', phaseTick: 768, durationTicks: 4, pitch: 51, velocity: 105 }),
  canonicalEvent({ id: 'drum-snare-3', role: 'drum', lane: 'snare', phaseTick: 832, durationTicks: 4, pitch: 40, velocity: 33 }),
  canonicalEvent({ id: 'drum-snare-4', role: 'drum', lane: 'snare', phaseTick: 896, durationTicks: 4, pitch: 40, velocity: 63 }),
] as const;

/**
 * Stable, machine-readable evidence snapshot. It intentionally stores only
 * source facts and a canonical simultaneous bar, not a full-song product score.
 */
export const JAZZ_FIVE_FOUR_MIDI_ORACLE = deepFreeze({
  schemaVersion: JAZZ_FIVE_FOUR_EVIDENCE_SCHEMA_VERSION,
  authority: {
    kind: 'read-only-midi-evidence',
    runtimeFilesystemDependency: 'none',
    productSelectionAuthority: 'none',
  },
  source: {
    fileName: 'Take-Five-1.mid',
    sha256: '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1',
    byteLength: 43_209,
    smfFormat: 0,
    trackCount: 1,
    ppq: JAZZ_FIVE_FOUR_SOURCE_PPQ,
    tempo: {
      microsecondsPerQuarter: 359_281,
      bpm: 60_000_000 / 359_281,
    },
    inferredMeter: { numerator: 5, denominator: 4 },
    inferredGrouping: [3, 2],
    barTicks: JAZZ_FIVE_FOUR_SOURCE_BAR_TICKS,
    groupBoundaryTick: 576,
    globalOrigin: {
      sourceAbsoluteTick: JAZZ_FIVE_FOUR_SOURCE_GLOBAL_ORIGIN_TICK,
      preOriginTicks: 960,
      preOriginBars: 1,
      count: 1,
      policy: 'song-global-only',
      roleLocalResetAllowed: false,
      sectionLocalResetAllowed: false,
    },
    pairedNoteCount: 4_966,
    roleNoteCounts: {
      piano: 2_091,
      acousticBass: 525,
      lead: 466,
      drum: 1_884,
    },
    channelPrograms: [
      { role: 'acousticBass', channelZeroBased: 1, channelOneBased: 2, programZeroBased: 32, programOneBased: 33, programName: 'Acoustic Bass' },
      { role: 'piano', channelZeroBased: 2, channelOneBased: 3, programZeroBased: 0, programOneBased: 1, programName: 'Acoustic Grand Piano' },
      { role: 'lead', channelZeroBased: 3, channelOneBased: 4, programZeroBased: 65, programOneBased: 66, programName: 'Alto Sax' },
      { role: 'drum', channelZeroBased: 9, channelOneBased: 10, programZeroBased: 0, programOneBased: 1, programName: 'GM percussion channel' },
    ],
    firstNoteOnTickByRole: {
      drum: 960,
      piano: 4_800,
      acousticBass: 8_640,
      lead: 12_110,
    },
    contentCoverage: {
      firstBarIndex: 0,
      lastBarIndex: 183,
      barCount: 184,
      sourceEndExclusiveTick: 177_600,
    },
    drumCoverage: {
      firstNonEmptyBarIndex: 0,
      lastNonEmptyBarIndex: 182,
      nonEmptyBarCount: 183,
      sourceNoteDurationTicks: 4,
      engineNoteDurationTicks: 10,
      notesWithThatDuration: 1_884,
    },
  },
  engineProjection: {
    ppq: JAZZ_FIVE_FOUR_ENGINE_PPQ,
    barTicks: JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS,
    groupBoundaryTick: 1_440,
    ratio: rationalTick(JAZZ_FIVE_FOUR_ENGINE_PPQ, JAZZ_FIVE_FOUR_SOURCE_PPQ),
    integerProjection: 'nearest-tick-max-error-half',
    postSwing: false,
  },
  canonicalSimultaneousBar: {
    contentBarIndex: CANONICAL_BAR_INDEX,
    sourceAbsoluteStartTick: CANONICAL_SOURCE_BAR_START,
    engineExpectedStartTick: CANONICAL_BAR_INDEX * JAZZ_FIVE_FOUR_ENGINE_BAR_TICKS,
    patternFamily: 'A-base',
    piano: {
      foundation: PIANO_FOUNDATION,
      upperComp: PIANO_UPPER_COMP,
    },
    acousticBass: ACOUSTIC_BASS,
    drum: DRUM,
  },
  arrangerAuthoredDecisions: [
    {
      id: 'bass-to-comp-handoff',
      authority: 'arranger-authored',
      observedInSourceMidi: false,
      reason: 'The source has Piano and Acoustic Bass coexisting; a handoff is an orchestration design, not MIDI evidence.',
    },
  ],
});
