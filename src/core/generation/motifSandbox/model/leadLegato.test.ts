import { describe, it, expect } from 'vitest';
import { buildLeadOnlyIr, buildSandboxIr } from './leadOnlyIr';
import { generateMotifWeave } from './motifWeaver';
import { generateSampleCaptured } from './motifAnalysis';
import { buildAccompaniment } from './accompaniment';
import { leadLegatoMetrics, connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from '../../newEngine/render/leadArticulation';
import type { MotifNote } from './types';

const weave = (style: 'jazz' | 'pop', seed: number) =>
  generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', seed % 4), style, keyPc: 0, mode: 'major', bpm: 96, seed });

describe('motifSandbox/leadOnlyIr · 快速 lead 连音 legato(CODEX directive §7.5 Q+R 回归)', () => {
  it('§7.5 jazz preview lead 快速线条触碰(≥0.8)+ 同音高无撞;legato 不动 start(swing 保住)', () => {
    const jazzOpts = fastLeadLegatoOptionsForStyle('jazz', 480);
    for (const seed of [1, 3, 7, 11]) {
      const r = weave('jazz', seed);
      const ir = buildLeadOnlyIr(r.lead, 120, 'jazz');
      const lead = ir.tracks.find((t) => t.role === 'lead')!;
      const m = leadLegatoMetrics(lead.notes, ir.timebase.ppq);
      if (m.fastPairs >= 3) expect(m.touchOrTinyGapRate, `seed${seed} 触碰率`).toBeGreaterThanOrEqual(0.8);
      expect(m.samePitchCollisionCount, `seed${seed} 同音撞`).toBe(0);
      // legato 只改 duration:再应用一遍不改 start(swing 在 start 里 → 被保住)
      const re = connectFastLeadNoteIR(lead.notes, jazzOpts);
      expect(re.map((n) => n.startTick)).toEqual(lead.notes.map((n) => n.startTick));
    }
  });

  it('§7.5 多轨 sandbox:lead legato 生效(同音撞=0);comp/bass 与 lead 独立轨、各自非空', () => {
    const r = weave('jazz', 3);
    const accomp = buildAccompaniment(r.progression, 'jazz', 3, r.lead);
    const multi = buildSandboxIr(r.lead, accomp, 120, 'jazz');
    const lead = multi.tracks.find((t) => t.role === 'lead')!;
    const comp = multi.tracks.find((t) => t.role === 'comp')!;
    const bass = multi.tracks.find((t) => t.role === 'bass')!;
    expect(leadLegatoMetrics(lead.notes, multi.timebase.ppq).samePitchCollisionCount).toBe(0);
    expect(comp.notes.length).toBeGreaterThan(0);
    expect(bass.notes.length).toBeGreaterThan(0);
    // ★ lead legato 不泄漏到伴奏:多轨里的 lead 轨 == 单轨 lead-only 的 lead 轨(同一 legato),
    //   而 comp/bass 走各自 toNoteIR(代码上只有 buildLeadNotes 接 legato)。
    const leadOnly = buildLeadOnlyIr(r.lead, 120, 'jazz').tracks[0];
    expect(lead.notes.map((n) => n.durationTicks)).toEqual(leadOnly.notes.map((n) => n.durationTicks));
  });

  it('§9.3 网格保护:jazz preview 的 16 分 run(0/.25/.5/.75/1)不被摆成挤压 — 无 IOI < ppq*0.12,连音仍触碰', () => {
    // 手搓一条全 16 分 lead(2 bar)
    const lead: MotifNote[] = Array.from({ length: 8 }, (_, i) => ({
      midi: 60 + (i % 4), onsetBeat: i * 0.25, durationBeat: 0.25, velocity: 0.8,
      scaleDegree: 1, octave: 5, accent: 0.5, structuralToneScore: 0.5,
    }));
    const ir = buildLeadOnlyIr(lead, 140, 'jazz');
    const notes = ir.tracks[0].notes;
    const ppq = ir.timebase.ppq;
    // 无相邻 IOI < ppq*0.12(挤压消失)
    const ns = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    let minGap = Infinity;
    for (let i = 1; i < ns.length; i++) minGap = Math.min(minGap, (ns[i].startTick as number) - (ns[i - 1].startTick as number));
    expect(minGap, 'jazz 16分 run 无 micro-IOI').toBeGreaterThanOrEqual(ppq * 0.12);
    expect(leadLegatoMetrics(notes, ppq).samePitchCollisionCount).toBe(0);
  });

  it('非 jazz(pop)preview lead 不被 legato 改:再跑 jazz legato 会改(证明 pop 没连过)', () => {
    const r = weave('pop', 5);
    const ir = buildLeadOnlyIr(r.lead, 100, 'pop');
    const lead = ir.tracks.find((t) => t.role === 'lead')!;
    const jazzOpts = fastLeadLegatoOptionsForStyle('jazz', ir.timebase.ppq);
    const relegato = connectFastLeadNoteIR(lead.notes, jazzOpts);
    const changed = relegato.some((n, i) => (n.durationTicks as number) !== (lead.notes[i].durationTicks as number));
    expect(changed, 'pop lead 未连音(故再连会变)').toBe(true);
  });
});
