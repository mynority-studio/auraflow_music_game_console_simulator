import { describe, it, expect } from 'vitest';
import { deepFreeze, type DeepReadonly } from './deepReadonly';
import { pc, type PitchClass } from './brandedPrimitives';

describe('foundation/deepReadonly', () => {
  it('基元直接返回(leaf)', () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze('x')).toBe('x');
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
  });

  it('返回同一引用且冻结', () => {
    const o = { a: 1 };
    const f = deepFreeze(o);
    expect(f).toBe(o);
    expect(Object.isFrozen(f)).toBe(true);
  });

  it('递归冻结嵌套对象 / 数组', () => {
    const o = { a: { b: 1 }, list: [{ c: 2 }] };
    deepFreeze(o);
    expect(Object.isFrozen(o.a)).toBe(true);
    expect(Object.isFrozen(o.list)).toBe(true);
    expect(Object.isFrozen(o.list[0])).toBe(true);
  });

  it('冻结后写入 / 重赋 → 抛(ESM 严格模式)', () => {
    const o = deepFreeze({ a: { b: 1 } });
    expect(() => { (o as { a: { b: number } }).a.b = 9; }).toThrow(TypeError);
    expect(() => { (o as unknown as { a: unknown }).a = {}; }).toThrow(TypeError);
  });

  it('数组冻结后 push → 抛', () => {
    const arr = deepFreeze([1, [2]]);
    expect(() => { (arr as unknown as number[]).push(3); }).toThrow(TypeError);
  });

  it('循环引用不死循环', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(() => deepFreeze(o)).not.toThrow();
    expect(Object.isFrozen(o)).toBe(true);
  });

  it('branded 基元运行期穿透(值不变)', () => {
    expect(deepFreeze(pc(5))).toBe(5);
  });

  // —— 类型层(由 `tsc --noEmit` 校验,H1):branded 基元经 DeepReadonly 仍是 leaf,可双向赋值 ——
  it('H1 类型:DeepReadonly<PitchClass> 与 PitchClass 互赋', () => {
    const a: DeepReadonly<PitchClass> = pc(5);
    const b: PitchClass = a;          // 若 branded 被映射成对象,这行 tsc 报错
    expect(b).toBe(5);
  });
});
