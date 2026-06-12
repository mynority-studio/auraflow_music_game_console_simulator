import { describe, it, expect } from 'vitest';
import { analyzeAndNormalize, generateSampleCaptured, MotifAnalysisError } from './motifAnalysis';
import { isInScale } from './scale';
import type { CapturedMidiNote } from './types';

describe('motifSandbox/motifAnalysis', () => {
  it('量化:onset/dur 落 1/16 网格(0.25 倍数)', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 1);
    const { motif } = analyzeAndNormalize(cap, 0, 'major', 96);
    for (const n of motif.notes) {
      expect(Math.abs(n.onsetBeat / 0.25 - Math.round(n.onsetBeat / 0.25))).toBeLessThan(1e-6);
      expect(n.durationBeat).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('snap:含离调音的输入 → 输出全在调内(major 与 minor)', () => {
    for (const mode of ['major', 'minor'] as const) {
      const cap = generateSampleCaptured(100, 7, mode, 2); // G key
      const { motif } = analyzeAndNormalize(cap, 7, mode, 100);
      for (const n of motif.notes) expect(isInScale(n.midi, 7, mode), `GM${n.midi}`).toBe(true);
    }
  });

  it('scaleDegree 在 1..7;length 补齐到 {1,2,4,8}', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0);
    const { motif } = analyzeAndNormalize(cap, 0, 'major', 96);
    for (const n of motif.notes) { expect(n.scaleDegree).toBeGreaterThanOrEqual(1); expect(n.scaleDegree).toBeLessThanOrEqual(7); }
    expect([1, 2, 4, 8]).toContain(motif.lengthBeats);
  });

  it('单旋律化:同 onset 的和音只留最高音,无重叠', () => {
    // 两个同 onset 音(和音),应只留高音
    const cap: CapturedMidiNote[] = [
      { midi: 60, velocity: 90, onsetMs: 0, durationMs: 400 },
      { midi: 64, velocity: 90, onsetMs: 3, durationMs: 400 }, // 同 bucket(量化后同 onset)
      { midi: 67, velocity: 90, onsetMs: 600, durationMs: 300 },
    ];
    const { motif } = analyzeAndNormalize(cap, 0, 'major', 100);
    // 第一个 onset bucket 只剩一个音(最高 64)
    const atZero = motif.notes.filter((n) => n.onsetBeat === 0);
    expect(atZero.length).toBe(1);
    expect(atZero[0].midi).toBe(64);
    // 无重叠
    const s = [...motif.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
    for (let i = 0; i < s.length - 1; i++) expect(s[i].onsetBeat + s[i].durationBeat).toBeLessThanOrEqual(s[i + 1].onsetBeat + 1e-6);
  });

  it('质量门:< 2 音抛错', () => {
    expect(() => analyzeAndNormalize([{ midi: 60, velocity: 90, onsetMs: 0, durationMs: 300 }], 0, 'major', 100)).toThrow(MotifAnalysisError);
    expect(() => analyzeAndNormalize([], 0, 'major', 100)).toThrow(MotifAnalysisError);
  });

  it('确定性:同输入两次一致', () => {
    const cap = generateSampleCaptured(96, 2, 'minor', 3);
    const a = analyzeAndNormalize(cap, 2, 'minor', 96);
    const b = analyzeAndNormalize(cap, 2, 'minor', 96);
    expect(a.motif.notes).toEqual(b.motif.notes);
  });
});
