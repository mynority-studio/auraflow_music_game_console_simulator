// ============================================================
// Take Five video · provisional opening replica
// ------------------------------------------------------------
// Audio facts are exact copies of the first raw baseline. Functional roles
// are intentionally marked provisional because the old B/L labels came from
// a MIDI-60 register split. Since every role uses the same piano, this gives
// us a lossless A/B baseline without pretending the curation is finished.
// ============================================================

import {
  defineVideoReplicaEvidenceSet,
  defineVideoReplicaScore,
  type VideoReplicaRoleAssignment,
} from './VideoReplicaScore';
import {
  parseTakeFiveOpeningEvidence,
} from './takeFiveIntroEvidence';
import {
  TAKE_FIVE_FIRST_RAW_ARTIFACT_SHA256,
  TAKE_FIVE_VIDEO_SOURCE,
} from './takeFiveFullEvidence';

export const TAKE_FIVE_OPENING_EVIDENCE = defineVideoReplicaEvidenceSet({
  id: 'take-five-video-opening-evidence-v1',
  detectorRevision: 'first-raw-baseline-before-grid-snap',
  sourceArtifactSha256: TAKE_FIVE_FIRST_RAW_ARTIFACT_SHA256,
  source: TAKE_FIVE_VIDEO_SOURCE,
  strikeGroupingToleranceTicks: 32,
  events: parseTakeFiveOpeningEvidence(),
});

const provisionalAssignments: VideoReplicaRoleAssignment[] = TAKE_FIVE_OPENING_EVIDENCE.events
  .filter((event) => event.disposition === 'kept')
  .map((event) => {
    if (!event.roleHint) throw new Error(`Opening evidence ${event.evidenceId} lacks its legacy role hint`);
    return {
      evidenceId: event.evidenceId,
      role: event.roleHint.role,
      method: event.roleHint.method,
      status: 'provisional',
    };
  });

export const TAKE_FIVE_OPENING_PROVISIONAL_REPLICA = defineVideoReplicaScore({
  schemaVersion: 1,
  id: 'take-five-video-opening-provisional-replica',
  replicaRevision: 'v1-first-raw-lossless',
  evidence: TAKE_FIVE_OPENING_EVIDENCE,
  curationStatus: 'provisional',
  piano: { bank: 0, program: 0 },
  roleAssignments: provisionalAssignments,
});
