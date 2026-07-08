import { describe, it, expect } from 'vitest';
import { renderAccompaniment, yieldUnderMelody, polyVelocity, pocketizeBeat } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, pc } from '../foundation';

describe('render/accompanimentRenderer (comp 织体,bass 见 bassRenderer)', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // C 大调 Cmaj7 - G7,各 1 小节
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });
  const tracks = renderAccompaniment(plan, timebase);
  const comp = tracks.find((t) => t.role === 'comp')!;

  it('只产出 comp 轨', () => {
    expect(tracks.map((t) => t.role)).toEqual(['comp']);
  });

  it('comp 用 chord-tone voicing,落 comp 区 [48,81],首拍皆 Cmaj7 音', () => {
    const cmaj7 = new Set([0, 4, 7, 11]); // C E G B(核心,无色彩)
    const firstChordComp = comp.notes.filter((n) => n.startTick === 0);
    expect(firstChordComp.length).toBeGreaterThan(0);
    for (const n of firstChordComp) expect(cmaj7.has(n.pitch % 12)).toBe(true);
    for (const n of comp.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThanOrEqual(81);
    }
  });

  it('★ 让位旋律:给 melodyFloorMidi=67 → comp 顶全部 < 67(转位/减法让位,不戳旋律保留区)', () => {
    const withCeil = renderAccompaniment(plan, timebase, { melodyFloorMidi: 67 }).find((t) => t.role === 'comp')!;
    expect(withCeil.notes.length).toBeGreaterThan(0);
    for (const n of withCeil.notes) expect(n.pitch).toBeLessThan(67);
    // 仍是真实和弦音(让位是转位/减法,不引入非和弦音)
    const cmaj7 = new Set([0, 4, 7, 11]);
    for (const n of withCeil.notes.filter((x) => x.startTick === 0)) expect(cmaj7.has(n.pitch % 12)).toBe(true);
  });

  it('★ yieldUnderMelody:≥ceiling 的声部转位下折到 ceiling 之下;低声部原样;不重复', () => {
    // C E G B + 高位 D6(86) → D6 折到 ceiling(74) 之下;floor=48
    const out = yieldUnderMelody([60, 64, 67, 71, 86], 74, 48);
    expect(Math.max(...out)).toBeLessThan(74);     // 顶在 ceiling 下
    expect(out).toContain(60); expect(out).toContain(64); // 核心声部留
    expect(new Set(out).size).toBe(out.length);    // 无重复(重复 → 减法)
    // 全部在 ceiling 之下、floor 之上
    for (const m of out) { expect(m).toBeLessThan(74); expect(m).toBeGreaterThanOrEqual(48); }
  });

  it('★ pocketizeBeat:小 lay-back 朝 8 分格收紧入袋;明显切分(>window)与 on-grid 不动', () => {
    expect(pocketizeBeat(0.15, 0.6)).toBeCloseTo(0.0225, 3); // ★ 强拍位(整拍0)锁紧:收 0.85 → 0.0225(与 bass/drum 锁拍)
    expect(pocketizeBeat(2.0, 0.6)).toBeCloseTo(2.0, 5);   // on-grid 不动
    expect(pocketizeBeat(0.25, 0.6)).toBeCloseTo(0.25, 5); // 离 8 分格 0.25 > window 0.18 → 切分保留
    expect(pocketizeBeat(0.66, 0.2)).toBeGreaterThan(0.6); // lofi 轻收(strength 0.2)→ 几乎保留 dusty
  });

  it('★ polyVelocity:单/双音不衰减,密块按 √(2/N) 衰减且单调递减', () => {
    expect(polyVelocity(100, 1)).toBe(100);
    expect(polyVelocity(100, 2)).toBe(100); // ≤2 不动
    expect(polyVelocity(100, 4)).toBeLessThan(100); // 密块衰减
    expect(polyVelocity(100, 7)).toBeLessThan(polyVelocity(100, 4)); // 越密越轻
    expect(polyVelocity(100, 8)).toBe(50); // √(2/8)=0.5
  });

});
