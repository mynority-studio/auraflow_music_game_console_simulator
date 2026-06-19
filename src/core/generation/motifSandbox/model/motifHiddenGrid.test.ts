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
  it('★ 1-bar 捕获 → lengthBeats=4;迟到首音【切头对齐】到 beat0;对拍后全落 16 分(2026-06-18 接 fit)', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, 0.5, 0.5), note(c, 62, 90, 1, 1), note(c, 64, 90, 2, 1), note(c, 67, 100, 3, 1)];
    const { motif, timing } = analyzeHiddenGridMotif(g, c);
    expect(timing.lengthBeats).toBe(4);
    expect(motif.lengthBeats).toBe(4);
    expect(motif.notes[0].onsetBeat).toBe(0);              // 切头 → 首音 = beat 0(禁止空拍)
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat); // 顺序保持
    for (const n of motif.notes) { const g16 = n.onsetBeat * 4; expect(Math.abs(g16 - Math.round(g16)), `onset@${n.onsetBeat}`).toBeLessThan(1e-6); } // 落 16 分
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

  it('★ 对拍(默认路径 · 2026-06-18 接 fit):骨干音落整数拍、经过音落 16 分、顺序保持、不越 brick', () => {
    const c = ctxOf({ desiredBars: 2 });
    // 想弹 2-bar:骨干(长)在 0/2/4/6,经过(短)穿插;弹得略不准
    const inB: [number, number][] = [[0, 1.9], [1.1, 0.4], [2.0, 1.9], [4.05, 1.9], [5.1, 0.4], [5.95, 1.9]];
    const g = inB.map(([on, du], i) => note(c, 60 + i, 90, on, du));
    const { motif } = analyzeHiddenGridMotif(g, c);
    expect(motif.notes[0].onsetBeat).toBe(0);                                                  // 切头 → beat0
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat); // 顺序保持
    for (const n of motif.notes) {
      const g16 = n.onsetBeat * 4;
      expect(Math.abs(g16 - Math.round(g16)), `onset@${n.onsetBeat} 落 16 分`).toBeLessThan(1e-6);
      expect(n.onsetBeat + n.durationBeat).toBeLessThanOrEqual(motif.lengthBeats + 1e-9);        // 不越 brick 末
    }
    // 长音(骨干)落到整数拍(对拍成立)
    const onInt = motif.notes.filter((n) => Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) < 1e-6).length;
    expect(onInt).toBeGreaterThanOrEqual(3);
  });

  it('★ Phase 2(directive 2026-06-19):首音落同 16 分格不被吞 — raw 60@.13/64@.18/67@.5/69@.75 → 4 音、首音=60@0', () => {
    const c = ctxOf({ desiredBars: 1 });
    // 0.13 与 0.18 都量化到 0.25(同格);旧版按 quantizedOnsetBeat 合并会吞掉 60 或 64
    const g = [note(c, 60, 100, 0.13, 0.25), note(c, 64, 95, 0.18, 0.25), note(c, 67, 90, 0.5, 0.25), note(c, 69, 90, 0.75, 0.25)];
    const { motif } = analyzeHiddenGridMotif(g, c);
    expect(motif.notes.length, '4 音都在(不吞)').toBe(4);
    expect(motif.notes[0].midi, '首音=用户真实第一音 60').toBe(60);
    expect(motif.notes[0].onsetBeat, '切头 → beat0').toBe(0);
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat);
  });

  it('★ 抢拍宽容 default(directive 2026-06-19):早进首音(cap-0.75)进 motif → 首音=60、切头 onset=0、leadingRest<0', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, -0.75, 0.5), note(c, 64, 95, 0, 0.5), note(c, 67, 90, 0.5, 0.5)];
    const { motif, timing } = analyzeHiddenGridMotif(g, c);
    expect(motif.notes.length).toBe(3);
    expect(motif.notes[0].midi).toBe(60);          // 早进首音保留为 motif 第一音
    expect(motif.notes[0].onsetBeat).toBe(0);       // 切头 → 0
    expect(timing.leadingRestBeats).toBeLessThan(0); // signed:抢进为负
    for (const n of motif.notes) expect(n.onsetBeat).toBeGreaterThanOrEqual(0); // 无负 onset
  });

  it('★ 抢拍宽容 too-early:cap-1.25(超 grace)被滤,首音=64', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, -1.25, 0.5), note(c, 64, 95, 0, 0.5)]; // -1.25 < -grace(1.0)→ 滤
    const { motif } = analyzeHiddenGridMotif(g, c);
    expect(motif.notes[0].midi).toBe(64);
    expect(motif.notes.every((n) => n.midi !== 60)).toBe(true);
  });

  it('★ 抢拍宽容 allowPickup:早进音不丢、无负 onset、递增、首音=60', () => {
    const c = ctxOf();
    const g = [note(c, 60, 100, -0.75, 0.5), note(c, 64, 95, -0.5, 0.5), note(c, 67, 90, 0, 0.5)];
    const { motif } = analyzeHiddenGridMotif(g, c, { allowPickup: true });
    expect(motif.notes.length).toBe(3);                                   // 不丢
    expect(motif.notes[0].midi).toBe(60);                                 // 首音=用户第一音
    for (const n of motif.notes) expect(n.onsetBeat).toBeGreaterThanOrEqual(0); // 无负 onset
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat);
  });

  it('★ Phase 2 边界(allowPickup=true,2026-06-19):同 16 分格不吞音 + 保前导休止(不切头)', () => {
    const c = ctxOf({ desiredBars: 1 });
    const g = [note(c, 60, 100, 0.13, 0.25), note(c, 64, 95, 0.18, 0.25), note(c, 67, 90, 0.5, 0.25), note(c, 69, 90, 0.75, 0.25)];
    const { motif } = analyzeHiddenGridMotif(g, c, { allowPickup: true });
    expect(motif.notes.length, 'pickup 也不吞 → 4 音').toBe(4);
    expect(motif.notes[0].midi, '首音=用户真实第一音 60').toBe(60);
    expect(motif.notes[0].onsetBeat, 'pickup 保前导休止 → 首音 0.25(非切头 0)').toBeCloseTo(0.25, 6);
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat);
  });

  it('★ Phase 2:密集(部分同量化格)不因 quantizedOnsetBeat 相同丢音 — onset 唯一递增', () => {
    const c = ctxOf({ desiredBars: 1 });
    const onsets = [0, 0.1, 0.22, 0.33, 0.45, 0.55, 0.7, 0.85]; // 相邻间隔均 > CHORD_EPS(0.04)→ 非和音,全保留
    const g = onsets.map((o, i) => note(c, 60 + i, 90, o, 0.12));
    const { motif } = analyzeHiddenGridMotif(g, c);
    expect(motif.notes.length, '密集音不被同格吞').toBe(onsets.length);
    for (let i = 1; i < motif.notes.length; i++) expect(motif.notes[i].onsetBeat).toBeGreaterThan(motif.notes[i - 1].onsetBeat);
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
