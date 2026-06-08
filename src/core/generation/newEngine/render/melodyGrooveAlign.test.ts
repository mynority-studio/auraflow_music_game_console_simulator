import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { applySwing } from './swing';
import { createTimebase, createRandomContext, beats, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

// ============================================================
// 旋律 timing 单一所有权(Loop A,2026-06-08 校正):
//   lead 的 swing owner = MG StyleRenderer(renderMgMelody 内 feelForStyle);
//   applySwing【跳过 lead】(swing.ts) → 不二次作用 → 不会双重 swing。
//   伴奏 owner = arranger feel + 全局 applySwing。
//   ⚠️ 之前误把 MG swing 压成 0.5,导致 jazz lead 直、伴奏摆 → 错位;此测试锁住"lead 自带 MG swing"。
// ============================================================

function rawLead(style: string, seeds: number) {
  let off8 = 0, nearSwung = 0, tot = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
    const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
    const lead = renderMgMelody(plan, band, tb, createRandomContext(seed).substream('melody'));
    for (const n of lead.notes) {
      const b = (n.startTick as number) / tb.ppq; const frac = b - Math.floor(b); tot++;
      if (Math.abs(frac - Math.round(frac * 2) / 2) > 0.02) off8++; // 距【最近 8 分格】(含下拍 frac=0)
      if (Math.abs(frac - 0.66) < 0.06) nearSwung++; // 落在 MG swing 后位
    }
  }
  return { off8: tot ? off8 / tot : 0, nearSwung: tot ? nearSwung / tot : 0 };
}

describe('render/melodyGrooveAlign · lead timing 单一所有权', () => {
  it('pop:lead 直拍(MG feel 0.5)→ onset 全在 8 分格,无摆动后位', () => {
    const { off8, nearSwung } = rawLead('pop', 15);
    expect(off8).toBe(0);
    expect(nearSwung).toBe(0);
  });

  it('jazz:lead 自带 MG swing(摆动后位 0.66 有显著占比)→ 不是被压直', () => {
    const { nearSwung } = rawLead('jazz', 15);
    expect(nearSwung).toBeGreaterThan(0.1); // 有真摆动(若被压成 0.5 → ≈0)
  });

  it('applySwing 不二次作用于 lead(单一所有权):lead 轨 onset 原样返回', () => {
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: 60 as never, startTick: ticks(240), durationTicks: ticks(240), velocity: 80 }] }; // 反拍 8 分(0.5 拍)
    const comp: TrackIR = { role: 'comp', notes: [{ pitch: 60 as never, startTick: ticks(240), durationTicks: ticks(240), velocity: 80 }] };
    const [outLead, outComp] = applySwing([lead, comp], 480, 0.66);
    expect(outLead.notes[0].startTick).toBe(240);                 // lead 跳过 swing → 不变
    expect(outComp.notes[0].startTick as number).toBeGreaterThan(240); // comp 被 swing 后移
  });
});
