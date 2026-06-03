import { describe, it, expect } from 'vitest';
import { createRandomContext } from './randomContext';

describe('foundation/randomContext', () => {
  it('seed 存储且只读', () => {
    const ctx = createRandomContext(42);
    expect(ctx.seed).toBe(42);
    expect(() => { (ctx as unknown as { seed: number }).seed = 7; }).toThrow(TypeError);
  });

  it('确定性:同 seed + name → 同序列', () => {
    const seq = (s: number): number[] => {
      const r = createRandomContext(s).substream('melody');
      return [r.next(), r.next(), r.next()];
    };
    expect(seq(42)).toEqual(seq(42));
  });

  it('不同 name → 不同子流', () => {
    const ctx = createRandomContext(42);
    const a = [ctx.substream('melody').next(), ...[1, 2].map(() => 0)];
    const m = ctx.substream('melody');
    const h = ctx.substream('harmony');
    const mSeq = [m.next(), m.next(), m.next()];
    const hSeq = [h.next(), h.next(), h.next()];
    expect(mSeq).not.toEqual(hSeq);
    void a;
  });

  it('next() ∈ [0,1)', () => {
    const r = createRandomContext(1).substream('melody');
    for (let i = 0; i < 200; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) ∈ [0,n) 整数;非法 n → 抛', () => {
    const r = createRandomContext(1).substream('melody');
    for (let i = 0; i < 200; i++) {
      const v = r.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(() => createRandomContext(1).substream('melody').int(0)).toThrow(RangeError);
    expect(() => createRandomContext(1).substream('melody').int(-1)).toThrow(RangeError);
    expect(() => createRandomContext(1).substream('melody').int(1.5)).toThrow(RangeError);
  });

  it('pick 返回数组元素;空数组 → 抛', () => {
    const r = createRandomContext(1).substream('melody');
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(() => createRandomContext(1).substream('melody').pick([])).toThrow(RangeError);
  });

  it('advance:只推进指定子流,其它不变,且不可变', () => {
    const ctx = createRandomContext(42);
    const melodyBefore = ctx.substream('melody').next();
    const harmonyBefore = ctx.substream('harmony').next();

    const ctx2 = ctx.advance('melody');
    expect(ctx2).not.toBe(ctx);
    expect(ctx2.seed).toBe(42);

    // melody 子流变了
    expect(ctx2.substream('melody').next()).not.toBe(melodyBefore);
    // harmony 子流未变
    expect(ctx2.substream('harmony').next()).toBe(harmonyBefore);
    // 原 ctx 未受影响(不可变)
    expect(ctx.substream('melody').next()).toBe(melodyBefore);
  });

  it('连续 advance 同一子流 → 每代序列各异', () => {
    const c0 = createRandomContext(42);
    const c1 = c0.advance('melody');
    const c2 = c1.advance('melody');
    const v0 = c0.substream('melody').next();
    const v1 = c1.substream('melody').next();
    const v2 = c2.substream('melody').next();
    expect(new Set([v0, v1, v2]).size).toBe(3);
  });
});
