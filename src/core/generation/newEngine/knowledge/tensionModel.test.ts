import { describe, it, expect } from 'vitest';
import { tensionTableFor } from './tensionModel';
import { pc } from '../foundation';

describe('knowledge/tensionModel', () => {
  it('Cmaj7:稳定音 = 和弦音;F(11) 是 avoid;D/F#/A 可接受', () => {
    const t = tensionTableFor(pc(0), 'maj7');
    expect(new Set(t.stable)).toEqual(new Set([0, 4, 7, 11])); // C E G B
    expect(t.avoid).toContain(5); // F = 自然 11
    expect(t.acceptable).toEqual(expect.arrayContaining([2, 6, 9])); // D(9) F#(#11) A(13)
  });

  it('G7:稳定音 G B D F;C(11) 是 avoid', () => {
    const t = tensionTableFor(pc(7), '7');
    expect(new Set(t.stable)).toEqual(new Set([7, 11, 2, 5])); // G B D F
    expect(t.avoid).toContain(0); // C = mod12(7+5) = 自然 11
  });

  it('Dm7:无 avoid;9/11/13 可接受', () => {
    const t = tensionTableFor(pc(2), 'm7');
    expect(new Set(t.stable)).toEqual(new Set([2, 5, 9, 0])); // D F A C
    expect(t.avoid).toEqual([]);
    expect(t.acceptable).toEqual(expect.arrayContaining([4, 7, 11])); // E(9) G(11) B(13)
  });

  it('三集互斥(stable / acceptable / avoid 两两不相交)', () => {
    for (const q of ['maj', 'min', 'maj7', 'm7', '7', 'm7b5', 'dim7'] as const) {
      const t = tensionTableFor(pc(0), q);
      const s = new Set(t.stable);
      const a = new Set(t.acceptable);
      const v = new Set(t.avoid);
      expect([...a].some((x) => s.has(x))).toBe(false);
      expect([...v].some((x) => s.has(x) || a.has(x))).toBe(false);
    }
  });

  it('avoid 永远不在安全音(stable ∪ acceptable)里', () => {
    const t = tensionTableFor(pc(0), 'maj7');
    const safe = new Set([...t.stable, ...t.acceptable]);
    expect(t.avoid.some((x) => safe.has(x))).toBe(false);
  });
});
