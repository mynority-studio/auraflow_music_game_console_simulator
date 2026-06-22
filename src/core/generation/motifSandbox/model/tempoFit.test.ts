import { describe, it, expect } from 'vitest';
import { fitMotifToBricks, type FitInputNote } from './motifAnalysis';

// 便捷:onset/dur/vel/midi
const N = (onset: number, dur: number, vel = 0.8, midi = 60): FitInputNote => ({ onset, dur, vel, midi });

describe('motifSandbox/fitMotifToBricks · 贴 16 分网格(用户 2026-06-22 重写)', () => {
  it('★ 均匀节奏保真(核心修复):均匀八分 / 满 bar 16 分逐音落网格,不被挤成"每拍贴俩"', () => {
    const eighths = fitMotifToBricks(Array.from({ length: 8 }, (_, i) => N(i * 0.5, 0.45, 0.8, 60 + i)));
    expect(eighths.notes.map((x) => x.onset)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]); // 均匀八分原样
    const s16 = fitMotifToBricks(Array.from({ length: 16 }, (_, i) => N(i * 0.25, 0.2, 0.8, 60 + (i % 8))));
    expect(s16.notes.map((x) => x.onset)).toEqual(Array.from({ length: 16 }, (_, i) => i * 0.25)); // 满 bar 16 分原样
  });

  it('★ 轻微贴合 bar = 只压不拉:稍超一个 bar(~4.4 拍)被轻压收进整 bar(s<1);末音落 beat3 时 s=1 不被拉离拍', () => {
    // 稍超一 bar:轻压 s<1 收进 1 bar
    const over = fitMotifToBricks([N(0, 0.5, 0.8, 60), N(1.1, 0.5, 0.8, 62), N(2.2, 0.5, 0.8, 64), N(3.3, 0.5, 0.8, 65), N(4.0, 0.4, 0.8, 67)]);
    expect(over.barCount).toBe(1);
    expect(over.scale).toBeLessThan(1.0);
    expect(over.notes.map((x) => x.onset)).toEqual([0, 1, 2, 3, 3.75]);
    // 末音落 beat3(span<bar)→ 不拉伸(s=1),拍上音原样落 0/1/2/3
    const onBeat = fitMotifToBricks([N(0, 0.9, 0.8, 60), N(1.05, 0.4, 0.8, 64), N(1.95, 0.9, 0.8, 67), N(3.0, 0.4, 0.8, 72)]);
    expect(onBeat.scale).toBe(1.0);
    expect(onBeat.notes.map((x) => x.onset)).toEqual([0, 1, 2, 3]);
  });

  it('★ 缩放窄限 [0.85,1.18]:半 bar 16 分【不被 ×2 拉成八分】,不丢音', () => {
    const half16 = fitMotifToBricks(Array.from({ length: 8 }, (_, i) => N(i * 0.25, 0.2, 0.8, 60 + i)));
    expect(half16.scale).toBeGreaterThanOrEqual(0.85 - 1e-9);
    expect(half16.scale).toBeLessThanOrEqual(1.18 + 1e-9);
    expect(half16.notes.length).toBe(8);                                   // 不丢
    expect(half16.notes[half16.notes.length - 1].onset).toBeLessThan(2.5); // 仍在前半 bar 附近(非铺满 4 拍)
  });

  it('★ 相对位置保持:输出 onset 单调递增,首音=0', () => {
    const fit = fitMotifToBricks([N(0, 0.5, 1.0), N(0.7, 0.4, 0.5), N(1.6, 0.5, 0.9), N(2.4, 0.5, 0.6), N(3.1, 0.5, 1.0)]);
    expect(fit.notes[0].onset).toBe(0);
    for (let i = 1; i < fit.notes.length; i++) expect(fit.notes[i].onset).toBeGreaterThan(fit.notes[i - 1].onset);
  });

  it('★ 经过音落 16 分网格(三连音吸附暂缓 — weaver/伴奏输出层为 1/16)', () => {
    const fit = fitMotifToBricks([N(0, 0.9, 1.0), N(0.4, 0.3, 0.5), N(0.9, 0.3, 0.5), N(1.0, 0.9, 1.0)]);
    for (const x of fit.notes) {
      const g = x.onset * 4;
      expect(Math.abs(g - Math.round(g)), `onset@${x.onset} 落 16 分`).toBeLessThan(1e-6);
    }
  });

  it('★ 时值不越 brick 末(tiling 安全),但内部不钳 barline', () => {
    const fit = fitMotifToBricks([N(0, 1, 1.0), N(2, 1, 1.0), N(3.5, 4, 1.0)]); // 末音超长 → 钳到 brick 末
    const last = fit.notes[fit.notes.length - 1];
    expect(last.onset + last.dur).toBeLessThanOrEqual(fit.lengthBeats + 1e-9);
  });

  it('★ 不吞音(用户 2026-06-18):对拍后撞位前推不丢音;非和音输入逐音保留、pitch 序列不变', () => {
    // 8 音旋律,onset 紧凑(对拍后会有撞位);全不同 onset(非和音)→ 必须 8 进 8 出
    const seq = [60, 62, 64, 65, 67, 65, 64, 62];
    const ons = [0, 0.45, 1.0, 1.4, 2.0, 2.45, 3.0, 3.4];
    const fit = fitMotifToBricks(ons.map((o, i) => N(o, 0.35, 0.8, seq[i])));
    expect(fit.notes.length).toBe(seq.length);                 // 不吞音
    expect(fit.notes.map((x) => x.midi)).toEqual(seq);         // pitch 序列原样(不留错误音)
    for (let i = 1; i < fit.notes.length; i++) expect(fit.notes[i].onset).toBeGreaterThan(fit.notes[i - 1].onset); // onset 唯一递增
  });

  it('★ 真和音(同 raw onset)单音化取最高 → 不被前推误当旋律', () => {
    // 3 音同 onset = 和音;后跟 2 个旋律音 → 输出 = 1(顶音) + 2
    const fit = fitMotifToBricks([N(0, 1, 0.8, 60), N(0, 1, 0.8, 64), N(0, 1, 0.8, 67), N(1, 0.5, 0.7, 69), N(2, 1, 0.8, 71)]);
    const atZero = fit.notes.filter((x) => Math.abs(x.onset) < 1e-9);
    expect(atZero.length).toBe(1);          // 和音 → 单音
    expect(atZero[0].midi).toBe(67);        // 取最高(顶声部)
    expect(fit.notes.length).toBe(3);       // 和音1 + 旋律2
  });

  it('空输入 → 安全返回 1 bar 空 motif', () => {
    const fit = fitMotifToBricks([]);
    expect(fit.notes).toEqual([]);
    expect(fit.lengthBeats).toBe(4);
  });
});
