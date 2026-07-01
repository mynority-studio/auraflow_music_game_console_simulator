import { describe, it, expect } from 'vitest';
import { ticks, midi } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { generateSong } from '../generation/GenerationController';
import { applyRenderMixBalance, leadCompWetEnergyRatio } from './renderMixBalance';

const ctx = (style: string, durationTicks: number, sectionTicks: number[] = [0]) => ({
  style,
  ppq: 480,
  durationTicks,
  sectionTicks,
});

describe('render/renderMixBalance — render 后处理混音', () => {
  it('只改 TrackMix 音量,不改音符/program/声像/空间', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 4,
        mix: { volume: 95, pan: 64, reverb: 45, chorus: 48 },
        notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }],
      },
      {
        role: 'comp',
        program: 4,
        mix: { volume: 89, pan: 52, reverb: 43, chorus: 58 },
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(67), startTick: ticks(960), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(71), startTick: ticks(960), durationTicks: ticks(960), velocity: 100 },
        ],
      },
    ];
    const beforeNotes = tracks.map((t) => t.notes);
    const beforePrograms = tracks.map((t) => t.program);
    const beforeRatio = leadCompWetEnergyRatio(tracks, ctx('rnb', durationTicks));
    const out = applyRenderMixBalance(tracks, ctx('rnb', durationTicks));
    const afterRatio = leadCompWetEnergyRatio(out, ctx('rnb', durationTicks));

    expect(out.map((t) => t.notes)).toEqual(beforeNotes);
    expect(out.map((t) => t.program)).toEqual(beforePrograms);
    expect(out.find((t) => t.role === 'lead')!.mix!.pan).toBe(64);
    expect(out.find((t) => t.role === 'comp')!.mix!.chorus).toBe(58);
    expect(afterRatio).toBeGreaterThan(beforeRatio);
  });

  it('代表 macro seed 的 lead/comp 有效响度落在可预览+可移植区间', () => {
    const cases = [
      { style: 'pop', seed: 7, lo: 0.80, hi: 1.60 },
      { style: 'jazz', seed: 7, lo: 0.95, hi: 1.65 },
      { style: 'lofi', seed: 7, lo: 0.75, hi: 1.45 },
      { style: 'rnb', seed: 7, lo: 0.75, hi: 1.35 },
      { style: 'acg', seed: 7, lo: 0.65, hi: 1.60 }, // ★ P1:normalizeAcgDynamics 恢复 MG pp-comp(vel~30)→ lead 合理更前置(melody-first ACG),放宽上界
    ];

    for (const c of cases) {
      const r = generateSong({ seed: c.seed, styleHint: c.style, mood: 'build', targetDuration: 90 });
      expect(r.ir, `${c.style}/${c.seed} no IR`).toBeTruthy();
      const ratio = leadCompWetEnergyRatio(r.ir!.tracks as TrackIR[], ctx(c.style, r.ir!.durationTicks as number));
      expect(ratio, `${c.style}/${c.seed} ratio`).toBeGreaterThanOrEqual(c.lo);
      expect(ratio, `${c.style}/${c.seed} ratio`).toBeLessThanOrEqual(c.hi);
    }
  });

  it('RNB seed=7 不再出现 comp 长 roll 压住 lead 的失衡', () => {
    const r = generateSong({ seed: 7, styleHint: 'rnb', mood: 'build', targetDuration: 90 });
    const ratio = leadCompWetEnergyRatio(r.ir!.tracks as TrackIR[], ctx('rnb', r.ir!.durationTicks as number));
    const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
    const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;

    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.35);
    expect(lead.mix!.volume).toBeGreaterThan(comp.mix!.volume);
  });

  it('melodic roles 不把 CC7 推到 ESP32/浏览器容易炸的高位', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      for (const seed of [0, 1, 7, 11, 42]) {
        const r = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        expect(r.ir, `${style}/${seed} no IR`).toBeTruthy();
        for (const t of r.ir!.tracks) {
          if (t.role === 'drum' || t.role === 'bass' || t.role === 'pad') continue;
          const vols = [t.mix?.volume, ...(t.mixChanges ?? []).map((m) => m.mix.volume)].filter((v): v is number => typeof v === 'number');
          for (const v of vols) expect(v, `${style}/${seed}/${t.role}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
