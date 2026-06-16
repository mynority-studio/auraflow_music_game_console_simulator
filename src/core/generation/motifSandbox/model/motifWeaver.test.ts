import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
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

  it('★ Phase1 无固定锚:24 bar 曲 quote 落点来自动态乐句头(0..80),非硬编 0/16/32/48', () => {
    const r = generateMotifWeave(baseInput({ form: defaultSandboxForm(24) }));
    const ref = fitRange(identity(r.motif.notes), 60, 84);
    // 24 bar = 6 乐句 → 乐句头 0,16,32,48,64,80 都应有原样复现(超出旧 16-bar 的 48)
    for (const head of [0, 16, 32, 48, 64, 80]) {
      expect(quotedAt(r.lead, ref, head), `乐句头@${head}`).toBe(true);
    }
    // 没有任何 lead 音越界(全在 96 拍内)
    expect(r.lead.every((n) => n.onsetBeat < 96)).toBe(true);
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
    expect(r.roadmap?.melodicSlots.filter((s) => s.role === 'userBrick').map((s) => s.startBeat)).toEqual([0, 16, 32, 48]);
  });

  it('minor key 全在调内;1-4 bar motif 都不崩', () => {
    for (const lenVariant of [0, 1, 2, 3]) {
      const r = generateMotifWeave(baseInput({ capturedNotes: generateSampleCaptured(96, 9, 'minor', lenVariant), keyPc: 9, mode: 'minor' }));
      expect(r.audit.unjustifiedChromatic).toBe(0); // 离调音都由真实和声/quote 证成
      expect(r.lead.length).toBeGreaterThan(4);
    }
  });
});
