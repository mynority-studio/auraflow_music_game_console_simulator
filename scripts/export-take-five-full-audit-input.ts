// Lock every input used by the full-score video comparison. This manifest is
// read-only evidence plumbing; it cannot edit or approve the fixed score.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  canonicalVideoReplicaApprovalPayload,
  findVideoReplicaSameKeyReattackCollisions,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica';

const root = process.cwd();
const outputDir = resolve('tmp/video-replica/take-five-full-curation-v5/full-audit');
const outputPath = resolve(outputDir, 'input-manifest.json');
const videoPath = resolve(
  '/Users/mynority/.codex/attachments/6b2f4909-d0f6-4864-b662-714760bec34d/微信视频2026-07-15_223754_429.mp4',
);
const paths = {
  video: videoPath,
  referenceWave: resolve('tmp/jazz-five-four-analysis/reference.wav'),
  scoreNoteLog: resolve('tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json'),
  scoreMidi: resolve('tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.mid'),
  scoreWave: resolve('tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.wav'),
  renderProvenance: resolve('tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.render-provenance.json'),
  thresholdSweep: resolve('tmp/video-replica/take-five-basic-pitch-sweep-full/full-threshold-sweep.json'),
  consensusReview: resolve('tmp/video-replica/take-five-basic-pitch-sweep-full/post-handoff-consensus-review-v3.json'),
} as const;

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifact(path: string) {
  const bytes = readFileSync(path);
  return {
    path: relative(root, path),
    byteLength: statSync(path).size,
    sha256: sha256Bytes(bytes),
  };
}

const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V5;
const artifacts = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, artifact(path)]));
if (artifacts.video!.sha256 !== score.source.videoSha256) {
  throw new Error(`Video hash mismatch: score=${score.source.videoSha256} file=${artifacts.video!.sha256}`);
}
if (artifacts.video!.byteLength !== score.source.videoByteLength) {
  throw new Error(`Video byte length mismatch: score=${score.source.videoByteLength} file=${artifacts.video!.byteLength}`);
}

const approvalPayload = canonicalVideoReplicaApprovalPayload(score);
const noteLog = JSON.parse(readFileSync(paths.scoreNoteLog, 'utf8')) as {
  approvalCandidate?: { sha256?: string };
  score?: { id?: string; replicaRevision?: string; noteCount?: number };
};
const approvalSha256 = sha256Bytes(Buffer.from(approvalPayload));
if (noteLog.approvalCandidate?.sha256 !== approvalSha256) {
  throw new Error('v5 note log approval hash is stale');
}
if (
  noteLog.score?.id !== score.id
  || noteLog.score.replicaRevision !== score.replicaRevision
  || noteLog.score.noteCount !== score.notes.length
) {
  throw new Error('v5 note log identity/count is stale');
}

const tickRate = score.source.ppq * score.source.bpm / 60;
const manifest = {
  schemaVersion: 1,
  status: 'locked-unapproved-full-score-audit-input',
  authority: {
    readOnly: true,
    scoreEffect: 'none',
    engineEffect: 'none',
    approvalEffect: 'none',
    extractionEffect: 'none',
  },
  truthOrder: [
    'source video frames and source-video audio',
    'independent detector/spectrum/physical-key evidence',
    'v5 fixed-score candidate under review',
    'metric and Groove annotations; never score authority',
  ],
  score: {
    id: score.id,
    replicaRevision: score.replicaRevision,
    status: score.curationStatus,
    approvalCanonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
    approvalSha256,
    noteCount: score.notes.length,
    tracks: {
      bass: score.tracks.bass.length,
      comp: score.tracks.comp.length,
      lead: score.tracks.lead.length,
    },
    durationPerformedTicks: score.durationPerformedTicks,
  },
  timeMapping: {
    ppq: score.source.ppq,
    bpm: score.source.bpm,
    meter: score.source.meter,
    ticksPerSecond: tickRate,
    evidenceVideoTickZeroSeconds: score.source.tickZeroAtVideoSeconds,
    waveformFittedSourceAnchorSeconds: 1.536858,
    performedSecondsFormula: 'performedTick / ticksPerSecond',
    sourceAudioFormula: 'waveformFittedSourceAnchorSeconds + performedTick / ticksPerSecond',
    sourceVideoEvidenceFormula: 'evidenceVideoTickZeroSeconds + performedTick / ticksPerSecond',
    policy: 'performed timing and nominal 5/4 metric annotation remain separate',
  },
  knownPreAuditFindings: {
    remainingSameKeyReattackCollisions: findVideoReplicaSameKeyReattackCollisions(score),
    disposition: 'must be independently confirmed in the full audit before a new score revision',
  },
  auditCoverageRequired: {
    events: score.notes.length,
    properties: ['pitch', 'onset', 'duration', 'velocity', 'role', 'strike/roll/reattack membership'],
    completeness: ['false-positive score notes', 'omitted physical notes', 'octave partials', 'detector continuations'],
    rhythm: ['global clock', 'local onset residual', '5/4 bar phase', '3+2 skeleton', 'rubato'],
  },
  artifacts,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`full-audit input manifest: ${relative(root, outputPath)}`);
console.log(`manifest SHA-256: ${sha256Bytes(readFileSync(outputPath))}`);
