// ============================================================
// newEngine · render · 键盘 comp voice 宽和弦色彩 / 测试
// ------------------------------------------------------------
// 锁用户决策 A(按乐器):键盘族 comp → voice 宽和弦色彩(9/13);非键盘 → 核心(色彩归旋律)。
// + 乐器类型/音域元数据 + 超域色彩交旋律(range guard)。
// ============================================================

import { describe, expect, it } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { instrumentInfo, isKeyboardFamily } from '../knowledge/instruments';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';

describe('乐器类型 + 音域元数据', () => {
  it('键盘族(0/1/2/4/5/8)→ keyboard;木琴/bass 非键盘', () => {
    for (const p of [0, 1, 2, 4, 5, 8]) expect(isKeyboardFamily(p)).toBe(true);
    for (const p of [11, 12, 32, 89]) expect(isKeyboardFamily(p)).toBe(false);
    expect(isKeyboardFamily(undefined)).toBe(false);
  });
  it('音域:钢琴宽 / 颤音琴窄', () => {
    expect(instrumentInfo(0).range).toEqual([21, 108]);
    expect(instrumentInfo(11).range).toEqual([53, 89]);
  });
});

// 找一个含 maj9 的 plan(★ POP 已对齐 MG 三和弦纯度→无 maj9;改用 LOFI,它保留延伸色彩)
function planWithMaj9() {
  for (let seed = 0; seed < 16; seed++) {
    const band = buildBandSpec({ seed, styleHint: 'lofi', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(seed));
    const maj9 = plan.chordTimeline.find((c) => c.chordType === 'maj9');
    if (maj9) return { plan, maj9 };
  }
  throw new Error('no maj9 found');
}

describe('键盘 comp voice 色彩', () => {
  const { plan, maj9 } = planWithMaj9();
  const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 100 }] });
  const ninthPc = (maj9.rootPc as number + 2) % 12;
  const lo = tb.beatToTick(maj9.startBeat) as number;
  const hi = lo + (tb.beatToTick(maj9.durationBeats) as number);
  const compNinths = (program: number) => {
    const tracks = renderAccompaniment(plan, tb, { style: 'lofi', compProgram: program });
    const comp = tracks[0].notes.filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
    return comp.filter((n) => (n.pitch as number) % 12 === ninthPc).length;
  };

  it('钢琴 comp(GM 0)→ maj9 的 9 出现在 comp 轨(色彩发声)', () => {
    expect(compNinths(0)).toBeGreaterThan(0);
  });

  it('颤音琴 comp(GM 11,非键盘)→ 不 voice 9(色彩归旋律)', () => {
    expect(compNinths(11)).toBe(0);
  });
});
