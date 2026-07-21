// ============================================================
// Take Five video · full provisional replica
// ------------------------------------------------------------
// Performed events are the lossless first-raw baseline. Role labels remain
// provisional until hand/gesture curation and user A/B acceptance are done.
// ============================================================

import {
  defineVideoReplicaEvidenceSet,
  defineVideoReplicaScore,
  type VideoReplicaRoleAssignment,
} from './VideoReplicaScore';
import {
  parseTakeFiveFullEvidence,
  TAKE_FIVE_FIRST_RAW_ARTIFACT_SHA256,
  TAKE_FIVE_VIDEO_SOURCE,
} from './takeFiveFullEvidence';

/** Legacy-stable score identity retained only for offline/audit provenance. */
export const TAKE_FIVE_VIDEO_PIANO_REFERENCE_ID = 'take-five-video-piano-v1' as const;

export const TAKE_FIVE_FULL_EVIDENCE = defineVideoReplicaEvidenceSet({
  id: 'take-five-video-full-evidence-v1',
  detectorRevision: 'first-raw-baseline-before-grid-snap',
  sourceArtifactSha256: TAKE_FIVE_FIRST_RAW_ARTIFACT_SHA256,
  source: TAKE_FIVE_VIDEO_SOURCE,
  strikeGroupingToleranceTicks: 32,
  events: parseTakeFiveFullEvidence(),
});

const provisionalAssignments: VideoReplicaRoleAssignment[] = TAKE_FIVE_FULL_EVIDENCE.events
  .filter((event) => event.disposition === 'kept')
  .map((event) => {
    if (!event.roleHint) throw new Error(`Full evidence ${event.evidenceId} lacks its provisional role hint`);
    return {
      evidenceId: event.evidenceId,
      role: event.roleHint.role,
      method: event.roleHint.method,
      status: 'provisional',
    };
  });

export const TAKE_FIVE_FULL_PROVISIONAL_REPLICA = defineVideoReplicaScore({
  schemaVersion: 1,
  id: TAKE_FIVE_VIDEO_PIANO_REFERENCE_ID,
  replicaRevision: 'v1-first-raw-lossless',
  evidence: TAKE_FIVE_FULL_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: provisionalAssignments,
  // Preserve the video/form tail after the final detected key release.
  durationPerformedTicks: 85_860,
});
