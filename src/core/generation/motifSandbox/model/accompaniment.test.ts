import { describe, it, expect } from 'vitest';
import { buildAccompaniment } from './accompaniment';
import { buildProgression } from './motifHarmony';
import { analyzeAndNormalize, generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import type { SandboxStyle } from './types';

const motifOf = (keyPc = 0, mode: 'major' | 'minor' = 'major') =>
  analyzeAndNormalize(generateSampleCaptured(96, keyPc, mode, 0), keyPc, mode, 96, 7).motif;
const sig = (ns: { midi: number; onsetBeat: number; durationBeat: number }[]) => ns.map((n) => `${n.midi}@${n.onsetBeat.toFixed(2)}+${n.durationBeat.toFixed(2)}`).join(',');

describe('motifSandbox/伴奏织体 + 16-bar 和声', () => {
  it('buildProgression:16 小节、末两小节 V→I、和声不单调(≥3 个不同级)', () => {
    const prog = buildProgression(motifOf(), 0, 'major', 16);
    expect(prog.length).toBe(16);
    expect(prog[14].degree).toBe(5); // V
    expect(prog[15].degree).toBe(1); // I
    expect(new Set(prog.map((c) => c.degree)).size).toBeGreaterThanOrEqual(3); // 不是 I-V-I-V 单调
    for (let i = 0; i < prog.length; i++) expect(prog[i].startBeat).toBe(i * 4);
  });

  it('每风格:comp + bass 非空、时值正、确定性', () => {
    const prog = buildProgression(motifOf(), 0, 'major', 16);
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      const a = buildAccompaniment(prog, style, 7);
      expect(a.comp.length, style).toBeGreaterThan(0);
      expect(a.bass.length, style).toBeGreaterThan(0);
      for (const n of [...a.comp, ...a.bass]) expect(n.durationBeat, style).toBeGreaterThan(0);
      const b = buildAccompaniment(prog, style, 7);
      expect(sig(a.comp), `${style} comp 确定性`).toBe(sig(b.comp));
      expect(sig(a.bass), `${style} bass 确定性`).toBe(sig(b.bass));
    }
  });

  it('comp 在 comp 音区、bass 在 bass 音区;comp 全 diatonic,非 jazz bass 全 diatonic(jazz 走音允许半音趋近)', () => {
    const prog = buildProgression(motifOf(0, 'major'), 0, 'major', 16);
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      const a = buildAccompaniment(prog, style, 3);
      for (const n of a.comp) {
        expect(n.midi, `${style} comp 区`).toBeGreaterThanOrEqual(40); expect(n.midi).toBeLessThanOrEqual(74);
        expect(isInScale(n.midi, 0, 'major'), `${style} comp GM${n.midi}`).toBe(true); // comp = 三和弦 → 全调内
      }
      for (const n of a.bass) { expect(n.midi, `${style} bass 区`).toBeGreaterThanOrEqual(30); expect(n.midi).toBeLessThanOrEqual(60); }
      if (style !== 'jazz') for (const n of a.bass) expect(isInScale(n.midi, 0, 'major'), `${style} bass GM${n.midi}`).toBe(true);
      else {
        const chrom = a.bass.filter((n) => !isInScale(n.midi, 0, 'major')).length; // 仅半音趋近音(≤每小节 1)
        expect(chrom).toBeLessThanOrEqual(16);
      }
    }
  });

  it('风格织体差异:jazz bass 走音(每小节≈4)> lofi 稀疏 bass', () => {
    const prog = buildProgression(motifOf(), 0, 'major', 16);
    const jazz = buildAccompaniment(prog, 'jazz', 7);
    const lofi = buildAccompaniment(prog, 'lofi', 7);
    expect(jazz.bass.length).toBeGreaterThan(lofi.bass.length * 2); // 走音 vs 整小节长音
    expect(jazz.bassProgram).toBe(32); // 原声贝斯
    expect(lofi.compProgram).toBe(4);  // 电钢
  });
});
