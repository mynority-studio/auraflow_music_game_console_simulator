import { deepFreeze, type DeepReadonly } from '../foundation';
import type { VideoReplicaScore, VideoReplicaScoreNote } from './VideoReplicaScore';

export type VideoReplicaComparedField =
  | 'role'
  | 'performedStartTick'
  | 'performedDurationTicks'
  | 'midi'
  | 'velocity';

export interface VideoReplicaComparableNote {
  eventId: string;
  role: VideoReplicaScoreNote['role'];
  performedStartTick: number;
  performedDurationTicks: number;
  midi: number;
  velocity: number;
}

export interface VideoReplicaEventDiff {
  eventId: string;
  kind: 'added' | 'removed' | 'modified';
  changedFields: readonly VideoReplicaComparedField[];
  audibleChange: boolean;
  before?: VideoReplicaComparableNote;
  after?: VideoReplicaComparableNote;
}

export interface VideoReplicaScoreDiffData {
  sourceVideoSha256: string;
  before: { scoreId: string; replicaRevision: string; noteCount: number };
  after: { scoreId: string; replicaRevision: string; noteCount: number };
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    audibleEventChanges: number;
    roleOnlyChanges: number;
  };
  eventChanges: readonly VideoReplicaEventDiff[];
  gestureChanges: {
    addedIds: readonly string[];
    removedIds: readonly string[];
  };
}

export type VideoReplicaScoreDiff = DeepReadonly<VideoReplicaScoreDiffData>;

const COMPARED_FIELDS: readonly VideoReplicaComparedField[] = [
  'role', 'performedStartTick', 'performedDurationTicks', 'midi', 'velocity',
];

function comparable(note: VideoReplicaComparableNote): VideoReplicaComparableNote {
  return {
    eventId: note.eventId,
    role: note.role,
    performedStartTick: note.performedStartTick,
    performedDurationTicks: note.performedDurationTicks,
    midi: note.midi,
    velocity: note.velocity,
  };
}

/** Exact event-identity diff for two curated views of the same source video. */
export function diffVideoReplicaScores(before: VideoReplicaScore, after: VideoReplicaScore): VideoReplicaScoreDiff {
  if (before.source.videoSha256 !== after.source.videoSha256) {
    throw new RangeError('VideoReplica A/B scores must reference the same source video');
  }
  if (
    before.source.ppq !== after.source.ppq
    || before.source.bpm !== after.source.bpm
    || before.source.meter.numerator !== after.source.meter.numerator
    || before.source.meter.denominator !== after.source.meter.denominator
  ) {
    throw new RangeError('VideoReplica A/B scores must share one performed timebase');
  }

  const beforeById = new Map(before.notes.map((note) => [note.eventId, note]));
  const afterById = new Map(after.notes.map((note) => [note.eventId, note]));
  const orderedIds = [
    ...before.notes.map((note) => note.eventId),
    ...after.notes.map((note) => note.eventId).filter((eventId) => !beforeById.has(eventId)),
  ];
  const eventChanges: VideoReplicaEventDiff[] = [];
  let unchanged = 0;
  for (const eventId of orderedIds) {
    const beforeNote = beforeById.get(eventId);
    const afterNote = afterById.get(eventId);
    if (!beforeNote && afterNote) {
      eventChanges.push({
        eventId,
        kind: 'added',
        changedFields: ['role', 'performedStartTick', 'performedDurationTicks', 'midi', 'velocity'],
        audibleChange: true,
        after: comparable(afterNote),
      });
      continue;
    }
    if (beforeNote && !afterNote) {
      eventChanges.push({
        eventId,
        kind: 'removed',
        changedFields: ['role', 'performedStartTick', 'performedDurationTicks', 'midi', 'velocity'],
        audibleChange: true,
        before: comparable(beforeNote),
      });
      continue;
    }
    if (!beforeNote || !afterNote) continue;
    const changedFields = COMPARED_FIELDS.filter((field) => beforeNote[field] !== afterNote[field]);
    if (changedFields.length === 0) {
      unchanged += 1;
      continue;
    }
    eventChanges.push({
      eventId,
      kind: 'modified',
      changedFields,
      // With the same piano on every role, role ownership alone is semantic.
      audibleChange: changedFields.some((field) => field !== 'role'),
      before: comparable(beforeNote),
      after: comparable(afterNote),
    });
  }

  const beforeGestures = new Set(before.gestures.map((gesture) => gesture.id));
  const afterGestures = new Set(after.gestures.map((gesture) => gesture.id));
  const added = eventChanges.filter((change) => change.kind === 'added').length;
  const removed = eventChanges.filter((change) => change.kind === 'removed').length;
  const modified = eventChanges.filter((change) => change.kind === 'modified').length;
  return deepFreeze({
    sourceVideoSha256: before.source.videoSha256,
    before: { scoreId: before.id, replicaRevision: before.replicaRevision, noteCount: before.notes.length },
    after: { scoreId: after.id, replicaRevision: after.replicaRevision, noteCount: after.notes.length },
    summary: {
      added,
      removed,
      modified,
      unchanged,
      audibleEventChanges: eventChanges.filter((change) => change.audibleChange).length,
      roleOnlyChanges: eventChanges.filter((change) => (
        change.kind === 'modified' && change.changedFields.length === 1 && change.changedFields[0] === 'role'
      )).length,
    },
    eventChanges,
    gestureChanges: {
      addedIds: after.gestures.map((gesture) => gesture.id).filter((id) => !beforeGestures.has(id)),
      removedIds: before.gestures.map((gesture) => gesture.id).filter((id) => !afterGestures.has(id)),
    },
  });
}
