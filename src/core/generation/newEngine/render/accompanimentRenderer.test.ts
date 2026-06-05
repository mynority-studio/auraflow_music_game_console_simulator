import { describe, it, expect } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/accompanimentRenderer (comp 织体,bass 见 bassRenderer)', () => {
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
  const comp = tracks.find((t) => t.role === 'comp')!;

  it('只产出 comp 轨', () => {
    expect(tracks.map((t) => t.role)).toEqual(['comp']);
  });

  it('comp 用 chord-tone voicing,落 comp 区 [48,81],首拍皆 Cmaj7 音', () => {
    const cmaj7 = new Set([0, 4, 7, 11]); // C E G B(核心,无色彩)
    const firstChordComp = comp.notes.filter((n) => n.startTick === 0);
    expect(firstChordComp.length).toBeGreaterThan(0);
    for (const n of firstChordComp) expect(cmaj7.has(n.pitch % 12)).toBe(true);
    for (const n of comp.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThanOrEqual(81);
    }
  });
});
