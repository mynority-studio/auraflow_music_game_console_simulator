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

  // —— 风格曲式池(CODEX V4.2 吸纳)——
  const styleForm = (style: string, seed: number) => {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 120, key: pc(0) });
    return buildArrangementPlan(band, { rng: createRandomContext(seed) });
  };

  it('★ 风格曲式:lofi 无 chorus + 全 harmonyRole=loop;jazz 有 solo/headOut;rnb 有 preHook/breakdown', () => {
    const lofi = styleForm('lofi', 5);
    expect(lofi.sections.some((s) => s.role === 'chorus')).toBe(false); // lofi 不套 chorus
    expect(lofi.sections.filter((s) => s.functionTag === 'loop').every((s) => s.harmonyRole === 'loop')).toBe(true);

    const jazz = styleForm('jazz', 5);
    expect(jazz.sections.some((s) => s.functionTag === 'solo')).toBe(true);
    expect(jazz.sections.some((s) => s.functionTag === 'headOut')).toBe(true);

    const rnb = styleForm('rnb', 5);
    expect(rnb.sections.some((s) => s.id === 'preHook1')).toBe(true);
    expect(rnb.sections.some((s) => s.functionTag === 'breakdown')).toBe(true);
  });

  it('★ 风格曲式确定性 + harmonyRole/functionTag 落位', () => {
    expect(styleForm('jazz', 7).sections.map((s) => s.id)).toEqual(styleForm('jazz', 7).sections.map((s) => s.id));
    const pop = styleForm('pop', 3);
    const ch = pop.sections.find((s) => s.role === 'chorus')!;
    expect(ch.harmonyRole).toBe('chorus');
    expect(ch.functionTag).toBe('hook');
    expect(pop.sections.find((s) => s.role === 'outro')!.harmonyRole).toBe('ending');
  });

  it('★ 风格曲式各段 repeatGroup 必同 bars(引擎按 group 复用 prototype,混 bars 会错配)', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      const secs = styleForm(style, 5).sections;
      const barsByGroup = new Map<string, number>();
      for (const s of secs) {
        if (!s.repeatGroup) continue;
        if (barsByGroup.has(s.repeatGroup)) expect(s.bars).toBe(barsByGroup.get(s.repeatGroup));
        else barsByGroup.set(s.repeatGroup, s.bars);
      }
    }
  });

  it('★ T4 dynamics:lofi 峰值<0.6 且 < pop hook;jazz 不吃 0.9;breakdown 显著低于邻段;统一 1 chord/bar', () => {
    const peak = (p: ReturnType<typeof styleForm>) => Math.max(...p.sections.map((s) => p.energyBySection[s.id]));
    const lofi = styleForm('lofi', 5);
    const pop = styleForm('pop', 3);
    const jazz = styleForm('jazz', 5);
    const rnb = styleForm('rnb', 5);

    const lofiPeak = peak(lofi);
    expect(lofiPeak).toBeLessThan(0.6);                       // lofi 不到 chorus 能量
    const popHook = pop.sections.find((s) => s.functionTag === 'hook')!;
    expect(pop.energyBySection[popHook.id]).toBeGreaterThan(lofiPeak); // pop hook > lofi 峰
    expect(peak(jazz)).toBeLessThan(0.8);                     // jazz 不吃 pop 0.9 chorus

    // breakdown 显著低于前后段
    const i = rnb.sections.findIndex((s) => s.functionTag === 'breakdown');
    const bd = rnb.energyBySection[rnb.sections[i].id];
    expect(bd).toBeLessThan(rnb.energyBySection[rnb.sections[i - 1].id]);
    expect(bd).toBeLessThan(rnb.energyBySection[rnb.sections[i + 1].id]);

    // 统一 1 chord/bar(去 chorus 加密)
    for (const s of pop.sections) expect(pop.harmonicRhythmTarget.chordsPerBarBySection[s.id]).toBe(1);
  });

  it('★ 回归 ramp(段落重心):同一中心段每次回归 energy 递增(末段=重心);lofi loop 仍 <0.6', () => {
    const pop = styleForm('pop', 3); // POP_FULL:chorus1/chorus2/finalChorus
    const e = (id: string) => pop.energyBySection[id];
    expect(e('chorus2')).toBeGreaterThan(e('chorus1'));        // 第二次副歌更重
    expect(e('finalChorus')).toBeGreaterThan(e('chorus2'));    // 末副歌最重 = 重心
    const lofi = styleForm('lofi', 5);
    expect(Math.max(...lofi.sections.map((s) => lofi.energyBySection[s.id]))).toBeLessThan(0.6); // loop ramp 仍守 <0.6
  });
});
