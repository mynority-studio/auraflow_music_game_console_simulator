// Export the full-span event-level curation candidate for A/B review.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  compileVideoReplicaScore,
  canonicalVideoReplicaApprovalPayload,
  diffVideoReplicaScores,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_EVIDENCE,
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
  videoReplicaToSMF,
  videoSecondsAtPerformedTick,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica';

const outputDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-full-curation-v3');
const midiPath = resolve(outputDir, 'take-five-full-curation-v3.mid');
const logPath = resolve(outputDir, 'take-five-full-curation-v3.notes.json');
const approvalPayloadPath = resolve(outputDir, 'take-five-full-curation-v3.approval-canonical.jsonl');
const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
const { ir, eventIndex } = compileVideoReplicaScore(score);
const approvalPayload = canonicalVideoReplicaApprovalPayload(score);
const candidateApprovalSha256 = createHash('sha256').update(approvalPayload).digest('hex');

mkdirSync(outputDir, { recursive: true });
writeFileSync(midiPath, Buffer.from(videoReplicaToSMF(ir, score.source.bpm)));
writeFileSync(approvalPayloadPath, approvalPayload);
writeFileSync(logPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'full-span event-level A/B candidate after middle/tail review; not approved and not the product baseline',
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
