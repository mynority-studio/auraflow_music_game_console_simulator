import { describe, it, expect } from 'vitest';
import { buildBandSpec } from './bandEngine';
import { pc } from '../foundation';

describe('band/bandEngine', () => {
  it('已知 style 取对应 styleProfile', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'lofi', mood: 'calm', targetDuration: 100 });
    expect(spec.style).toBe('lofi');
    expect(spec.styleProfile.padDensity).toBe(0.6);
    expect(spec.tonalityKind).toBe('tonal');
  });

  it('未知 style → default', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'unknown-xyz', mood: 'x', targetDuration: 60 });
    expect(spec.style).toBe('default');
  });

  it('key/mode 缺省 → seed 派生(确定性 + 合法范围);显式 request 永远覆盖', () => {
    const a = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60 });
    expect(a.key).toBeGreaterThanOrEqual(0);
    expect(a.key).toBeLessThan(12);             // 12 调之一
    expect(['major', 'minor']).toContain(a.mode);
    // 确定性:同 seed 两次一致
    const a2 = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60 });
    expect(a2.key).toBe(a.key);
    expect(a2.mode).toBe(a.mode);
    // 显式覆盖
    const b = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60, key: pc(7), mode: 'minor' });
    expect(b.key).toBe(7);
    expect(b.mode).toBe('minor');
  });

  it('不同 seed 出不同 key(seed 派生 → 调性多样)', () => {
    const keys = new Set<number>();
    for (let s = 0; s < 24; s++) keys.add(buildBandSpec({ seed: s, styleHint: 'pop', mood: 'x', targetDuration: 60 }).key);
    expect(keys.size).toBeGreaterThanOrEqual(6); // 24 seed 至少出 6 个不同调
  });

  it('instrumentPool 含 5 角色', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(spec.instrumentPool).toEqual(['bass', 'comp', 'pad', 'lead', 'drum']);
  });
});
