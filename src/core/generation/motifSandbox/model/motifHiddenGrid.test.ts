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
  it('★ 1-bar 捕获 → lengthBeats=4;迟到首音【切头对齐】到 beat0(禁止空拍开始,directive Phase 1)', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0.5, 0.5), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif, timing } = analyzeHiddenGridMotif(g, c);
    expect(timing.lengthBeats).toBe(4);
    expect(motif.lengthBeats).toBe(4);
    expect(motif.notes[0].onsetBeat).toBe(0);              // 切头 → 首音 = beat 0(禁止空拍)
    expect(motif.notes[1].onsetBeat).toBeCloseTo(0.5, 6);  // 整段前移 0.5(1 − 0.5)
    expect(timing.leadingRestBeats).toBeCloseTo(0.5, 6);   // 晚进量仍报告(诊断)
    expect(timing.aligned).toBe(true);
    expect(timing.captureMode).toBe('hiddenGrid');
  });

  it('★ directive #1+#2:首音 0.5 → 切头 onset=0/次音=0.5;allowPickup 保留 + 切头使首音落下拍权重更高', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0.5, 1), note(c, 62, 90, 1.5, 1), note(c, 64, 90, 2.5, 1)]; // raw 0.5/1.5/2.5 → local 0/1/2
    const aligned = analyzeHiddenGridMotif(g, c);                          // 默认切头
    const pickup = analyzeHiddenGridMotif(g, c, { allowPickup: true });    // 保留前导休止
    expect(aligned.timing.leadingRestBeats).toBeCloseTo(0.5, 6);
    expect(aligned.motif.notes[0].onsetBeat).toBe(0);                      // #1:切头 beat0
    expect(aligned.motif.notes[1].onsetBeat).toBeCloseTo(1.0, 6);          // #2:raw 1.5 → local 1
    expect(aligned.motif.notes[2].onsetBeat).toBeCloseTo(2.0, 6);          // #2:raw 2.5 → local 2
    expect(pickup.motif.notes[0].onsetBeat).toBeCloseTo(0.5, 6);           // allowPickup → 保留
    expect(pickup.timing.aligned).toBe(false);
    // #2:切头后首音落下拍(weight 1.0),保留前导则落八分反拍(weight 0.35)→ 结构分更高
    expect(aligned.motif.notes[0].structuralToneScore!).toBeGreaterThan(pickup.motif.notes[0].structuralToneScore!);
  });

  it('★ 形状保真(默认路径 · 2026-06-18):onset 间距逐对保留;跨 barline 的整分音值不被砍(只规整,不钳 bar)', () => {
    const c = ctxOf({ desiredBars: 2 });
    // 首音落 beat0(无切头),含一个跨 barline 的干净四分音符:3.5 + 1.0 → 4.5
    const inB: [number, number][] = [[0, 0.5], [0.5, 0.5], [1, 1], [3.5, 1], [4.5, 0.5], [6, 1]];
    const g = inB.map(([on, du], i) => note(c, 60 + i, 90, on, du));
    const { motif } = analyzeHiddenGridMotif(g, c);
    // onset 间距逐对 == 输入(切头量=0 → 完全保留;音符之间的距离不被过量改变)
    const inGaps = inB.slice(1).map(([on], i) => on - inB[i][0]);
    const outGaps = motif.notes.slice(1).map((n, i) => n.onsetBeat - motif.notes[i].onsetBeat);
    expect(outGaps.map((x) => +x.toFixed(6))).toEqual(inGaps.map((x) => +x.toFixed(6)));
    // 时值全整分音值
    for (const n of motif.notes) expect(Math.abs(n.durationBeat / 0.25 - Math.round(n.durationBeat / 0.25))).toBeLessThan(1e-6);
    // ★ 跨 barline 的四分音符(3.5+1.0→4.5)保留,不再被钳到 bar 末(旧版砍成 0.5)
    const crossing = motif.notes.find((n) => Math.abs(n.onsetBeat - 3.5) < 1e-6)!;
    expect(crossing.durationBeat).toBeCloseTo(1.0, 6);
    expect(crossing.onsetBeat + crossing.durationBeat).toBeCloseTo(4.5, 6);
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
    // slot-plan 驱动:quote 落 plan slot(≥1),有发展,非死复制
    expect(r.melodicSlotPlan!.userQuoteSlotIds.length, '≥1 quote slot').toBeGreaterThanOrEqual(1);
    expect(r.occurrences.some((o) => o.kind === 'quote'), '有原样 quote').toBe(true);
    expect(r.occurrences.some((o) => o.kind === 'develop'), '有发展/续写').toBe(true);   // 不是死复制
    expect(r.lead.some((n) => n.occurrenceKind === 'develop')).toBe(true);
    // ★ 审计按【quote 单元】校验 → 第一个 quote slot 原样 = ✓
    expect(r.audit.motifQuotedFirstCycle, 'quote 单元原样').toBe(true);
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

  it('★ slot-plan 驱动:原样 motif 落在 plan 的 quote slot;无不证成离调', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    const r = generateMotifWeave({ capturedNotes: [], motif, style: 'pop', keyPc: 0, mode: 'major', bpm: c.bpm, seed: 7 });
    const ref = fitRange(identity(motif.notes), 60, 84);
    const qs = r.melodicSlotPlan!.userQuoteSlotIds.map((id) => r.melodicSlotPlan!.slots.find((s) => s.id === id)!.startBeat);
    expect(qs.length).toBeGreaterThanOrEqual(1);
    for (const b of qs) expect(quotedAt(r.lead, ref, b), `quote@${b}`).toBe(true);
    expect(r.audit.unjustifiedChromatic).toBe(0); // 离调音都由真实和声/quote 证成(非 jazz 无"乱"离调)
  });

  it('★ slot-plan 模式下 quotePlan 失效(被 RoadMap 计划取代):verseHeadsOnly 与 phraseHeads 同结果', () => {
    // Phase 5 后 motif 落位由 RoadMap slot plan 驱动,quotePlan 仅旧乐句循环 fallback 才用 → 此处应等价。
    const c = ctxOf();
    const g = [note(c, 60, 100, 0, 1), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    const base = { capturedNotes: [], motif, style: 'pop' as const, keyPc: 0, mode: 'major' as const, bpm: c.bpm, seed: 7 };
    const a = generateMotifWeave({ ...base, quotePlan: 'verseHeadsOnly' });
    const b = generateMotifWeave({ ...base, quotePlan: 'phraseHeads' });
    const sig = (r: typeof a) => r.lead.map((n) => `${n.midi}@${n.onsetBeat.toFixed(2)}`).join(',');
    expect(sig(a)).toBe(sig(b)); // slot-plan 驱动 → quotePlan 不影响
  });
});
