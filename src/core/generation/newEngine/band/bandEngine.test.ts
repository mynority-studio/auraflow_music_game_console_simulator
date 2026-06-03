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

  it('key/mode 默认 C 大调,可被 request 覆盖', () => {
    const a = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60 });
    expect(a.key).toBe(0);
    expect(a.mode).toBe('major');
    const b = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60, key: pc(7), mode: 'minor' });
    expect(b.key).toBe(7);
    expect(b.mode).toBe('minor');
  });

  it('instrumentPool 含 5 角色', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(spec.instrumentPool).toEqual(['bass', 'comp', 'pad', 'lead', 'drum']);
  });
});
