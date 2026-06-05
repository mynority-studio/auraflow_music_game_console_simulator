// ============================================================
// newEngine · render · 非键盘 comp 走 mg voicing 管线(复活 §7,2026-06-05)
// ------------------------------------------------------------
// 锁:非键盘 comp = assembleVoicing(核心)→ placeVoicingMidi → applyArrangement;
//   jazz rootless(无 root)/ pop 含 root;只 voice 核心 1-3-5-7(色彩归旋律);落 [48,81]。
// ============================================================

import { describe, expect, it } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
// Cmaj9 - G13:宽和弦(带色彩 9/13)→ 验非键盘 comp 只取核心
const plan = buildHarmonicPlan({
  key: pc(0), beatsPerBar: 4,
  progression: [{ degree: 1, quality: 'maj7', bars: 1 }, { degree: 5, quality: '7', bars: 1 }],
});
// 颤音琴(GM 11,非键盘)comp
const compFor = (style: string) =>
  renderAccompaniment(plan, timebase, { style, compProgram: 11 }).find((t) => t.role === 'comp')!;

describe('非键盘 comp · mg voicing 管线', () => {
  it('jazz = rootless(首和弦 comp 不含 root pc 0)', () => {
    const first = compFor('jazz').notes.filter((n) => (n.startTick as number) === 0);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((n) => (n.pitch as number) % 12 === 0)).toBe(false); // 无 root C
    // 含 3/7 guide tone(E=4 / B=11)
    expect(first.some((n) => [4, 11].includes((n.pitch as number) % 12))).toBe(true);
  });

  it('只 voice 核心 1-3-5-7,落 [48,81](色彩不进 comp)', () => {
    const comp = compFor('jazz');
    const core = new Set([0, 4, 7, 11]); // Cmaj7 核心
    const first = comp.notes.filter((n) => (n.startTick as number) === 0);
    for (const n of first) expect(core.has((n.pitch as number) % 12)).toBe(true);
    for (const n of comp.notes) {
      expect(n.pitch as number).toBeGreaterThanOrEqual(48);
      expect(n.pitch as number).toBeLessThanOrEqual(81);
    }
  });
});
