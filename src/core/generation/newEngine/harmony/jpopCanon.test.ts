import { describe, it, expect } from 'vitest';
import { PROGRESSION_POOL } from '../knowledge/progressions';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, pc } from '../foundation';

// ============================================================
// JPOP canon ii-V 模板(follow MG HarmonyChangeLog)+ preserveType 机制
// ============================================================

describe('harmony · JPOP canon 模板结构', () => {
  const proto = PROGRESSION_POOL.find((p) => p.id === 'pop_jpop_canon_251_bar_replace_8')!;

  it('已注册:POP / Major / 8 bars / weight 2.5(提高权重)', () => {
    expect(proto).toBeDefined();
    expect(proto.style).toBe('POP');
    expect(proto.mode).toBe('Major');
    expect(proto.lengthBars).toBe(8);
    expect(proto.weight).toBe(2.5);
  });

  it('★ 32 拍 = 8 小节(ii-V cell 各 2+2)', () => {
    const total = proto.slots.reduce((s, sl) => s + (sl.beats ?? 4), 0);
    expect(total).toBe(32);
  });

  it('★ 离调借用内置:secondary_ii_v(ii/X)+ secondary_dominant(V/X)+ mustResolve', () => {
    const iiv = proto.slots.filter((s) => s.borrowedSource === 'secondary_ii_v');
    const secDom = proto.slots.filter((s) => s.borrowedSource === 'secondary_dominant');
    expect(iiv.length).toBe(2);           // ii/vi, ii/IV
    expect(secDom.length).toBe(3);        // V/vi×2, V/IV
    for (const s of secDom) expect(s.mustResolve).toBe(true);
  });

  it('★ ii-V cell 用 preserveType 保精确品质(m7b5/m7/7)', () => {
    const preserved = proto.slots.filter((s) => s.preserveType);
    expect(preserved.length).toBeGreaterThanOrEqual(7);
    expect(preserved.some((s) => s.type === 'm7b5')).toBe(true);
    expect(preserved.some((s) => s.type === 'm7')).toBe(true);
    expect(preserved.some((s) => s.type === '7')).toBe(true);
  });

  it('自由变体:主和弦 I/IV lockType:false(留 Stage2 装饰)', () => {
    const unlocked = proto.slots.filter((s) => s.lockType === false);
    expect(unlocked.length).toBe(2); // I add9, IV add9
  });
});

describe('harmony · preserveType 端到端(POP 折叠被跳过)', () => {
  // 扫多个 POP seed:JPOP 模板(weight 2.5)会在部分 seed 命中 → chordTimeline 出现精确 m7/m7b5。
  // 若无 preserveType,POP 的 alignChordTypeToMgStyle 会把 m7→min,m7b5 保留但 m7 必丢。
  it('★ 至少一个 POP seed 的进行保住了 m7(preserveType 生效)', () => {
    const qualities = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
      const arrangement = buildArrangementPlan(band);
      const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
      for (const c of plan.chordTimeline) qualities.add(c.quality);
    }
    // m7 只可能来自 preserveType 槽(否则 alignPop 折成 min)
    expect(qualities.has('m7')).toBe(true);
  });

  it('确定性:同 seed 两次进行一致', () => {
    const build = () => {
      const band = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
      const arrangement = buildArrangementPlan(band);
      const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(3));
      return plan.chordTimeline.map((c) => `${c.rootPc}-${c.quality}`);
    };
    expect(build()).toEqual(build());
  });
});
