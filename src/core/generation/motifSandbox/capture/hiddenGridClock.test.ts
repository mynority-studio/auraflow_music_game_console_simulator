import { describe, it, expect } from 'vitest';
import {
  createHiddenGridContext, mapRawNoteToGrid, isWithinCapture, capturedToGridNotes,
  metricalWeight, quantizeBeat, msPerBeat,
} from './hiddenGridClock';
import type { CapturedMidiNote } from '../model/types';

const ctxOf = (over: Partial<Parameters<typeof createHiddenGridContext>[0]> = {}) =>
  createHiddenGridContext({ seed: 7, keyPc: 0, scaleMode: 'major', tonality: 'major', style: 'pop', startMs: 1000, ...over });

describe('motifSandbox/hiddenGridClock(隐形时钟)', () => {
  it('预选 BPM 落风格区间内 + 确定性', () => {
    const a = ctxOf(); const b = ctxOf();
    expect(a.bpm).toBe(b.bpm);                          // 同 seed → 同 BPM
    expect(a.bpm).toBeGreaterThanOrEqual(96); expect(a.bpm).toBeLessThanOrEqual(108);
    expect(ctxOf({ style: 'lofi' }).bpm).toBeGreaterThanOrEqual(70);
    expect(ctxOf({ style: 'jazz' }).bpm).toBeGreaterThanOrEqual(120);
  });

  it('数拍 1 小节 → captureStart = start + 1bar;captureBars 默认 1', () => {
    const c = ctxOf();
    expect(c.captureBars).toBe(1);
    expect(c.countInBars).toBe(1);
    const mpbar = (4 * 60000) / c.bpm;
    expect(c.captureStartMs).toBeCloseTo(1000 + mpbar, 3);
    expect(c.captureEndMs).toBeCloseTo(c.captureStartMs + mpbar, 3);
  });

  it('captureBars = desiredBars(放开 ≤4s 钳制,用户要更长窗);countInBars 可配 2', () => {
    expect(ctxOf({ desiredBars: 2 }).captureBars).toBe(2);
    expect(ctxOf({ desiredBars: 1 }).captureBars).toBe(1);
    const c2 = ctxOf({ countInBars: 2, desiredBars: 2 });
    expect(c2.countInBars).toBe(2);
    const mpbar = (4 * 60000) / c2.bpm;
    expect(c2.captureStartMs).toBeCloseTo(1000 + 2 * mpbar, 3); // start(1000) + 2 小节数拍后才开始捕获
  });

  it('★ ms→beat:captureStart = 隐形 beat 0;迟到的首音保留为正(不强制成 0)', () => {
    const c = ctxOf();
    const mpb = msPerBeat(c);
    // 在 captureStart 之后【半拍】才弹第一个音 → onsetBeat ≈ 0.5(不是 0)
    const late = mapRawNoteToGrid({ midi: 60, velocity: 100, onMs: c.captureStartMs + mpb * 0.5, offMs: c.captureStartMs + mpb * 1.5 }, c);
    expect(late.quantizedOnsetBeat).toBeCloseTo(0.5, 6);   // 迟到=迟到,前面的休止保留
    expect(late.barIndex).toBe(0);
    expect(late.beatInBar).toBeCloseTo(0.5, 6);
    // 正好踩在 beat 2 上
    const onBeat2 = mapRawNoteToGrid({ midi: 64, velocity: 90, onMs: c.captureStartMs + mpb * 2, offMs: c.captureStartMs + mpb * 3 }, c);
    expect(onBeat2.quantizedOnsetBeat).toBeCloseTo(2, 6);
    expect(onBeat2.metricalWeight).toBeCloseTo(0.75, 6); // beat3(0-indexed 2)= 0.75
  });

  it('数拍期内的音 = 捕获窗外(不收)', () => {
    const c = ctxOf();
    expect(isWithinCapture(c.captureStartMs - 1, c)).toBe(false); // 数拍期
    expect(isWithinCapture(c.captureStartMs, c)).toBe(true);
    expect(isWithinCapture(c.captureEndMs, c)).toBe(false);       // 窗后
  });

  it('节拍权重表(4/4)', () => {
    expect(metricalWeight(0)).toBe(1.0);    // 下拍
    expect(metricalWeight(2)).toBe(0.75);   // beat3
    expect(metricalWeight(1)).toBe(0.55);   // beat2
    expect(metricalWeight(3)).toBe(0.55);   // beat4
    expect(metricalWeight(1.5)).toBe(0.35); // 八分反拍
    expect(metricalWeight(2.25)).toBe(0.2); // 十六分
  });

  it('量化误差被记录', () => {
    const c = ctxOf();
    const mpb = msPerBeat(c);
    const off = mapRawNoteToGrid({ midi: 60, velocity: 100, onMs: c.captureStartMs + mpb * 1.1, offMs: c.captureStartMs + mpb * 2 }, c);
    expect(off.quantizedOnsetBeat).toBeCloseTo(1.0, 6);
    expect(Math.abs(off.timingErrorBeat)).toBeCloseTo(0.1, 6); // 1.1 - 1.0
  });

  it('quantizeBeat', () => {
    expect(quantizeBeat(0.66, 4)).toBe(0.75);
    expect(quantizeBeat(2.33, 4)).toBe(2.25);
  });

  it('★ count-in 不进 motif:数拍期(start=0 相对帧,onsetMs<captureStart)的音被滤掉', () => {
    const c = createHiddenGridContext({ seed: 7, keyPc: 0, scaleMode: 'major', tonality: 'major', style: 'pop', startMs: 0 });
    const mpb = msPerBeat(c);
    const captured: CapturedMidiNote[] = [
      { midi: 60, velocity: 100, onsetMs: mpb * 1, durationMs: mpb }, // 数拍期(< captureStart=4拍)→ 滤
      { midi: 62, velocity: 100, onsetMs: c.captureStartMs + mpb * 0, durationMs: mpb }, // 窗内 beat0
      { midi: 64, velocity: 100, onsetMs: c.captureStartMs + mpb * 2, durationMs: mpb }, // 窗内 beat2
    ];
    const g = capturedToGridNotes(captured, c);
    expect(g.length).toBe(2); // 数拍那一个被滤
    expect(g[0].midi).toBe(62);
    expect(g[0].quantizedOnsetBeat).toBeCloseTo(0, 6);
  });
});
