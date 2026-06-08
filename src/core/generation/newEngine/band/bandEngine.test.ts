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

  it('编制可变(2–5 件):必含 lead + ≥1 和声(comp/pad/bass);每件有 GM program', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(spec.instrumentPool.length).toBeGreaterThanOrEqual(2);
    expect(spec.instrumentPool.length).toBeLessThanOrEqual(5);
    expect(spec.instrumentPool).toContain('lead'); // 旋律必有
    expect(spec.instrumentPool.some((r) => r === 'comp' || r === 'pad' || r === 'bass')).toBe(true); // 和声承载
    for (const r of spec.instrumentPool) expect(typeof spec.roleProgram[r]).toBe('number'); // 每件选了乐器
  });

  it('LOFI 固定含 bass,避免 bass:required texture 被分轨丢失', () => {
    for (let seed = 0; seed < 32; seed++) {
      const spec = buildBandSpec({ seed, styleHint: 'lofi', mood: 'x', targetDuration: 60 });
      expect(spec.instrumentPool).toContain('bass');
    }
  });

  it('不同 style/seed → 编制大小或乐器不同(乐器要素随 seed)', () => {
    const sig = (s: number, style: string) => { const b = buildBandSpec({ seed: s, styleHint: style, mood: 'x', targetDuration: 60 }); return `${b.instrumentPool.join(',')}|${b.instrumentPool.map((r) => b.roleProgram[r]).join(',')}`; };
    const sigs = new Set<string>();
    for (let s = 0; s < 12; s++) { sigs.add(sig(s, 'jazz')); sigs.add(sig(s, 'lofi')); }
    expect(sigs.size).toBeGreaterThanOrEqual(6); // 编制/乐器有多样性
    expect(sig(3, 'jazz')).toBe(sig(3, 'jazz')); // 确定性
  });
});
