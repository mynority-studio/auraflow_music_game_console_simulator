import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, pc } from '../foundation';

describe('harmony · 借和弦 (3.3)', () => {
  const mkPlan = (style: string) => {
    const band = buildBandSpec({ seed: 5, styleHint: style, mood: 'x', targetDuration: 120, key: pc(0) });
    const arrangement = buildArrangementPlan(band);
    return buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));
  };

  it('★ pop(colorBudget≥0.3,大调)→ IV 借为小调 iv(Fm7)+ borrowedChordMap 标记', () => {
    const plan = mkPlan('pop');
    const borrowedIds = Object.keys(plan.borrowedChordMap);
    expect(borrowedIds.length).toBeGreaterThan(0);
    for (const id of borrowedIds) {
      const c = plan.chordTimeline.find((x) => x.id === id)!;
      expect(c.rootPc).toBe(5); // IV = F = 5
      expect(c.quality).toBe('m7'); // 借为小调 iv
      expect(plan.borrowedChordMap[id]).toEqual({ from: 'parallel-minor', label: 'iv' });
    }
  });

  it('iv 含离调音(Ab=8 / Eb=3,非 C 大调)', () => {
    const plan = mkPlan('pop');
    const id = Object.keys(plan.borrowedChordMap)[0];
    const ivPcs = new Set(plan.stableToneMap[id]); // Fm7 = F Ab C Eb
    expect(ivPcs.has(8 as never)).toBe(true); // Ab 离调
    expect(ivPcs.has(3 as never)).toBe(true); // Eb 离调
  });

  it('确定性 + 排比不破:verse1 ≡ verse2', () => {
    const plan = mkPlan('pop');
    const roots = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => `${c.rootPc}-${c.quality}`);
    expect(roots('verse1')).toEqual(roots('verse2'));
  });
});
