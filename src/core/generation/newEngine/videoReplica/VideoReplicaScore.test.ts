import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compileVideoReplicaScore,
  defineVideoReplicaEvidenceSet,
  defineVideoReplicaScore,
  type VideoReplicaRoleAssignment,
  type VideoReplicaSourceManifest,
} from './VideoReplicaScore';

const source: VideoReplicaSourceManifest = {
  schemaVersion: 1,
  videoSha256: 'a'.repeat(64),
  videoByteLength: 123,
  tickZeroAtVideoSeconds: 1.5,
  ppq: 480,
  bpm: 200,
  meter: { numerator: 5, denominator: 4 },
};

const makeScore = (performedStartTick: number, durationPerformedTicks?: number) => {
  const evidence = defineVideoReplicaEvidenceSet({
    id: 'off-grid-evidence',
    detectorRevision: 'test',
    sourceArtifactSha256: 'b'.repeat(64),
    source,
    strikeGroupingToleranceTicks: 32,
    events: [{
      evidenceId: 'event-1',
      sourceRow: 0,
      performedStartTick,
      performedDurationTicks: 137,
      midi: 62,
      velocity: 77,
      disposition: 'kept',
    }],
  });
  const roleAssignments: VideoReplicaRoleAssignment[] = [{
    evidenceId: 'event-1',
    role: 'lead',
    method: 'test-curation',
    status: 'confirmed',
  }];
  return defineVideoReplicaScore({
    schemaVersion: 1,
    id: 'off-grid-score',
    replicaRevision: 'test',
    evidence,
    curationStatus: 'confirmed',
    piano: { bank: 0, program: 0 },
    roleAssignments,
    durationPerformedTicks,
  });
};

describe('VideoReplicaScore clean boundary', () => {
  it('preserves off-grid performed timing and arbitrary non-barline tails exactly', () => {
    const score = makeScore(19, 777);
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    const note = ir.tracks[2]!.notes[0]!;
    expect({
      pitch: note.pitch,
      startTick: note.startTick,
      durationTicks: note.durationTicks,
      velocity: note.velocity,
    }).toEqual({ pitch: 62, startTick: 19, durationTicks: 137, velocity: 77 });
    expect(ir.durationTicks).toBe(777);
    expect(eventIndex['event-1']).toEqual({ role: 'lead', trackIndex: 2, noteIndex: 0 });
    expect(score).toEqual(expect.objectContaining({
      sourceEvidenceId: 'off-grid-evidence',
      sourceEvidenceArtifactSha256: 'b'.repeat(64),
      sourceEvidenceDetectorRevision: 'test',
    }));
    expect(Object.isFrozen(score)).toBe(true);
  });

  it('moves MIDI by exactly the performed-tick change instead of snapping to a nominal grid', () => {
    const first = compileVideoReplicaScore(makeScore(19)).ir.tracks[2]!.notes[0]!;
    const shifted = compileVideoReplicaScore(makeScore(26)).ir.tracks[2]!.notes[0]!;
    expect((shifted.startTick as number) - (first.startTick as number)).toBe(7);
    expect(shifted.durationTicks).toBe(first.durationTicks);
  });

  it('does not accept Groove, Harmony, Arranger or render modules as compiler dependencies', () => {
    const moduleSource = readFileSync(new URL('./VideoReplicaScore.ts', import.meta.url), 'utf8');
    const importLines = moduleSource.split('\n').filter((line) => /^import |^\} from /u.test(line));
    expect(importLines.join('\n')).not.toMatch(/knowledge|groove|harmony|arranger|render|GenerationController/iu);
  });

  it('rejects a confirmed score when any role assignment is still provisional', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: 'c'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [{
        evidenceId: 'event-1', sourceRow: 0, performedStartTick: 19,
        performedDurationTicks: 120, midi: 60, velocity: 70, disposition: 'kept',
      }],
    });
    expect(() => defineVideoReplicaScore({
      schemaVersion: 1,
      id: 'invalid-confirmed-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed',
      piano: { bank: 0, program: 0 },
      roleAssignments: [{
        evidenceId: 'event-1', role: 'lead', method: 'threshold', status: 'provisional',
      }],
    })).toThrow(/provisional assignment/u);
  });

  it('can curate a detector false positive without mutating or deleting its evidence', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'false-positive-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: 'd'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [{
        evidenceId: 'harmonic-1', sourceRow: 0, performedStartTick: 19,
        performedDurationTicks: 120, midi: 76, velocity: 60, disposition: 'kept',
      }],
    });
    const score = defineVideoReplicaScore({
      schemaVersion: 1,
      id: 'curated-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed',
      piano: { bank: 0, program: 0 },
      roleAssignments: [],
      rejections: [{
        evidenceId: 'harmonic-1',
        reason: 'confirmed octave harmonic false positive',
        method: 'video-hand-position-plus-spectrum',
        status: 'confirmed',
      }],
      durationPerformedTicks: 120,
    });
    expect(evidence.events).toHaveLength(1);
    expect(score.notes).toHaveLength(0);
    expect(score.rejections).toEqual([expect.objectContaining({ evidenceId: 'harmonic-1' })]);
    expect(compileVideoReplicaScore(score).ir.tracks.every((track) => track.notes.length === 0)).toBe(true);
  });

  it('applies a reviewed score correction while preserving the immutable detector event', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'latency-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: 'e'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [{
        evidenceId: 'late-onset', sourceRow: 0, performedStartTick: 427,
        performedDurationTicks: 120, midi: 62, velocity: 70, disposition: 'kept',
      }],
    });
    const score = defineVideoReplicaScore({
      schemaVersion: 1,
      id: 'corrected-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed',
      piano: { bank: 0, program: 0 },
      roleAssignments: [{
        evidenceId: 'late-onset', role: 'lead', method: 'visual', status: 'confirmed',
      }],
      corrections: [{
        evidenceId: 'late-onset',
        performedStartTick: 434,
        reason: 'reviewed detector latency',
        method: 'independent-source-onset-oracle',
        status: 'confirmed',
      }],
    });
    expect(evidence.events[0]!.performedStartTick).toBe(427);
    expect(score.notes[0]!.performedStartTick).toBe(434);
    expect(compileVideoReplicaScore(score).ir.tracks[2]!.notes[0]!.startTick).toBe(434);
  });

  it('adds a positively observed missing note without manufacturing raw detector evidence', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'omission-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: '2'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [{
        evidenceId: 'detected-fs3', sourceRow: 0, performedStartTick: 100,
        performedDurationTicks: 240, midi: 54, velocity: 80, disposition: 'kept',
      }],
    });
    const score = defineVideoReplicaScore({
      schemaVersion: 1,
      id: 'observation-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed',
      piano: { bank: 0, program: 0 },
      roleAssignments: [{
        evidenceId: 'detected-fs3', role: 'bass', method: 'visual', status: 'confirmed',
      }],
      additions: [{
        observationId: 'observed-d4',
        role: 'lead',
        performedStartTick: 118,
        performedDurationTicks: 210,
        midi: 62,
        velocity: 72,
        sourceVideoWindowSeconds: [1.56, 1.61],
        relatedEvidenceIds: ['detected-fs3'],
        relatedStrikeGroupId: 'strike-001',
        reason: 'D4 key depression and fundamental are both visible in the source',
        method: 'frame-plus-source-spectrum',
        status: 'confirmed',
      }],
    });
    expect(evidence.events).toHaveLength(1);
    expect(score.additions).toHaveLength(1);
    expect(score.notes.map((note) => [note.origin, note.eventId])).toEqual([
      ['evidence', 'detected-fs3'],
      ['curated-observation', 'observed-d4'],
    ]);
    const observed = score.notes[1]!;
    expect(observed.origin).toBe('curated-observation');
    const { ir, eventIndex } = compileVideoReplicaScore(score);
    expect(eventIndex['observed-d4']).toEqual({ role: 'lead', trackIndex: 2, noteIndex: 0 });
    expect(ir.tracks[2]!.notes[0]).toEqual(expect.objectContaining({
      pitch: 62, startTick: 118, durationTicks: 210, velocity: 72,
    }));
  });

  it('rejects untraceable or provisional missing-note observations', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'observation-validation-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: '3'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [{
        evidenceId: 'detected', sourceRow: 0, performedStartTick: 100,
        performedDurationTicks: 120, midi: 60, velocity: 70, disposition: 'kept',
      }],
    });
    const base = {
      schemaVersion: 1 as const,
      id: 'observation-validation-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed' as const,
      piano: { bank: 0, program: 0 },
      roleAssignments: [{
        evidenceId: 'detected', role: 'lead' as const, method: 'visual', status: 'confirmed' as const,
      }],
    };
    const addition = {
      observationId: 'observed',
      role: 'lead' as const,
      performedStartTick: 118,
      performedDurationTicks: 120,
      midi: 64,
      velocity: 70,
      sourceVideoWindowSeconds: [1.56, 1.61] as const,
      reason: 'test',
      method: 'test',
      status: 'confirmed' as const,
    };
    expect(() => defineVideoReplicaScore({
      ...base,
      additions: [{ ...addition, relatedEvidenceIds: ['missing'] }],
    })).toThrow(/unknown evidence missing/u);
    expect(() => defineVideoReplicaScore({
      ...base,
      additions: [{ ...addition, relatedStrikeGroupId: 'strike-999' }],
    })).toThrow(/unknown strike group strike-999/u);
    expect(() => defineVideoReplicaScore({
      ...base,
      additions: [{ ...addition, status: 'provisional' }],
    })).toThrow(/provisional observation/u);
  });

  it('records reviewed roll semantics without rewriting either performed onset', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'roll-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: 'f'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [
        {
          evidenceId: 'roll-low', sourceRow: 0, performedStartTick: 9276,
          performedDurationTicks: 400, midi: 40, velocity: 78, disposition: 'kept',
        },
        {
          evidenceId: 'roll-high', sourceRow: 1, performedStartTick: 9313,
          performedDurationTicks: 360, midi: 66, velocity: 72, disposition: 'kept',
        },
      ],
    });
    const score = defineVideoReplicaScore({
      schemaVersion: 1,
      id: 'roll-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed',
      piano: { bank: 0, program: 0 },
      roleAssignments: [
        { evidenceId: 'roll-low', role: 'bass', method: 'visual', status: 'confirmed' },
        { evidenceId: 'roll-high', role: 'lead', method: 'visual', status: 'confirmed' },
      ],
      gestures: [{
        id: 'roll-1',
        kind: 'micro-roll',
        evidenceIds: ['roll-low', 'roll-high'],
        reason: 'frame-reviewed low-to-high piano roll',
        method: 'frame-by-frame-video',
        status: 'confirmed',
      }],
    });
    expect(score.gestures).toEqual([expect.objectContaining({
      id: 'roll-1', kind: 'micro-roll', evidenceIds: ['roll-low', 'roll-high'],
    })]);
    expect(compileVideoReplicaScore(score).ir.tracks.flatMap((track) => track.notes)
      .map((note) => note.startTick)).toEqual([9276, 9313]);
  });

  it('rejects non-traceable, unordered or provisional gesture annotations', () => {
    const evidence = defineVideoReplicaEvidenceSet({
      id: 'gesture-validation-evidence',
      detectorRevision: 'test',
      sourceArtifactSha256: '1'.repeat(64),
      source,
      strikeGroupingToleranceTicks: 32,
      events: [
        {
          evidenceId: 'first', sourceRow: 0, performedStartTick: 100,
          performedDurationTicks: 120, midi: 60, velocity: 70, disposition: 'kept',
        },
        {
          evidenceId: 'second', sourceRow: 1, performedStartTick: 150,
          performedDurationTicks: 120, midi: 64, velocity: 70, disposition: 'kept',
        },
      ],
    });
    const base = {
      schemaVersion: 1 as const,
      id: 'gesture-validation-score',
      replicaRevision: 'test',
      evidence,
      curationStatus: 'confirmed' as const,
      piano: { bank: 0, program: 0 },
      roleAssignments: [
        { evidenceId: 'first', role: 'lead' as const, method: 'visual', status: 'confirmed' as const },
        { evidenceId: 'second', role: 'lead' as const, method: 'visual', status: 'confirmed' as const },
      ],
    };
    expect(() => defineVideoReplicaScore({ ...base, gestures: [{
      id: 'unknown', kind: 'micro-roll', evidenceIds: ['first', 'missing'],
      reason: 'test', method: 'test', status: 'confirmed',
    }] })).toThrow(/unknown evidence missing/u);
    expect(() => defineVideoReplicaScore({ ...base, gestures: [{
      id: 'unordered', kind: 'micro-roll', evidenceIds: ['second', 'first'],
      reason: 'test', method: 'test', status: 'confirmed',
    }] })).toThrow(/ordered by performed onset/u);
    expect(() => defineVideoReplicaScore({ ...base, gestures: [{
      id: 'provisional', kind: 'micro-roll', evidenceIds: ['first', 'second'],
      reason: 'test', method: 'test', status: 'provisional',
    }] })).toThrow(/provisional gesture/u);
  });
});
