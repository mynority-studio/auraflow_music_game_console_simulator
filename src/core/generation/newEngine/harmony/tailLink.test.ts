import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { createRandomContext, pc } from '../foundation';

describe('harmony · linkOut 段尾链接 (T6)', () => {
  // 简化曲式后:verse2 带 linkOut=dominantLift(推进副歌);verse1/verse2 同 repeatGroup V。
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

  it('★ dominantLift 段尾倒数第二 = IV(degree 4):verse2 尾 IV→V', () => {
    const cs = h.chordTimeline.filter((c) => c.sectionId === 'verse2');
    expect(cs.length).toBeGreaterThanOrEqual(2);
    expect(cs[cs.length - 2].roman.degree).toBe(4); // IV
    expect(cs[cs.length - 1].roman.degree).toBe(5); // V
  });

  it('★ verse×2 记忆点:verse1/verse2 段体一致(除 verse2 尾推 IV→V)', () => {
    const sig = (id: string) => h.chordTimeline.filter((c) => c.sectionId === id).map((c) => [c.rootPc, c.quality]);
    const v1 = sig('verse1'), v2 = sig('verse2');
    expect(v1.length).toBeGreaterThanOrEqual(3);
    expect(v2.slice(0, -2)).toEqual(v1.slice(0, -2)); // 段体(除末 2 推进和弦)逐和弦一致 = 记忆点
    expect(tailDeg('verse2')).toBe(5);                // verse2 尾 = V(推进副歌)
  });

  it('确定性:同 band/plan 两次和声逐和弦一致', () => {
    const h2 = buildHarmonicPlanFromArrangement(band, plan, createRandomContext(3));
    expect(h2.chordTimeline.map((c) => [c.rootPc, c.quality])).toEqual(h.chordTimeline.map((c) => [c.rootPc, c.quality]));
  });
});
