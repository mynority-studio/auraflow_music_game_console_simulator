import { describe, it, expect } from 'vitest';
import { buildLeadOnlyIr } from './leadOnlyIr';
import type { MotifNote } from './types';

const note = (midi: number, onsetBeat: number, durationBeat = 0.5): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity: 0.8, scaleDegree: 1, octave: 5, accent: 0.7, occurrenceKind: 'quote' });
// 下拍 1.0 + 反拍 1.5 + 十六分 1.75
const lead: MotifNote[] = [note(60, 0), note(62, 1.0), note(64, 1.5), note(65, 1.75)];
// 真八分反拍 lead(1.5 后接下拍 2.0,非 16 分)→ 网格所有者允许摆动
const eighthLead: MotifNote[] = [note(60, 0), note(62, 1.0), note(64, 1.5), note(65, 2.0)];
const startTickOf = (leadArr: MotifNote[], style: 'pop' | 'jazz', onset: number): number => {
  const ns = buildLeadOnlyIr(leadArr, 130, style).tracks[0].notes;
  const idx = leadArr.findIndex((n) => Math.abs(n.onsetBeat - onset) < 1e-6);
  return ns[idx].startTick as unknown as number;
};

describe('motifSandbox/leadOnlyIr swing(jazz 摆动,播放/吸附层)', () => {
  it('★ jazz:下拍不动,【真八分反拍】推后 → 摇摆;非 jazz 直拍', () => {
    expect(startTickOf(eighthLead, 'jazz', 1.0)).toBe(startTickOf(eighthLead, 'pop', 1.0)); // 下拍不动
    expect(startTickOf(eighthLead, 'jazz', 1.5)).toBeGreaterThan(startTickOf(eighthLead, 'pop', 1.5)); // 真八分反拍 → 摆
    expect(startTickOf(eighthLead, 'jazz', 0)).toBe(startTickOf(eighthLead, 'pop', 0)); // 曲首不动
  });

  it('★ 网格所有者(2026-06-19):16 分 run 内的 .5 不被摆动(jazz==pop 直拍,防挤压)', () => {
    const run: MotifNote[] = [note(60, 0, 0.25), note(62, 0.25, 0.25), note(64, 0.5, 0.25), note(65, 0.75, 0.25), note(67, 1.0, 0.25)];
    // run 内的 0.5(以及 0.25/0.75)在 jazz 下保持笔直 == pop
    for (const onset of [0.25, 0.5, 0.75]) {
      expect(startTickOf(run, 'jazz', onset), `16分 ${onset} 不摆`).toBe(startTickOf(run, 'pop', onset));
    }
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
