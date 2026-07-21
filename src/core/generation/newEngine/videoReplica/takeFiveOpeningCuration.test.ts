import { describe, expect, it } from 'vitest';
import { compileVideoReplicaScore } from './VideoReplicaScore';
import {
  TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2,
  TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3,
  TAKE_FIVE_OPENING_CURATION_REJECTIONS,
} from './takeFiveOpeningCuration';
import { TAKE_FIVE_OPENING_EVIDENCE } from './takeFiveOpeningReplica';

describe('Take Five opening visual/spectral curation candidate', () => {
  it('keeps all evidence while excluding 16 traceable detector false positives from the score', () => {
    const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2;
    expect(TAKE_FIVE_OPENING_EVIDENCE.events).toHaveLength(161);
    expect(TAKE_FIVE_OPENING_CURATION_REJECTIONS).toHaveLength(16);
    expect(score.notes).toHaveLength(145);
    expect(score.rejections).toHaveLength(16);
    expect(score.tracks.bass).toHaveLength(101);
    expect(score.tracks.comp).toHaveLength(0);
    expect(score.tracks.lead).toHaveLength(44);
  });

  it('removes the artificial high register without changing any retained performed fact', () => {
    const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2;
    expect(Math.max(...score.tracks.lead.map((note) => note.midi))).toBe(74);
    expect(score.notes.some((note) => note.performedStartTick === 2_993 && note.midi === 59)).toBe(false);
    expect(score.notes.some((note) => note.midi >= 76)).toBe(false);
    for (const note of score.notes) {
      expect(note.origin).toBe('evidence');
      if (note.origin !== 'evidence') throw new Error(`Unexpected observed addition ${note.eventId}`);
      const evidence = TAKE_FIVE_OPENING_EVIDENCE.events.find((event) => event.evidenceId === note.evidenceId)!;
      expect([
        note.performedStartTick, note.performedDurationTicks, note.midi, note.velocity,
      ]).toEqual([
        evidence.performedStartTick, evidence.performedDurationTicks, evidence.midi, evidence.velocity,
      ]);
    }
  });

  it('compiles as a 145-note piano candidate without affecting the approved product baseline', () => {
    const { ir } = compileVideoReplicaScore(TAKE_FIVE_OPENING_CURATION_CANDIDATE_V2);
    expect(ir.tracks.reduce((sum, track) => sum + track.notes.length, 0)).toBe(145);
    expect(ir.durationTicks).toBe(24_945);
  });
});

describe('Take Five opening event-level curation candidate v3', () => {
  it('moves the ten visually tracked B3 notes to Lead without changing their performed facts', () => {
    const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3;
    const moved = [
      'bass-028', 'bass-035', 'bass-036', 'bass-045', 'bass-047',
      'bass-054', 'bass-070', 'bass-079', 'bass-082', 'bass-091',
    ];
    for (const eventId of moved) {
      const note = score.notes.find((candidate) => candidate.eventId === eventId)!;
      expect(note.role).toBe('lead');
      expect(note.midi).toBe(59);
      expect(note.assignmentMethod).toBe('frame-by-frame-hand-pose-key-coordinate');
    }
    expect(score.tracks.bass).toHaveLength(91);
    expect(score.tracks.comp).toHaveLength(0);
    expect(score.tracks.lead).toHaveLength(53);
  });

  it('joins only the one frame-and-pitch-confirmed continuation and retains every real reattack', () => {
    const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3;
    expect(score.notes).toHaveLength(144);
    expect(score.rejections).toHaveLength(17);
    expect(score.corrections).toHaveLength(1);
    const expected = [
      ['lead-006', 4_462, 781, 5_243, 'lead-007'],
    ] as const;
    for (const [eventId, start, duration, end, rejectedContinuation] of expected) {
      const note = score.notes.find((candidate) => candidate.eventId === eventId)!;
      expect([note.performedStartTick, note.performedDurationTicks, start + duration]).toEqual([start, duration, end]);
      expect(score.notes.some((candidate) => candidate.eventId === rejectedContinuation)).toBe(false);
      expect(score.rejections.some((rejection) => rejection.evidenceId === rejectedContinuation)).toBe(true);
    }
    // These have independent target-frequency onset evidence and must not be over-merged.
    expect(score.notes.some((note) => note.eventId === 'bass-021')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'bass-023')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'bass-031')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'bass-033')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'bass-050')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'lead-026')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'bass-062')).toBe(true);
    expect(score.notes.some((note) => note.eventId === 'lead-032')).toBe(true);
  });

  it('annotates the three reviewed rolls without snapping their individual onsets', () => {
    const score = TAKE_FIVE_OPENING_CURATION_CANDIDATE_V3;
    expect(score.gestures).toHaveLength(8);
    expect(score.gestures.filter((gesture) => gesture.kind === 'micro-roll').map((gesture) => [gesture.id, gesture.kind])).toEqual([
      ['opening-roll-9276-9424', 'micro-roll'],
      ['opening-roll-14072-14109', 'micro-roll'],
      ['opening-roll-21525-21562', 'micro-roll'],
    ]);
    expect(score.gestures.find((gesture) => gesture.id === 'opening-legato-cs5-4462-5243')?.kind)
      .toBe('legato-continuation');
    expect(score.gestures.filter((gesture) => gesture.kind === 'reattack')).toHaveLength(4);
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    for (const eventId of ['bass-041', 'bass-042', 'lead-020', 'bass-043', 'lead-021', 'bass-044', 'bass-045']) {
      const note = score.notes.find((candidate) => candidate.eventId === eventId)!;
      const location = eventIndex[eventId]!;
      expect(ir.tracks[location.trackIndex]!.notes[location.noteIndex]!.startTick).toBe(note.performedStartTick);
    }
  });
});
