import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalVideoReplicaApprovalPayload,
  isVideoReplicaUserApprovalReceiptForCandidate,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
  VIDEO_REPLICA_USER_APPROVAL_RECEIPT_SCHEMA_VERSION,
  type VideoReplicaApprovalCandidateRef,
} from './VideoReplicaApproval';
import type { VideoReplicaScore } from './VideoReplicaScore';
import {
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V2,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
} from './takeFiveFullCuration';

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const cloneScore = (score: VideoReplicaScore): Mutable<VideoReplicaScore> => (
  structuredClone(score) as Mutable<VideoReplicaScore>
);

describe('VideoReplica approval canonicalization', () => {
  it('locks the full v3 content and immutable evidence provenance into one deterministic candidate hash', () => {
    const payload = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    expect(payload.trimEnd().split('\n')).toHaveLength(1 + 534 + 19);
    expect(JSON.parse(payload.split('\n')[0]!)).toEqual({
      type: 'manifest',
      canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
      scoreId: 'take-five-video-full-curation-candidate-v3',
      replicaRevision: 'v3-middle-reattacks-plus-tail-false-partial-review',
      sourceEvidenceId: 'take-five-video-full-evidence-v1',
      sourceEvidenceArtifactSha256: '5714183d3cca508a8594c190cba3cb063600b5e7126079f12dac504b2a2df89b',
      sourceEvidenceDetectorRevision: 'first-raw-baseline-before-grid-snap',
      videoSha256: '73810e3c4dc69f8337c392642e47f52e84ce890c7995949895ca5317100d01e7',
      videoByteLength: 1_753_564,
      ppq: 480,
      bpm: 200,
      meter: { numerator: 5, denominator: 4 },
      tickZeroAtVideoSeconds: 1.547,
      durationPerformedTicks: 85_860,
      piano: { bank: 0, program: 0 },
    });
    expect(sha256(payload)).toBe('97265094f1c43514384830ea33f1a059faa749f64ac68c1fdda697839b0ffb95');
  });

  it('locks full v4 separately while leaving the v3 approval identity intact', () => {
    const payload = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V4);
    expect(payload.trimEnd().split('\n')).toHaveLength(1 + 534 + 19);
    expect(JSON.parse(payload.split('\n')[0]!)).toEqual(expect.objectContaining({
      type: 'manifest',
      canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
      scoreId: 'take-five-video-full-curation-candidate-v4',
      replicaRevision: 'v4-tail-e4-audible-duration-review',
      sourceEvidenceId: 'take-five-video-full-evidence-v1',
      sourceEvidenceArtifactSha256: '5714183d3cca508a8594c190cba3cb063600b5e7126079f12dac504b2a2df89b',
      sourceEvidenceDetectorRevision: 'first-raw-baseline-before-grid-snap',
      durationPerformedTicks: 85_860,
      piano: { bank: 0, program: 0 },
    }));
    expect(sha256(payload)).toBe('74d350b6ee11838a070496c580ea05406b20321e21946b28be1915f4eb4f828f');
    expect(sha256(payload)).not.toBe(sha256(
      canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3),
    ));
  });

  it('invalidates the candidate hash when reviewed notes or gestures change', () => {
    const v2 = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V2);
    const v3 = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    expect(sha256(v2)).not.toBe(sha256(v3));
  });

  const contentMutations: ReadonlyArray<{
    name: string;
    mutate: (score: Mutable<VideoReplicaScore>) => void;
  }> = [
    { name: 'note role', mutate: (score) => { score.notes[0]!.role = 'comp'; } },
    { name: 'note start', mutate: (score) => { score.notes[0]!.performedStartTick += 1; } },
    { name: 'note duration', mutate: (score) => { score.notes[0]!.performedDurationTicks += 1; } },
    { name: 'note MIDI', mutate: (score) => { score.notes[0]!.midi += 1; } },
    { name: 'note velocity', mutate: (score) => { score.notes[0]!.velocity -= 1; } },
    { name: 'piano bank', mutate: (score) => { score.piano.bank += 1; } },
    { name: 'piano program', mutate: (score) => { score.piano.program += 1; } },
    { name: 'timebase PPQ', mutate: (score) => { score.source.ppq += 1; } },
    { name: 'timebase BPM', mutate: (score) => { score.source.bpm += 1; } },
    { name: 'timebase meter numerator', mutate: (score) => { score.source.meter.numerator += 1; } },
    { name: 'timebase meter denominator', mutate: (score) => { score.source.meter.denominator += 1; } },
    { name: 'timebase video anchor', mutate: (score) => { score.source.tickZeroAtVideoSeconds += 0.001; } },
    { name: 'performed duration', mutate: (score) => { score.durationPerformedTicks += 1; } },
    {
      name: 'gesture kind',
      mutate: (score) => {
        const gesture = score.gestures[0]!;
        gesture.kind = gesture.kind === 'micro-roll' ? 'reattack' : 'micro-roll';
      },
    },
    { name: 'gesture member order', mutate: (score) => { score.gestures[0]!.evidenceIds.reverse(); } },
    { name: 'score ID provenance', mutate: (score) => { score.id += '-mutated'; } },
    { name: 'replica revision provenance', mutate: (score) => { score.replicaRevision += '-mutated'; } },
    { name: 'source evidence ID provenance', mutate: (score) => { score.sourceEvidenceId += '-mutated'; } },
    { name: 'source video hash provenance', mutate: (score) => { score.source.videoSha256 = 'f'.repeat(64); } },
    { name: 'source video byte length provenance', mutate: (score) => { score.source.videoByteLength += 1; } },
    {
      name: 'source evidence artifact provenance',
      mutate: (score) => { score.sourceEvidenceArtifactSha256 = '0'.repeat(64); },
    },
    {
      name: 'source evidence detector provenance',
      mutate: (score) => { score.sourceEvidenceDetectorRevision += '-mutated'; },
    },
  ];

  it.each(contentMutations)('changes the payload/hash for a $name mutation', ({ mutate }) => {
    const baselinePayload = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    const changed = cloneScore(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    mutate(changed);
    const changedPayload = canonicalVideoReplicaApprovalPayload(changed);
    expect(changedPayload).not.toBe(baselinePayload);
    expect(sha256(changedPayload)).not.toBe(sha256(baselinePayload));
  });

  it('keeps curation workflow status out of the candidate content hash', () => {
    const baselinePayload = canonicalVideoReplicaApprovalPayload(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    const statusOnly = cloneScore(TAKE_FIVE_FULL_CURATION_CANDIDATE_V3);
    statusOnly.curationStatus = 'confirmed';
    statusOnly.notes[0]!.assignmentStatus = 'confirmed';
    statusOnly.rejections[0]!.status = 'confirmed';
    statusOnly.corrections[0]!.status = 'confirmed';
    statusOnly.gestures[0]!.status = 'confirmed';
    expect(canonicalVideoReplicaApprovalPayload(statusOnly)).toBe(baselinePayload);
  });
});

describe('VideoReplica user approval receipt', () => {
  const candidate: VideoReplicaApprovalCandidateRef = {
    scoreId: 'score-v1',
    replicaRevision: 'replica-v1',
    candidateContentSha256: 'a'.repeat(64),
  };
  const receiptFixture = () => ({
    schemaVersion: VIDEO_REPLICA_USER_APPROVAL_RECEIPT_SCHEMA_VERSION,
    kind: 'video-replica-user-approval',
    approvalStatus: 'approved',
    ...candidate,
    approvedAtIso8601: '2026-07-20T12:34:56.000Z',
  });

  it('accepts a well-formed receipt bound to the exact candidate identity', () => {
    expect(isVideoReplicaUserApprovalReceiptForCandidate(receiptFixture(), candidate)).toBe(true);
  });

  it('rejects a receipt with a different hash, score, revision, decision or timestamp', () => {
    expect(isVideoReplicaUserApprovalReceiptForCandidate({
      ...receiptFixture(), candidateContentSha256: 'b'.repeat(64),
    }, candidate)).toBe(false);
    expect(isVideoReplicaUserApprovalReceiptForCandidate({
      ...receiptFixture(), scoreId: 'another-score',
    }, candidate)).toBe(false);
    expect(isVideoReplicaUserApprovalReceiptForCandidate({
      ...receiptFixture(), replicaRevision: 'another-revision',
    }, candidate)).toBe(false);
    expect(isVideoReplicaUserApprovalReceiptForCandidate({
      ...receiptFixture(), approvalStatus: 'provisional',
    }, candidate)).toBe(false);
    expect(isVideoReplicaUserApprovalReceiptForCandidate({
      ...receiptFixture(), approvedAtIso8601: 'not-a-timestamp',
    }, candidate)).toBe(false);
  });
});
