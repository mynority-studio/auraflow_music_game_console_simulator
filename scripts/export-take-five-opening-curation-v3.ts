// Export the event-level opening curation candidate for A/B review.

import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  compileVideoReplicaScore,
  diffVideoReplicaScores,
  TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3,
  TAKE_FIVE_OPENING_EVIDENCE,
  TAKE_FIVE_OPENING_PROVISIONAL_REPLICA,
  videoReplicaToSMF,
  videoSecondsAtPerformedTick,
} from '../src/core/generation/newEngine/videoReplica';

const outputDir = resolve(process.argv[2] ?? 'tmp/video-replica/take-five-opening-curation-v3');
const midiPath = resolve(outputDir, 'take-five-opening-curation-v3.mid');
const logPath = resolve(outputDir, 'take-five-opening-curation-v3.notes.json');
const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3;
const { ir, eventIndex } = compileVideoReplicaScore(score);

mkdirSync(outputDir, { recursive: true });
writeFileSync(midiPath, Buffer.from(videoReplicaToSMF(ir, score.source.bpm)));
writeFileSync(logPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'event-level A/B candidate; not the product baseline',
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
  diffFromProvisionalBaseline: diffVideoReplicaScores(TAKE_FIVE_OPENING_PROVISIONAL_REPLICA, score),
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
