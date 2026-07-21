// Export the visually curated opening candidate for A/B review.

import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  compileVideoReplicaScore,
  TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2,
  TAKE_FIVE_OPENING_EVIDENCE,
  videoReplicaToSMF,
  videoSecondsAtPerformedTick,
} from '../src/core/generation/newEngine/videoReplica';

const outputDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-opening-curation-v2');
const midiPath = resolve(outputDir, 'take-five-opening-curation-v2.mid');
const logPath = resolve(outputDir, 'take-five-opening-curation-v2.notes.json');
const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2;
const { ir, eventIndex } = compileVideoReplicaScore(score);

mkdirSync(outputDir, { recursive: true });
writeFileSync(midiPath, Buffer.from(videoReplicaToSMF(ir, score.source.bpm)));
writeFileSync(logPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'A/B candidate; not the product baseline',
  source: score.source,
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
  evidenceEventCount: TAKE_FIVE_OPENING_EVIDENCE.events.length,
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
