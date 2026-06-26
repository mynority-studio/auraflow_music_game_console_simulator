import { describe, it, expect } from 'vitest';
import { renderMgMelody } from './mgLeadRenderer';
import { feelFromGrooveContract } from './mgStyleRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, pc } from '../foundation';

// ============================================================
// MG 升级 Phase 1c — lead 消费 GrooveContract.melodySwingRatio(零洗牌门控)
// ------------------------------------------------------------
// 锁两条结构事实:
//   ① 非 ACG contract → renderMgMelody 门控回退 feelForStyle(style) = 现状(忽略 contract → 零洗牌)。
//   ② ACG contract → lead 真用 contract.melodySwingRatio(swing 0.5 vs 0.72 → 音符 timing 不同 = 接线生效)。
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

describe('render/grooveContractFeel(MG 升级 Phase 1c)', () => {
  it('★ feelFromGrooveContract 桥:melodySwingRatio→swingRatio、articulation/accent 直传', () => {
    const f = feelFromGrooveContract(contract('ACG', 0.66));
    expect(f.swingRatio).toBe(0.66);
    expect(f.articulation).toBe('bebop');
    expect(f.accentPattern).toEqual([1.0, 0.85, 1.05, 0.85]);
  });

  it('★ 非 ACG contract 被门控忽略 → 与【无 contract】字节一致(零洗牌)', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb']) {
      const { band, plan, timebase } = setup(style, 7);
      const base = renderMgMelody(plan, band, timebase, 7, undefined);
      // 传一个 swing 极端跑偏(0.78)的非 ACG contract:门控必须忽略它。
      const withLegacy = renderMgMelody(plan, band, timebase, 7, undefined, contract('POP', 0.78));
      expect(ser(withLegacy), `${style} 非 ACG 门控`).toBe(ser(base));
    }
  });

  it('★ ACG contract:lead 真消费 melodySwingRatio(0.5 直 vs 0.72 摆 → 不同)', () => {
    const { band, plan, timebase } = setup('jazz', 7);
    const straight = renderMgMelody(plan, band, timebase, 7, undefined, contract('ACG', 0.5));
    const swung = renderMgMelody(plan, band, timebase, 7, undefined, contract('ACG', 0.72));
    expect(ser(swung)).not.toBe(ser(straight)); // swing 真改 timing
  });
});
