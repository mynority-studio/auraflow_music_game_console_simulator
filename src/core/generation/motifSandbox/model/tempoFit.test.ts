import { describe, it, expect } from 'vitest';
import { fitMotifToBricks, type FitInputNote } from './motifAnalysis';

// 便捷:onset/dur/vel/midi
const N = (onset: number, dur: number, vel = 0.8, midi = 60): FitInputNote => ({ onset, dur, vel, midi });

describe('motifSandbox/tempoFit · 两阶段对拍(用户 2026-06-18)', () => {
  it('★ 弹慢+不准:骨干音(强力度/长音)→ 强拍,经过音 → 就近等分,自动 1 bar', () => {
    // 想弹 0*,1,2*,3(骨干在 0/2);实际弹慢+抖:0 / 1.15 / 2.30 / 3.40
    const fit = fitMotifToBricks([N(0, 0.9, 1.0), N(1.15, 0.5, 0.6), N(2.3, 0.9, 1.0), N(3.4, 0.5, 0.6)]);
    expect(fit.barCount).toBe(1);
    expect(fit.lengthBeats).toBe(4);
    expect(fit.notes.map((x) => x.onset)).toEqual([0, 1, 2, 3]);
    // 骨干音(0/2)被标 structural 且落在四分拍下拍/半小节
    const struct = fit.notes.filter((x) => x.structural).map((x) => x.onset);
    expect(struct).toContain(0);
    expect(struct).toContain(2);
  });

  it('★ 弹太快:被等比放大拉回 1 bar,骨干仍落 0/2', () => {
    const fit = fitMotifToBricks([N(0, 0.4, 1.0), N(0.55, 0.3, 0.6), N(1.18, 0.4, 1.0), N(1.7, 0.3, 0.6)]);
    expect(fit.scale).toBeGreaterThan(1); // 放大
    expect(fit.notes.map((x) => x.onset)).toEqual([0, 1, 2, 3]);
  });

  it('★ 缩放限在 ×0.5–×2(8分↔16分↔4分)', () => {
    const fit = fitMotifToBricks([N(0, 1, 1.0), N(1.3, 0.5, 0.5), N(2.1, 1, 1.0)]);
    expect(fit.scale).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(fit.scale).toBeLessThanOrEqual(2.0 + 1e-9);
  });

  it('★ 相对位置保持:输出 onset 单调递增,首音=0', () => {
    const fit = fitMotifToBricks([N(0, 0.5, 1.0), N(0.7, 0.4, 0.5), N(1.6, 0.5, 0.9), N(2.4, 0.5, 0.6), N(3.1, 0.5, 1.0)]);
    expect(fit.notes[0].onset).toBe(0);
    for (let i = 1; i < fit.notes.length; i++) expect(fit.notes[i].onset).toBeGreaterThan(fit.notes[i - 1].onset);
  });

  it('★ 经过音可吸到三连音位(更接近三连的形状)', () => {
    // 三连感:0 / 0.33 / 0.66(8 分三连),骨干在 0;span 小 → 放大到 1 bar
    const fit = fitMotifToBricks([N(0, 0.9, 1.0), N(0.33, 0.3, 0.5), N(0.66, 0.3, 0.5), N(1.0, 0.9, 1.0)]);
    // 至少一个经过音落在三连位(x*3 接近整数,但非 16 分位)
    const onTriplet = fit.notes.some((x) => {
      const t = x.onset * 3, g = x.onset * 4;
      return Math.abs(t - Math.round(t)) < 1e-6 && Math.abs(g - Math.round(g)) > 1e-6;
    });
    expect(onTriplet).toBe(true);
  });

  it('★ 时值不越 brick 末(tiling 安全),但内部不钳 barline', () => {
    const fit = fitMotifToBricks([N(0, 1, 1.0), N(2, 1, 1.0), N(3.5, 4, 1.0)]); // 末音超长 → 钳到 brick 末
    const last = fit.notes[fit.notes.length - 1];
    expect(last.onset + last.dur).toBeLessThanOrEqual(fit.lengthBeats + 1e-9);
  });

  it('空输入 → 安全返回 1 bar 空 motif', () => {
    const fit = fitMotifToBricks([]);
    expect(fit.notes).toEqual([]);
    expect(fit.lengthBeats).toBe(4);
  });
});
