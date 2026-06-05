import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, pc } from '../foundation';

describe('harmony · 终止式 (3.4)', () => {
  const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));

  const sectionIds = [...new Set(plan.chordTimeline.map((c) => c.sectionId))];

  // ★ Loop 2(prototype 即真理):终止/收尾由 prototype 自带,不再强制 V7-I。
  //   旧"每段强制 V7-I authentic"已退役(prototype 收尾多样:loop/soft/I 6-9/V sus 等)。
  it('prototype 驱动:和弦携带宽 chordType(maj9/m9/add9 等色彩),段落非空', () => {
    const types = new Set(plan.chordTimeline.map((c) => c.chordType));
    expect([...types].some((t) => ['maj9', 'm9', 'm11', 'add9', '9sus4', '7sus4', '13sus4', '6/9'].includes(t ?? ''))).toBe(true);
    for (const sid of sectionIds) {
      expect(plan.chordTimeline.filter((c) => c.sectionId === sid).length).toBeGreaterThan(0);
    }
  });

  it('功能时间线每项合法(T/S/D)', () => {
    for (const f of plan.chordFunctionTimeline) expect(['T', 'S', 'D']).toContain(f);
  });

  it('排比不破:verse1 ≡ verse2(含终止)', () => {
    const roots = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    expect(roots('verse1')).toEqual(roots('verse2'));
  });
});
