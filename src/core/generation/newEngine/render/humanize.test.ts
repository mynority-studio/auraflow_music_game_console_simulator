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
    // 反拍(beat 1.5/2.5/3.5)= 全幅抖动,确保"至少一个被抖"
    const track: TrackIR = { role: 'comp', notes: [note(0), note(720), note(1200), note(1680)] };
    const grid = [0, 720, 1200, 1680];
    const out = humanizeTiming([track], PPQ, 4, rng)[0];
    const onsets = out.notes.map((n) => n.startTick as number);
    expect(onsets.some((t, i) => t !== grid[i])).toBe(true); // 至少一个被抖
    for (let i = 0; i < onsets.length; i++) {
      expect(Math.abs(onsets[i] - grid[i])).toBeLessThanOrEqual(max); // 有界
      expect(onsets[i]).toBeGreaterThanOrEqual(0); // clamp
    }
  });

  it('★ Loop 9:lead 跳过全局力度/时序人性化(保 MG StyleRenderer 纯净)', () => {
    const rng = createRandomContext(2).substream('humanize');
    const lead: TrackIR = { role: 'lead', notes: [note(0, 100), note(720, 100), note(1200, 100)] };
    const vOut = humanizeVelocity([lead], PPQ, 4, rng)[0];
    expect(vOut.notes.map((n) => n.velocity)).toEqual([100, 100, 100]); // 力度不被改
    const tOut = humanizeTiming([lead], PPQ, 4, rng)[0];
    expect(tOut.notes.map((n) => n.startTick)).toEqual([0, 720, 1200]); // 时序不被抖
  });

  it('★ 槽位共享:同 tick 的多声部拿同一偏移 → 一起移动(对拍/复调不被打散)', () => {
    const rng = createRandomContext(4).substream('humanize');
    // bass 根音 + kick + comp 都落在反拍 tick 720(全幅抖,最容易暴露分散)
    const bass: TrackIR = { role: 'bass', notes: [note(720, 90, 36)] };
    const drum: TrackIR = { role: 'drum', notes: [note(720, 100, 36)] };
    const comp: TrackIR = { role: 'comp', notes: [note(720, 70, 60)] };
    const out = humanizeTiming([bass, drum, comp], PPQ, 4, rng);
    const t0 = out[0].notes[0].startTick as number;
    expect(out[1].notes[0].startTick).toBe(t0); // kick 与 bass 同步移动
    expect(out[2].notes[0].startTick).toBe(t0); // comp 与 bass 同步移动
  });

  it('★ 重心锚定:下拍位移幅度 ≪ 反拍(下拍稳、off-beat 才松)', () => {
    const downTrack: TrackIR = { role: 'comp', notes: Array.from({ length: 16 }, (_, i) => note(i * 1920)) }; // 各小节下拍
    const offTrack: TrackIR = { role: 'comp', notes: Array.from({ length: 16 }, (_, i) => note(i * 1920 + 720)) }; // 各小节反拍
    const down = humanizeTiming([downTrack], PPQ, 4, createRandomContext(11).substream('humanize'))[0];
    const off = humanizeTiming([offTrack], PPQ, 4, createRandomContext(11).substream('humanize'))[0];
    const dev = (out: TrackIR, grid: (n: number) => number) =>
      out.notes.reduce((s, n, i) => s + Math.abs((n.startTick as number) - grid(i)), 0) / out.notes.length;
    const downDev = dev(down, (i) => i * 1920);
    const offDev = dev(off, (i) => i * 1920 + 720);
    expect(downDev).toBeLessThan(offDev); // 下拍平均位移 < 反拍 → 重心稳
  });

  it('确定性:同 seed 两次 humanize 完全一致', () => {
    const mk = () => {
      const rng = createRandomContext(9).substream('humanize');
      const t: TrackIR = { role: 'comp', notes: [note(0), note(240), note(480)] };
      const v = humanizeVelocity([t], PPQ, 4, rng);
      return humanizeTiming(v, PPQ, 4, rng);
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

  // ★ Loop F:结构锚点不做负向 jitter(段落下拍不被拉到上一段)
  it('anchor 槽位:有 anchor → downbeat 不被负偏(>= 锚点);无 anchor → 会有负偏', () => {
    const ANCHOR = 1920; // 某段落起始下拍
    let minWith = Infinity, minWithout = Infinity;
    for (let seed = 0; seed < 60; seed++) {
      const mk = (): TrackIR[] => [{ role: 'bass', notes: [note(ANCHOR, 80, 40)] }];
      const withA = humanizeTiming(mk(), PPQ, 4, createRandomContext(seed).substream('humanize'), undefined, new Set([ANCHOR]));
      const without = humanizeTiming(mk(), PPQ, 4, createRandomContext(seed).substream('humanize'), undefined, new Set());
      minWith = Math.min(minWith, withA[0].notes[0].startTick as number);
      minWithout = Math.min(minWithout, without[0].notes[0].startTick as number);
    }
    expect(minWith).toBeGreaterThanOrEqual(ANCHOR);  // anchor → 永不早于下拍
    expect(minWithout).toBeLessThan(ANCHOR);          // 无 anchor → 存在负偏(证明 clamp 真起作用)
  });

  it('anchor 不冻结普通 offbeat:非锚点反拍仍能 humanize', () => {
    const OFF = 240; // 反拍 8 分(frac=0.5)
    const ticksSeen = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const t: TrackIR[] = [{ role: 'comp', notes: [note(OFF)] }];
      const out = humanizeTiming(t, PPQ, 4, createRandomContext(seed).substream('humanize'), undefined, new Set([1920]));
      ticksSeen.add(out[0].notes[0].startTick as number);
    }
    expect(ticksSeen.size).toBeGreaterThan(1); // offbeat 仍被抖动(非锚点不受保护)
  });
});
