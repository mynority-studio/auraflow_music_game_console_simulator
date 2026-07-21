import { describe, expect, it } from 'vitest';
import {
  assertNoVideoReplicaSameKeyReattackCollisions,
  compileVideoReplicaScore,
  findVideoReplicaSameKeyReattackCollisions,
} from './VideoReplicaScore';
import { diffVideoReplicaScores } from './VideoReplicaDiff';
import {
  TAKE_FIVE_FULL_CURATION_ADDITIONS_V6,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V2,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V6,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V7,
} from './takeFiveFullCuration';
import { TAKE_FIVE_FULL_PROVISIONAL_REPLICA } from './takeFiveFullReplica';
import { TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3 } from './takeFiveOpeningCuration';

describe('Take Five full event-level curation candidate', () => {
  it('embeds the opening v3 facts exactly instead of regenerating its first 15 seconds', () => {
    const fullPrefix = TAKE_FIVE_FULL_CURATION_CANDIDATE_V2.notes
      .filter((note) => note.performedStartTick < 24_000)
      .map((note) => [
        note.eventId, note.role, note.performedStartTick, note.performedDurationTicks, note.midi, note.velocity,
      ]);
    const opening = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3.notes.map((note) => [
      note.eventId, note.role, note.performedStartTick, note.performedDurationTicks, note.midi, note.velocity,
    ]);
    expect(fullPrefix).toEqual(opening);
  });

  it('applies only the two high-confidence post-handoff pitch facts', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V2;
    const corrected = score.notes.find((note) => note.eventId === 'lead-069')!;
    expect([corrected.performedStartTick, corrected.midi]).toEqual([31_228, 64]);
    expect(score.notes.some((note) => note.eventId === 'lead-073')).toBe(false);
    expect(score.rejections.some((rejection) => rejection.evidenceId === 'lead-073')).toBe(true);
    // A real high-register reharm note must not be removed by a global octave rule.
    expect(score.notes.some((note) => note.eventId === 'lead-085' && note.midi === 74)).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'lead-094' && note.midi === 72)).toBe(true);
  });

  it('preserves the silent handoff tick, Bass tails and first real Comp onset', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V2;
    expect(score.notes.some((note) => note.performedStartTick === 24_000)).toBe(false);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick))).toBe(23_924);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick + note.performedDurationTicks))).toBe(24_945);
    expect(Math.min(...score.tracks.comp.map((note) => note.performedStartTick))).toBe(24_722);
  });

  it('keeps reviewed post-handoff flam/roll timings 1:1 in MusicalIR', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V2;
    expect(score.gestures).toHaveLength(11);
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    for (const eventId of ['lead-064', 'comp-025', 'comp-026', 'comp-036', 'lead-069', 'comp-037', 'lead-094', 'comp-094', 'comp-095']) {
      const note = score.notes.find((candidate) => candidate.eventId === eventId)!;
      const location = eventIndex[eventId]!;
      expect(ir.tracks[location.trackIndex]!.notes[location.noteIndex]!.startTick).toBe(note.performedStartTick);
    }
  });

  it('remains an unapproved candidate and does not replace the product baseline', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V2;
    expect(score.curationStatus).toBe('provisional');
    expect(score.notes).toHaveLength(537);
    expect(score.tracks.bass).toHaveLength(91);
    expect(score.tracks.comp).toHaveLength(275);
    expect(score.tracks.lead).toHaveLength(171);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes).toHaveLength(555);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.replicaRevision).toBe('v1-first-raw-lossless');
  });
});

describe('Take Five full event-level curation candidate v3', () => {
  it('keeps all four reviewed middle same-key pairs as real reattacks', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const pairs = [
      ['middle-reattack-fs4-35205-35428', 'lead-071', 35_205, 'lead-072', 35_428],
      ['middle-reattack-bb2-36118-36322', 'comp-061', 36_118, 'comp-065', 36_322],
      ['middle-reattack-d5-41693-41897', 'lead-085', 41_693, 'lead-087', 41_897],
      ['middle-reattack-a2-43311-43478', 'comp-092', 43_311, 'comp-093', 43_478],
    ] as const;
    for (const [gestureId, firstId, firstTick, secondId, secondTick] of pairs) {
      expect(score.gestures.find((gesture) => gesture.id === gestureId)?.kind).toBe('reattack');
      expect(score.notes.find((note) => note.eventId === firstId)?.performedStartTick).toBe(firstTick);
      expect(score.notes.find((note) => note.eventId === secondId)?.performedStartTick).toBe(secondTick);
    }
  });

  it('removes only the three video-confirmed tail upper partials', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    for (const eventId of ['comp-187', 'lead-168', 'lead-170']) {
      expect(score.notes.some((note) => note.eventId === eventId)).toBe(false);
      expect(score.rejections.some((rejection) => rejection.evidenceId === eventId)).toBe(true);
    }
    expect(score.notes.some((note) => note.eventId === 'comp-186' && note.midi === 44)).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'lead-167' && note.midi === 66)).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'lead-169' && note.midi === 66)).toBe(true);

    const fromV2 = diffVideoReplicaScores(TAKE_FIVE_FULL_CURATION_CANDIDATE_V2, score);
    expect(fromV2.eventChanges.filter((change) => change.kind === 'added')).toHaveLength(0);
    expect(fromV2.eventChanges.filter((change) => change.kind === 'removed').map((change) => change.eventId))
      .toEqual(['comp-187', 'lead-168', 'lead-170']);
    expect(fromV2.eventChanges.filter((change) => change.kind === 'modified')).toHaveLength(0);
    expect(fromV2.summary.audibleEventChanges).toBe(3);
  });

  it('annotates the reviewed middle and tail rolls without changing their onsets', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const rolls = [
      ['middle-roll-35168-35205', ['comp-053', 'comp-054', 'lead-071'], [35_168, 35_187, 35_205]],
      ['tail-roll-53942-53980', ['comp-128', 'comp-129', 'lead-128'], [53_942, 53_961, 53_980]],
      ['tail-roll-54444-54481', ['lead-130', 'comp-131', 'comp-132', 'comp-133'], [54_444, 54_462, 54_462, 54_481]],
      ['tail-roll-76155-76174', ['comp-251', 'comp-252', 'comp-253', 'lead-173', 'lead-174'], [76_155, 76_155, 76_174, 76_174, 76_174]],
    ] as const;
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    for (const [gestureId, eventIds, expectedTicks] of rolls) {
      expect(score.gestures.find((gesture) => gesture.id === gestureId)?.kind).toBe('micro-roll');
      expect(eventIds.map((eventId) => score.notes.find((note) => note.eventId === eventId)?.performedStartTick))
        .toEqual(expectedTicks);
      for (const eventId of eventIds) {
        const note = score.notes.find((candidate) => candidate.eventId === eventId)!;
        const location = eventIndex[eventId]!;
        expect(ir.tracks[location.trackIndex]!.notes[location.noteIndex]!.startTick).toBe(note.performedStartTick);
      }
    }
  });

  it('remains provisional, preserves the handoff and leaves the product baseline untouched', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    expect(score.curationStatus).toBe('provisional');
    expect(score.notes).toHaveLength(534);
    expect(score.tracks.bass).toHaveLength(91);
    expect(score.tracks.comp).toHaveLength(274);
    expect(score.tracks.lead).toHaveLength(169);
    expect(score.rejections).toHaveLength(21);
    expect(score.corrections).toHaveLength(2);
    expect(score.gestures).toHaveLength(19);
    expect(score.notes.some((note) => note.performedStartTick === 24_000)).toBe(false);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick + note.performedDurationTicks))).toBe(24_945);
    expect(Math.min(...score.tracks.comp.map((note) => note.performedStartTick))).toBe(24_722);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes).toHaveLength(555);
  });
});

describe('Take Five full event-level curation candidate v4', () => {
  it('extends only the evidence-supported final E4 tail and preserves v3 as history', () => {
    const v3 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const v4 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    const v3Tail = v3.notes.find((note) => note.eventId === 'lead-178')!;
    const v4Tail = v4.notes.find((note) => note.eventId === 'lead-178')!;

    expect([
      v3Tail.performedStartTick,
      v3Tail.performedDurationTicks,
      v3Tail.midi,
      v3Tail.velocity,
    ]).toEqual([81_137, 279, 64, 74]);
    expect([
      v4Tail.performedStartTick,
      v4Tail.performedDurationTicks,
      v4Tail.performedStartTick + v4Tail.performedDurationTicks,
      v4Tail.midi,
      v4Tail.velocity,
    ]).toEqual([81_137, 760, 81_897, 64, 74]);
    expect(v4Tail.origin).toBe('evidence');
    expect(v4Tail.origin === 'evidence' ? v4Tail.correction?.performedDurationTicks : undefined).toBe(760);

    const fromV3 = diffVideoReplicaScores(v3, v4);
    expect(fromV3.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 1,
      unchanged: 533,
      audibleEventChanges: 1,
      roleOnlyChanges: 0,
    });
    expect(fromV3.eventChanges.find((change) => change.eventId === 'lead-178')).toEqual(expect.objectContaining({
      kind: 'modified',
      changedFields: ['performedDurationTicks'],
      audibleChange: true,
    }));
  });

  it('does not promote the conflicting F3 detector cluster into the fixed score', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    expect(score.additions).toHaveLength(0);
    expect(score.notes.some((note) => (
      note.performedStartTick === 43_288 && note.midi === 53
    ))).toBe(false);
  });

  it('remains isolated, provisional and structurally identical to v3', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    expect(score.curationStatus).toBe('provisional');
    expect(score.notes).toHaveLength(534);
    expect(score.tracks.bass).toHaveLength(91);
    expect(score.tracks.comp).toHaveLength(274);
    expect(score.tracks.lead).toHaveLength(169);
    expect(score.rejections).toHaveLength(21);
    expect(score.corrections).toHaveLength(3);
    expect(score.gestures).toHaveLength(19);
    expect(score.notes.some((note) => note.performedStartTick === 24_000)).toBe(false);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick + note.performedDurationTicks))).toBe(24_945);
    expect(Math.min(...score.tracks.comp.map((note) => note.performedStartTick))).toBe(24_722);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes).toHaveLength(555);
  });
});

describe('Take Five full event-level curation candidate v5', () => {
  it('fixes every post-handoff Comp same-key MIDI collision without moving an attack', () => {
    const v4 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    const v5 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V5;
    const postHandoffCompWindow = { startTickInclusive: 24_000, endTickExclusive: 85_860 };
    const before = findVideoReplicaSameKeyReattackCollisions(v4, postHandoffCompWindow)
      .filter((collision) => collision.role === 'comp');

    expect(before.map((collision) => [
      collision.previousEventId,
      collision.nextEventId,
      collision.previousOffTick,
      collision.nextOnTick,
      collision.overlapTicks,
    ])).toEqual([
      ['comp-052', 'comp-053', 35_169, 35_168, 1],
      ['comp-066', 'comp-069', 37_363, 37_362, 1],
      ['comp-138', 'comp-141', 56_750, 56_749, 1],
      ['comp-154', 'comp-159', 61_043, 61_042, 1],
      ['comp-165', 'comp-167', 62_847, 62_846, 1],
      ['comp-174', 'comp-178', 64_521, 64_520, 1],
      ['comp-188', 'comp-190', 66_230, 66_229, 1],
      ['comp-212', 'comp-215', 71_008, 71_007, 1],
      ['comp-217', 'comp-220', 71_491, 71_490, 1],
      ['comp-219', 'comp-222', 71_714, 71_713, 1],
      ['comp-258', 'comp-260', 77_811, 77_810, 1],
      ['comp-254', 'comp-263', 78_944, 78_943, 1],
      ['comp-267', 'comp-269', 80_878, 80_877, 1],
    ]);
    expect(() => assertNoVideoReplicaSameKeyReattackCollisions(v5, postHandoffCompWindow)).not.toThrow();

    const v4ById = new Map(v4.notes.map((note) => [note.eventId, note]));
    for (const note of v5.notes) {
      const previous = v4ById.get(note.eventId)!;
      expect([note.performedStartTick, note.midi, note.velocity])
        .toEqual([previous.performedStartTick, previous.midi, previous.velocity]);
    }
  });

  it('is an isolated thirteen-duration revision and leaves v4 and the product baseline untouched', () => {
    const fromV4 = diffVideoReplicaScores(
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
    );
    expect(fromV4.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 13,
      unchanged: 521,
      audibleEventChanges: 13,
      roleOnlyChanges: 0,
    });
    expect(fromV4.eventChanges.every((change) => (
      change.kind === 'modified'
      && change.changedFields.length === 1
      && change.changedFields[0] === 'performedDurationTicks'
    ))).toBe(true);
    expect(TAKE_FIVE_FULL_CURATION_CANDIDATE_V4.corrections).toHaveLength(3);
    expect(TAKE_FIVE_FULL_CURATION_CANDIDATE_V5.corrections).toHaveLength(16);
    expect(TAKE_FIVE_FULL_CURATION_CANDIDATE_V5.notes).toHaveLength(534);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.replicaRevision).toBe('v1-first-raw-lossless');
  });
});

describe('Take Five full event-level curation candidate v6', () => {
  it('contains the complete reviewed 550-note three-role score and remains provisional', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V6;

    expect(score.curationStatus).toBe('provisional');
    expect(score.notes).toHaveLength(550);
    expect(score.tracks.bass).toHaveLength(96);
    expect(score.tracks.comp).toHaveLength(282);
    expect(score.tracks.lead).toHaveLength(172);
    expect(score.additions).toHaveLength(17);
    expect(score.corrections).toHaveLength(22);
    expect(score.rejections).toHaveLength(22);
    expect(score.gestures).toHaveLength(19);
  });

  it('adds exactly the seventeen video-confirmed omission facts', () => {
    const expected = [
      ['observed-v6-03378-d3', 'bass', 3_378, 167, 50, 60],
      ['observed-v6-08156-b3', 'lead', 8_156, 223, 59, 51],
      ['observed-v6-08379-e2', 'bass', 8_379, 316, 40, 55],
      ['observed-v6-10107-b2', 'bass', 10_107, 504, 47, 55],
      ['observed-v6-10555-d3', 'bass', 10_555, 241, 50, 52],
      ['observed-v6-15591-d3', 'bass', 15_591, 167, 50, 55],
      ['observed-v6-39533-c3', 'comp', 39_533, 204, 48, 50],
      ['observed-v6-40555-g3', 'comp', 40_555, 223, 55, 50],
      ['observed-v6-43065-a2', 'comp', 43_065, 241, 45, 57],
      ['observed-v6-59682-d3', 'comp', 59_682, 204, 50, 51],
      ['observed-v6-59775-a2', 'comp', 59_775, 316, 45, 51],
      ['observed-v6-60536-fs4', 'lead', 60_536, 671, 66, 57],
      ['observed-v6-63994-a2', 'comp', 63_994, 299, 45, 56],
      ['observed-v6-67546-d5', 'lead', 67_546, 186, 74, 51],
      ['observed-v6-73622-g4', 'lead', 73_622, 448, 67, 70],
      ['observed-v6-76169-a2', 'comp', 76_169, 167, 45, 54],
      ['observed-v6-76318-e3', 'comp', 76_318, 204, 52, 51],
    ] as const;
    const facts = TAKE_FIVE_FULL_CURATION_ADDITIONS_V6.map((addition) => [
      addition.observationId,
      addition.role,
      addition.performedStartTick,
      addition.performedDurationTicks,
      addition.midi,
      addition.velocity,
    ]);

    expect(facts).toEqual(expected);
    expect(TAKE_FIVE_FULL_CURATION_CANDIDATE_V6.notes
      .filter((note) => note.origin === 'curated-observation')
      .map((note) => [
        note.eventId,
        note.role,
        note.performedStartTick,
        note.performedDurationTicks,
        note.midi,
        note.velocity,
      ])).toEqual(expected);
  });

  it('keeps the disputed D4 out and merges the false F#4 split into the observed hold', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V6;

    expect(score.notes.some((note) => (
      note.performedStartTick === 40_295 && note.midi === 62
    ))).toBe(false);
    expect(score.notes.some((note) => note.eventId === 'lead-147')).toBe(false);
    expect(score.rejections.some((rejection) => rejection.evidenceId === 'lead-147')).toBe(true);
    expect(score.notes.find((note) => note.eventId === 'lead-148'))
      .toEqual(TAKE_FIVE_FULL_CURATION_CANDIDATE_V5.notes.find((note) => note.eventId === 'lead-148'));
    expect(score.notes.find((note) => note.eventId === 'observed-v6-60536-fs4'))
      .toEqual(expect.objectContaining({
        role: 'lead',
        performedStartTick: 60_536,
        performedDurationTicks: 671,
        midi: 66,
        velocity: 57,
      }));
  });

  it('diffs from v5 by seventeen additions, one removal and six duration-only repairs', () => {
    const v5 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V5;
    const v6 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V6;
    const diff = diffVideoReplicaScores(v5, v6);

    expect(diff.summary).toEqual({
      added: 17,
      removed: 1,
      modified: 6,
      unchanged: 527,
      audibleEventChanges: 24,
      roleOnlyChanges: 0,
    });
    expect(diff.eventChanges.filter((change) => change.kind === 'added').map((change) => change.eventId))
      .toEqual(TAKE_FIVE_FULL_CURATION_ADDITIONS_V6.map((addition) => addition.observationId));
    expect(diff.eventChanges.filter((change) => change.kind === 'removed').map((change) => change.eventId))
      .toEqual(['lead-147']);

    const durationRepairs = [
      ['bass-006', 502, 501],
      ['bass-037', 149, 148],
      ['bass-058', 502, 501],
      ['bass-069', 502, 501],
      ['bass-084', 279, 278],
      ['lead-042', 446, 445],
    ] as const;
    expect(diff.eventChanges
      .filter((change) => change.kind === 'modified')
      .map((change) => change.eventId)
      .sort()).toEqual(durationRepairs.map(([eventId]) => eventId).sort());

    for (const [eventId, beforeDuration, afterDuration] of durationRepairs) {
      const before = v5.notes.find((note) => note.eventId === eventId)!;
      const after = v6.notes.find((note) => note.eventId === eventId)!;
      const change = diff.eventChanges.find((candidate) => candidate.eventId === eventId)!;
      expect([before.performedDurationTicks, after.performedDurationTicks])
        .toEqual([beforeDuration, afterDuration]);
      expect(change).toEqual(expect.objectContaining({
        kind: 'modified',
        changedFields: ['performedDurationTicks'],
        audibleChange: true,
      }));
      expect([after.role, after.performedStartTick, after.midi, after.velocity])
        .toEqual([before.role, before.performedStartTick, before.midi, before.velocity]);
    }
  });

  it('has no same-key reattack collision anywhere in the full score', () => {
    expect(findVideoReplicaSameKeyReattackCollisions(TAKE_FIVE_FULL_CURATION_CANDIDATE_V6))
      .toEqual([]);
    expect(() => assertNoVideoReplicaSameKeyReattackCollisions(
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V6,
    )).not.toThrow();
  });

  it('does not replace the 555-note v1 product baseline', () => {
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes).toHaveLength(555);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.replicaRevision).toBe('v1-first-raw-lossless');
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA).not.toBe(TAKE_FIVE_FULL_CURATION_CANDIDATE_V6);
  });
});

describe('Take Five full event-level curation candidate v7', () => {
  it('keeps the reviewed 550-note three-role score and remains provisional', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V7;

    expect(score.curationStatus).toBe('provisional');
    expect(score.notes).toHaveLength(550);
    expect(score.tracks.bass).toHaveLength(96);
    expect(score.tracks.comp).toHaveLength(282);
    expect(score.tracks.lead).toHaveLength(172);
  });

  it('moves only the observed E3 hammer onset while preserving its absolute end and note identity', () => {
    const v6 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V6;
    const v7 = TAKE_FIVE_FULL_CURATION_CANDIDATE_V7;
    const eventId = 'observed-v6-76318-e3';
    const before = v6.notes.find((note) => note.eventId === eventId)!;
    const after = v7.notes.find((note) => note.eventId === eventId)!;
    const diff = diffVideoReplicaScores(v6, v7);

    expect(diff.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 1,
      unchanged: 549,
      audibleEventChanges: 1,
      roleOnlyChanges: 0,
    });
    expect(diff.eventChanges).toEqual([
      expect.objectContaining({
        eventId,
        kind: 'modified',
        changedFields: ['performedStartTick', 'performedDurationTicks'],
        audibleChange: true,
      }),
    ]);
    expect([
      before.performedStartTick,
      before.performedDurationTicks,
      before.performedStartTick + before.performedDurationTicks,
    ]).toEqual([76_318, 204, 76_522]);
    expect([
      after.performedStartTick,
      after.performedDurationTicks,
      after.performedStartTick + after.performedDurationTicks,
    ]).toEqual([76_273, 249, 76_522]);
    expect([after.eventId, after.origin, after.role, after.midi, after.velocity])
      .toEqual([before.eventId, before.origin, before.role, before.midi, before.velocity]);
  });

  it('has no same-key reattack collision anywhere in the full score', () => {
    expect(findVideoReplicaSameKeyReattackCollisions(TAKE_FIVE_FULL_CURATION_CANDIDATE_V7))
      .toEqual([]);
    expect(() => assertNoVideoReplicaSameKeyReattackCollisions(
      TAKE_FIVE_FULL_CURATION_CANDIDATE_V7,
    )).not.toThrow();
  });

  it('does not replace the 555-note v1 product baseline', () => {
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.notes).toHaveLength(555);
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA.replicaRevision).toBe('v1-first-raw-lossless');
    expect(TAKE_FIVE_FULL_PROVISIONAL_REPLICA).not.toBe(TAKE_FIVE_FULL_CURATION_CANDIDATE_V7);
  });
});
