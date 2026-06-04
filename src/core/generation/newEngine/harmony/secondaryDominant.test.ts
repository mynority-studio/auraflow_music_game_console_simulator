import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, mod12, pc } from '../foundation';

describe('harmony · 副属 V7/X (3.2)', () => {
  const mkPlan = (style: string) => {
    const band = buildBandSpec({ seed: 5, styleHint: style, mood: 'x', targetDuration: 120, key: pc(0) });
    const arrangement = buildArrangementPlan(band);
    return buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));
  };

  it('★ jazz(colorBudget 高)→ 含副属 V7/X(secondaryTarget 标记)', () => {
    const plan = mkPlan('jazz');
    const sds = plan.romanProgression.filter((r) => r.secondaryTarget !== undefined);
    expect(sds.length).toBeGreaterThan(0);
    // 副属是属七
    for (const r of sds) expect(r.quality).toBe('7');
  });

  it('pop(colorBudget 低)→ 无副属', () => {
    const plan = mkPlan('pop');
    expect(plan.romanProgression.some((r) => r.secondaryTarget !== undefined)).toBe(false);
  });

  it('副属根音 = 目标根音上方五度;3 音离调(色彩)', () => {
    const plan = mkPlan('jazz');
    const majorPcs = new Set([0, 2, 4, 5, 7, 9, 11]);
    const idx = plan.romanProgression.findIndex((r) => r.secondaryTarget !== undefined);
    expect(idx).toBeGreaterThanOrEqual(0);
    const sd = plan.chordTimeline[idx];
    const target = plan.chordTimeline[idx + 1];
    expect(sd.rootPc).toBe(mod12(target.rootPc + 7)); // 上方五度
    // 属七 3 音(root+4)落在 C 大调外 = 离调色彩(如 D7 → F#)
    const sdThird = mod12(sd.rootPc + 4);
    expect(majorPcs.has(sdThird)).toBe(false);
  });

  it('确定性 + 排比不破:verse1 ≡ verse2', () => {
    const plan = mkPlan('jazz');
    const roots = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    expect(roots('verse1')).toEqual(roots('verse2'));
  });
});
