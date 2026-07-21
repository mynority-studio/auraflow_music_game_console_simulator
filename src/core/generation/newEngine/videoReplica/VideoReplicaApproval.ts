import type { VideoReplicaScore, VideoReplicaScoreNote } from './VideoReplicaScore';

export const VIDEO_REPLICA_APPROVAL_CANONICALIZATION = 'video-replica-approval-v2' as const;
export const VIDEO_REPLICA_USER_APPROVAL_RECEIPT_SCHEMA_VERSION = 1 as const;

export interface VideoReplicaApprovalCandidateRef {
  readonly scoreId: string;
  readonly replicaRevision: string;
  readonly candidateContentSha256: string;
}

/**
 * An explicit user decision bound to one immutable candidate payload hash.
 * This lives outside the candidate payload so approval state can never alter
 * the content identity being approved.
 */
export interface VideoReplicaUserApprovalReceipt extends VideoReplicaApprovalCandidateRef {
  readonly schemaVersion: typeof VIDEO_REPLICA_USER_APPROVAL_RECEIPT_SCHEMA_VERSION;
  readonly kind: 'video-replica-user-approval';
  readonly approvalStatus: 'approved';
  readonly approvedAtIso8601: string;
}

const ROLE_RANK: Record<VideoReplicaScoreNote['role'], number> = {
  bass: 0,
  comp: 1,
  lead: 2,
};

/**
 * Stable musical/functional payload used by offline SHA-256 approval tooling.
 * Review prose and mutable workflow state are deliberately excluded. Immutable
 * evidence provenance, every audible fact, role and ordered gesture are included.
 */
export function canonicalVideoReplicaApprovalPayload(score: VideoReplicaScore): string {
  const notes = [...score.notes].sort((left, right) => (
    left.performedStartTick - right.performedStartTick
    || ROLE_RANK[left.role] - ROLE_RANK[right.role]
    || left.midi - right.midi
    || left.eventId.localeCompare(right.eventId)
  ));
  const gestures = [...score.gestures].sort((left, right) => left.id.localeCompare(right.id));
  const lines = [
    JSON.stringify({
      type: 'manifest',
      canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
      scoreId: score.id,
      replicaRevision: score.replicaRevision,
      sourceEvidenceId: score.sourceEvidenceId,
      sourceEvidenceArtifactSha256: score.sourceEvidenceArtifactSha256,
      sourceEvidenceDetectorRevision: score.sourceEvidenceDetectorRevision,
      videoSha256: score.source.videoSha256,
      videoByteLength: score.source.videoByteLength,
      ppq: score.source.ppq,
      bpm: score.source.bpm,
      meter: score.source.meter,
      tickZeroAtVideoSeconds: score.source.tickZeroAtVideoSeconds,
      durationPerformedTicks: score.durationPerformedTicks,
      piano: score.piano,
    }),
    ...notes.map((note) => JSON.stringify({
      type: 'note',
      eventId: note.eventId,
      origin: note.origin,
      role: note.role,
      performedStartTick: note.performedStartTick,
      performedDurationTicks: note.performedDurationTicks,
      midi: note.midi,
      velocity: note.velocity,
    })),
    ...gestures.map((gesture) => JSON.stringify({
      type: 'gesture',
      id: gesture.id,
      kind: gesture.kind,
      evidenceIds: gesture.evidenceIds,
    })),
  ];
  return `${lines.join('\n')}\n`;
}

const LOWERCASE_SHA256 = /^[a-f\d]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

/**
 * Runtime gate for a persisted user receipt. It validates both the receipt
 * shape and its exact binding to the caller-supplied candidate identity.
 */
export function isVideoReplicaUserApprovalReceiptForCandidate(
  value: unknown,
  candidate: VideoReplicaApprovalCandidateRef,
): value is VideoReplicaUserApprovalReceipt {
  if (
    !candidate.scoreId.trim()
    || !candidate.replicaRevision.trim()
    || !LOWERCASE_SHA256.test(candidate.candidateContentSha256)
    || !isRecord(value)
  ) {
    return false;
  }
  return value.schemaVersion === VIDEO_REPLICA_USER_APPROVAL_RECEIPT_SCHEMA_VERSION
    && value.kind === 'video-replica-user-approval'
    && value.approvalStatus === 'approved'
    && value.scoreId === candidate.scoreId
    && value.replicaRevision === candidate.replicaRevision
    && value.candidateContentSha256 === candidate.candidateContentSha256
    && isCanonicalIsoInstant(value.approvedAtIso8601);
}
