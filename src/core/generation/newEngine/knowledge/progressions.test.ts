import { describe, it, expect } from 'vitest';
import {
  diatonicQuality, pickProgressionDegrees,
  PROGRESSION_POOL, listProgressionPrototypes, pickProgressionPrototype, fitProgressionToBars,
} from './progressions';
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

describe('progression prototype registry (harmony 迁移 Loop 1)', () => {
  it('POOL = modern15 + lofi16 = 31,不含 legacy,id 唯一', () => {
    expect(PROGRESSION_POOL).toHaveLength(31);
    expect(PROGRESSION_POOL.some((p) => p.id.startsWith('legacy_'))).toBe(false);
    expect(new Set(PROGRESSION_POOL.map((p) => p.id)).size).toBe(31);
  });

  it('POP major 能选到 pop_canon_8 / pop_4536251_8', () => {
    const ids = listProgressionPrototypes({ style: 'POP', mode: 'Major' }).map((p) => p.id);
    expect(ids).toContain('pop_canon_8');
    expect(ids).toContain('pop_4536251_8');
  });

  it('LOFI major prototype 含 maj9/m9/13sus4 色彩', () => {
    const warm = listProgressionPrototypes({ style: 'LOFI', mode: 'Major' }).find((p) => p.id === 'lofi_major_warm_8')!;
    const types = new Set(warm.slots.map((s) => s.type));
    expect(types.has('maj9')).toBe(true);
    expect(types.has('m9')).toBe(true);
    expect(types.has('13sus4')).toBe(true);
  });

  it('LOFI transformPolicy 禁 tonicization / borrowed', () => {
    const lofi = listProgressionPrototypes({ style: 'LOFI' });
    expect(lofi.length).toBeGreaterThan(0);
    for (const p of lofi) {
      expect(p.transformPolicy?.allowTonicization).toBe(false);
      expect(p.transformPolicy?.allowBorrowed).toBe(false);
    }
  });

  it('fitProgressionToBars(8→16 / →4)长度正确', () => {
    const phrase = PROGRESSION_POOL.find((p) => p.id === 'pop_canon_8')!.slots;
    expect(phrase).toHaveLength(8);
    expect(fitProgressionToBars(phrase, 16)).toHaveLength(16);
    expect(fitProgressionToBars(phrase, 4)).toHaveLength(4);
  });

  it('pickProgressionPrototype:确定性 + fit 到 bars', () => {
    const a = pickProgressionPrototype({ style: 'POP', mode: 'Major', functionRole: 'chorus', bars: 8, random: createRandomContext(5).substream('harmony') });
    const b = pickProgressionPrototype({ style: 'POP', mode: 'Major', functionRole: 'chorus', bars: 8, random: createRandomContext(5).substream('harmony') });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.length).toBe(8);
  });

  it('slot:rootOffset=半音(V=7)· lockType 默认 true · scaleDegree 推导 · borrowed metadata 保留', () => {
    const canon = PROGRESSION_POOL.find((p) => p.id === 'pop_canon_8')!;
    const v = canon.slots.find((s) => s.roman === 'V')!;
    expect(v.rootOffset).toBe(7);
    expect(v.lockType).toBe(true);
    expect(v.scaleDegree).toBe(5);
    const epic = PROGRESSION_POOL.find((p) => p.id === 'pop_epic_cadence_8')!;
    expect(epic.slots.some((s) => s.borrowedSource === 'modal_interchange')).toBe(true);
  });
});
