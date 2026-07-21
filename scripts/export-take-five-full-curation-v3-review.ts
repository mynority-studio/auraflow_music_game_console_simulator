// Build a read-only audition index from existing full-v3 candidate and A/B artifacts.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  canonicalVideoReplicaApprovalPayload,
  compileVideoReplicaScore,
  diffVideoReplicaScores,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_EVIDENCE,
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
  videoReplicaToSMF,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica';

const outputDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-full-curation-v3');
const midiPath = resolve(outputDir, 'take-five-full-curation-v3.mid');
const approvalPayloadPath = resolve(outputDir, 'take-five-full-curation-v3.approval-canonical.jsonl');
const noteLogPath = resolve(outputDir, 'take-five-full-curation-v3.notes.json');
const renderProvenancePath = resolve(outputDir, 'take-five-full-curation-v3.render-provenance.json');
const reviewManifestPath = resolve(outputDir, 'take-five-full-curation-v3.review-manifest.json');
const abManifestPath = resolve(outputDir, 'ab/take-five-full-v3-AB-manifest.json');
const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
const diffFromProvisionalBaseline = diffVideoReplicaScores(TAKE_FIVE_FULL_PROVISIONAL_REPLICA, score);

function requireFile(path: string, description: string): void {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifactAbsolutePath(path: string): string {
  return resolve(process.cwd(), path);
}

requireFile(midiPath, 'full-v3 MIDI candidate');
requireFile(approvalPayloadPath, 'full-v3 canonical approval payload');
requireFile(noteLogPath, 'full-v3 complete note log');
requireFile(renderProvenancePath, 'full-v3 render provenance');
requireFile(abManifestPath, 'full-v3 A/B manifest');

const approvalPayload = readFileSync(approvalPayloadPath, 'utf8');
if (approvalPayload !== canonicalVideoReplicaApprovalPayload(score)) {
  throw new Error('Existing approval payload is stale relative to the full-v3 fixed score');
}
const candidateApprovalSha256 = createHash('sha256').update(approvalPayload).digest('hex');
const existingMidiBytes = readFileSync(midiPath);
const expectedMidiBytes = Buffer.from(videoReplicaToSMF(
  compileVideoReplicaScore(score).ir,
  score.source.bpm,
));
if (!existingMidiBytes.equals(expectedMidiBytes)) {
  const existingSha256 = createHash('sha256').update(existingMidiBytes).digest('hex');
  const expectedSha256 = createHash('sha256').update(expectedMidiBytes).digest('hex');
  throw new Error(
    `Existing full-v3 MIDI is stale relative to the fixed score: actual ${existingSha256}, expected ${expectedSha256}`,
  );
}
const midiSha256 = createHash('sha256').update(existingMidiBytes).digest('hex');

interface NoteLogNote {
  eventId: string;
  role: 'bass' | 'comp' | 'lead';
  performedStartTick: number;
  performedDurationTicks: number;
  midi: number;
  velocity: number;
}

interface NoteLog {
  approvalCandidate: { status: string; sha256: string };
  score: { id: string; replicaRevision: string; noteCount: number };
  tracks: Record<'bass' | 'comp' | 'lead', { noteCount: number; notes: NoteLogNote[] }>;
}

const noteLog = JSON.parse(readFileSync(noteLogPath, 'utf8')) as NoteLog;
if (noteLog.approvalCandidate.status !== 'unapproved'
  || noteLog.approvalCandidate.sha256 !== candidateApprovalSha256
  || noteLog.score.id !== score.id
  || noteLog.score.replicaRevision !== score.replicaRevision
  || noteLog.score.noteCount !== score.notes.length) {
  throw new Error('Complete note log metadata is stale relative to the full-v3 candidate');
}
const roles = ['bass', 'comp', 'lead'] as const;
const expectedNoteFacts = score.notes.map((note) => ({
  eventId: note.eventId,
  role: note.role,
  performedStartTick: note.performedStartTick,
  performedDurationTicks: note.performedDurationTicks,
  midi: note.midi,
  velocity: note.velocity,
})).sort((left, right) => left.eventId.localeCompare(right.eventId));
const loggedNoteFacts = roles.flatMap((role) => {
  const track = noteLog.tracks[role];
  if (track.noteCount !== track.notes.length) throw new Error(`Note log ${role} count is stale`);
  return track.notes.map((note) => ({
    eventId: note.eventId,
    role: note.role,
    performedStartTick: note.performedStartTick,
    performedDurationTicks: note.performedDurationTicks,
    midi: note.midi,
    velocity: note.velocity,
  }));
}).sort((left, right) => left.eventId.localeCompare(right.eventId));
if (JSON.stringify(loggedNoteFacts) !== JSON.stringify(expectedNoteFacts)) {
  throw new Error('Complete note log event facts are stale relative to the full-v3 score');
}

interface RenderProvenance {
  status: string;
  candidate: {
    scoreId: string;
    replicaRevision: string;
    canonicalization: string;
    approvalContentSha256: string;
    approvalPayloadPath: string;
  };
  midi: { path: string; sha256: string };
  renderer: { sourcePath: string; sourceSha256: string };
  soundFont: { path: string; sha256: string };
  output: { path: string; sha256: string };
  verification: { byteIdentical: boolean; rerenderedSha256: string };
}

const renderProvenance = JSON.parse(readFileSync(renderProvenancePath, 'utf8')) as RenderProvenance;
if (renderProvenance.status !== 'verified-byte-identical'
  || renderProvenance.verification.byteIdentical !== true
  || renderProvenance.verification.rerenderedSha256 !== renderProvenance.output.sha256
  || renderProvenance.candidate.scoreId !== score.id
  || renderProvenance.candidate.replicaRevision !== score.replicaRevision
  || renderProvenance.candidate.canonicalization !== VIDEO_REPLICA_APPROVAL_CANONICALIZATION
  || renderProvenance.candidate.approvalContentSha256 !== candidateApprovalSha256
  || renderProvenance.midi.sha256 !== midiSha256) {
  throw new Error('Render provenance is stale relative to the full-v3 candidate');
}
for (const artifact of [
  renderProvenance.candidate.approvalPayloadPath,
  renderProvenance.midi.path,
  renderProvenance.renderer.sourcePath,
  renderProvenance.soundFont.path,
  renderProvenance.output.path,
]) {
  requireFile(artifactAbsolutePath(artifact), 'render-provenance input/output');
}
if (sha256File(artifactAbsolutePath(renderProvenance.candidate.approvalPayloadPath)) !== candidateApprovalSha256
  || sha256File(artifactAbsolutePath(renderProvenance.midi.path)) !== midiSha256
  || sha256File(artifactAbsolutePath(renderProvenance.renderer.sourcePath)) !== renderProvenance.renderer.sourceSha256
  || sha256File(artifactAbsolutePath(renderProvenance.soundFont.path)) !== renderProvenance.soundFont.sha256
  || sha256File(artifactAbsolutePath(renderProvenance.output.path)) !== renderProvenance.output.sha256) {
  throw new Error('A render-provenance artifact hash is stale');
}

const reviewSegmentSeconds = 3;
const performedTicksPerSecond = score.source.ppq * score.source.bpm / 60;
const reviewSegmentTicks = performedTicksPerSecond * reviewSegmentSeconds;
const reviewSegmentCount = Math.ceil(score.durationPerformedTicks / reviewSegmentTicks);

if (!Number.isInteger(performedTicksPerSecond) || !Number.isInteger(reviewSegmentTicks)) {
  throw new RangeError('The review manifest requires an integer performed-tick timebase');
}
if (reviewSegmentCount !== 18) {
  throw new RangeError(`The locked full-v3 review must contain exactly 18 segments; got ${reviewSegmentCount}`);
}

interface ABManifestSegment {
  index: number;
  performedStartSeconds: number;
  performedEndSeconds: number;
  performedStartTickAt200BpmPpq480: number;
  performedEndTickAt200BpmPpq480: number;
  sequential: string;
  sequentialSha256: string;
  alignedStereo: string;
  alignedStereoSha256: string;
}

interface ABManifest {
  schemaVersion: number;
  sourceInput: { path: string; sha256: string };
  candidateInput: { path: string; sha256: string };
  candidateRenderProvenance: {
    path: string;
    sha256: string;
    status: string;
    candidateApprovalContentSha256: string;
    midi: { sha256: string };
    renderer: { sourceSha256: string };
    soundFont: { sha256: string };
    output: { sha256: string };
    verification: { byteIdentical: boolean };
  };
  segmentedReview: {
    path: string;
    sha256: string;
    segments: ABManifestSegment[];
  };
}

const abManifest = JSON.parse(readFileSync(abManifestPath, 'utf8')) as ABManifest;
if (abManifest.schemaVersion !== 2) throw new RangeError('Full-v3 A/B manifest must use schema version 2');
const embeddedRenderProvenance = abManifest.candidateRenderProvenance;
if (!embeddedRenderProvenance
  || artifactAbsolutePath(embeddedRenderProvenance.path) !== renderProvenancePath
  || embeddedRenderProvenance.sha256 !== sha256File(renderProvenancePath)
  || embeddedRenderProvenance.status !== 'verified-byte-identical'
  || embeddedRenderProvenance.candidateApprovalContentSha256 !== candidateApprovalSha256
  || embeddedRenderProvenance.midi.sha256 !== midiSha256
  || embeddedRenderProvenance.renderer.sourceSha256 !== renderProvenance.renderer.sourceSha256
  || embeddedRenderProvenance.soundFont.sha256 !== renderProvenance.soundFont.sha256
  || embeddedRenderProvenance.output.sha256 !== renderProvenance.output.sha256
  || embeddedRenderProvenance.verification.byteIdentical !== true) {
  throw new Error('A/B manifest is not bound to the verified full-v3 render provenance');
}
if (!Array.isArray(abManifest.segmentedReview?.segments)
  || abManifest.segmentedReview.segments.length !== reviewSegmentCount) {
  throw new RangeError(`A/B manifest must contain exactly ${reviewSegmentCount} review segments`);
}
const abSegmentByIndex = new Map<number, ABManifestSegment>();
for (const segment of abManifest.segmentedReview.segments) {
  if (!Number.isInteger(segment.index) || segment.index < 1 || segment.index > reviewSegmentCount) {
    throw new RangeError(`Invalid A/B review segment index ${segment.index}`);
  }
  if (abSegmentByIndex.has(segment.index)) throw new Error(`Duplicate A/B review segment ${segment.index}`);
  const expectedStartTick = (segment.index - 1) * reviewSegmentTicks;
  const expectedEndTick = Math.min(segment.index * reviewSegmentTicks, score.durationPerformedTicks);
  if (segment.performedStartTickAt200BpmPpq480 !== expectedStartTick
    || segment.performedEndTickAt200BpmPpq480 !== expectedEndTick) {
    throw new RangeError(`A/B review segment ${segment.index} does not match the fixed performed-tick grid`);
  }
  for (const artifactPath of [segment.sequential, segment.alignedStereo]) {
    requireFile(artifactAbsolutePath(artifactPath), 'A/B review segment artifact');
  }
  if (sha256File(artifactAbsolutePath(segment.sequential)) !== segment.sequentialSha256
    || sha256File(artifactAbsolutePath(segment.alignedStereo)) !== segment.alignedStereoSha256) {
    throw new Error(`Stale A/B review segment hash at segment ${segment.index}`);
  }
  abSegmentByIndex.set(segment.index, segment);
}
for (const input of [abManifest.sourceInput, abManifest.candidateInput]) {
  const inputPath = artifactAbsolutePath(input.path);
  requireFile(inputPath, 'A/B input artifact');
  if (sha256File(inputPath) !== input.sha256) throw new Error(`Stale A/B input hash: ${input.path}`);
}
if (abManifest.candidateInput.sha256 !== renderProvenance.output.sha256
  || artifactAbsolutePath(abManifest.candidateInput.path) !== artifactAbsolutePath(renderProvenance.output.path)) {
  throw new Error('A/B candidate input is not the byte-identical verified render output');
}
const wholePerformanceABPath = artifactAbsolutePath(abManifest.segmentedReview.path);
requireFile(wholePerformanceABPath, 'whole-performance A/B review artifact');
if (sha256File(wholePerformanceABPath) !== abManifest.segmentedReview.sha256) {
  throw new Error('Whole-performance A/B artifact hash is stale');
}

function reviewSegment(index: number) {
  if (!Number.isInteger(index) || index < 1 || index > reviewSegmentCount) {
    throw new RangeError(`Review segment index must be in 1..${reviewSegmentCount}; got ${index}`);
  }
  const performedStartTick = (index - 1) * reviewSegmentTicks;
  const performedEndTick = Math.min(index * reviewSegmentTicks, score.durationPerformedTicks);
  const abSegment = abSegmentByIndex.get(index);
  if (!abSegment) throw new Error(`Missing verified A/B review segment ${index}`);
  return {
    index,
    performedStartTick,
    performedEndTick,
    performedStartSeconds: performedStartTick / performedTicksPerSecond,
    performedEndSeconds: performedEndTick / performedTicksPerSecond,
    sequentialABPath: relative(outputDir, artifactAbsolutePath(abSegment.sequential)),
    sequentialABSha256: abSegment.sequentialSha256,
    alignedStereoPath: relative(outputDir, artifactAbsolutePath(abSegment.alignedStereo)),
    alignedStereoSha256: abSegment.alignedStereoSha256,
  };
}

function reviewSegmentsForRange(performedStartTick: number, performedEndTickExclusive: number) {
  const boundedStart = Math.max(0, Math.min(performedStartTick, score.durationPerformedTicks - 1));
  const boundedEndExclusive = Math.max(
    boundedStart + 1,
    Math.min(performedEndTickExclusive, score.durationPerformedTicks),
  );
  const firstIndex = Math.floor(boundedStart / reviewSegmentTicks) + 1;
  const lastIndex = Math.floor((boundedEndExclusive - 1) / reviewSegmentTicks) + 1;
  return Array.from(
    { length: lastIndex - firstIndex + 1 },
    (_, offset) => reviewSegment(firstIndex + offset),
  );
}

function eventChangeReview(change: (typeof diffFromProvisionalBaseline.eventChanges)[number]) {
  const eventVersions = [change.before, change.after].filter((note) => note !== undefined);
  const affectedStartTick = Math.min(...eventVersions.map((note) => note.performedStartTick));
  const affectedEndTickExclusive = Math.max(
    ...eventVersions.map((note) => note.performedStartTick + note.performedDurationTicks),
  );
  return {
    ...change,
    affectedPerformedTickRange: [affectedStartTick, affectedEndTickExclusive] as const,
    affectedPerformedSecondsRange: [
      affectedStartTick / performedTicksPerSecond,
      affectedEndTickExclusive / performedTicksPerSecond,
    ] as const,
    reviewSegments: reviewSegmentsForRange(affectedStartTick, affectedEndTickExclusive),
  };
}

const baselineGestureById = new Map(
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA.gestures.map((gesture) => [gesture.id, gesture]),
);
const candidateGestureById = new Map(score.gestures.map((gesture) => [gesture.id, gesture]));
const baselineNoteById = new Map(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes.map((note) => [note.eventId, note]));
const candidateNoteById = new Map(score.notes.map((note) => [note.eventId, note]));
const evidenceEventById = new Map(TAKE_FIVE_FULL_EVIDENCE.events.map((event) => [event.evidenceId, event]));

function gestureChangeReview(id: string, kind: 'added' | 'removed') {
  const gesture = kind === 'added' ? candidateGestureById.get(id) : baselineGestureById.get(id);
  if (!gesture) throw new Error(`Missing ${kind} gesture ${id}`);
  const scoreNoteById = kind === 'added' ? candidateNoteById : baselineNoteById;
  const performedTicks = gesture.evidenceIds.map((evidenceId) => {
    const note = scoreNoteById.get(evidenceId);
    if (note) return note.performedStartTick;
    const evidence = evidenceEventById.get(evidenceId);
    if (!evidence) throw new Error(`Gesture ${id} references unknown evidence ${evidenceId}`);
    return evidence.performedStartTick;
  });
  const affectedStartTick = Math.min(...performedTicks);
  const affectedEndTickExclusive = Math.max(...performedTicks) + 1;
  return {
    kind,
    gesture,
    affectedPerformedTickRange: [affectedStartTick, affectedEndTickExclusive] as const,
    affectedPerformedSecondsRange: [
      affectedStartTick / performedTicksPerSecond,
      affectedEndTickExclusive / performedTicksPerSecond,
    ] as const,
    reviewSegments: reviewSegmentsForRange(affectedStartTick, affectedEndTickExclusive),
  };
}

function currentNote(eventId: string) {
  const note = candidateNoteById.get(eventId);
  if (!note) throw new Error(`Review queue references missing candidate event ${eventId}`);
  return {
    eventId: note.eventId,
    role: note.role,
    performedStartTick: note.performedStartTick,
    performedDurationTicks: note.performedDurationTicks,
    midi: note.midi,
    velocity: note.velocity,
  };
}

const unresolvedLowConfidenceReviewQueue = [
  {
    id: 'lead-006-keyoff-duration',
    kind: 'duration',
    status: 'needs-user-ab',
    question: 'Does C#5 end at tick 5243 as a held key, pedal/natural tail, or an earlier physical key-off?',
    currentScoreFacts: [currentNote('lead-006')],
    affectedPerformedTickRange: [4_462, 5_243],
    reviewSegments: reviewSegmentsForRange(4_462, 5_243),
  },
  {
    id: 'lead-178-keyoff-duration',
    kind: 'duration',
    status: 'needs-user-ab',
    question: 'Is the retained E4 duration of 279 ticks correct, or is its audible/key-held tail longer?',
    currentScoreFacts: [currentNote('lead-178')],
    affectedPerformedTickRange: [81_137, 81_416],
    reviewSegments: reviewSegmentsForRange(81_137, 81_416),
  },
  {
    id: 'comp-137-fs2-presence',
    kind: 'note-presence',
    status: 'needs-user-ab',
    question: 'Is the retained F#2 at tick 56471 a physical/audible attack rather than a low partial?',
    currentScoreFacts: [currentNote('comp-137')],
    affectedPerformedTickRange: [56_471, 56_638],
    reviewSegments: reviewSegmentsForRange(56_471, 56_638),
  },
  {
    id: 'possible-inner-voices-38570',
    kind: 'possible-omission',
    status: 'needs-user-ab',
    question: 'Are any middle-register inner voices missing at tick 38570? No unverified pitch is proposed or added.',
    currentScoreFacts: [currentNote('comp-076'), currentNote('lead-075')],
    affectedPerformedTickRange: [38_570, 38_571],
    reviewSegments: reviewSegmentsForRange(38_570, 38_571),
  },
  {
    id: 'possible-inner-voices-43311',
    kind: 'possible-omission',
    status: 'needs-user-ab',
    question: 'Are any middle-register inner voices missing at tick 43311? No unverified pitch is proposed or added.',
    currentScoreFacts: [currentNote('comp-092'), currentNote('lead-092')],
    affectedPerformedTickRange: [43_311, 43_312],
    reviewSegments: reviewSegmentsForRange(43_311, 43_312),
  },
] as const;

const reviewManifest = {
  schemaVersion: 1,
  status: 'unapproved',
  authority: {
    readOnly: true,
    engineEffect: 'none',
    productBaselineEffect: 'none',
    approvalEffect: 'none',
    policy: 'This manifest is an audition index only. It cannot edit/import score events or approve/switch any engine path.',
  },
  timebase: {
    ppq: score.source.ppq,
    bpm: score.source.bpm,
    performedTicksPerSecond,
    mapping: 'performedSeconds = performedTick / performedTicksPerSecond',
    reviewSegmentSeconds,
    reviewSegmentTicks,
    reviewSegmentCount,
  },
  source: {
    videoSha256: score.source.videoSha256,
    videoByteLength: score.source.videoByteLength,
    evidenceId: TAKE_FIVE_FULL_EVIDENCE.id,
    evidenceArtifactSha256: TAKE_FIVE_FULL_EVIDENCE.sourceArtifactSha256,
    auditionAudio: {
      sha256: abManifest.sourceInput.sha256,
      path: relative(outputDir, artifactAbsolutePath(abManifest.sourceInput.path)),
    },
  },
  candidate: {
    id: score.id,
    replicaRevision: score.replicaRevision,
    approvalCandidate: {
      id: score.id,
      status: 'unapproved',
      canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
      algorithm: 'sha256',
      sha256: candidateApprovalSha256,
      payloadPath: relative(outputDir, approvalPayloadPath),
    },
    midi: {
      sha256: midiSha256,
      path: relative(outputDir, midiPath),
      verification: 'byte-for-byte equal to current score -> MusicalIR -> SMF at review export time',
    },
    auditionAudio: {
      sha256: abManifest.candidateInput.sha256,
      path: relative(outputDir, artifactAbsolutePath(abManifest.candidateInput.path)),
    },
    completeNoteLog: {
      path: relative(outputDir, noteLogPath),
      sha256: sha256File(noteLogPath),
      verification: 'all 534 event facts equal the current fixed score',
    },
    renderProvenance: {
      path: relative(outputDir, renderProvenancePath),
      sha256: sha256File(renderProvenancePath),
      status: renderProvenance.status,
      rendererSourceSha256: renderProvenance.renderer.sourceSha256,
      soundFontSha256: renderProvenance.soundFont.sha256,
      verification: 'fresh MIDI render is byte-identical to the candidate audition WAV',
    },
  },
  abArtifacts: {
    pathBase: 'paths are relative to this review manifest',
    verification: 'approval -> score -> MIDI -> verified render -> A/B plus 18 segment boundaries verified at export time',
    manifestPath: relative(outputDir, abManifestPath),
    manifestSha256: sha256File(abManifestPath),
    wholePerformancePath: relative(outputDir, wholePerformanceABPath),
    wholePerformanceSha256: sha256File(wholePerformanceABPath),
  },
  diffFromProvisionalBaseline: {
    before: diffFromProvisionalBaseline.before,
    after: diffFromProvisionalBaseline.after,
    summary: diffFromProvisionalBaseline.summary,
    audibleChanges: diffFromProvisionalBaseline.eventChanges
      .filter((change) => change.audibleChange)
      .map(eventChangeReview),
    roleOnlyChanges: diffFromProvisionalBaseline.eventChanges
      .filter((change) => (
        change.kind === 'modified'
        && change.changedFields.length === 1
        && change.changedFields[0] === 'role'
      ))
      .map(eventChangeReview),
    gestureChanges: {
      added: diffFromProvisionalBaseline.gestureChanges.addedIds
        .map((id) => gestureChangeReview(id, 'added')),
      removed: diffFromProvisionalBaseline.gestureChanges.removedIds
        .map((id) => gestureChangeReview(id, 'removed')),
    },
  },
  unresolvedLowConfidenceReviewQueue,
};
const reviewManifestJson = `${JSON.stringify(reviewManifest, null, 2)}\n`;
const reviewManifestSha256 = createHash('sha256').update(reviewManifestJson).digest('hex');

writeFileSync(reviewManifestPath, reviewManifestJson);

console.log(`review manifest: ${relative(process.cwd(), reviewManifestPath)}`);
console.log(`review manifest SHA-256: ${reviewManifestSha256}`);
console.log(`candidate approval SHA-256: ${candidateApprovalSha256}`);
