import { describe, it, expect } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/accompanimentRenderer', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // C 大调 Cmaj7 - G7,各 1 小节
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });
  const tracks = renderAccompaniment(plan, timebase);
  const bass = tracks.find((t) => t.role === 'bass')!;
  const comp = tracks.find((t) => t.role === 'comp')!;

  it('产出 bass + comp 两轨', () => {
    expect(tracks.map((t) => t.role)).toEqual(['bass', 'comp']);
  });

  it('bass:每和弦一个根音,pc 正确,落在 36..47', () => {
    expect(bass.notes.length).toBe(2);
    expect(bass.notes.map((n) => n.pitch)).toEqual([36, 43]); // C2=36, G2=43
    for (const n of bass.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(36);
      expect(n.pitch).toBeLessThanOrEqual(47);
    }
  });

  it('comp:每和弦稳定音块,pc 正确,落在 48..59', () => {
    // Cmaj7 稳定音 C E G B → 48 52 55 59
    const firstChordComp = comp.notes.filter((n) => n.startTick === 0).map((n) => n.pitch).sort((a, b) => a - b);
    expect(firstChordComp).toEqual([48, 52, 55, 59]);
    for (const n of comp.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThanOrEqual(59);
    }
  });

  it('节拍:第二和弦起 tick = 1920(4 拍 * 480)', () => {
    expect(bass.notes[1].startTick).toBe(1920);
    expect(bass.notes[0].durationTicks).toBe(1920);
  });
});
