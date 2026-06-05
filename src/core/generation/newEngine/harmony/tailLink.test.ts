import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { createRandomContext, pc } from '../foundation';

describe('harmony · linkOut 段尾链接 (T6)', () => {
  // seed 3 pop → POP_FULL(build1/build2/bridge 皆有 linkOut)
  const band = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const plan = buildArrangementPlan(band, { rng: createRandomContext(3) });
  const h = buildHarmonicPlanFromArrangement(band, plan, createRandomContext(3));
  const tailDeg = (sid: string) => {
    const cs = h.chordTimeline.filter((c) => c.sectionId === sid);
    return cs.length ? (cs[cs.length - 1].roman.degree as number) : undefined;
  };

  it('★ dominantLift / stopOnDominant 段尾落 V(degree 5 = 功能推进入下一段)', () => {
    const linkSecs = plan.sections.filter((s) => s.linkOut && s.linkOut !== 'none');
    expect(linkSecs.length).toBeGreaterThan(0);
    for (const s of linkSecs) expect(tailDeg(s.id)).toBe(5);
  });

  it('★ dominantLift 段尾倒数第二 = IV(degree 4):IV→V', () => {
    const cs = h.chordTimeline.filter((c) => c.sectionId === 'build1');
    expect(cs.length).toBeGreaterThanOrEqual(2);
    expect(cs[cs.length - 2].roman.degree).toBe(4); // IV
    expect(cs[cs.length - 1].roman.degree).toBe(5); // V
  });

  it('★ repeatGroup 配对段体一致(build1≡build2,同 prototype + 同 link → 逐和弦全等)', () => {
    const sig = (id: string) => h.chordTimeline.filter((c) => c.sectionId === id).map((c) => [c.rootPc, c.quality]);
    const b1 = sig('build1'), b2 = sig('build2');
    if (b1.length && b2.length) expect(b1).toEqual(b2);
  });

  it('确定性:同 band/plan 两次和声逐和弦一致', () => {
    const h2 = buildHarmonicPlanFromArrangement(band, plan, createRandomContext(3));
    expect(h2.chordTimeline.map((c) => [c.rootPc, c.quality])).toEqual(h.chordTimeline.map((c) => [c.rootPc, c.quality]));
  });
});
