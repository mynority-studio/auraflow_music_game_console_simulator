import { describe, it, expect } from 'vitest';
import { buildArrangementPlan } from './arranger';
import { planForm } from './formPlanner';
import { planDynamics } from './dynamicsPlanner';
import type { Section } from './ArrangementPlan';
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

  it('★ 程序化曲式【≤6 段 + 记忆点 + 必有收尾】:每首 ≤6 段;有 ×2 连续记忆点;★ 每首末段=收尾(harmonyRole ending,修戛然而止);lofi 无 chorus;jazz head×2+headOut', () => {
    const cnt = (secs: readonly { functionTag?: string }[], t: string) => secs.filter((s) => s.functionTag === t).length;
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 12; seed++) {
        const secs = styleForm(style, seed).sections;
        expect(secs.length).toBeLessThanOrEqual(6);          // ★ 放宽到 6(intro+verse×2+chorus×2+outro 标准曲式)
        expect(secs.length).toBeGreaterThanOrEqual(2);
        // 记忆点:story/hook/loop/head 之一 ≥2(连续重复)
        expect(cnt(secs, 'story') >= 2 || cnt(secs, 'hook') >= 2 || cnt(secs, 'loop') >= 2 || cnt(secs, 'head') >= 2).toBe(true);
        // ★ 必有收尾段(修戛然而止):末段 harmonyRole='ending'(→ 终止式回归 + 能量回落)
        expect(secs[secs.length - 1].harmonyRole).toBe('ending');
      }
    }
    for (let seed = 0; seed < 8; seed++) {
      expect(styleForm('lofi', seed).sections.some((s) => s.role === 'chorus')).toBe(false); // lofi 不套 chorus
      const jazz = styleForm('jazz', seed).sections;
      expect(cnt(jazz, 'head')).toBe(2);                     // jazz head×2(记忆点)
      expect(jazz.some((s) => s.functionTag === 'headOut')).toBe(true);
    }
  });

  it('★ 连续×2 记忆点:同功能相邻段共享 repeatGroup(verse/loop/head ×2 时)', () => {
    for (const [style, tag] of [['pop', 'story'], ['rnb', 'story'], ['lofi', 'loop'], ['jazz', 'head']] as const) {
      let sawPair = false;
      for (let seed = 0; seed < 12; seed++) {
        const secs = styleForm(style, seed).sections;
        for (let i = 0; i < secs.length - 1; i++) {
          if (secs[i].functionTag === tag && secs[i + 1].functionTag === tag) {
            sawPair = true;
            expect(secs[i + 1].repeatGroup).toBe(secs[i].repeatGroup); // 连续同功能 → 同 group = 记忆点
          }
        }
      }
      expect(sawPair).toBe(true); // 该风格跨 seed 至少出现一次连续×2
    }
  });

  it('★ 风格曲式确定性 + harmonyRole/functionTag 落位', () => {
    expect(styleForm('jazz', 7).sections.map((s) => s.id)).toEqual(styleForm('jazz', 7).sections.map((s) => s.id));
    const pop = styleForm('pop', 3);
    const ch = pop.sections.find((s) => s.role === 'chorus')!;
    expect(ch.harmonyRole).toBe('chorus');
    expect(ch.functionTag).toBe('hook');
    const outro = pop.sections.find((s) => s.role === 'outro');
    expect(outro).toBeDefined();                  // ★ 收尾段现必有
    expect(outro!.harmonyRole).toBe('ending');
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
    void rnb;

    // breakdown 能量显著低于邻段(directly 测 planDynamics;简化后曲式已无 breakdown 段,故合成验)
    const synth: Section[] = [
      { id: 'h1', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
      { id: 'bd', role: 'bridge', functionTag: 'breakdown', bars: 8, hookPolicy: 'none' },
      { id: 'h2', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
    ];
    const dyn = planDynamics(synth);
    expect(dyn.energyBySection.bd).toBeLessThan(dyn.energyBySection.h1);
    expect(dyn.energyBySection.bd).toBeLessThan(dyn.energyBySection.h2);

    // 统一 1 chord/bar(去 chorus 加密)
    for (const s of pop.sections) expect(pop.harmonicRhythmTarget.chordsPerBarBySection[s.id]).toBe(1);
  });

  it('★ 回归 ramp(段落重心):同一中心段每次回归 energy 递增;lofi loop 跨 seed 仍 <0.6', () => {
    // 直测 planDynamics:两个 hook → 第二次更重(程序化曲式 hook 数可变,故合成验)
    const dyn = planDynamics([
      { id: 'h1', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
      { id: 'h2', role: 'chorus', functionTag: 'hook', bars: 8, hookPolicy: 'main' },
    ]);
    expect(dyn.energyBySection.h2).toBeGreaterThan(dyn.energyBySection.h1);
    for (let seed = 0; seed < 8; seed++) {
      const lofi = styleForm('lofi', seed);
      expect(Math.max(...lofi.sections.map((s) => lofi.energyBySection[s.id]))).toBeLessThan(0.6); // loop ramp 仍守 <0.6
    }
  });
});
