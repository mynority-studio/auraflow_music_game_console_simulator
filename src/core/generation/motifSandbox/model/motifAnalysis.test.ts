import { describe, it, expect } from 'vitest';
import { analyzeAndNormalize, generateSampleCaptured, fitRecordingToBars, MotifAnalysisError } from './motifAnalysis';
import { isInScale } from './scale';
import type { CapturedMidiNote } from './types';

describe('motifSandbox/motifAnalysis', () => {
  it('★ onset + duration 都落 1/16 网格(规整音值 2/4/8/16 分);音符不溢出本 bar(2026-06-18 用户)', () => {
    for (const variant of [0, 1, 2, 3]) {
      const cap = generateSampleCaptured(96, 0, 'major', variant);
      const { motif } = analyzeAndNormalize(cap, 0, 'major', 96);
      for (const n of motif.notes) {
        expect(Math.abs(n.onsetBeat / 0.25 - Math.round(n.onsetBeat / 0.25)), `onset@${n.onsetBeat}`).toBeLessThan(1e-6);       // onset 规整
        expect(Math.abs(n.durationBeat / 0.25 - Math.round(n.durationBeat / 0.25)), `dur@${n.durationBeat}`).toBeLessThan(1e-6); // ★ duration 规整(整分音值)
        expect(n.durationBeat).toBeGreaterThanOrEqual(0.25);                                                                     // ≥ 16 分
        expect(Math.floor((n.onsetBeat + n.durationBeat - 1e-6) / 4)).toBe(Math.floor(n.onsetBeat / 4));                          // ★ 不溢出本 bar
      }
    }
  });

  it('★ 2-bar motif:不规则跨 bar 音被规整 + 钳回本 bar(downbeat 干净,用户场景)', () => {
    const bpm = 120, mpb = 60000 / bpm; // 8 拍 = 2 bar
    const cap: CapturedMidiNote[] = [
      { midi: 60, velocity: 100, onsetMs: 0, durationMs: mpb * 0.87 },        // 不规则 0.87 拍
      { midi: 62, velocity: 90, onsetMs: mpb * 2, durationMs: mpb * 1.4 },
      { midi: 64, velocity: 90, onsetMs: mpb * 3.5, durationMs: mpb * 1.3 },  // 3.5 + 1.3 = 4.8 → 旧:溢进 bar2;新:钳到 4.0
      { midi: 65, velocity: 90, onsetMs: mpb * 6, durationMs: mpb * 2.0 },
    ];
    const { motif } = analyzeAndNormalize(cap, 0, 'major', bpm);
    expect(motif.lengthBeats).toBe(8); // 2 bar
    for (const n of motif.notes) {
      expect(Math.abs(n.durationBeat / 0.25 - Math.round(n.durationBeat / 0.25)), `dur@${n.durationBeat}`).toBeLessThan(1e-6); // 整分音值
      const startBar = Math.floor(n.onsetBeat / 4);
      expect(Math.floor((n.onsetBeat + n.durationBeat - 1e-6) / 4), `note@${n.onsetBeat} 溢出 bar`).toBe(startBar); // 不溢进下个 bar
    }
    // 那个跨 bar 的音(onset 3.5)被钳到本 bar 末(dur ≤ 0.5)
    const crossing = motif.notes.find((n) => Math.abs(n.onsetBeat - 3.5) < 1e-6)!;
    expect(crossing.durationBeat).toBeLessThanOrEqual(0.5 + 1e-6);
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
    expect([4, 8, 12, 16]).toContain(motif.lengthBeats); // 整 bar(1..4 bar)
  });

  it('★ fitRecordingToBars:据长度识别整 bar + 反算 bpm 让它正好整 bar', () => {
    // 96bpm,msPerBar=2500;录 ~2 bar 略快(4800ms)→ targetBars=2,bpm 调到 100(2bar=4800ms)
    const cap = [
      { midi: 60, velocity: 100, onsetMs: 0, durationMs: 400 },
      { midi: 64, velocity: 90, onsetMs: 4400, durationMs: 400 }, // span = 4800ms
    ];
    const fit = fitRecordingToBars(cap, 96);
    expect(fit.targetBars).toBe(2);
    expect(fit.adjustedBpm).toBeCloseTo(100, 1);
    // 用调整后的 bpm,这段正好 2 bar:span(beats) = 8
    const msPerBeat = 60000 / fit.adjustedBpm;
    expect((4800 / msPerBeat)).toBeCloseTo(8, 1);
  });

  it('fitRecordingToBars:不整拍 → 缩/拉到最近整 bar', () => {
    // 100bpm,msPerBar=2400;录 3.1 bar(7440ms)→ round=3 bar,bpm 反算
    const cap = [{ midi: 60, velocity: 100, onsetMs: 0, durationMs: 300 }, { midi: 67, velocity: 90, onsetMs: 7200, durationMs: 240 }];
    const fit = fitRecordingToBars(cap, 100);
    expect(fit.targetBars).toBe(3);
    const msPerBeat = 60000 / fit.adjustedBpm;
    expect(fit.spanMs / msPerBeat).toBeCloseTo(12, 1); // 正好 3 bar = 12 拍
  });

  it('录制路径:调 bpm 后 motif 长度落整 bar(4/8/12/16 拍)', () => {
    const cap = [{ midi: 60, velocity: 100, onsetMs: 0, durationMs: 400 }, { midi: 64, velocity: 90, onsetMs: 4400, durationMs: 400 }];
    const fit = fitRecordingToBars(cap, 96);
    const { motif } = analyzeAndNormalize(cap, 0, 'major', fit.adjustedBpm);
    expect(motif.lengthBeats % 4).toBe(0);            // 整 bar
    expect(motif.lengthBeats).toBe(fit.targetBars * 4); // = 识别的 bar 数
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
    // 单旋律:onset 互不相同(无同起音和弦);时值可叠(legato 保留,不强制非重叠)
    const s = [...motif.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
    for (let i = 0; i < s.length - 1; i++) expect(s[i].onsetBeat).toBeLessThan(s[i + 1].onsetBeat);
  });

  it('★ 不规则/legato 录入 → 时值吸成整分音值 + 钳在 bar 内(取代旧"完全还原原始时值")', () => {
    const cap: CapturedMidiNote[] = [
      { midi: 60, velocity: 100, onsetMs: 0, durationMs: 700 },   // 1.12 拍 → 规整 1.0
      { midi: 64, velocity: 90, onsetMs: 640, durationMs: 700 },
      { midi: 67, velocity: 90, onsetMs: 1260, durationMs: 900 }, // 1.44 拍 → 规整 1.5
    ];
    const { motif } = analyzeAndNormalize(cap, 0, 'major', 96);
    for (const n of motif.notes) {
      expect(Math.abs(n.durationBeat / 0.25 - Math.round(n.durationBeat / 0.25)), `dur@${n.durationBeat}`).toBeLessThan(1e-6); // 整分音值
      expect(Math.floor((n.onsetBeat + n.durationBeat - 1e-6) / 4)).toBe(Math.floor(n.onsetBeat / 4));                          // 不溢出本 bar
    }
    expect(motif.notes[0].durationBeat).toBeCloseTo(1.0, 6); // 1.12 → 1.0(不再是原始 1.12)
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
