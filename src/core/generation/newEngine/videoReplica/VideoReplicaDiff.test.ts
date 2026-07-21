import { describe, expect, it } from 'vitest';
import { diffVideoReplicaScores } from './VideoReplicaDiff';
import {
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V2,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
} from './takeFiveFullCuration';
import { TAKE_FIVE_FULL_PROVISIONAL_REPLICA } from './takeFiveFullReplica';
import { TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3 } from './takeFiveOpeningCuration';
import { TAKE_FIVE_OPENING_PROVISIONAL_REPLICA } from './takeFiveOpeningReplica';

describe('VideoReplica event-level A/B diff', () => {
  it('separates opening role-only changes from audible event changes', () => {
    const diff = diffVideoReplicaScores(
      TAKE_FIVE_OPENING_PROVISIONAL_REPLICA,
      TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3,
    );
    expect(diff.summary).toEqual({
      added: 0,
      removed: 17,
      modified: 11,
      unchanged: 133,
      audibleEventChanges: 18,
      roleOnlyChanges: 10,
    });
    expect(diff.eventChanges.find((change) => change.eventId === 'bass-028')).toEqual(expect.objectContaining({
      kind: 'modified', changedFields: ['role'], audibleChange: false,
    }));
    expect(diff.eventChanges.find((change) => change.eventId === 'lead-006')).toEqual(expect.objectContaining({
      kind: 'modified', changedFields: ['performedDurationTicks'], audibleChange: true,
    }));
    expect(diff.gestureChanges.addedIds).toHaveLength(8);
  });

  it('reports the full candidate as a bounded, traceable delta from the product baseline', () => {
    const diff = diffVideoReplicaScores(
      TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V2,
    );
    expect(diff.summary).toEqual({
      added: 0,
      removed: 18,
      modified: 12,
      unchanged: 525,
      audibleEventChanges: 20,
      roleOnlyChanges: 10,
    });
    expect(diff.eventChanges.find((change) => change.eventId === 'lead-069')).toEqual(expect.objectContaining({
      kind: 'modified', changedFields: ['midi'], audibleChange: true,
    }));
    expect(diff.eventChanges.find((change) => change.eventId === 'lead-073')?.kind).toBe('removed');
    expect(diff.gestureChanges.addedIds).toHaveLength(11);
  });

  it('reports full v3 as the same reviewed score plus three tail-partial removals and eight gestures', () => {
    const diff = diffVideoReplicaScores(
      TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
    );
    expect(diff.summary).toEqual({
      added: 0,
      removed: 21,
      modified: 12,
      unchanged: 522,
      audibleEventChanges: 23,
      roleOnlyChanges: 10,
    });
    expect(diff.gestureChanges.addedIds).toHaveLength(19);
    expect(diff.eventChanges.filter((change) => change.kind === 'removed').map((change) => change.eventId))
      .toEqual(expect.arrayContaining(['comp-187', 'lead-168', 'lead-170']));
  });

  it('reports full v4 as one evidence-supported duration delta without an inferred F3 addition', () => {
    const fromV3 = diffVideoReplicaScores(
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
    );
    expect(fromV3.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 1,
      unchanged: 533,
      audibleEventChanges: 1,
      roleOnlyChanges: 0,
    });
    expect(fromV3.eventChanges).toEqual([expect.objectContaining({
      eventId: 'lead-178',
      kind: 'modified',
      changedFields: ['performedDurationTicks'],
    })]);

    const fromBaseline = diffVideoReplicaScores(
      TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
    );
    expect(fromBaseline.summary).toEqual({
      added: 0,
      removed: 21,
      modified: 13,
      unchanged: 521,
      audibleEventChanges: 24,
      roleOnlyChanges: 10,
    });
  });
});
