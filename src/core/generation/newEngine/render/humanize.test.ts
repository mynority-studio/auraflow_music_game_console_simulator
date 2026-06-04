import { describe, it, expect } from 'vitest';
import { metricAccentScale, humanizeVelocity, humanizeTiming } from './humanize';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, ticks, midi, pc } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const PPQ = 480;
const note = (tick: number, vel = 80, pitch = 60) => ({
  pitch: midi(pitch),
  startTick: ticks(tick),
  durationTicks: ticks(120),
  velocity: vel,
});

describe('render · 人性化力度/微时序 (5.3)', () => {
  it('metricAccentScale:强拍 > 次强 > 其它正拍 > 反拍', () => {
    const down = metricAccentScale(0, 4);
    const mid = metricAccentScale(2, 4);
    const other = metricAccentScale(1, 4);
    const off = metricAccentScale(0.5, 4);
    expect(down).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(off);
  });

  it('★ humanizeVelocity:同力度同音反复 → 力度不再完全一致(非网格);强拍均值 > 反拍均值', () => {
    const rng = createRandomContext(1).substream('humanize');
    const track: TrackIR = {
      role: 'comp',
      notes: [
        note(0), note(480), note(960), note(1440), // 强拍(每小节首,beat 0)
        note(240), note(720), note(1200), note(1680), // 反拍(beat 0.5)
      ],
    };
    const out = humanizeVelocity([track], PPQ, 4, rng)[0];
    const vels = out.notes.map((n) => n.velocity);
    expect(new Set(vels).size).toBeGreaterThan(1); // 非完全网格
    const downAvg = (vels[0] + vels[1] + vels[2] + vels[3]) / 4;
    const offAvg = (vels[4] + vels[5] + vels[6] + vels[7]) / 4;
    expect(downAvg).toBeGreaterThan(offAvg); // 强拍重于反拍
  });

  it('humanizeVelocity:鼓轨跳过(保 groove,力度原样)', () => {
    const rng = createRandomContext(1).substream('humanize');
    const drum: TrackIR = { role: 'drum', notes: [note(0, 100), note(240, 70)] };
    const out = humanizeVelocity([drum], PPQ, 4, rng)[0];
    expect(out.notes.map((n) => n.velocity)).toEqual([100, 70]);
  });

  it('★ humanizeTiming:起音偏离网格但有界;clamp ≥0', () => {
    const rng = createRandomContext(2).substream('humanize');
    const max = Math.max(2, Math.round(PPQ * 0.015));
    const track: TrackIR = { role: 'lead', notes: [note(0), note(480), note(960), note(1440)] };
    const out = humanizeTiming([track], PPQ, rng)[0];
    const onsets = out.notes.map((n) => n.startTick as number);
    expect(onsets.some((t, i) => t !== [0, 480, 960, 1440][i])).toBe(true); // 至少一个被抖
    for (let i = 0; i < onsets.length; i++) {
      expect(Math.abs(onsets[i] - [0, 480, 960, 1440][i])).toBeLessThanOrEqual(max); // 有界
      expect(onsets[i]).toBeGreaterThanOrEqual(0); // clamp
    }
  });

  it('确定性:同 seed 两次 humanize 完全一致', () => {
    const mk = () => {
      const rng = createRandomContext(9).substream('humanize');
      const t: TrackIR = { role: 'comp', notes: [note(0), note(240), note(480)] };
      const v = humanizeVelocity([t], PPQ, 4, rng);
      return humanizeTiming(v, PPQ, rng);
    };
    expect(mk()).toEqual(mk());
  });

  it('★ 端到端确定性:同 seed 两次 generateSong → IR 逐音一致(含人性化)', () => {
    const req = { seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) };
    const a = generateSong(req);
    const b = generateSong(req);
    expect(a.status).not.toBe('failed');
    expect(a.ir!.tracks).toEqual(b.ir!.tracks);
  });
});
