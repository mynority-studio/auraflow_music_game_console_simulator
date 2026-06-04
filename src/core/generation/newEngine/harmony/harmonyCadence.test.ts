import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, mod12, pc } from '../foundation';

describe('harmony · 终止式 (3.4)', () => {
  const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));

  const sectionIds = [...new Set(plan.chordTimeline.map((c) => c.sectionId))];

  it('★ 每段以 V7-I authentic 终止收尾', () => {
    for (const sid of sectionIds) {
      const chords = plan.chordTimeline.filter((c) => c.sectionId === sid);
      const last = chords[chords.length - 1];
      const secondLast = chords[chords.length - 2];
      expect(last.rootPc).toBe(0); // I = 主音(key=C=0)
      expect(secondLast.rootPc).toBe(mod12(0 + 7)); // V = G = 7
      expect(secondLast.quality).toBe('7'); // 属七
    }
  });

  it('功能时间线段尾 D-T(V→I)', () => {
    for (const sid of sectionIds) {
      const idx = plan.chordTimeline.map((c, i) => ({ c, i })).filter((x) => x.c.sectionId === sid).map((x) => x.i);
      const lastI = idx[idx.length - 1];
      expect(plan.chordFunctionTimeline[lastI]).toBe('T');
      expect(plan.chordFunctionTimeline[lastI - 1]).toBe('D');
    }
  });

  it('排比不破:verse1 ≡ verse2(含终止)', () => {
    const roots = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    expect(roots('verse1')).toEqual(roots('verse2'));
  });
});
