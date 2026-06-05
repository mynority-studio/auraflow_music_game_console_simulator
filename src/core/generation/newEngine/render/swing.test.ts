import { describe, it, expect } from 'vitest';
import { applySwing, swingFrac } from './swing';
import type { TrackIR } from '../ir/MusicalIR';
import { midi, ticks } from '../foundation';

const note = (tick: number): TrackIR['notes'][number] => ({
  pitch: midi(72),
  startTick: ticks(tick),
  durationTicks: ticks(240),
  velocity: 80,
});

describe('render/swing', () => {
  // 直 8 分:beat 0(0),0.5(240),1(480) @ ppq 480。用 comp(lead 已跳过全局 swing)。
  const tracks: TrackIR[] = [{ role: 'comp', notes: [note(0), note(240), note(480)] }];

  it('swingFrac:ratio=0.5 恒等;0.66 后移 offbeat', () => {
    expect(swingFrac(0.5, 0.5)).toBeCloseTo(0.5, 6);
    expect(swingFrac(0.5, 0.6667)).toBeCloseTo(0.6667, 4);
    expect(swingFrac(0, 0.6667)).toBeCloseTo(0, 6); // 整拍不动
  });

  it('直(0.5)→ onset 不变', () => {
    const out = applySwing(tracks, 480, 0.5);
    expect(out[0].notes.map((n) => n.startTick)).toEqual([0, 240, 480]);
  });

  it('swing(0.6667)→ offbeat 后移,整拍不动', () => {
    const out = applySwing(tracks, 480, 0.6667);
    const onsets = out[0].notes.map((n) => n.startTick);
    expect(onsets[0]).toBe(0);    // beat 0 不动
    expect(onsets[2]).toBe(480);  // beat 1 不动
    expect(onsets[1]).toBeGreaterThan(240); // beat 0.5 → 后移(~320)
    expect(onsets[1]).toBe(Math.round(0.6667 * 480));
  });

  it('确定性 + pitch/dur/vel 不变', () => {
    const out = applySwing(tracks, 480, 0.6667);
    expect(out[0].notes[1].pitch).toBe(72);
    expect(out[0].notes[1].durationTicks).toBe(240);
    const again = applySwing(tracks, 480, 0.6667);
    expect(again[0].notes.map((n) => n.startTick)).toEqual(out[0].notes.map((n) => n.startTick));
  });

  it('★ Loop 9:lead 跳过全局 swing(MG StyleRenderer 已上单轨 swing,不双 swing)', () => {
    const lead: TrackIR[] = [{ role: 'lead', notes: [note(0), note(240), note(480)] }];
    const out = applySwing(lead, 480, 0.6667);
    expect(out[0].notes.map((n) => n.startTick)).toEqual([0, 240, 480]); // offbeat 不被后移
  });
});
