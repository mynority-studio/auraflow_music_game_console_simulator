import { describe, it, expect } from 'vitest';
import { feelForStyle } from './mgStyleRenderer';
import { renderMgMelody } from './mgLeadRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, pc } from '../foundation';

// ============================================================
// MG 升级 Phase 2c(part 1)— ACG 旋律 grammar(复用 LOFI)+ feel(ballad/直拍)
// ============================================================

describe('render/acgMelodyFeel(MG 升级 Phase 2c)', () => {
  it('★ feelForStyle(ACG) = 直拍 0.5 + ballad 连奏(电影钢琴 cantabile)', () => {
    const f = feelForStyle('acg');
    expect(f.swingRatio).toBe(0.5);          // 直拍(rubato 走 pocket,非 swing)
    expect(f.articulation).toBe('ballad');
    expect(f.accentPattern).toHaveLength(4);
  });

  it('★ 非 ACG feel 不变(POP/JAZZ 回归)', () => {
    expect(feelForStyle('jazz').swingRatio).toBe(0.67);
    expect(feelForStyle('pop').swingRatio).toBe(0.5);
    expect(feelForStyle('pop').articulation).toBe('legato');
  });

  it('★ ACG 旋律生成非空 + 音域合理(LOFI grammar + preserveSlope 链不崩)', () => {
    for (const seed of [7, 42]) {
      const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
      const timebase = createTimebase({ meter: arrangement.meter });
      const lead = renderMgMelody(plan, band, timebase, seed);
      expect(lead.notes.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const n of lead.notes) { expect(n.pitch).toBeGreaterThanOrEqual(48); expect(n.pitch).toBeLessThanOrEqual(96); }
    }
  });

  it('★ ACG 旋律确定性(同 seed 两次一致)', () => {
    const gen = () => {
      const band = buildBandSpec({ seed: 11, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(11) });
      const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(11));
      const timebase = createTimebase({ meter: arrangement.meter });
      return renderMgMelody(plan, band, timebase, 11).notes.map((n) => `${n.pitch}@${n.startTick}`).join('|');
    };
    expect(gen()).toBe(gen());
  });
});
