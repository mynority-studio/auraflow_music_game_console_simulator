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

  it('★ 感知旋律:传 lead → bass 锚每小节下拍 + 击点落在旋律结构点上(对拍)', () => {
    const motif = motifOf();
    const prog = buildProgression(motif, 0, 'major', 16);
    // 造一段已知重音落点的 lead(bar0 重音在 1.5;bar1 重音在 2.5)
    const lead = [
      { midi: 72, onsetBeat: 0, durationBeat: 1, velocity: 1, scaleDegree: 1, octave: 5, accent: 0.9, occurrenceKind: 'quote' as const },
      { midi: 74, onsetBeat: 1.5, durationBeat: 1, velocity: 0.9, scaleDegree: 2, octave: 5, accent: 0.8, occurrenceKind: 'quote' as const },
      { midi: 76, onsetBeat: 6.5, durationBeat: 1, velocity: 0.9, scaleDegree: 3, octave: 5, accent: 0.8, occurrenceKind: 'develop' as const },
    ];
    const a = buildAccompaniment(prog, 'pop', 7, lead);
    const has = (arr: { onsetBeat: number }[], b: number) => arr.some((n) => Math.abs(n.onsetBeat - b) < 1e-6);
    expect(has(a.bass, 0), 'bar0 下拍锚').toBe(true);
    expect(has(a.bass, 1.5), 'bar0 bass 落旋律重音 1.5').toBe(true);   // 锁结构点(非固定 beat2)
    expect(has(a.bass, 4), 'bar1 下拍锚').toBe(true);
    expect(has(a.bass, 6.5), 'bar1 bass 落旋律重音 2.5(=beat6.5)').toBe(true);
    // 每小节都有下拍 root
    for (let bar = 0; bar < 16; bar++) expect(has(a.bass, bar * 4), `bar${bar} 下拍`).toBe(true);
  });

  it('★ §5:伴奏支点用 structuralToneScore —— 安静下拍长音(低 accent / 高结构分)也成支点', () => {
    const prog = buildProgression(motifOf(), 0, 'major', 16);
    const lead = [
      { midi: 72, onsetBeat: 0, durationBeat: 1, velocity: 0.9, scaleDegree: 1, octave: 5, accent: 0.9, structuralToneScore: 0.9, occurrenceKind: 'quote' as const },
      // bar0 beat3:安静(accent 0.35 < 0.58)但结构分高(0.72 ≥ 0.58)→ 旧逻辑会漏,新逻辑应成支点
      { midi: 74, onsetBeat: 3, durationBeat: 1, velocity: 0.3, scaleDegree: 2, octave: 5, accent: 0.35, structuralToneScore: 0.72, occurrenceKind: 'quote' as const },
    ];
    const a = buildAccompaniment(prog, 'pop', 7, lead);
    expect(a.bass.some((n) => Math.abs(n.onsetBeat - 3) < 1e-6), 'bass 落在结构音 beat3').toBe(true);
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
