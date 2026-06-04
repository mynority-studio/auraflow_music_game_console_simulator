import { describe, it, expect } from 'vitest';
import { computeLerdahlScaleGravity, getScaleGravity } from './scaleGravity';

describe('knowledge · ScaleGravity Lerdahl (KB 移植 §1)', () => {
  it('computeLerdahlScaleGravity(Ionian):导音 7→1 强解决(score 25,resolve_up);2→1 下解决(score 6)', () => {
    const ion = computeLerdahlScaleGravity('Ionian');
    expect(ion).toContainEqual({ fromInterval: 11, toInterval: 0, score: 25, type: 'resolve_up' });
    expect(ion).toContainEqual({ fromInterval: 2, toInterval: 0, score: 6, type: 'resolve_down' });
    expect(ion).toContainEqual({ fromInterval: 5, toInterval: 4, score: 15, type: 'resolve_down' }); // 4→3
  });

  it('手调 literal 逐值忠实:Aeolian b6→5(8→7 score25 down)/ Phrygian b2→1(1→0 score22 down)', () => {
    const ae = getScaleGravity('Aeolian');
    expect(ae[8]).toEqual({ fromInterval: 8, toInterval: 7, score: 25, type: 'resolve_down' });
    const ph = getScaleGravity('Phrygian');
    expect(ph[1]).toEqual({ fromInterval: 1, toInterval: 0, score: 22, type: 'resolve_down' });
  });

  it('getScaleGravity:同 fromInterval 取最高 score(Dorian 9 有 hang5 与 up6 → 取 up6)', () => {
    const dor = getScaleGravity('Dorian');
    expect(dor[9]).toEqual({ fromInterval: 9, toInterval: 10, score: 6, type: 'resolve_up' }); // 6 > 5
  });

  it('未知/无引力音阶 → 空 record', () => {
    expect(getScaleGravity('Whole Tone')).toEqual({}); // 未在表中
  });

  it('returns readonly record(非可变 Map),key=fromInterval', () => {
    const hm = getScaleGravity('Harmonic Minor');
    expect(hm[11]).toEqual({ fromInterval: 11, toInterval: 0, score: 25, type: 'resolve_up' });
    expect(Object.keys(hm).map(Number).sort((a, b) => a - b)).toEqual([2, 8, 11]);
  });
});
