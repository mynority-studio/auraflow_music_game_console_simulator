import { describe, it, expect } from 'vitest';
import { renderMgMelody } from './mgLeadRenderer';
import { feelFromGrooveContract } from './mgStyleRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, pc } from '../foundation';

// ============================================================
// MG full-parity Phase D(directive 3.2,推翻 Phase 1c 零洗牌门控)— lead 消费 GrooveContract.melodySwingRatio
// ------------------------------------------------------------
// 锁两条结构事实:
//   ① 任意风格 contract → renderMgMelody 都用 feelFromGrooveContract(contract)(门控已撤,全 MG-backed 真消费)。
//   ② contract.melodySwingRatio 改变 → lead 音符 timing 不同(swing 真改 timing = 接线生效)。
// ============================================================

function setup(style: string, seed: number) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: arrangement.meter });
  return { band, plan, timebase };
}
const ser = (t: { notes: { pitch: number; startTick: number; durationTicks: number; velocity: number }[] }) =>
  t.notes.map((n) => `${n.pitch}@${n.startTick}:${n.durationTicks}:${n.velocity}`).join('|');
const contract = (style: string, melodySwingRatio: number) =>
  ({ style, melodySwingRatio, articulation: 'bebop' as const, accentPattern: [1.0, 0.85, 1.05, 0.85] });

describe('render/grooveContractFeel(MG full-parity Phase D)', () => {
  it('★ feelFromGrooveContract 桥:melodySwingRatio→swingRatio、articulation/accent 直传', () => {
    const f = feelFromGrooveContract(contract('ACG', 0.66));
    expect(f.swingRatio).toBe(0.66);
    expect(f.articulation).toBe('bebop');
    expect(f.accentPattern).toEqual([1.0, 0.85, 1.05, 0.85]);
  });

  it('★ Phase D:全风格 lead 真消费注入 contract 的 melodySwingRatio(0.5 直 vs 0.72 摆 → timing 不同)', () => {
    // directive 3.2 验收:注入只在 melodySwingRatio 上不同的两条 contract → lead 真改(门控已撤,非 ACG 也消费)。
    let sawDiff = false;
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      const { band, plan, timebase } = setup(style, 7);
      const straight = renderMgMelody(plan, band, timebase, 7, undefined, contract('POP', 0.5));
      const swung = renderMgMelody(plan, band, timebase, 7, undefined, contract('POP', 0.72));
      if (ser(swung) !== ser(straight)) sawDiff = true;
    }
    expect(sawDiff, '注入 melodySwingRatio 改变 → 至少一个风格 lead timing 改变').toBe(true);
  });

  it('★ Phase D:lead 用注入 contract 的 feel,而非 feelForStyle 回退(极端 swing 0.78 contract ≠ 无 contract)', () => {
    // 门控撤除后:传 contract → 走 feelFromGrooveContract;不传 → feelForStyle。极端 swing 0.78 必与回退不同。
    let sawDiff = false;
    for (const style of ['pop', 'lofi', 'rnb']) { // 直拍风格 feelForStyle≈0.5,与 0.78 必不同
      const { band, plan, timebase } = setup(style, 7);
      const base = renderMgMelody(plan, band, timebase, 7, undefined);
      const withContract = renderMgMelody(plan, band, timebase, 7, undefined, contract('POP', 0.78));
      if (ser(withContract) !== ser(base)) sawDiff = true;
    }
    expect(sawDiff, '注入 contract 覆盖 feelForStyle 回退(至少一个直拍风格改变)').toBe(true);
  });
});
