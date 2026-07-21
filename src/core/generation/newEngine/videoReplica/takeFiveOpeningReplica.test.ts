import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSMF } from '../../../audio/smfParser';
import { musicalIRToSMF } from '../sandbox/midiFile';
import { compileVideoReplicaScore, videoSecondsAtPerformedTick, type VideoReplicaRole } from './VideoReplicaScore';
import {
  TAKE_FIVE_OPENING_CANONICAL_EVENT_SHA256,
  TAKE_FIVE_OPENING_CSV_SHA256,
  TAKE_FIVE_OPENING_EVIDENCE_CSV,
  TAKE_FIVE_OPENING_STRIKE_GROUP_SHA256,
} from './takeFiveIntroEvidence';
import {
  TAKE_FIVE_VIDEO_BYTE_LENGTH,
  TAKE_FIVE_VIDEO_SHA256,
} from './takeFiveFullEvidence';
import {
  TAKE_FIVE_OPENING_EVIDENCE,
  TAKE_FIVE_OPENING_PROVISIONAL_REPLICA,
} from './takeFiveOpeningReplica';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const roleRank: Record<VideoReplicaRole, number> = { bass: 0, comp: 1, lead: 2 };
const roleChannel: Record<VideoReplicaRole, number> = { bass: 3, comp: 2, lead: 1 };

const canonicalEvents = (): string => [...TAKE_FIVE_OPENING_EVIDENCE.events]
  .sort((left, right) => (
    left.performedStartTick - right.performedStartTick
    || roleRank[left.roleHint!.role] - roleRank[right.roleHint!.role]
    || left.midi - right.midi
    || left.performedDurationTicks - right.performedDurationTicks
    || left.velocity - right.velocity
  ))
  .map((event) => [
    event.roleHint!.role,
    event.performedStartTick,
    event.performedDurationTicks,
    event.midi,
    event.velocity,
  ].join('|'))
  .join('\n') + '\n';

describe('Take Five opening provisional replica', () => {
  it('pins the supplied video and the independently canonicalized opening evidence', () => {
    expect(TAKE_FIVE_VIDEO_SHA256).toBe('73810e3c4dc69f8337c392642e47f52e84ce890c7995949895ca5317100d01e7');
    expect(TAKE_FIVE_VIDEO_BYTE_LENGTH).toBe(1_753_564);
    expect(TAKE_FIVE_OPENING_EVIDENCE.source.tickZeroAtVideoSeconds).toBe(1.547);
    expect(sha256(TAKE_FIVE_OPENING_EVIDENCE_CSV)).toBe(TAKE_FIVE_OPENING_CSV_SHA256);
    expect(Buffer.byteLength(canonicalEvents())).toBe(3_322);
    expect(sha256(canonicalEvents())).toBe(TAKE_FIVE_OPENING_CANONICAL_EVENT_SHA256);
  });

  it('retains 161 candidate events and 89 fixed-anchor physical strike groups', () => {
    const evidence = TAKE_FIVE_OPENING_EVIDENCE;
    expect(evidence.events).toHaveLength(161);
    expect(evidence.strikeGroups).toHaveLength(89);
    expect(evidence.strikeGroups.filter((group) => group.evidenceIds.length > 1)).toHaveLength(40);
    expect(evidence.events.filter((event) => event.roleHint?.role === 'bass')).toHaveLength(102);
    expect(evidence.events.filter((event) => event.roleHint?.role === 'lead')).toHaveLength(59);

    const canonicalGroups = evidence.strikeGroups
      .map((group) => `${group.anchorTick}|${group.evidenceIds.map((id) => evidence.events.findIndex((event) => event.evidenceId === id)).join(',')}`)
      .join('\n') + '\n';
    expect(sha256(canonicalGroups)).toBe(TAKE_FIVE_OPENING_STRIKE_GROUP_SHA256);
  });

  it('preserves the off-grid and rolled-onset sentinels instead of hard-snapping them', () => {
    const score = TAKE_FIVE_OPENING_PROVISIONAL_REPLICA;
    expect(score.notes.some((note) => note.performedStartTick === 19)).toBe(true);
    expect(score.notes.some((note) => note.performedStartTick === 427)).toBe(true);
    const at4017 = score.notes.filter((note) => note.performedStartTick === 4017);
    const at4035 = score.notes.filter((note) => note.performedStartTick === 4035);
    expect(at4017.length).toBeGreaterThan(0);
    expect(at4035.length).toBeGreaterThan(0);
    expect(at4017.every((note) => note.origin === 'evidence')).toBe(true);
    expect(at4035.every((note) => note.origin === 'evidence')).toBe(true);
    expect(new Set([...at4017, ...at4035].map((note) => (
      note.origin === 'evidence' ? note.strikeGroupId : undefined
    ))).size).toBe(1);
  });

  it('keeps performed section time distinct from absolute source-video time', () => {
    const source = TAKE_FIVE_OPENING_EVIDENCE.source;
    expect(videoSecondsAtPerformedTick(source, 21_525)).toBeCloseTo(15.000125, 6);
    expect(videoSecondsAtPerformedTick(source, 21_600)).toBeCloseTo(15.047, 6);
    expect(videoSecondsAtPerformedTick(source, 24_000)).toBeCloseTo(16.547, 6);
    expect(24_000 / source.ppq * 60 / source.bpm).toBe(15);
  });

  it('projects every performed fact 1:1 into MusicalIR, including cross-bar tails', () => {
    const score = TAKE_FIVE_OPENING_PROVISIONAL_REPLICA;
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    expect(ir.durationTicks).toBe(24_945);
    expect(ir.tracks.map((track) => [track.role, track.notes.length])).toEqual([
      ['bass', 102], ['comp', 0], ['lead', 59],
    ]);
    for (const note of score.notes) {
      const location = eventIndex[note.eventId]!;
      const irNote = ir.tracks[location.trackIndex]!.notes[location.noteIndex]!;
      expect([
        ir.tracks[location.trackIndex]!.role,
        irNote.pitch,
        irNote.startTick,
        irNote.durationTicks,
        irNote.velocity,
      ]).toEqual([
        note.role,
        note.midi,
        note.performedStartTick,
        note.performedDurationTicks,
        note.velocity,
      ]);
    }
    expect(score.notes.filter((note) => note.performedStartTick < 24_000
      && note.performedStartTick + note.performedDurationTicks > 24_000)).toHaveLength(4);
  });

  it('survives the production MusicalIR-to-SMF path with exact note semantics', () => {
    const score = TAKE_FIVE_OPENING_PROVISIONAL_REPLICA;
    const { ir } = compileVideoReplicaScore(score);
    const bytes = musicalIRToSMF(ir, score.source.bpm, 'jazz');
    const parsed = parseSMF(bytes);
    expect(parsed.division).toBe(480);
    expect(parsed.bpm).toBeCloseTo(200, 5);
    expect(parsed.noteCount).toBe(score.notes.length);
    expect(parsed.durationTicks).toBe(score.durationPerformedTicks);
    expect([...bytes].join(',')).toContain([0xff, 0x58, 0x04, 5, 2, 24, 8].join(','));

    const expectedOn = score.notes.map((note) => [
      note.performedStartTick,
      roleChannel[note.role],
      note.midi,
      note.velocity,
    ].join('|')).sort();
    const actualOn = parsed.events.filter((event) => event.type === 'noteOn').map((event) => [
      event.ticks, event.channel, event.data1, event.data2,
    ].join('|')).sort();
    expect(actualOn).toEqual(expectedOn);

    const expectedOff = score.notes.map((note) => [
      note.performedStartTick + note.performedDurationTicks,
      roleChannel[note.role],
      note.midi,
      0,
    ].join('|')).sort();
    const actualOff = parsed.events.filter((event) => event.type === 'noteOff').map((event) => [
      event.ticks, event.channel, event.data1, event.data2,
    ].join('|')).sort();
    expect(actualOff).toEqual(expectedOff);
  });
});
