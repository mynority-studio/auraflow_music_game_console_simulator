// Export the Comp same-key reattack lifecycle candidate for isolated A/B review.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  assertNoVideoReplicaSameKeyReattackCollisions,
  canonicalVideoReplicaApprovalPayload,
  compileVideoReplicaScore,
  diffVideoReplicaScores,
  findVideoReplicaSameKeyReattackCollisions,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
  TAKE_FIVE_FULL_EVIDENCE,
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
  videoReplicaToSMF,
  videoSecondsAtPerformedTick,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica';

const artifactStem = 'take-five-full-curation-v5';
const outputDir = resolve(process.argv[2] ?? `tmp/video-replica/${artifactStem}`);
const midiPath = resolve(outputDir, `${artifactStem}.mid`);
const logPath = resolve(outputDir, `${artifactStem}.notes.json`);
const approvalPayloadPath = resolve(outputDir, `${artifactStem}.approval-canonical.jsonl`);
const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V5;
const postHandoffWindow = { startTickInclusive: 24_000, endTickExclusive: score.durationPerformedTicks };

// This gate is deliberately read-only. A bad fixed score must fail export
// instead of being silently clipped in the MIDI adapter.
assertNoVideoReplicaSameKeyReattackCollisions(score, postHandoffWindow);

const { ir, eventIndex } = compileVideoReplicaScore(score);
const approvalPayload = canonicalVideoReplicaApprovalPayload(score);
const candidateApprovalSha256 = createHash('sha256').update(approvalPayload).digest('hex');
const diffFromV4 = diffVideoReplicaScores(TAKE_FIVE_FULL_CURATION_CANDIDATE_V4, score);

mkdirSync(outputDir, { recursive: true });
writeFileSync(midiPath, Buffer.from(videoReplicaToSMF(ir, score.source.bpm)));
writeFileSync(approvalPayloadPath, approvalPayload);
writeFileSync(logPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'Comp same-key reattack lifecycle A/B candidate; unapproved and not the product baseline',
  source: score.source,
  evidence: {
    id: TAKE_FIVE_FULL_EVIDENCE.id,
    eventCount: TAKE_FIVE_FULL_EVIDENCE.events.length,
    strikeGroupCount: TAKE_FIVE_FULL_EVIDENCE.strikeGroups.length,
  },
  approvalCandidate: {
    status: 'unapproved',
    canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
    algorithm: 'sha256',
    sha256: candidateApprovalSha256,
    payloadPath: relative(process.cwd(), approvalPayloadPath),
  },
  score: {
    id: score.id,
    replicaRevision: score.replicaRevision,
    curationStatus: score.curationStatus,
    durationPerformedTicks: score.durationPerformedTicks,
    noteCount: score.notes.length,
    rejections: score.rejections,
    corrections: score.corrections,
    additions: score.additions,
    gestures: score.gestures,
  },
  midiSafetyGate: {
    scope: postHandoffWindow,
    sameKeyReattackCollisionsBefore: findVideoReplicaSameKeyReattackCollisions(
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
      postHandoffWindow,
    ),
    sameKeyReattackCollisionsAfter: findVideoReplicaSameKeyReattackCollisions(score, postHandoffWindow),
    policy: 'report and fail; never mutate performed events in the compiler or MIDI adapter',
  },
  diffFromV4,
  diffFromProvisionalBaseline: diffVideoReplicaScores(TAKE_FIVE_FULL_PROVISIONAL_REPLICA, score),
  tracks: Object.fromEntries((['bass', 'comp', 'lead'] as const).map((role) => [role, {
    noteCount: score.tracks[role].length,
    notes: score.tracks[role].map((note) => ({
      ...note,
      performedRelativeSeconds: note.performedStartTick / score.source.ppq * 60 / score.source.bpm,
      sourceVideoSeconds: videoSecondsAtPerformedTick(score.source, note.performedStartTick),
      irLocation: eventIndex[note.eventId],
    })),
  }])),
}, null, 2)}\n`);

console.log(`MIDI: ${relative(process.cwd(), midiPath)}`);
console.log(`notes: ${relative(process.cwd(), logPath)}`);
console.log(`candidate approval SHA-256: ${candidateApprovalSha256}`);
