import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { isInScale } from './scale';
import { quotedAt } from './jazzinessAudit';
import { fitRange, identity } from './motifTransform';
import type { MotifWeaverInput } from './types';

const baseInput = (over: Partial<MotifWeaverInput> = {}): MotifWeaverInput => ({
  capturedNotes: generateSampleCaptured(96, 0, 'major', 0),
  style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, ...over,
});
const sig = (lead: { midi: number; onsetBeat: number }[]) => lead.map((n) => `${n.midi}@${n.onsetBeat.toFixed(2)}`).join(',');

describe('motifSandbox/motifWeaver(Impro-Visor 陈述 + 发展)', () => {
  it('16 小节进行;第一槽 head = 原样 motif', () => {
    const r = generateMotifWeave(baseInput());
    expect(r.totalBars).toBe(16);
    expect(r.progression.reduce((n, c) => n + c.durationBeats, 0)).toBe(64); // 覆盖 16 bar(模板可含半小节 beats)
    expect(r.audit.motifQuotedFirstCycle).toBe(true);
    const ref = fitRange(identity(r.motif.notes), 60, 84);
    expect(quotedAt(r.lead, ref, 0)).toBe(true);       // 第一槽 = 原样 motif
    expect(r.occurrences[0].kind).toBe('quote');
    expect(r.occurrences[0].label).toBe('head');
  });

  it('★ 排比:原样 motif 在每个和弦进行乐句的【同一相对位置】(乐句头)都出现', () => {
    for (let s = 1; s <= 12; s++) {
      const r = generateMotifWeave(baseInput({ seed: s }));
      const ref = fitRange(identity(r.motif.notes), 60, 84);
      const motifBeats = r.motif.lengthBeats;            // sample = 4 拍(1 bar)
      const phraseBeats = 16;                            // 乐句 = 4 bar
      // 每个乐句头(0,16,32,48)都应原样复现 motif
      for (let p = 0; p * phraseBeats < 64; p++) {
        expect(quotedAt(r.lead, ref, p * phraseBeats), `seed${s} 乐句${p}`).toBe(true);
      }
      // 应答区(乐句头 motif 之后)应有【发展】音,而非又一个原样复制
      expect(r.occurrences.some((o) => o.kind === 'develop'), `seed${s} 有应答发展`).toBe(true);
      expect(motifBeats).toBeLessThanOrEqual(phraseBeats);
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
      expect(r.audit.restRatio, `seed${s} rest`).toBeGreaterThan(0.05); // 真有空拍
      expect(r.audit.notesPerBar, `seed${s} 密度`).toBeLessThanOrEqual(8);
      if (r.lead.some((n) => n.occurrenceKind === 'connect')) sawConnect = true;
    }
    expect(sawConnect).toBe(true); // 概率上出现过连接/留白音
  });

  it('确定性:同 seed 同结果', () => {
    expect(sig(generateMotifWeave(baseInput({ seed: 11 })).lead)).toBe(sig(generateMotifWeave(baseInput({ seed: 11 })).lead));
  });

  it('POP/LOFI/RNB:chromaticRatio = 0(全 diatonic);jazziness < 0.4', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const r = generateMotifWeave(baseInput({ style }));
      expect(r.audit.chromaticRatio, style).toBe(0);
      for (const n of r.lead) expect(isInScale(n.midi, 0, 'major'), `${style} GM${n.midi}`).toBe(true);
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
    expect(r.roadmap?.melodicSlots.filter((s) => s.role === 'userBrick').map((s) => s.startBeat)).toEqual([0, 16, 32, 48]);
  });

  it('minor key 全在调内;1-4 bar motif 都不崩', () => {
    for (const lenVariant of [0, 1, 2, 3]) {
      const r = generateMotifWeave(baseInput({ capturedNotes: generateSampleCaptured(96, 9, 'minor', lenVariant), keyPc: 9, mode: 'minor' }));
      for (const n of r.lead) expect(isInScale(n.midi, 9, 'minor')).toBe(true);
      expect(r.lead.length).toBeGreaterThan(4);
    }
  });
});
