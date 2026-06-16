import { describe, it, expect } from 'vitest';
import { buildLeadOnlyIr } from './leadOnlyIr';
import type { MotifNote } from './types';

const note = (midi: number, onsetBeat: number, durationBeat = 0.5): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity: 0.8, scaleDegree: 1, octave: 5, accent: 0.7, occurrenceKind: 'quote' });
// 下拍 1.0 + 反拍 1.5 + 十六分 1.75
const lead: MotifNote[] = [note(60, 0), note(62, 1.0), note(64, 1.5), note(65, 1.75)];
const startTickAt = (style: 'pop' | 'jazz', onset: number): number => {
  const ir = buildLeadOnlyIr(lead, 130, style);
  const ns = ir.tracks[0].notes;
  // 找回最接近该 straight onset 的音(按音高定位)
  const idx = lead.findIndex((n) => Math.abs(n.onsetBeat - onset) < 1e-6);
  return ns[idx].startTick as unknown as number;
};

describe('motifSandbox/leadOnlyIr swing(jazz 摆动,播放/吸附层)', () => {
  it('★ jazz:下拍不动,反拍(八分/十六分)推后 → 摇摆;非 jazz 直拍', () => {
    // 下拍 1.0:jazz 与 pop 相同(摆动不动整数拍)
    expect(startTickAt('jazz', 1.0)).toBe(startTickAt('pop', 1.0));
    // 反拍 1.5:jazz 比 pop 晚(推后 = 摇摆)
    expect(startTickAt('jazz', 1.5)).toBeGreaterThan(startTickAt('pop', 1.5));
    // 十六分 1.75:jazz 也按拍内映射推后
    expect(startTickAt('jazz', 1.75)).toBeGreaterThan(startTickAt('pop', 1.75));
    // 曲首 0:不动
    expect(startTickAt('jazz', 0)).toBe(startTickAt('pop', 0));
  });

  it('★ 非 jazz 完全直拍(pop/lofi/rnb 各 onset tick 不变)', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const ir = buildLeadOnlyIr(lead, 130, style);
      const ns = ir.tracks[0].notes;
      // 反拍 1.5 的 tick == 1.5 拍的直拍 tick(= 下拍 1.0 与 2.0 的中点)
      const t1 = ns[1].startTick as unknown as number; // 1.0
      const t15 = ns[2].startTick as unknown as number; // 1.5
      const t2cand = t1 + (t1 - (ns[0].startTick as unknown as number)); // 2.0 估
      expect(Math.abs(t15 - (t1 + (t2cand - t1) / 2))).toBeLessThan(2); // 直拍中点(允许取整误差)
    }
  });
});
