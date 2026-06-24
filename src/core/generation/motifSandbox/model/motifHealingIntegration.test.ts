import { describe, it, expect } from 'vitest';
import { generateMotifWeave } from './motifWeaver';
import { analyzeAndNormalize, generateSampleCaptured } from './motifAnalysis';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from '../../newEngine/render/leadArticulation';
import { midi, ticks } from '../../newEngine/foundation';
import type { NoteIR } from '../../newEngine/ir/MusicalIR';

describe('motifSandbox/healing 集成(Phase 1)', () => {
  it('★ BPM snapshot:playbackBpm = input.bpm(非 motif.bpm 捕获时钟)', () => {
    // 预分析的 motif 带 bpm=100;generate 用 input.bpm=140 → playbackBpm 取 140(generation snapshot)
    const motif = analyzeAndNormalize(generateSampleCaptured(100, 0, 'major', 0), 0, 'major', 100, 0).motif;
    expect(motif.bpm).toBe(100); // capture 元数据保留
    const r = generateMotifWeave({ capturedNotes: [], motif, style: 'pop', keyPc: 0, mode: 'major', bpm: 140, seed: 7 });
    expect(r.playbackBpm).toBe(140); // ★ = input.bpm,不是 motif.bpm
    expect(r.audit.captureBpmUsedForTimingOnly).toBe(true);
  });

  it('★ 治愈审计计数挂上(articulationGapsHealed / intentionalRepeatStaccatoCount)', () => {
    const r = generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 0), style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7 });
    expect(typeof r.audit.articulationGapsHealed).toBe('number');
    expect(typeof r.audit.intentionalRepeatStaccatoCount).toBe('number');
  });

  it('★ healingMode off:不补不锁(motif 音保持原时值数量)', () => {
    const cap = generateSampleCaptured(96, 0, 'major', 0);
    const on = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, healingMode: 'beginner' });
    const off = generateMotifWeave({ capturedNotes: cap, style: 'pop', keyPc: 0, mode: 'major', bpm: 96, seed: 7, healingMode: 'off' });
    expect(off.audit.articulationGapsHealed).toBe(0);
    expect(off.audit.intentionalRepeatStaccatoCount).toBe(0);
    expect(on.lead.length).toBe(off.lead.length); // healing 不改数量
  });

  it('★ render legato 不连接同音重复断奏(jazz/blues)', () => {
    // 同音 G 三连击(IOI 0.5 拍 = 快速对,旧逻辑会连)→ 现在不延长,保 staccato
    const ppq = 480;
    const note = (p: number, startBeat: number, durBeat: number): NoteIR => ({ pitch: midi(p), startTick: ticks(startBeat * ppq), durationTicks: ticks(durBeat * ppq), velocity: 90 });
    const run = [note(67, 0, 0.2), note(67, 0.5, 0.2), note(67, 1, 0.2), note(72, 1.5, 0.4)];
    const out = connectFastLeadNoteIR(run, fastLeadLegatoOptionsForStyle('jazz', ppq));
    // 【下一个是同音 G】的 0/1 不被延长(保 staccato);out[2]→不同音 C 可正常连音(乐句过渡,非同音连接)
    expect((out[0].durationTicks as number), 'G0 不连同音').toBeLessThanOrEqual(0.2 * ppq + 1);
    expect((out[1].durationTicks as number), 'G1 不连同音').toBeLessThanOrEqual(0.2 * ppq + 1);
    expect((out[2].durationTicks as number), 'G2→C 不同音可连').toBeGreaterThan(0.2 * ppq + 1);
  });
});
