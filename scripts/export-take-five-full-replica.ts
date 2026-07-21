// ============================================================
// Export the clean full VideoReplica provisional baseline.
// Usage: npx tsx scripts/export-take-five-full-replica.ts [output-directory]
// ============================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  compileVideoReplicaScore,
  TAKE_FIVE_FULL_EVIDENCE,
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
  videoReplicaToSMF,
  videoSecondsAtPerformedTick,
} from '../src/core/generation/newEngine/videoReplica';

const outputDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-full-provisional');
const midiPath = resolve(outputDir, 'take-five-full-provisional.mid');
const logPath = resolve(outputDir, 'take-five-full-provisional.notes.json');
const score = TAKE_FIVE_FULL_PROVISIONAL_REPLICA;
const { ir, eventIndex } = compileVideoReplicaScore(score);
const source = score.source;

mkdirSync(outputDir, { recursive: true });
writeFileSync(midiPath, Buffer.from(videoReplicaToSMF(ir, source.bpm)));
writeFileSync(logPath, `${JSON.stringify({
  schemaVersion: 1,
  warning: 'This is the lossless first-raw baseline. Functional roles and detected notes still require video curation.',
  source,
  evidence: {
    id: TAKE_FIVE_FULL_EVIDENCE.id,
    detectorRevision: TAKE_FIVE_FULL_EVIDENCE.detectorRevision,
    sourceArtifactSha256: TAKE_FIVE_FULL_EVIDENCE.sourceArtifactSha256,
    strikeGroupingToleranceTicks: TAKE_FIVE_FULL_EVIDENCE.strikeGroupingToleranceTicks,
    eventCount: TAKE_FIVE_FULL_EVIDENCE.events.length,
    strikeGroupCount: TAKE_FIVE_FULL_EVIDENCE.strikeGroups.length,
    strikeGroups: TAKE_FIVE_FULL_EVIDENCE.strikeGroups,
  },
  score: {
    id: score.id,
    replicaRevision: score.replicaRevision,
    curationStatus: score.curationStatus,
    durationPerformedTicks: score.durationPerformedTicks,
    durationPerformedSeconds: score.durationPerformedTicks / source.ppq * 60 / source.bpm,
    sourceEndSeconds: videoSecondsAtPerformedTick(source, score.durationPerformedTicks),
    piano: score.piano,
    additions: score.additions,
    gestures: score.gestures,
  },
  tracks: Object.fromEntries((['bass', 'comp', 'lead'] as const).map((role) => [role, {
    noteCount: score.tracks[role].length,
    notes: score.tracks[role].map((note) => ({
      ...note,
      performedRelativeSeconds: note.performedStartTick / source.ppq * 60 / source.bpm,
      sourceVideoSeconds: videoSecondsAtPerformedTick(source, note.performedStartTick),
      irLocation: eventIndex[note.eventId],
    })),
  }])),
}, null, 2)}\n`);

console.log(`MIDI: ${relative(process.cwd(), midiPath)}`);
console.log(`notes: ${relative(process.cwd(), logPath)}`);
