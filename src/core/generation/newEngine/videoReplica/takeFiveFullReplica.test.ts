import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSMF } from '../../../audio/smfParser';
import { compileVideoReplicaScore, type VideoReplicaRole } from './VideoReplicaScore';
import { videoReplicaToSMF } from './videoReplicaMidi';
import {
  TAKE_FIVE_FULL_CANONICAL_EVENT_SHA256,
  TAKE_FIVE_FULL_EVIDENCE_CSV,
  TAKE_FIVE_FULL_EVIDENCE_CSV_SHA256,
  TAKE_FIVE_FULL_STRIKE_GROUP_SHA256,
} from './takeFiveFullEvidence';
import {
  TAKE_FIVE_FULL_EVIDENCE,
  TAKE_FIVE_FULL_PROVISIONAL_REPLICA,
} from './takeFiveFullReplica';
import { TAKE_FIVE_OPENING_PROVISIONAL_REPLICA } from './takeFiveOpeningReplica';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const roleRank: Record<VideoReplicaRole, number> = { bass: 0, comp: 1, lead: 2 };

describe('Take Five full provisional replica', () => {
  it('pins all 555 first-raw events and 340 fixed-anchor strike groups', () => {
    const evidence = TAKE_FIVE_FULL_EVIDENCE;
    expect(sha256(TAKE_FIVE_FULL_EVIDENCE_CSV)).toBe(TAKE_FIVE_FULL_EVIDENCE_CSV_SHA256);
    expect(evidence.events).toHaveLength(555);
    expect(evidence.strikeGroups).toHaveLength(340);
    expect(evidence.strikeGroups.filter((group) => group.evidenceIds.length > 1)).toHaveLength(146);

    const canonicalEvents = [...evidence.events]
      .sort((left, right) => (
        left.performedStartTick - right.performedStartTick
        || roleRank[left.roleHint!.role] - roleRank[right.roleHint!.role]
        || left.midi - right.midi
        || left.performedDurationTicks - right.performedDurationTicks
        || left.velocity - right.velocity
      ))
      .map((event) => `${event.roleHint!.role}|${event.performedStartTick}|${event.performedDurationTicks}|${event.midi}|${event.velocity}`)
      .join('\n') + '\n';
    expect(sha256(canonicalEvents)).toBe(TAKE_FIVE_FULL_CANONICAL_EVENT_SHA256);

    const canonicalGroups = evidence.strikeGroups
      .map((group) => `${group.anchorTick}|${group.evidenceIds.map((id) => evidence.events.findIndex((event) => event.evidenceId === id)).join(',')}`)
      .join('\n') + '\n';
    expect(sha256(canonicalGroups)).toBe(TAKE_FIVE_FULL_STRIKE_GROUP_SHA256);
  });

  it('models the performed handoff without inventing a Comp downbeat or truncating Bass tails', () => {
    const score = TAKE_FIVE_FULL_PROVISIONAL_REPLICA;
    expect(score.tracks.bass).toHaveLength(102);
    expect(score.tracks.comp).toHaveLength(275);
    expect(score.tracks.lead).toHaveLength(178);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick))).toBe(23_924);
    expect(Math.min(...score.tracks.comp.map((note) => note.performedStartTick))).toBe(24_722);
    expect(score.tracks.comp.some((note) => note.performedStartTick === 24_000)).toBe(false);
    expect(Math.max(...score.tracks.bass.map((note) => note.performedStartTick + note.performedDurationTicks))).toBe(24_945);
  });

  it('uses the opening score as an exact prefix and preserves the real video tail', () => {
    const score = TAKE_FIVE_FULL_PROVISIONAL_REPLICA;
    const prefix = score.notes.filter((note) => note.performedStartTick < 24_000);
    expect(prefix).toEqual(TAKE_FIVE_OPENING_PROVISIONAL_REPLICA.notes);
    expect(score.durationPerformedTicks).toBe(85_860);
    expect(Math.max(...score.notes.map((note) => note.performedStartTick + note.performedDurationTicks))).toBe(82_809);
  });

  it('compiles and roundtrips all full-score note events without a grid rewrite', () => {
    const score = TAKE_FIVE_FULL_PROVISIONAL_REPLICA;
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    expect(Object.keys(eventIndex)).toHaveLength(555);
    expect(ir.durationTicks).toBe(85_860);
    expect(ir.tracks.reduce((sum, track) => sum + track.notes.length, 0)).toBe(555);
    expect(ir.tracks.flatMap((track) => track.notes).some((note) => (note.startTick as number) % 120 !== 0)).toBe(true);

    const parsed = parseSMF(videoReplicaToSMF(ir, score.source.bpm));
    expect(parsed.noteCount).toBe(555);
    expect(parsed.division).toBe(480);
    expect(parsed.bpm).toBeCloseTo(200, 5);
    expect(parsed.events.filter((event) => event.type === 'noteOn')).toHaveLength(555);
    expect(parsed.events.filter((event) => event.type === 'noteOff')).toHaveLength(555);
  });
});
