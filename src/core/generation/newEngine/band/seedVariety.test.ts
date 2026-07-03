import { describe, it, expect } from 'vitest';
import { buildBandSpec } from './bandEngine';
import { planTime } from '../arranger/timePlanner';
import { traceGeneration } from '../generation';
import { createRandomContext } from '../foundation';

const reqs = (n: number, style = 'pop') =>
  Array.from({ length: n }, (_, s) => ({ seed: s, styleHint: style, mood: 'x', targetDuration: 120 }));

describe('band · seed 派生音乐身份多样性 (①key ③tempo ④mode)', () => {
  it('④ mode:跨 seed 大调小调都出现(非永远大调)', () => {
    const modes = new Set(reqs(24).map((r) => buildBandSpec(r).mode));
    expect(modes.has('major')).toBe(true);
    expect(modes.has('minor')).toBe(true);
  });

  it('① key:跨 seed ≥8 个不同调中心', () => {
    const keys = new Set(reqs(24).map((r) => buildBandSpec(r).key));
    expect(keys.size).toBeGreaterThanOrEqual(8);
  });

  it('modal:跨 seed 调式池轮换(≥3 种教会调式)', () => {
    const modes = new Set(reqs(24, 'modal').map((r) => buildBandSpec(r).modalModeName));
    expect(modes.size).toBeGreaterThanOrEqual(3);
  });

  it('③ tempo:有 rng → POP/JAZZ 放宽到抒情/欢快;无 rng → 中心;跨 seed 多速度', () => {
    expect(planTime('pop').tempoBpm).toBe(118); // 无 rng = 中心
    expect(planTime('jazz').tempoBpm).toBe(132);
    const popTempos = new Set<number>();
    const jazzTempos = new Set<number>();
    for (let s = 0; s < 16; s++) {
      const bpm = planTime('pop', createRandomContext(s).substream('time')).tempoBpm;
      expect(bpm).toBeGreaterThanOrEqual(74);
      expect(bpm).toBeLessThanOrEqual(162);
      popTempos.add(bpm);
      const jazzBpm = planTime('jazz', createRandomContext(s).substream('time')).tempoBpm;
      expect(jazzBpm).toBeGreaterThanOrEqual(76);
      expect(jazzBpm).toBeLessThanOrEqual(188);
      jazzTempos.add(jazzBpm);
    }
    expect(popTempos.size).toBeGreaterThanOrEqual(4); // 多个不同速度
    expect(jazzTempos.size).toBeGreaterThanOrEqual(4);
    const popWide = Array.from({ length: 64 }, (_, s) => planTime('pop', createRandomContext(s).substream('time')).tempoBpm);
    const jazzWide = Array.from({ length: 64 }, (_, s) => planTime('jazz', createRandomContext(s).substream('time')).tempoBpm);
    expect(Math.min(...popWide)).toBeLessThanOrEqual(90);  // 抒情 pop
    expect(Math.max(...popWide)).toBeGreaterThanOrEqual(145); // 欢快 pop
    expect(Math.min(...jazzWide)).toBeLessThanOrEqual(95); // jazz ballad / slow swing
    expect(Math.max(...jazzWide)).toBeGreaterThanOrEqual(165); // bright swing
  });

  it('★ 端到端:不同 seed 出不同身份(key/tempo 组合)不再"就那么几首"', () => {
    const ids = new Set(reqs(16).map((r) => { const t = traceGeneration(r); return `${buildBandSpec(r).key}|${buildBandSpec(r).mode}|${t.bpm}`; }));
    expect(ids.size).toBeGreaterThanOrEqual(10); // 16 seed ≥10 个不同身份
  });

  it('确定性:显式 key/mode 永远覆盖 seed 派生', () => {
    const b = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 120, key: 0 as never, mode: 'major' });
    expect(b.key).toBe(0);
    expect(b.mode).toBe('major');
  });
});
