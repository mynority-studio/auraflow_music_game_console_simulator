import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, mod12, pc } from '../foundation';

// 离调由 tonicizationPlanner 产出(degree-picker fallback 段上)；
// planner-specific 合同 = secondaryTarget + localTonalCenterPc；
// tonicizationPlacement 只描述 placement，作者 prototype 也可以使用它。
// 作者进行也会携带 secondaryTarget + localTonalCenter，
// 但它们不参与这里“通用 planner 是否触发”的抽样统计。
// 因此这里仅验证仍走通用 planner 的 POP/RNB。LOFI/BLUES=0 不触发。
describe('harmony · 副属/离调 tonicizationPlanner (3.2)', () => {
  const mkPlan = (style: string, seed: number) => {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 120, key: pc(0) });
    return buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(seed));
  };
  const tonChords = (plan: ReturnType<typeof mkPlan>) =>
    plan.chordTimeline.filter((c) =>
      c.roman.secondaryTarget !== undefined && c.localTonalCenterPc !== undefined,
    );
  const firstFiring = (style: string) => {
    for (let s = 0; s < 30; s++) { const p = mkPlan(style, s); if (tonChords(p).length > 0) return { plan: p, seed: s, style }; }
    return null;
  };

  it('★ POP/RNB 跨 seed 会触发 planner 离调(secondaryTarget + local center)', () => {
    for (const style of ['pop', 'rnb']) {
      expect(firstFiring(style), style).not.toBeNull();
    }
  });

  it('LOFI 不触发 planner 离调(tonMaxSong=0)', () => {
    for (let s = 0; s < 24; s++) expect(tonChords(mkPlan('lofi', s)).length, `lofi#${s}`).toBe(0);
  });

  it('离调 V/X:根 = 临时主音上方五度,3 音落调外(chromatic 色彩)', () => {
    const f = firstFiring('pop') ?? firstFiring('rnb')!;
    const majorPcs = new Set([0, 2, 4, 5, 7, 9, 11]);
    const vx = tonChords(f.plan).find((c) => c.roman.degree === 5 && c.localTonalCenterPc !== undefined)!;
    expect(vx).toBeDefined();
    expect(vx.rootPc).toBe(mod12((vx.localTonalCenterPc as number) + 7)); // 上方五度
    expect(vx.roman.secondaryTarget).toBeDefined();
    expect(majorPcs.has(mod12(vx.rootPc + 4))).toBe(false); // 属七 3 音离调
  });

  it('离调 V/X 走匹配和弦色彩的 forcedScale(Mixolydian/Mixolydian b6/Phrygian Dominant)', () => {
    const f = firstFiring('pop') ?? firstFiring('rnb')!;
    const vx = tonChords(f.plan).find((c) => c.roman.degree === 5)!;
    const scale = f.plan.chordScaleMap[vx.id];
    expect(scale.length).toBe(7);
    expect(scale).toContain(mod12(vx.rootPc + 4)); // 属七大三度在音阶内(Mixolydian/PhrDom 都含)
  });

  it('确定性 + 排比不破:同 seed 两次一致 + verse1 ≡ verse2', () => {
    const f = firstFiring('pop') ?? firstFiring('rnb')!;
    const a = mkPlan(f.style, f.seed);
    const sig = (p: typeof a) => p.chordTimeline.map((c) => `${c.rootPc}:${c.quality}@${c.startBeat}`).join('|');
    expect(sig(mkPlan(f.style, f.seed))).toBe(sig(mkPlan(f.style, f.seed)));
    const roots = (sid: string) => f.plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    if (roots('verse1').length && roots('verse2').length) expect(roots('verse1')).toEqual(roots('verse2'));
  });
});
