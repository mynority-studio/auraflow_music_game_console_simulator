import { describe, it, expect } from 'vitest';
import { renderBass } from './bassRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/bassRenderer (1.2)', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // Cmaj7 - Am7 - Dm7 - G7,各 1 小节
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 6, quality: 'm7', bars: 1 },
      { degree: 2, quality: 'm7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });

  it('jazz:walking — 每和弦逐拍多音(非纯根音)', () => {
    const bass = renderBass(plan, timebase, 'jazz');
    expect(bass.notes.length).toBeGreaterThan(plan.chordTimeline.length); // 逐拍 > 和弦数
    // 第一和弦内出现 >1 个不同音(走动)
    const firstBarPitches = new Set(bass.notes.filter((n) => n.startTick < 1920).map((n) => n.pitch));
    expect(firstBarPitches.size).toBeGreaterThan(1);
  });

  it('pop:根-五交替 — 比和弦数多(逐拍)', () => {
    const bass = renderBass(plan, timebase, 'pop');
    expect(bass.notes.length).toBeGreaterThan(plan.chordTimeline.length);
  });

  it('lofi/default:根音持续 — 每和弦至少 1 音', () => {
    const lofi = renderBass(plan, timebase, 'lofi');
    const def = renderBass(plan, timebase, 'default');
    expect(def.notes.length).toBe(plan.chordTimeline.length); // default 纯根音
    expect(lofi.notes.length).toBeGreaterThanOrEqual(def.notes.length); // lofi 加五度铺垫
  });

  it('全落 bass 音区 [28,55]=E1–G3,确定性', () => {
    const bass = renderBass(plan, timebase, 'jazz');
    for (const n of bass.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(28); // E1
      expect(n.pitch).toBeLessThanOrEqual(55);    // G3
    }
    const again = renderBass(plan, timebase, 'jazz');
    expect(again.notes.map((n) => n.pitch)).toEqual(bass.notes.map((n) => n.pitch));
  });

  it('★ 音区不再单八度死锁:跨度 > 12(有八度起伏),重心落 C2–G2', () => {
    const bass = renderBass(plan, timebase, 'jazz');
    const ps = bass.notes.map((n) => n.pitch as number);
    expect(Math.max(...ps) - Math.min(...ps)).toBeGreaterThan(12); // 不再压在一个八度
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
    expect(mean).toBeGreaterThanOrEqual(33); // 重心 ~C2–G2(不飘高、不沉底)
    expect(mean).toBeLessThanOrEqual(47);
  });
});
