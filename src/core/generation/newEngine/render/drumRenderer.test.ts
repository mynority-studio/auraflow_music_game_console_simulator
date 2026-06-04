import { describe, it, expect } from 'vitest';
import { renderDrums } from './drumRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/drumRenderer', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // 2 小节
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });
  const drum = renderDrums(plan, timebase, 4);

  it('产出 drum 轨,非空', () => {
    expect(drum.role).toBe('drum');
    expect(drum.notes.length).toBeGreaterThan(0);
  });

  it('含 kick(36)/snare(38)/hat(42)', () => {
    const pitches = new Set<number>(drum.notes.map((n) => n.pitch));
    expect(pitches.has(36)).toBe(true);
    expect(pitches.has(38)).toBe(true);
    expect(pitches.has(42)).toBe(true);
  });

  it('kick 落拍1/3:每小节 2 个 kick', () => {
    const kicks = drum.notes.filter((n) => n.pitch === 36);
    expect(kicks.length).toBe(2 * 2); // 2 bars × 2 kicks
    expect(kicks.map((k) => k.startTick).sort((a, b) => a - b)).toEqual([0, 960, 1920, 2880]); // 拍0/2,ppq480
  });

  it('确定性:同输入 → 同节拍', () => {
    const again = renderDrums(plan, timebase, 4);
    expect(again.notes.map((n) => n.startTick)).toEqual(drum.notes.map((n) => n.startTick));
  });

  it('per-style:jazz 有 ride(51);pop 有 backbeat snare(38)', () => {
    const jazz = renderDrums(plan, timebase, 4, { style: 'jazz' });
    expect(new Set<number>(jazz.notes.map((n) => n.pitch)).has(51)).toBe(true);
    const pop = renderDrums(plan, timebase, 4, { style: 'pop' });
    expect(new Set<number>(pop.notes.map((n) => n.pitch)).has(38)).toBe(true);
  });

  it('力度人性化:相邻小节力度序列不完全相同', () => {
    const velOf = (lo: number, hi: number) => drum.notes.filter((n) => n.startTick >= lo && n.startTick < hi).map((n) => n.velocity);
    expect(velOf(0, 1920)).not.toEqual(velOf(1920, 3840)); // bar0 vs bar1
  });

  it('段落 fill:fillBar 比普通小节音多', () => {
    const withFill = renderDrums(plan, timebase, 4, { fillBars: new Set([0]) });
    const bar0 = withFill.notes.filter((n) => n.startTick < 1920).length;
    const bar1 = withFill.notes.filter((n) => n.startTick >= 1920 && n.startTick < 3840).length;
    expect(bar0).toBeGreaterThan(bar1);
  });
});
