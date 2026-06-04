import { describe, it, expect } from 'vitest';
import { generateMotifShape } from './motifShapes';
import { createRandomContext } from '../foundation';

describe('knowledge/motifShapes', () => {
  it('节奏 cell 求和 = 4 拍(1 小节)', () => {
    for (let s = 0; s < 20; s++) {
      const shape = generateMotifShape(createRandomContext(s).substream('prepass'));
      const sum = shape.rhythmCell.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(4, 6);
    }
  });

  it('音级在 1..7,长度与节奏一致;轮廓长度 = n-1', () => {
    const shape = generateMotifShape(createRandomContext(1).substream('prepass'));
    expect(shape.scaleDegrees.length).toBe(shape.rhythmCell.length);
    expect(shape.contour.length).toBe(shape.scaleDegrees.length - 1);
    for (const d of shape.scaleDegrees) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  it('同 seed 确定;不同 seed → 不同形状', () => {
    const a = generateMotifShape(createRandomContext(5).substream('prepass'));
    const b = generateMotifShape(createRandomContext(5).substream('prepass'));
    expect(a).toEqual(b);
    const c = generateMotifShape(createRandomContext(6).substream('prepass'));
    expect([a.scaleDegrees, a.rhythmCell]).not.toEqual([c.scaleDegrees, c.rhythmCell]);
  });

  it('连续抽取 → 不同动机(同一子流推进)', () => {
    const rng = createRandomContext(1).substream('prepass');
    const m1 = generateMotifShape(rng);
    const m2 = generateMotifShape(rng);
    expect([m1.scaleDegrees, m1.rhythmCell]).not.toEqual([m2.scaleDegrees, m2.rhythmCell]);
  });
});
