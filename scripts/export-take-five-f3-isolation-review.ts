// Verify and index the audition-only F3 comparison without granting it score authority.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseSMF } from '../src/core/audio/smfParser';
import { canonicalVideoReplicaApprovalPayload } from '../src/core/generation/newEngine/videoReplica/VideoReplicaApproval';
import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V4 } from '../src/core/generation/newEngine/videoReplica/takeFiveFullCuration';

const baseDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-full-curation-v4');
const isolationDir = resolve(process.argv[3] ?? 'tmp/video-replica/auditions/take-five-f3-isolation');
const variantId = 'take-five-full-v4-f3-43288-isolation';
const baseMidiPath = resolve(baseDir, 'take-five-full-curation-v4.mid');
const baseWavPath = resolve(baseDir, 'take-five-full-curation-v4.wav');
const baseReviewPath = resolve(baseDir, 'take-five-full-curation-v4.review-manifest.json');
const baseAbPath = resolve(baseDir, 'ab/take-five-full-v4-AB-manifest.json');
const variantMidiPath = resolve(isolationDir, `${variantId}.mid`);
const variantWavPath = resolve(isolationDir, `${variantId}.wav`);
const variantPayloadPath = resolve(isolationDir, `${variantId}.audition-canonical.json`);
const variantProvenancePath = resolve(isolationDir, `${variantId}.render-provenance.json`);
const noAddVsAddAbPath = resolve(isolationDir, 'ab-v4-vs-f3/take-five-v4-vs-f3-AB-manifest.json');
const sourceVsAddAbPath = resolve(isolationDir, 'ab-source-vs-f3/take-five-source-vs-f3-AB-manifest.json');
const focusSourceVsNoAddPath = resolve(
  isolationDir,
  'focus/source-vs-no-f3/take-five-focus-source-vs-no-f3-AB-manifest.json',
);
const focusSourceVsAddPath = resolve(
  isolationDir,
  'focus/source-vs-f3/take-five-focus-source-vs-f3-AB-manifest.json',
);
const focusNoAddVsAddPath = resolve(
  isolationDir,
  'focus/no-f3-vs-f3/take-five-focus-no-f3-vs-f3-AB-manifest.json',
);
const reviewPath = resolve(isolationDir, `${variantId}.review-manifest.json`);

function requireFile(path: string, description: string): void {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function absoluteArtifact(path: string): string {
  return resolve(process.cwd(), path);
}

function readJson(path: string): Record<string, any> {
  requireFile(path, 'JSON artifact');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

function noteKeys(path: string, type: 'noteOn' | 'noteOff'): string[] {
  return parseSMF(readFileSync(path)).events
    .filter((event) => event.type === type)
    .map((event) => [event.channel, event.ticks, event.data1, event.data2].join('|'))
    .sort();
}

function addedMultiset(after: readonly string[], before: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const value of before) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const additions: string[] = [];
  for (const value of after) {
    const count = remaining.get(value) ?? 0;
    if (count > 0) remaining.set(value, count - 1);
    else additions.push(value);
  }
  if ([...remaining.values()].some((count) => count !== 0)) {
    throw new Error('F3 audition MIDI removed at least one base event');
  }
  return additions;
}

interface ABExpectation {
  sourcePath: string;
  candidatePath: string;
  sourceAnchorSeconds: number;
  candidateAnchorSeconds: number;
  gainPolicy: 'independent' | 'shared';
}

function validateAbManifest(path: string, expected: ABExpectation) {
  const manifest = readJson(path);
  if (manifest.schemaVersion !== 2
    || manifest.gainPolicy !== expected.gainPolicy
    || manifest.sourceAnchorSeconds !== expected.sourceAnchorSeconds
    || manifest.candidateAnchorSeconds !== expected.candidateAnchorSeconds) {
    throw new Error(`A/B policy mismatch: ${path}`);
  }
  const sourcePath = absoluteArtifact(manifest.sourceInput.path);
  const candidatePath = absoluteArtifact(manifest.candidateInput.path);
  if (sourcePath !== expected.sourcePath || candidatePath !== expected.candidatePath) {
    throw new Error(`A/B input path mismatch: ${path}`);
  }
  if (manifest.sourceInput.sha256 !== sha256File(sourcePath)
    || manifest.candidateInput.sha256 !== sha256File(candidatePath)) {
    throw new Error(`A/B input hash mismatch: ${path}`);
  }
  const segments = manifest.segmentedReview?.segments;
  if (!Array.isArray(segments) || segments.length !== 18) {
    throw new Error(`A/B manifest must contain 18 segments: ${path}`);
  }
  const focus = segments.find((segment: Record<string, any>) => segment.index === 10);
  if (!focus
    || focus.performedStartTickAt200BpmPpq480 !== 43_200
    || focus.performedEndTickAt200BpmPpq480 !== 48_000) {
    throw new Error(`A/B manifest lacks the exact segment-10 boundary: ${path}`);
  }
  for (const [artifactPath, expectedHash] of [
    [focus.sequential, focus.sequentialSha256],
    [focus.alignedStereo, focus.alignedStereoSha256],
  ] as const) {
    const absolute = absoluteArtifact(artifactPath);
    requireFile(absolute, 'focused A/B artifact');
    if (sha256File(absolute) !== expectedHash) throw new Error(`Stale focused A/B artifact: ${artifactPath}`);
  }
  return {
    manifestPath: relative(isolationDir, path),
    manifestSha256: sha256File(path),
    gainPolicy: manifest.gainPolicy,
    sourceAnchorSeconds: manifest.sourceAnchorSeconds,
    candidateAnchorSeconds: manifest.candidateAnchorSeconds,
    segment10: {
      performedStartTick: focus.performedStartTickAt200BpmPpq480,
      performedEndTick: focus.performedEndTickAt200BpmPpq480,
      sequentialPath: relative(isolationDir, absoluteArtifact(focus.sequential)),
      sequentialSha256: focus.sequentialSha256,
      alignedStereoPath: relative(isolationDir, absoluteArtifact(focus.alignedStereo)),
      alignedStereoSha256: focus.alignedStereoSha256,
    },
  };
}

function validateFocusedAbManifest(path: string, expected: ABExpectation) {
  const manifest = readJson(path);
  if (manifest.schemaVersion !== 2
    || manifest.gainPolicy !== expected.gainPolicy
    || manifest.sourceAnchorSeconds !== expected.sourceAnchorSeconds
    || manifest.candidateAnchorSeconds !== expected.candidateAnchorSeconds
    || manifest.durationSeconds !== 1.75) {
    throw new Error(`Focused A/B policy mismatch: ${path}`);
  }
  const sourcePath = absoluteArtifact(manifest.sourceInput.path);
  const candidatePath = absoluteArtifact(manifest.candidateInput.path);
  if (sourcePath !== expected.sourcePath || candidatePath !== expected.candidatePath) {
    throw new Error(`Focused A/B input path mismatch: ${path}`);
  }
  if (manifest.sourceInput.sha256 !== sha256File(sourcePath)
    || manifest.candidateInput.sha256 !== sha256File(candidatePath)) {
    throw new Error(`Focused A/B input hash mismatch: ${path}`);
  }
  if (!Array.isArray(manifest.segmentedReview?.segments)
    || manifest.segmentedReview.segments.length !== 0) {
    throw new Error(`Focused A/B must remain one unsplit window: ${path}`);
  }
  const sequentialPath = absoluteArtifact(manifest.sequential.path);
  const alignedStereoPath = absoluteArtifact(manifest.alignedStereo.path);
  requireFile(sequentialPath, 'focused sequential A/B artifact');
  requireFile(alignedStereoPath, 'focused aligned-stereo artifact');
  if (sha256File(sequentialPath) !== manifest.sequential.sha256
    || sha256File(alignedStereoPath) !== manifest.alignedStereo.sha256) {
    throw new Error(`Focused A/B artifact hash mismatch: ${path}`);
  }
  return {
    manifestPath: relative(isolationDir, path),
    manifestSha256: sha256File(path),
    gainPolicy: manifest.gainPolicy,
    performedWindowSeconds: [expected.candidateAnchorSeconds, expected.candidateAnchorSeconds + 1.75],
    targetOffsetSeconds: Number((43_288 / 1_600 - expected.candidateAnchorSeconds).toFixed(6)),
    sequentialPath: relative(isolationDir, sequentialPath),
    sequentialSha256: manifest.sequential.sha256,
    alignedStereoPath: relative(isolationDir, alignedStereoPath),
    alignedStereoSha256: manifest.alignedStereo.sha256,
  };
}

for (const [path, description] of [
  [baseMidiPath, 'base v4 MIDI'],
  [baseWavPath, 'base v4 WAV'],
  [baseReviewPath, 'base v4 review manifest'],
  [baseAbPath, 'base v4 A/B manifest'],
  [variantMidiPath, 'F3 audition MIDI'],
  [variantWavPath, 'F3 audition WAV'],
  [variantPayloadPath, 'F3 audition canonical payload'],
  [variantProvenancePath, 'F3 audition render provenance'],
  [noAddVsAddAbPath, 'v4 versus F3 A/B manifest'],
  [sourceVsAddAbPath, 'source versus F3 A/B manifest'],
  [focusSourceVsNoAddPath, 'focused source versus no-F3 A/B manifest'],
  [focusSourceVsAddPath, 'focused source versus F3 A/B manifest'],
  [focusNoAddVsAddPath, 'focused no-F3 versus F3 A/B manifest'],
] as const) requireFile(path, description);

const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
const approvalSha256 = createHash('sha256')
  .update(canonicalVideoReplicaApprovalPayload(score))
  .digest('hex');
const baseReview = readJson(baseReviewPath);
if (baseReview.status !== 'unapproved'
  || baseReview.candidate?.approvalCandidate?.sha256 !== approvalSha256) {
  throw new Error('Base v4 review is stale or no longer unapproved');
}

const provenance = readJson(variantProvenancePath);
if (provenance.kind !== 'video-replica-audition-variant-render'
  || provenance.status !== 'verified-byte-identical'
  || provenance.verification?.byteIdentical !== true
  || provenance.authority?.fixedScoreEffect !== 'none'
  || provenance.authority?.productEffect !== 'none'
  || provenance.authority?.approvalEffect !== 'none'
  || provenance.authority?.extractionEffect !== 'none'
  || provenance.baseCandidate?.approvalContentSha256 !== approvalSha256
  || provenance.verification?.fixedScoreApprovalSha256Before !== approvalSha256
  || provenance.verification?.fixedScoreApprovalSha256After !== approvalSha256) {
  throw new Error('F3 audition provenance is not safely bound to the unchanged v4 candidate');
}
for (const artifact of [
  provenance.auditionVariant?.canonicalPayloadPath,
  provenance.midi?.path,
  provenance.renderer?.sourcePath,
  provenance.soundFont?.path,
  provenance.output?.path,
]) {
  if (typeof artifact !== 'string') throw new Error('F3 provenance has a missing artifact path');
  requireFile(absoluteArtifact(artifact), 'F3 provenance artifact');
}
if (sha256File(variantPayloadPath) !== provenance.auditionVariant.contentSha256
  || sha256File(variantMidiPath) !== provenance.midi.sha256
  || sha256File(variantWavPath) !== provenance.output.sha256
  || sha256File(absoluteArtifact(provenance.renderer.sourcePath)) !== provenance.renderer.sourceSha256
  || sha256File(absoluteArtifact(provenance.soundFont.path)) !== provenance.soundFont.sha256) {
  throw new Error('F3 audition provenance contains a stale artifact hash');
}

const baseParsed = parseSMF(readFileSync(baseMidiPath));
const variantParsed = parseSMF(readFileSync(variantMidiPath));
const addedOns = addedMultiset(noteKeys(variantMidiPath, 'noteOn'), noteKeys(baseMidiPath, 'noteOn'));
const addedOffs = addedMultiset(noteKeys(variantMidiPath, 'noteOff'), noteKeys(baseMidiPath, 'noteOff'));
if (baseParsed.noteCount !== 534
  || variantParsed.noteCount !== 535
  || JSON.stringify(addedOns) !== JSON.stringify(['2|43288|53|55'])
  || JSON.stringify(addedOffs) !== JSON.stringify(['2|43455|53|0'])) {
  throw new Error('F3 isolation is no longer an exact one-note MIDI delta');
}

const referencePath = resolve('tmp/jazz-five-four-analysis/reference.wav');
const sourceVsNoAdd = validateAbManifest(baseAbPath, {
  sourcePath: referencePath,
  candidatePath: baseWavPath,
  sourceAnchorSeconds: 1.536858,
  candidateAnchorSeconds: 0,
  gainPolicy: 'independent',
});
const noAddVsAdd = validateAbManifest(noAddVsAddAbPath, {
  sourcePath: baseWavPath,
  candidatePath: variantWavPath,
  sourceAnchorSeconds: 0,
  candidateAnchorSeconds: 0,
  gainPolicy: 'shared',
});
const sourceVsAdd = validateAbManifest(sourceVsAddAbPath, {
  sourcePath: referencePath,
  candidatePath: variantWavPath,
  sourceAnchorSeconds: 1.536858,
  candidateAnchorSeconds: 0,
  gainPolicy: 'independent',
});
const focusedSourceVsNoAdd = validateFocusedAbManifest(focusSourceVsNoAddPath, {
  sourcePath: referencePath,
  candidatePath: baseWavPath,
  sourceAnchorSeconds: 27.786858,
  candidateAnchorSeconds: 26.25,
  gainPolicy: 'independent',
});
const focusedSourceVsAdd = validateFocusedAbManifest(focusSourceVsAddPath, {
  sourcePath: referencePath,
  candidatePath: variantWavPath,
  sourceAnchorSeconds: 27.786858,
  candidateAnchorSeconds: 26.25,
  gainPolicy: 'independent',
});
const focusedNoAddVsAdd = validateFocusedAbManifest(focusNoAddVsAddPath, {
  sourcePath: baseWavPath,
  candidatePath: variantWavPath,
  sourceAnchorSeconds: 26.25,
  candidateAnchorSeconds: 26.25,
  gainPolicy: 'shared',
});

const review = {
  schemaVersion: 1,
  kind: 'video-replica-audition-only-review',
  status: 'closed-no-add',
  authority: {
    readOnly: true,
    fixedScoreEffect: 'none',
    productEffect: 'none',
    approvalEffect: 'none',
    extractionEffect: 'none',
  },
  question: 'Does the source contain a distinct very soft F3 roll-in 23 ticks before the A2+C5 attack?',
  decision: {
    authority: 'user-delegated-evidence-based-default',
    outcome: 'keep-fixed-v4-without-f3',
    rationale: 'Conflicting detector, spectrum and single-frame evidence is insufficient to justify an added attack or guessed velocity.',
    fixedScoreMutation: 'none',
    approvalEffect: 'none',
  },
  baseCandidate: {
    scoreId: score.id,
    replicaRevision: score.replicaRevision,
    approvalContentSha256: approvalSha256,
    status: 'unapproved',
    noteCount: baseParsed.noteCount,
  },
  auditionVariant: {
    id: variantId,
    status: 'not-a-fixed-score',
    noteCount: variantParsed.noteCount,
    soleMidiDelta: {
      role: 'comp',
      channel: 2,
      performedStartTick: 43_288,
      performedDurationTicks: 167,
      midi: 53,
      velocity: 55,
      noteOn: addedOns[0],
      noteOff: addedOffs[0],
    },
    renderProvenancePath: relative(isolationDir, variantProvenancePath),
    renderProvenanceSha256: sha256File(variantProvenancePath),
  },
  focusedListeningOrder: [
    {
      order: 1,
      comparison: 'source-video versus fixed v4 without F3',
      ...focusedSourceVsNoAdd,
    },
    {
      order: 2,
      comparison: 'source-video versus audition variant with F3',
      ...focusedSourceVsAdd,
    },
    {
      order: 3,
      comparison: 'fixed v4 without F3 versus audition variant with F3; one shared gain',
      ...focusedNoAddVsAdd,
    },
  ],
  listeningOrder: [
    {
      order: 1,
      comparison: 'source-video versus fixed v4 without F3',
      ...sourceVsNoAdd,
    },
    {
      order: 2,
      comparison: 'source-video versus audition variant with F3',
      ...sourceVsAdd,
    },
    {
      order: 3,
      comparison: 'fixed v4 without F3 versus audition variant with F3; shared gain and exact one-note delta',
      ...noAddVsAdd,
    },
  ],
  decisionPolicy: {
    default: 'keep F3 out of the fixed score',
    resolution: 'closed by the user-delegated conservative default; the audition variant remains historical evidence only',
    reopenOnlyIf: 'new independent physical-attack evidence is supplied',
    nextIfAdded: 'create a new fixed-score revision; never mutate or approve v4 in place',
  },
};
const reviewJson = `${JSON.stringify(review, null, 2)}\n`;
writeFileSync(reviewPath, reviewJson);
console.log(`F3 isolation review: ${relative(process.cwd(), reviewPath)}`);
console.log(`review SHA-256: ${createHash('sha256').update(reviewJson).digest('hex')}`);
console.log(`fixed-score approval unchanged: ${approvalSha256}`);
