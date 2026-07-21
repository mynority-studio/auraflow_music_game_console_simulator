// ============================================================
// videoReplica · Take Five 5/4 descriptive audit fixture
// ------------------------------------------------------------
// This fixed transcription is intentionally outside the product generation
// graph. It is provisional and incomplete: audits may compare observations
// against it, but it is never a correctness oracle, MusicGenerationRequest,
// Arranger input, renderer branch, UI choice or playback route.
// ============================================================

import type { MusicalIR } from '../ir/MusicalIR';
import {
  compileVideoReplicaScore,
  type VideoReplicaScore,
} from './VideoReplicaScore';
import {
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
  TAKE_FIVE_VIDEO_PIANO_REFERENCE_ID,
} from './takeFiveFullReplica';

export const TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA = Object.freeze({
  id: 'audit.jazz-5-4.take-five-video-fixed-v1',
  scoreId: TAKE_FIVE_VIDEO_PIANO_REFERENCE_ID,
  scope: 'audit-only' as const,
  authority: 'descriptive-non-authoritative' as const,
  productEligible: false as const,
  curationStatus: 'provisional' as const,
  limitations: Object.freeze([
    'The transcription is provisional and has not been accepted as an exact video replica.',
    'It contains fixed performed notes and cannot stand in for generative Grammar or Arranger behavior.',
    'It has no Drum track, so it cannot certify a complete 5/4 ensemble GrooveContract.',
    'Its timing and role observations are descriptive comparisons, never pass/fail truth.',
  ]),
});

export interface TakeFiveFiveFourAuditFixture {
  readonly metadata: typeof TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA;
  readonly score: VideoReplicaScore;
  readonly ir: MusicalIR;
  readonly fingerprint: {
    readonly ppq: number;
    readonly meter: readonly [5, 4];
    readonly bpm: number;
    readonly durationTicks: number;
    readonly durationBars: number;
    readonly noteCountByRole: Readonly<Record<'bass' | 'comp' | 'lead', number>>;
    readonly firstTickByRole: Readonly<Record<'bass' | 'comp' | 'lead', number | null>>;
    readonly lastTickByRole: Readonly<Record<'bass' | 'comp' | 'lead', number | null>>;
  };
}

function bounds(values: readonly number[]): readonly [number | null, number | null] {
  return values.length === 0
    ? [null, null]
    : [Math.min(...values), Math.max(...values)];
}

/** Compile an immutable comparison artifact for tests/offline audits only. */
export function buildTakeFiveFiveFourAuditFixture(): TakeFiveFiveFourAuditFixture {
  const score = TAKE_FIVE_FULL_PROVISIONAL_REPLICA;
  const { ir } = compileVideoReplicaScore(score);
  const roles = ['bass', 'comp', 'lead'] as const;
  const starts = Object.fromEntries(roles.map((role) => [
    role,
    ir.tracks.find((track) => track.role === role)?.notes.map((note) => Number(note.startTick)) ?? [],
  ])) as Record<(typeof roles)[number], number[]>;
  const roleBounds = Object.fromEntries(roles.map((role) => [role, bounds(starts[role])])) as Record<
    (typeof roles)[number],
    readonly [number | null, number | null]
  >;
  const ticksPerBar = score.source.ppq * score.source.meter.numerator;

  return Object.freeze({
    metadata: TAKE_FIVE_FIVE_FOUR_AUDIT_FIXTURE_METADATA,
    score,
    ir,
    fingerprint: Object.freeze({
      ppq: score.source.ppq,
      meter: Object.freeze([5, 4] as const),
      bpm: score.source.bpm,
      durationTicks: score.durationPerformedTicks,
      durationBars: score.durationPerformedTicks / ticksPerBar,
      noteCountByRole: Object.freeze(Object.fromEntries(roles.map((role) => [role, starts[role].length]))) as Readonly<Record<'bass' | 'comp' | 'lead', number>>,
      firstTickByRole: Object.freeze(Object.fromEntries(roles.map((role) => [role, roleBounds[role][0]]))) as Readonly<Record<'bass' | 'comp' | 'lead', number | null>>,
      lastTickByRole: Object.freeze(Object.fromEntries(roles.map((role) => [role, roleBounds[role][1]]))) as Readonly<Record<'bass' | 'comp' | 'lead', number | null>>,
    }),
  });
}
