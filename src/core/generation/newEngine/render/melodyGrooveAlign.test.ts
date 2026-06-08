import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// 旋律 ↔ groove 对拍(2026-06-08):MG 链不再自带 swing(原 jazz/blues 摆到 0.67),
//   swing 交给 renderCoordinator.applySwing 对【全轨统一】施加 → 旋律与 comp/bass/drum 同摆同对拍。
//   验收:MG 链出来的旋律 onset 落在直拍 8/16 分格上(像 pop 一样),不再被双重摇摆推离网格。
// ============================================================

// 一次扫描返回 8 分格 / 16 分格离格率(避免重复渲染全曲旋律)。
function offGridRates(style: string, seeds: number): { off8: number; off16: number } {
  let off8 = 0, off16 = 0, tot = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
    const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
    const lead = renderMgMelody(plan, band, tb, createRandomContext(seed).substream('melody'));
    for (const n of lead.notes) {
      const b = (n.startTick as number) / tb.ppq;
      if (Math.abs(b - Math.round(b * 2) / 2) > 0.02) off8++;
      if (Math.abs(b - Math.round(b * 4) / 4) > 0.02) off16++;
      tot++;
    }
  }
  return { off8: tot ? off8 / tot : 0, off16: tot ? off16 / tot : 0 };
}

describe('render/melodyGrooveAlign · MG 链不双重 swing', () => {
  it('pop:旋律全在 8 分格(直拍)', () => {
    expect(offGridRates('pop', 15).off8).toBe(0);
  });

  it('jazz:直拍生成(无双重 swing 残留;原双摆 >50% 离 8 分格)→ 91%+ 在 16 分格', () => {
    const { off8, off16 } = offGridRates('jazz', 15);
    expect(off16).toBeLessThan(0.2);   // 残留=realizer 自然装饰
    expect(off8).toBeLessThan(0.35);   // 远低于双摆时的 0.56
  });
});
