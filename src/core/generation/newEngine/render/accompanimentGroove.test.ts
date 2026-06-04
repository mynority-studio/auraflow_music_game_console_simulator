import { describe, it, expect } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/accompaniment 织体化 (1.1)', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // 4 小节,每和弦 1 小节(4 个和弦)
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 6, quality: 'm7', bars: 1 },
      { degree: 4, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });

  it('comp 起音数 > 和弦数(有律动,不再每和弦一整块)', () => {
    const comp = renderAccompaniment(plan, timebase, { style: 'pop' }).find((t) => t.role === 'comp')!;
    const onsets = new Set(comp.notes.map((n) => n.startTick));
    expect(onsets.size).toBeGreaterThan(plan.chordTimeline.length); // 4 和弦 < comp 起音
  });

  it('jazz:存在 offbeat hit(tick 非整拍)', () => {
    const comp = renderAccompaniment(plan, timebase, { style: 'jazz' }).find((t) => t.role === 'comp')!;
    const hasOffbeat = comp.notes.some((n) => n.startTick % 480 !== 0); // 480=1拍
    expect(hasOffbeat).toBe(true);
  });

  it('comp 仍 pc-correct(48..59)', () => {
    const comp = renderAccompaniment(plan, timebase, { style: 'pop' }).find((t) => t.role === 'comp')!;
    for (const n of comp.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThanOrEqual(59);
    }
  });

  it('确定性:同输入 → 同 comp', () => {
    const a = renderAccompaniment(plan, timebase, { style: 'pop' }).find((t) => t.role === 'comp')!;
    const b = renderAccompaniment(plan, timebase, { style: 'pop' }).find((t) => t.role === 'comp')!;
    expect(a.notes.map((n) => n.startTick)).toEqual(b.notes.map((n) => n.startTick));
  });
});
