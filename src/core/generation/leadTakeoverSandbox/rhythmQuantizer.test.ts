import { describe, expect, it } from 'vitest';

import { beatsPerBarOf, quantizeTakeoverBeat } from './rhythmQuantizer';

describe('leadTakeoverSandbox/rhythmQuantizer', () => {
  it('uses the nearest 16th and plays immediately when that grid is behind the live input', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.01,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.baseTargetBeat).toBeCloseTo(1);
    expect(q.targetBeat).toBeCloseTo(1.01);
    expect(q.delayMs).toBe(0);
    expect(q.gridStepBeats).toBe(0.25);
  });

  it('keeps exact grid hits immediate', () => {
    const q = quantizeTakeoverBeat({
      beat: 2.5,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.targetBeat).toBeCloseTo(2.5);
    expect(q.delayMs).toBe(0);
  });

  it('allows bar-end hits to land on the next downbeat', () => {
    const q = quantizeTakeoverBeat({
      beat: 3.99,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.barStartBeat).toBe(0);
    expect(q.barEndBeat).toBe(4);
    expect(q.targetBeat).toBeCloseTo(4);
    expect(q.delayMs).toBeCloseTo(5);
  });

  it('supports nearest-point 32nd-note quantization', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.01,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '32nd',
    });

    expect(q.baseTargetBeat).toBeCloseTo(1);
    expect(q.targetBeat).toBeCloseTo(1.01);
    expect(q.delayMs).toBe(0);
  });

  it('uses the provided time signature instead of hard-coded 4-beat bars', () => {
    expect(beatsPerBarOf([3, 4])).toBe(3);
    expect(beatsPerBarOf([6, 8])).toBe(3);

    const q34 = quantizeTakeoverBeat({
      beat: 2.99,
      bpm: 120,
      timeSignature: [3, 4],
      grid: '16th',
    });
    const q68 = quantizeTakeoverBeat({
      beat: 2.99,
      bpm: 120,
      timeSignature: [6, 8],
      grid: '16th',
    });

    expect(q34.barEndBeat).toBe(3);
    expect(q34.targetBeat).toBeCloseTo(3);
    expect(q68.barEndBeat).toBe(3);
    expect(q68.targetBeat).toBeCloseTo(3);
  });

  it('attaches a slightly late hit to the nearest previous grid without latency', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.01,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.targetBeat).toBeCloseTo(1.01);
    expect(q.baseTargetBeat).toBeCloseTo(1);
    expect(q.delayMs).toBe(0);
  });

  it('keeps a near-beat live hit immediate', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.12,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.baseTargetBeat).toBeCloseTo(1);
    expect(q.targetBeat).toBeCloseTo(1.12);
    expect(q.delayMs).toBe(0);
  });

  it('chooses the nearest weak 16th instead of always waiting for the next one', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.37,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '16th',
    });

    expect(q.baseTargetBeat).toBeCloseTo(1.25);
    expect(q.targetBeat).toBeCloseTo(1.37);
    expect(q.delayMs).toBe(0);
  });

  it('uses the current groove pocket when catching a strong beat', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.01,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '16th',
      grooveContract: {
        id: 'pocketed_downbeat',
        melodySwingRatio: 0.5,
        melodyStrongPocketMs: [12, 12],
        melodyWeakPocketMs: [0, 0],
      },
    });

    expect(q.baseTargetBeat).toBeCloseTo(1);
    expect(q.targetBeat).toBeCloseTo(1.02);
    expect(q.delayMs).toBeCloseTo(6);
    expect(q.grooveOffsetMs).toBeCloseTo(12);
    expect(q.grooveContractId).toBe('pocketed_downbeat');
  });

  it('applies melody swing from the current groove contract on eighth offbeats', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.6,
      bpm: 120,
      timeSignature: [4, 4],
      grid: '16th',
      grooveContract: {
        id: 'jazz_medium_swing',
        melodySwingRatio: 0.67,
        melodyStrongPocketMs: [0, 0],
        melodyWeakPocketMs: [0, 0],
      },
    });

    expect(q.baseTargetBeat).toBeCloseTo(1.5);
    expect(q.targetBeat).toBeCloseTo(1.67);
    expect(q.grooveOffsetMs).toBeCloseTo(85);
    expect(q.delayMs).toBeCloseTo(35);
    expect(q.grooveContractId).toBe('jazz_medium_swing');
  });

  it('applies weak melody pocket to non-onbeat 16th targets', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.14,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '16th',
      grooveContract: {
        id: 'lofi_lazy_dilla',
        melodySwingRatio: 0.5,
        melodyStrongPocketMs: [0, 0],
        melodyWeakPocketMs: [12, 12],
      },
    });

    expect(q.baseTargetBeat).toBeCloseTo(1.25);
    expect(q.targetBeat).toBeCloseTo(1.27);
    expect(q.grooveOffsetMs).toBeCloseTo(12);
    expect(q.delayMs).toBeCloseTo(78);
  });

  it('clamps negative groove pocket to avoid scheduling live notes in the past', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.49,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '16th',
      grooveContract: {
        id: 'acg_jpop_456_drive',
        melodySwingRatio: 0.5,
        melodyStrongPocketMs: [0, 0],
        melodyWeakPocketMs: [-20, -20],
      },
    });

    expect(q.baseTargetBeat).toBeCloseTo(1.5);
    expect(q.targetBeat).toBeCloseTo(q.sourceBeat);
    expect(q.delayMs).toBe(0);
  });

  it('caps a far future snap instead of making a live note wait', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.14,
      bpm: 72,
      timeSignature: [4, 4],
      grid: '16th',
      maxDelayMs: 60,
    });

    expect(q.baseTargetBeat).toBeCloseTo(1.25);
    expect(q.targetBeat).toBeCloseTo(q.sourceBeat);
    expect(q.delayMs).toBe(0);
  });

  it('keeps a sequential target distinct while bounding the extra wait', () => {
    const q = quantizeTakeoverBeat({
      beat: 1.19,
      bpm: 100,
      timeSignature: [4, 4],
      grid: '32nd',
      afterTargetBeat: 1.25,
      maxDelayMs: 60,
    });

    expect(q.targetBeat).toBeGreaterThan(1.25);
    expect(q.delayMs).toBeLessThanOrEqual(60);
  });
});
