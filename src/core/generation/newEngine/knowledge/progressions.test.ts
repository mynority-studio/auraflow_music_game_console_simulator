import { describe, it, expect } from 'vitest';
import { diatonicQuality, pickProgressionDegrees } from './progressions';
import { createRandomContext } from '../foundation';

describe('knowledge/progressions', () => {
  it('大调自然 7 和弦品质', () => {
    expect(diatonicQuality(1, 'major')).toBe('maj7'); // Imaj7
    expect(diatonicQuality(2, 'major')).toBe('m7');   // iim7
    expect(diatonicQuality(5, 'major')).toBe('7');    // V7
    expect(diatonicQuality(7, 'major')).toBe('m7b5'); // viiø
  });
  it('小调自然 7 和弦品质', () => {
    expect(diatonicQuality(1, 'minor')).toBe('m7');
    expect(diatonicQuality(2, 'minor')).toBe('m7b5');
    expect(diatonicQuality(3, 'minor')).toBe('maj7');
  });
  it('越界度数 → 抛', () => {
    expect(() => diatonicQuality(9, 'major')).toThrow(RangeError);
  });
  it('pickProgressionDegrees:确定性 + 返回候选之一', () => {
    const rng = createRandomContext(7).substream('harmony');
    const a = pickProgressionDegrees('chorus', rng);
    const rng2 = createRandomContext(7).substream('harmony');
    const b = pickProgressionDegrees('chorus', rng2);
    expect(a).toEqual(b); // 同种子同选
    expect([[1, 5, 6, 4], [4, 5, 1, 1]]).toContainEqual(a);
  });
  it('返回副本(不污染内部表)', () => {
    const rng = createRandomContext(1).substream('harmony');
    const a = pickProgressionDegrees('verse', rng);
    a.push(99);
    const rng2 = createRandomContext(1).substream('harmony');
    expect(pickProgressionDegrees('verse', rng2)).not.toContain(99);
  });
});
