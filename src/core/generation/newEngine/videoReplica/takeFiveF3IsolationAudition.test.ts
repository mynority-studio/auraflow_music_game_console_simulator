import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSMF } from '../../../audio/smfParser';
import { canonicalVideoReplicaApprovalPayload } from './VideoReplicaApproval';
import { compileVideoReplicaScore } from './VideoReplicaScore';
import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V4 } from './takeFiveFullCuration';
import { videoReplicaToSMF } from './videoReplicaMidi';
import {
  buildTakeFiveF3IsolationIr,
  TAKE_FIVE_F3_ISOLATION_DELTA,
} from '../../../../../scripts/takeFiveF3Isolation';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function eventKeys(bytes: Uint8Array, type?: 'noteOn' | 'noteOff'): string[] {
  return parseSMF(bytes).events
    .filter((event) => type === undefined || event.type === type)
    .map((event) => [event.type, event.channel, event.ticks, event.data1, event.data2].join('|'))
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
  expect([...remaining.values()].every((count) => count === 0)).toBe(true);
  return additions;
}

describe('Take Five F3 audition-only isolation transform', () => {
  it('adds exactly one comp note without changing the fixed score or its approval identity', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    const approvalBefore = canonicalVideoReplicaApprovalPayload(score);
    const { ir: baseIr } = compileVideoReplicaScore(score);
    const variantIr = buildTakeFiveF3IsolationIr(baseIr);
    const baseBytes = videoReplicaToSMF(baseIr, score.source.bpm);
    const variantBytes = videoReplicaToSMF(variantIr, score.source.bpm);
    const baseParsed = parseSMF(baseBytes);
    const variantParsed = parseSMF(variantBytes);

    expect(TAKE_FIVE_F3_ISOLATION_DELTA).toEqual({
      role: 'comp',
      performedStartTick: 43_288,
      performedDurationTicks: 167,
      midi: 53,
      velocity: 55,
    });
    expect(score.notes).toHaveLength(534);
    expect(score.additions).toHaveLength(0);
    expect(score.notes.some((note) => note.performedStartTick === 43_288 && note.midi === 53)).toBe(false);
    expect(baseParsed.noteCount).toBe(534);
    expect(variantParsed.noteCount).toBe(535);
    expect(variantIr.durationTicks).toBe(baseIr.durationTicks);
    expect(variantIr.timebase).toBe(baseIr.timebase);
    expect(Object.isFrozen(variantIr)).toBe(true);

    expect(addedMultiset(eventKeys(variantBytes, 'noteOn'), eventKeys(baseBytes, 'noteOn'))).toEqual([
      'noteOn|2|43288|53|55',
    ]);
    expect(addedMultiset(eventKeys(variantBytes, 'noteOff'), eventKeys(baseBytes, 'noteOff'))).toEqual([
      'noteOff|2|43455|53|0',
    ]);
    expect(addedMultiset(eventKeys(variantBytes), eventKeys(baseBytes))).toEqual([
      'noteOff|2|43455|53|0',
      'noteOn|2|43288|53|55',
    ]);

    const approvalAfter = canonicalVideoReplicaApprovalPayload(score);
    expect(approvalAfter).toBe(approvalBefore);
    expect(sha256(approvalAfter)).toBe('74d350b6ee11838a070496c580ea05406b20321e21946b28be1915f4eb4f828f');
  });

  it('has no dependency capable of defining a score or routing a product generation path', () => {
    const source = readFileSync(new URL('../../../../../scripts/takeFiveF3Isolation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/defineVideoReplicaScore|takeFiveFullCuration|musicGeneration|arranger|harmony|render/iu);
  });
});
