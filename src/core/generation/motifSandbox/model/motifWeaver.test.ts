import { describe, it, expect } from 'vitest';
import { generateMotifWeave, renderMelodicSlot } from './motifWeaver';
import type { MelodicSlot, MelodicSlotFunction, UserMotifPolicy } from './melodicBrickTypes';
import { generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import { quotedAt } from './jazzinessAudit';
import { fitRange, identity } from './motifTransform';
import { chordAtBeat, effectiveTonePcs } from './chords';
import { defaultSandboxForm, type MotifWeaverInput } from './types';

const baseInput = (over: Partial<MotifWeaverInput> = {}): MotifWeaverInput => ({
  capturedNotes: generateSampleCaptured(96, 0, 'major', 0),
  style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, ...over,
});
const sig = (lead: { midi: number; onsetBeat: number }[]) => lead.map((n) => `${n.midi}@${n.onsetBeat.toFixed(2)}`).join(',');
// slot-plan 的 quote slot 起点(motif 原样落点;非固定 0/16/32/48)
const quoteStarts = (r: ReturnType<typeof generateMotifWeave>): number[] =>
  r.melodicSlotPlan!.userQuoteSlotIds.map((id) => r.melodicSlotPlan!.slots.find((s) => s.id === id)!.startBeat).sort((a, b) => a - b);

describe('motifSandbox/motifWeaver(Impro-Visor 陈述 + 发展)', () => {
  it('16 小节进行;motif 原样落在 plan 的 quote slot(slot-plan 驱动)', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.totalBars).toBe(16);
    expect(r.progression.reduce((n, c) => n + c.durationBeats, 0)).toBe(64); // 覆盖 16 bar(模板可含半小节 beats)
    expect(r.audit.motifQuotedFirstCycle).toBe(true);  // 第一个 quote slot = 原样 motif
    const ref = fitRange(identity(r.motif.notes), 60, 84);
    const qs = quoteStarts(r);
    expect(qs.length).toBeGreaterThanOrEqual(1);
    for (const b of qs) expect(quotedAt(r.lead, ref, b), `quote@${b}`).toBe(true); // motif 原样落在每个 quote slot
    expect(r.occurrences.some((o) => o.kind === 'quote')).toBe(true);
  });

  it('★ Phase5 renderMelodicSlot:mustQuote 原样 / mustDevelop 变形 / generatedOnly 跟和声(§8)', () => {
    const r = generateMotifWeave(baseInput());
    const motif = r.motif, prog = r.progression, brick = r.brick!;
    const mkSlot = (policy: UserMotifPolicy, fn: MelodicSlotFunction, start = 0, dur = 8): MelodicSlot =>
      ({ id: `s@${start}`, roadmapBrickId: 'b', startBeat: start, durationBeats: dur, requiredFunction: fn, userMotifPolicy: policy, lineage: {}, reason: '' });
    const common = { userMotif: motif, userBrick: brick, progression: prog, previousNotes: [] as never[], seed: 7, keyPc: 0, mode: 'major' as const };
    const base = fitRange(identity(motif.notes), 60, 84);
    // mustQuote → 槽以【原样陈述】开头(首音 quote = base 首音),陈述后槽内继续发展填充(不留死寂)
    const q = renderMelodicSlot({ slot: mkSlot('mustQuote', 'opening'), ...common });
    expect(q.notes.length).toBeGreaterThan(0);
    expect(q.notes[0].occurrenceKind).toBe('quote');
    expect(q.notes[0].midi).toBe(base[0].midi);
    expect(q.notes.some((n) => n.occurrenceKind === 'quote')).toBe(true);
    // mustDevelop → 变形(occurrenceKind=develop)
    const d = renderMelodicSlot({ slot: mkSlot('mustDevelop', 'approach'), ...common });
    expect(d.notes.length).toBeGreaterThan(0);
    expect(d.notes.every((n) => n.occurrenceKind === 'develop')).toBe(true);
    // generatedOnly → 连接(occurrenceKind=connect)且每音【跟和声】(当拍和弦音 或 调内,不乱离调)
    const g = renderMelodicSlot({ slot: mkSlot('generatedOnly', 'cadence'), ...common });
    expect(g.notes.length).toBeGreaterThan(0);
    expect(g.notes.every((n) => n.occurrenceKind === 'connect')).toBe(true);
    for (const n of g.notes) {
      const pc = ((n.midi % 12) + 12) % 12;
      const ok = isInScale(n.midi, 0, 'major') || effectiveTonePcs(chordAtBeat(prog, n.onsetBeat)).includes(pc);
      expect(ok, `gen GM${n.midi}@${n.onsetBeat}`).toBe(true);
    }
  });

  it('★ Gap4:generatedOnly 按 requiredFunction 生成不同行为(opening 升序建立 / cadence 解决到和弦音)', () => {
    const r = generateMotifWeave(baseInput());
    const motif = r.motif, prog = r.progression, brick = r.brick!;
    const mkSlot = (fn: MelodicSlotFunction): MelodicSlot => ({ id: `g-${fn}`, roadmapBrickId: 'b', startBeat: 0, durationBeats: 4, requiredFunction: fn, userMotifPolicy: 'generatedOnly', lineage: {}, reason: '' });
    const common = { userMotif: motif, userBrick: brick, progression: prog, previousNotes: [] as never[], seed: 7, keyPc: 0, mode: 'major' as const };
    const op = renderMelodicSlot({ slot: mkSlot('opening'), ...common }).notes;
    const cad = renderMelodicSlot({ slot: mkSlot('cadence'), ...common }).notes;
    const cont = renderMelodicSlot({ slot: mkSlot('continuation'), ...common }).notes;
    // 不同功能 → 不同音符序列(不再一律 placeConnect)
    expect(op.map((n) => `${n.midi}@${n.onsetBeat}`).join()).not.toBe(cad.map((n) => `${n.midi}@${n.onsetBeat}`).join());
    expect(op.map((n) => n.midi).join()).not.toBe(cont.map((n) => n.midi).join());
    // opening = 升序(琶音建立调性)
    expect(op.length).toBeGreaterThanOrEqual(2);
    expect(op[op.length - 1].midi).toBeGreaterThan(op[0].midi);
    // cadence = 末音落当拍和弦音(解决)、时值更长
    const land = cad[cad.length - 1];
    expect(effectiveTonePcs(chordAtBeat(prog, land.onsetBeat)).includes(((land.midi % 12) + 12) % 12)).toBe(true);
    expect(land.durationBeat).toBeGreaterThanOrEqual(cad[0].durationBeat);
  });

  it('★ Phase4:weaver result 带 melodicSlotPlan(RoadMap 驱动,≥1 quote slot,每 slot 有 roadmapBrickId)', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.melodicSlotPlan).toBeDefined();
    const plan = r.melodicSlotPlan!;
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.slots.every((s) => s.roadmapBrickId)).toBe(true);
    expect(plan.userQuoteSlotIds.length).toBeGreaterThanOrEqual(1);
    // quote 落点来自 RoadMap slot(brickSlots 的 startBeat),非硬编锚点
    const brickStarts = new Set(r.roadmap!.brickSlots.map((b) => b.startBeat));
    for (const id of plan.userQuoteSlotIds) expect(brickStarts.has(plan.slots.find((s) => s.id === id)!.startBeat)).toBe(true);
  });

  it('★ Phase1 动态曲长:8 bar → progressionBeats=32;24 bar → 96(无需改代码,form context 驱动)', () => {
    const r8 = generateMotifWeave(baseInput({ form: defaultSandboxForm(8) }));
    expect(r8.totalBars).toBe(8);
    expect(r8.progressionBeats).toBe(32);
    const r24 = generateMotifWeave(baseInput({ form: defaultSandboxForm(24) }));
    expect(r24.totalBars).toBe(24);
    expect(r24.progressionBeats).toBe(96);
    // 默认(不传 form)= 16 bar
    expect(generateMotifWeave(baseInput()).progressionBeats).toBe(64);
  });

  it('★ 无固定锚:24 bar 曲 quote 落点来自 RoadMap slot(非硬编 0/16/32/48),lead 不越界', () => {
    const r = generateMotifWeave(baseInput({ form: defaultSandboxForm(24) }));
    const ref = fitRange(identity(r.motif.notes), 60, 84);
    const qs = quoteStarts(r);
    expect(qs.length).toBeGreaterThanOrEqual(1);
    for (const b of qs) expect(quotedAt(r.lead, ref, b), `quote@${b}`).toBe(true);   // motif 落 plan slot
    const brickStarts = new Set(r.roadmap!.brickSlots.map((b) => b.startBeat));
    for (const b of qs) expect(brickStarts.has(b), `quote@${b} 来自 RoadMap brick`).toBe(true); // 来自 RoadMap,非固定锚
    expect(r.lead.every((n) => n.onsetBeat < 96)).toBe(true);
  });

  it('★ 排比(结构性复现):motif 原样落在 plan 所有 quote slot;有发展', () => {
    for (let s = 1; s <= 12; s++) {
      const r = generateMotifWeave(baseInput({ seed: s }));
      const ref = fitRange(identity(r.motif.notes), 60, 84);
      const qs = quoteStarts(r);
      expect(qs.length, `seed${s} ≥1 quote`).toBeGreaterThanOrEqual(1);
      for (const b of qs) expect(quotedAt(r.lead, ref, b), `seed${s} quote@${b}`).toBe(true); // 结构等价 brick 上再现
      expect(r.occurrences.some((o) => o.kind === 'develop'), `seed${s} 有发展`).toBe(true);
    }
  });

  it('★ 动机不丢:motif 永远在曲首(beat0)原样陈述(回归:slot-plan 纯功能落位会让动机不在开头)', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        for (const variant of [0, 1, 2, 3]) {
          const r = generateMotifWeave(baseInput({ style, seed, capturedNotes: generateSampleCaptured(96, 0, 'major', variant) }));
          const ref = fitRange(identity(r.motif.notes), 60, 84).filter((n) => n.onsetBeat < r.quoteBars * 4 - 1e-6);
          expect(quotedAt(r.lead, ref, 0), `${style} seed${seed} v${variant} 曲首陈述`).toBe(true);
        }
      }
    }
  });

  it('★ 真有发展(不是复制):≥2 种发展手法 + 含 develop 槽,且变体音与原样不同', () => {
    for (let s = 1; s <= 20; s++) {
      const r = generateMotifWeave(baseInput({ seed: s }));
      expect(r.audit.developVariants, `seed${s}`).toBeGreaterThanOrEqual(2);
      expect(r.occurrences.some((o) => o.kind === 'develop'), `seed${s}`).toBe(true);
      // develop 槽产出的音确实出现(否则只剩复制)
      expect(r.lead.some((n) => n.occurrenceKind === 'develop'), `seed${s}`).toBe(true);
    }
  });

  it('★ 透气(不再太密):有留白 + 整体密度受控 + 存在连接槽', () => {
    let sawConnect = false;
    for (let s = 1; s <= 20; s++) {
      const r = generateMotifWeave(baseInput({ seed: s }));
      expect(r.audit.restRatio, `seed${s} rest`).toBeGreaterThan(0.03); // 真有空拍(slot 填充后更连续,留白下限放宽)
      expect(r.audit.notesPerBar, `seed${s} 密度`).toBeLessThanOrEqual(8);
      if (r.lead.some((n) => n.occurrenceKind === 'connect')) sawConnect = true;
    }
    expect(sawConnect).toBe(true); // 概率上出现过连接/留白音
  });

  it('确定性:同 seed 同结果', () => {
    expect(sig(generateMotifWeave(baseInput({ seed: 11 })).lead)).toBe(sig(generateMotifWeave(baseInput({ seed: 11 })).lead));
  });

  it('POP/LOFI/RNB:无【不证成】离调音(离调必须是真实和声音 / 用户 quote);jazziness < 0.4', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const r = generateMotifWeave(baseInput({ style }));
      expect(r.audit.unjustifiedChromatic, style).toBe(0); // 续写的色彩音都由选中模板真实和声证成
      for (const n of r.lead) { // 每音:调内 / quote / 当拍真实和声音 之一
        const ok = isInScale(n.midi, 0, 'major') || n.occurrenceKind === 'quote'
          || (effectiveTonePcs(chordAtBeat(r.progression, n.onsetBeat)).includes(((n.midi % 12) + 12) % 12));
        expect(ok, `${style} GM${n.midi}@${n.onsetBeat}`).toBe(true);
      }
      expect(r.audit.jazzinessScore, style).toBeLessThan(0.4);
    }
  });

  it('音符排序 + 时值非负', () => {
    const r = generateMotifWeave(baseInput());
    const sorted = [...r.lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
    expect(r.lead.map((n) => n.onsetBeat)).toEqual(sorted.map((n) => n.onsetBeat));
    for (const n of r.lead) expect(n.durationBeat).toBeGreaterThan(0);
  });

  it('★ 续写旋律线平滑:相邻跳进 ≤ 小六度(8 半音),音域 ≤ 十二度内(作曲原则)', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const r = generateMotifWeave(baseInput({ style, seed }));
        const lead = [...r.lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
        let maxLeap = 0;
        for (let i = 1; i < lead.length; i++) maxLeap = Math.max(maxLeap, Math.abs(lead[i].midi - lead[i - 1].midi));
        expect(maxLeap, `${style} seed${seed} 跳进`).toBeLessThanOrEqual(8);
        const range = Math.max(...lead.map((n) => n.midi)) - Math.min(...lead.map((n) => n.midi));
        expect(range, `${style} seed${seed} 音域`).toBeLessThanOrEqual(19);
      }
    }
  });

  it('覆盖 16 小节:lead 铺到曲尾(末音 onset 落在后段)', () => {
    const r = generateMotifWeave(baseInput());
    const lastOnset = Math.max(...r.lead.map((n) => n.onsetBeat));
    expect(lastOnset, '末音应落在后段(≥ 第 13 小节)').toBeGreaterThanOrEqual(48);
    expect(lastOnset).toBeLessThan(64);
  });

  it('★ brick 驱动和声:模板路径 + 保真实和声(realRoman/realTonePcs)+ 真 RoadMap bricks', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.harmonySource).toBe('template');        // 走模板,不静默兜底
    expect(r.harmonyError).toBeUndefined();
    expect(r.selectedProgression?.prototypeId).toBeTruthy();
    for (const c of r.progression) { expect(c.realRoman).toBeTruthy(); expect(c.realTonePcs?.length).toBeGreaterThanOrEqual(2); } // 真和弦数据保留
    expect((r.roadmap?.harmonicBricks?.length ?? 0)).toBeGreaterThan(0); // parseRoadMap 出真 bricks
    expect((r.roadmap?.brickSlots.length ?? 0)).toBeGreaterThan(0);       // 规范化 brickSlots(取代固定锚点)
    expect(r.melodicSlotPlan?.userQuoteSlotIds.length).toBeGreaterThanOrEqual(1); // motif 落点来自 RoadMap slot
  });

  it('minor key 全在调内;1-4 bar motif 都不崩', () => {
    for (const lenVariant of [0, 1, 2, 3]) {
      const r = generateMotifWeave(baseInput({ capturedNotes: generateSampleCaptured(96, 9, 'minor', lenVariant), keyPc: 9, mode: 'minor' }));
      expect(r.audit.unjustifiedChromatic).toBe(0); // 离调音都由真实和声/quote 证成
      expect(r.lead.length).toBeGreaterThan(4);
    }
  });
});
