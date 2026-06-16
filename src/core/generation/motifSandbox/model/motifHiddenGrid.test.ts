import { describe, it, expect } from 'vitest';
import { analyzeHiddenGridMotif } from './motifAnalysis';
import { generateMotifWeave } from './motifWeaver';
import { createHiddenGridContext, mapRawNoteToGrid, msPerBeat, type HiddenGridCaptureContext } from '../capture/hiddenGridClock';
import { fitRange, identity } from './motifTransform';
import { quotedAt } from './jazzinessAudit';
import { isInScale } from './scale';

const ctxOf = (over: Partial<Parameters<typeof createHiddenGridContext>[0]> = {}): HiddenGridCaptureContext =>
  createHiddenGridContext({ seed: 7, keyPc: 0, scaleMode: 'major', tonality: 'major', style: 'pop', startMs: 1000, ...over });
const note = (ctx: HiddenGridCaptureContext, midi: number, vel: number, onBeat: number, durBeat: number) =>
  mapRawNoteToGrid({ midi, velocity: vel, onMs: ctx.captureStartMs + onBeat * msPerBeat(ctx), offMs: ctx.captureStartMs + (onBeat + durBeat) * msPerBeat(ctx) }, ctx);

describe('motifSandbox/hidden-grid 分析 + quote plan(directive Phase C/E)', () => {
  it('★ 1-bar 捕获 → lengthBeats=4;迟到首音保留前导休止(不被减成 beat0)', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0.5, 0.5), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif, timing } = analyzeHiddenGridMotif(g, c);
    expect(timing.lengthBeats).toBe(4);
    expect(motif.lengthBeats).toBe(4);
    expect(motif.notes[0].onsetBeat).toBeCloseTo(0.5, 6); // 迟到=迟到,前面 0.5 拍休止保留
    expect(timing.leadingRestBeats).toBeCloseTo(0.5, 6);
    expect(timing.captureMode).toBe('hiddenGrid');
  });

  it('2-bar 捕获 → lengthBeats=8', () => {
    const c = ctxOf({ style: 'jazz', desiredBars: 2 });
    expect(c.captureBars).toBe(2);
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 2, 1), note(c, 64, 90, 5, 1), note(c, 67, 100, 7, 1)];
    expect(analyzeHiddenGridMotif(g, c).motif.lengthBeats).toBe(8);
  });

  it('★ 真 motif 长度 = 实际演奏小节数(4bar 窗里只弹到第 2 小节 → lengthBeats=8,非 16)', () => {
    const c = ctxOf({ desiredBars: 4 });
    expect(c.captureBars).toBe(4);
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 2, 1), note(c, 64, 90, 5, 1), note(c, 67, 100, 7, 1)]; // 末音落第 8 拍
    const { motif, timing } = analyzeHiddenGridMotif(g, c);
    expect(motif.lengthBeats).toBe(8);   // 派生 = 2 小节
    expect(timing.captureBars).toBe(4);  // 窗仍是 4(最多)
  });

  it('4bar 窗弹满 4 小节 → lengthBeats=16', () => {
    const c = ctxOf({ desiredBars: 4 });
    const g = [note(c, 60, 100, 0, 1), note(c, 67, 90, 12, 1), note(c, 64, 90, 14, 1)]; // 末音落第 15 拍(第 4 小节)
    expect(analyzeHiddenGridMotif(g, c).motif.lengthBeats).toBe(16);
  });

  it('★ §4:4 小节 motif 不退化成 4 段死复制(quote 缩子动机 + 每和弦循环有发展)', () => {
    const c = ctxOf({ desiredBars: 4 });
    const g = [note(c, 60, 100, 0, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 4, 1), note(c, 72, 90, 8, 1), note(c, 69, 90, 12, 1), note(c, 67, 100, 14, 1)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    expect(motif.lengthBeats).toBe(16); // 真 4 小节
    const r = generateMotifWeave({ capturedNotes: [], motif, style: 'pop', keyPc: 0, mode: 'major', bpm: c.bpm, seed: 7 });
    expect(r.motifBars).toBe(4);   // 显式返回:分析长度
    expect(r.quoteBars).toBe(2);   // 显式返回:实际 quote 单元(缩到子动机)
    const quoteHeads = r.occurrences.filter((o) => o.kind === 'quote').map((o) => o.startBeat);
    for (const b of [0, 16, 32, 48]) expect(quoteHeads, `循环头@${b} 有 quote`).toContain(b); // 每和弦循环头都再现
    expect(r.occurrences.some((o) => o.kind === 'develop'), '有发展/续写').toBe(true);   // 不是死复制
    expect(r.lead.some((n) => n.occurrenceKind === 'develop')).toBe(true);
    // ★ 审计按【quote 单元】校验 → head 原样 = ✓(不再因完整 motif 误报 ✗)
    expect(r.audit.motifQuotedFirstCycle, 'head(quote 单元)原样').toBe(true);
  });

  it('★ 结构音:下拍上的【安静长音】结构分 > 弱拍 16 分上的【响亮短音】(directive §12)', () => {
    const c = ctxOf();
    const g = [
      note(c, 60, 40, 0, 2),      // 下拍、安静(vel40)、长(2拍)= 骨干
      note(c, 71, 122, 1.25, 0.25), // 弱拍 16 分、响亮(vel122)、短 = 经过音
      note(c, 67, 90, 2, 1),
    ];
    const { motif } = analyzeHiddenGridMotif(g, c);
    const down = motif.notes.find((n) => Math.abs(n.onsetBeat) < 1e-6)!;
    const passing = motif.notes.find((n) => Math.abs(n.onsetBeat - 1.25) < 1e-6)!;
    expect(down.structuralToneScore!).toBeGreaterThan(passing.structuralToneScore!); // 安静下拍长音更"结构"
  });

  it('量化误差被报告;调内输入 snapChanges=0', () => {
    const c = ctxOf();
    const mpb = msPerBeat(c);
    const g = [
      mapRawNoteToGrid({ midi: 60, velocity: 100, onMs: c.captureStartMs + mpb * 0.08, offMs: c.captureStartMs + mpb }, c), // 略早
      note(c, 64, 90, 1, 1), note(c, 67, 90, 2, 1),
    ];
    const { timing, snapChanges } = analyzeHiddenGridMotif(g, c);
    expect(timing.quantizeErrorMax).toBeGreaterThan(0);
    expect(snapChanges).toBe(0); // C/E/G 都在 C 大调内
  });

  it('★ quotePlan=phraseHeads(排比,默认):原样 motif 在 0/16/32/48 都出现', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    const r = generateMotifWeave({ capturedNotes: [], motif, style: 'pop', keyPc: 0, mode: 'major', bpm: c.bpm, seed: 7 });
    const ref = fitRange(identity(motif.notes), 60, 84);
    for (const b of [0, 16, 32, 48]) expect(quotedAt(r.lead, ref, b), `bar@${b}`).toBe(true);
    for (const n of r.lead) expect(isInScale(n.midi, 0, 'major')).toBe(true); // 非 jazz 全 diatonic
  });

  it('★ quotePlan=verseHeadsOnly:原样只在 bar1(0)/bar9(32),bar5(16)是发展不是原样', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    const r = generateMotifWeave({ capturedNotes: [], motif, style: 'pop', keyPc: 0, mode: 'major', bpm: c.bpm, seed: 7, quotePlan: 'verseHeadsOnly' });
    const ref = fitRange(identity(motif.notes), 60, 84);
    expect(quotedAt(r.lead, ref, 0), 'verse1 头').toBe(true);
    expect(quotedAt(r.lead, ref, 32), 'verse2 头').toBe(true);
    expect(quotedAt(r.lead, ref, 16), 'bar5 应为发展非原样').toBe(false);
    expect(r.occurrences.some((o) => o.startBeat === 16 && o.kind === 'develop')).toBe(true);
  });
});
