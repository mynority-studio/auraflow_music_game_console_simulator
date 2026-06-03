import { describe, it, expect } from 'vitest';
import { buildHarmonicPlan } from './harmonyEngine';
import { commonSafeToneSet } from './commonSafeToneQuery';
import { pc } from '../foundation';

describe('harmony/commonSafeToneSet', () => {
  // C 大调 Cmaj7 - Dm7 - G7
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 }, // c0 Cmaj7
      { degree: 2, quality: 'm7', bars: 1 },   // c1 Dm7
      { degree: 5, quality: '7', bars: 1 },    // c2 G7
    ],
  });

  it('单 span = stable ∪ acceptable,且不含 avoid', () => {
    const safe = commonSafeToneSet(plan, 'local', ['c0']); // Cmaj7
    expect(safe).toContain(0); // C
    expect(safe).toContain(4); // E
    expect(safe).toContain(2); // D(9)
    expect(safe).not.toContain(5); // F = avoid(11),被剔除
  });

  it('多 span = 各 span 安全音的交集', () => {
    const c0 = new Set(commonSafeToneSet(plan, 'global', ['c0']));
    const c2 = new Set(commonSafeToneSet(plan, 'global', ['c2']));
    const inter = commonSafeToneSet(plan, 'global', ['c0', 'c2']);
    // 交集结果必须同时属于两个 span 的安全音
    for (const x of inter) {
      expect(c0.has(x)).toBe(true);
      expect(c2.has(x)).toBe(true);
    }
    // 且不超过任一单 span
    expect(inter.length).toBeLessThanOrEqual(Math.min(c0.size, c2.size));
  });

  it('结果升序、无重复', () => {
    const safe = commonSafeToneSet(plan, 'local', ['c0', 'c1']);
    expect([...safe].sort((a, b) => a - b)).toEqual(safe);
    expect(new Set(safe).size).toBe(safe.length);
  });

  it('空 spans → []', () => {
    expect(commonSafeToneSet(plan, 'local', [])).toEqual([]);
  });

  it('未知 chordSpanId → 抛', () => {
    expect(() => commonSafeToneSet(plan, 'local', ['nope'])).toThrow(RangeError);
  });
});
