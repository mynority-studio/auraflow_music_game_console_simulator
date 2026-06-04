import { describe, it, expect } from 'vitest';
import { buildArrangementPlan } from './arranger';
import { planForm } from './formPlanner';
import { buildBandSpec } from '../band/bandEngine';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, pc } from '../foundation';

describe('arranger · 曲式多样 (3.5)', () => {
  const formShape = (seed: number) => {
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    return plan.sections.map((s) => s.role).join('-');
  };

  it('★ 不同 seed 出不同曲式(≥2 种骨架)', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 16; seed++) shapes.add(formShape(seed));
    expect(shapes.size).toBeGreaterThanOrEqual(2);
  });

  it('确定性:同 seed 两次 → 完全相同曲式', () => {
    expect(formShape(7)).toBe(formShape(7));
  });

  it('无 rng → 固定 verse-chorus(向后兼容)', () => {
    const band = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildArrangementPlan(band);
    expect(plan.sections.map((s) => s.id)).toEqual(['intro', 'verse1', 'chorus1', 'verse2', 'chorus2', 'outro']);
  });

  it('不变量:每个模板池曲式 ≥1 chorus(高潮锚点)+ verse/chorus 带 repeatGroup', () => {
    const templates = ['verse-chorus', 'verse-chorus-bridge', 'double-verse', 'compact'] as const;
    for (const t of templates) {
      const secs = planForm({ template: t });
      expect(secs.some((s) => s.role === 'chorus')).toBe(true);
      for (const s of secs) {
        if (s.role === 'verse' || s.role === 'chorus') expect(s.repeatGroup).toBeDefined();
      }
    }
  });

  it('★ 每种曲式都能端到端成曲(Auditor 非 failed)', () => {
    // 跨多 seed 覆盖全部模板分支,均须收敛(pass/warning,绝不 failed)
    for (let seed = 0; seed < 12; seed++) {
      const result = generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
      expect(result.status).not.toBe('failed');
    }
  });
});
