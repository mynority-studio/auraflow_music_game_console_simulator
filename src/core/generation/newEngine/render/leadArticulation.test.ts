import { describe, it, expect } from 'vitest';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle, leadLegatoMetrics } from './leadArticulation';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { midi, ticks, createTimebase, createRandomContext, beats } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const PPQ = 480;
const n = (pitch: number, startTick: number, durationTicks: number, velocity = 85): NoteIR =>
  ({ pitch: midi(pitch), startTick: ticks(startTick), durationTicks: ticks(durationTicks), velocity });
const jazzOpts = fastLeadLegatoOptionsForStyle('JAZZ', PPQ);

describe('render/leadArticulation · 快速 lead 连音 legato(CODEX directive 2026-06-18)', () => {
  it('§7.1 快速音触碰:相邻快速音延到下一起音,pitch/start 不变', () => {
    // 0.00/dur0.30, 0.667/dur0.20, 1.00/dur0.30(ppq480)
    const out = connectFastLeadNoteIR([n(60, 0, 144), n(62, 320, 96), n(64, 480, 144)], jazzOpts);
    expect(out[0].durationTicks).toBe(320);   // 延到 note2 起音(~0.667 拍)
    expect(out[1].durationTicks).toBe(160);   // 延到 note3 起音(~0.333 拍)
    expect(out[2].durationTicks).toBe(144);   // 末音不动
    expect(out.map((x) => x.pitch)).toEqual([60, 62, 64]);             // pitch 不变
    expect(out.map((x) => x.startTick)).toEqual([0, 320, 480]);        // start 不变
    expect(out.length).toBe(3);                                        // 数量不变
  });

  it('§7.2 同音高安全:连音后【首音尾 ≤ 次音头 − 1 tick】(防 noteOff 撞掉 noteOn)', () => {
    const out = connectFastLeadNoteIR([n(60, 0, 240), n(60, 240, 240)], jazzOpts);
    expect((out[0].startTick as number) + (out[0].durationTicks as number)).toBeLessThanOrEqual(240 - 1);
    expect(out[0].pitch).toBe(60);
  });

  it('§7.3 乐句断点保留:IOI > 0.75 拍不连音', () => {
    const out = connectFastLeadNoteIR([n(60, 0, 144), n(62, 720, 144)], jazzOpts); // IOI 720 > 360
    expect(out[0].durationTicks).toBe(144); // 不被延到 720
  });

  it('非 jazz 风格 enabled=false → 原样返回(durationTicks 全不变)', () => {
    const src = [n(60, 0, 144), n(62, 320, 96), n(64, 480, 144)];
    const popOpts = fastLeadLegatoOptionsForStyle('POP', PPQ);
    expect(popOpts.enabled).toBe(false);
    const out = connectFastLeadNoteIR(src, popOpts);
    expect(out.map((x) => x.durationTicks)).toEqual(src.map((x) => x.durationTicks));
  });

  it('blues 也启用;jazz 默认参数符合 directive §4', () => {
    expect(fastLeadLegatoOptionsForStyle('BLUES', PPQ).enabled).toBe(true);
    expect(jazzOpts.maxConnectIoiTicks).toBe(Math.round(PPQ * 0.75));
    expect(jazzOpts.samePitchGapTicks).toBe(1);
  });

  // §7.4 Q+N 回归:jazz 成曲 lead 快速线条触碰、无同音高撞、articulation 高;非 jazz 不变
  it('§7.4 Q+N:jazz generateSong lead 快速线条 legato(触碰率≥0.8 · art 中位≥0.97 · 同音撞=0)', () => {
    for (const seed of [3, 7, 13]) {
      const song = generateSong({ seed, styleHint: 'jazz', mood: 'build', targetDuration: 120 });
      const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
      const m = leadLegatoMetrics(lead.notes, song.ir!.timebase.ppq);
      if (m.fastPairs >= 3) { // 有足够快速线条才度量
        expect(m.touchOrTinyGapRate, `seed${seed} 触碰率`).toBeGreaterThanOrEqual(0.8);
        expect(m.medianFastArticulation, `seed${seed} art`).toBeGreaterThanOrEqual(0.97);
      }
      expect(m.samePitchCollisionCount, `seed${seed} 同音撞`).toBe(0);
    }
  });

  it('§7.4 默认非 jazz generateSong lead 不被 legato 改(pop/lofi/rnb 风格 enabled=false)', () => {
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      expect(fastLeadLegatoOptionsForStyle(style.toUpperCase(), 480).enabled).toBe(false);
      // 端到端不抛 + lead 存在(legato no-op 不破坏非 jazz 链)
      const song = generateSong({ seed: 5, styleHint: style, mood: 'build', targetDuration: 96 });
      expect(song.status).not.toBe('failed');
    }
  });

  // 走 A:override(motif)lead 也接 legato —— renderCoordinator 末步安全闸对【所有 lead 轨】生效(不分 MG/override)。
  function setup(seed: number, style: string) {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
    const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
    const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
    return { band, arr, instr, plan, tb };
  }
  // 故意 staccato 的快速 lead(dur 60 << IOI 240)→ jazz 应被连起来,pop 不连
  const staccatoOverride = (): TrackIR => ({
    role: 'lead',
    notes: Array.from({ length: 16 }, (_, i) => ({ pitch: midi(72 + (i % 2) * 2), startTick: ticks(i * 240), durationTicks: ticks(60), velocity: 90 })),
  });

  it('★ 走 A:override(motif)lead 也接 legato — jazz 连起来(触碰率≥0.8)、pop 不连(staccato 留空)', () => {
    const ov = staccatoOverride();
    const j = setup(3, 'jazz');
    const jLead = renderSongFull(j.band, j.arr, j.plan, j.instr, j.tb, createRandomContext(3), undefined, ov).ir.tracks.find((t) => t.role === 'lead')!;
    const jm = leadLegatoMetrics(jLead.notes, j.tb.ppq);
    const p = setup(3, 'pop');
    const pLead = renderSongFull(p.band, p.arr, p.plan, p.instr, p.tb, createRandomContext(3), undefined, ov).ir.tracks.find((t) => t.role === 'lead')!;
    const pm = leadLegatoMetrics(pLead.notes, p.tb.ppq);
    expect(jm.touchOrTinyGapRate, 'jazz override 连起来').toBeGreaterThanOrEqual(0.8);
    expect(pm.touchOrTinyGapRate, 'pop override 不连(staccato)').toBeLessThan(0.5);
    expect(jm.touchOrTinyGapRate, 'jazz 比 pop 更连').toBeGreaterThan(pm.touchOrTinyGapRate);
    expect(jm.samePitchCollisionCount, 'jazz override 同音撞=0').toBe(0);
  });
});
