import { describe, it, expect } from 'vitest';
import { renderStyleFeel, feelForStyle } from './mgStyleRenderer';
import { isInProtectedFastRun, shouldSwingAsEighthOffbeat, beatFracOf } from './leadGridTiming';
import { generateSong } from '../generation/GenerationController';
import { leadLegatoMetrics } from './leadArticulation';
import type { MgNoteEvent } from './mgMelodyRealizer';

const jazz = feelForStyle('JAZZ'); // swingRatio 0.67, bebop
const evs = (times: number[], dur = 0.25): MgNoteEvent[] =>
  times.map((t) => ({ time: t, duration: dur, noteNumber: 60, velocity: 80, part: 'melody' }) as MgNoteEvent);
const feelTimes = (times: number[], protect = true): number[] =>
  renderStyleFeel({ events: evs(times), feel: jazz, protectFastRuns: protect }).map((e) => e.time);
const minIoi = (ts: number[]): number => {
  const s = [...ts].sort((a, b) => a - b);
  let m = Infinity;
  for (let i = 1; i < s.length; i++) m = Math.min(m, s[i] - s[i - 1]);
  return m;
};

describe('render/leadGridTiming · 快速线条网格所有者(CODEX directive 2026-06-19)', () => {
  it('§9.1 case A:普通八分仍摆动 — [0, .5, 1] → [0, .67, 1]', () => {
    const t = feelTimes([0, 0.5, 1.0]);
    expect(t[0]).toBeCloseTo(0, 5);
    expect(t[1]).toBeCloseTo(0.67, 2);   // .5 → 摆动
    expect(t[2]).toBeCloseTo(1.0, 5);
  });

  it('§9.1 case B:连续 16 分 run 被保护 — [0,.25,.5,.75,1] 笔直,.5 不变 .67,无 micro-IOI', () => {
    const t = feelTimes([0, 0.25, 0.5, 0.75, 1.0]);
    expect(t).toEqual([0, 0.25, 0.5, 0.75, 1.0]); // 全笔直
    expect(t[2]).toBeCloseTo(0.5, 5);             // .5 没被推到 .67
    expect(minIoi(t)).toBeGreaterThanOrEqual(0.12);
  });

  it('§9.1 case C:三连音原样不变 — [0,.333,.667,1]', () => {
    const t = feelTimes([0, 1 / 3, 2 / 3, 1.0]);
    expect(t[0]).toBeCloseTo(0, 5);
    expect(t[1]).toBeCloseTo(1 / 3, 3);
    expect(t[2]).toBeCloseTo(2 / 3, 3);
    expect(t[3]).toBeCloseTo(1.0, 5);
  });

  it('§9.1 case D:局部挤压被阻止 — [28,28.25,28.5,28.75,29] 无 28.67 micro-IOI', () => {
    const t = feelTimes([28, 28.25, 28.5, 28.75, 29]);
    expect(t[2]).toBeCloseTo(28.5, 5);  // .5 不被摆到 28.67
    expect(minIoi(t)).toBeGreaterThanOrEqual(0.12);
  });

  it('protectFastRuns=false(默认/oracle):旧严格行为 — 16 分 run 的 .5 仍被摆动(parity 保留)', () => {
    const t = feelTimes([0, 0.25, 0.5, 0.75, 1.0], false);
    expect(t[2]).toBeCloseTo(0.67, 2); // 旧行为:.5 → .67(挤压)
  });

  it('决策函数:isInProtectedFastRun / shouldSwingAsEighthOffbeat', () => {
    const run = evs([0, 0.25, 0.5, 0.75, 1.0]);
    expect(isInProtectedFastRun(run, 2)).toBe(true);                       // 16 分 run 中点
    expect(shouldSwingAsEighthOffbeat(run, 2, 0.67)).toBe(false);          // → 不摆
    const eighths = evs([0, 0.5, 1.0]);
    expect(shouldSwingAsEighthOffbeat(eighths, 1, 0.67)).toBe(true);       // 真八分反拍 → 摆
    expect(shouldSwingAsEighthOffbeat(eighths, 1, 0.5)).toBe(false);       // 直 → 不摆
    expect(beatFracOf(28.5, 4)).toBeCloseTo(0.5, 6);
  });

  it('§9.2 整合:seed 564417 jazz lead microIoiCount=0、无 .5→.67 挤压、连音仍好', () => {
    const song = generateSong({ seed: 564417, styleHint: 'jazz', mood: 'build', targetDuration: 120 });
    const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
    const ppq = song.ir!.timebase.ppq;
    const m = leadLegatoMetrics(lead.notes, ppq);
    expect(m.microIoiCount, 'seed564417 microIoi').toBe(0);               // ★ 0.08 挤压消失
    if (m.fastPairs >= 3) expect(m.touchOrTinyGapRate).toBeGreaterThanOrEqual(0.8); // 连音仍好
    expect(m.samePitchCollisionCount).toBe(0);
    // 无相邻 IOI < ppq*0.12
    const ns = [...lead.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    let minGap = Infinity;
    for (let i = 1; i < ns.length; i++) minGap = Math.min(minGap, (ns[i].startTick as number) - (ns[i - 1].startTick as number));
    expect(minGap, 'min adjacent IOI ticks').toBeGreaterThanOrEqual(ppq * 0.12);
  });
});
