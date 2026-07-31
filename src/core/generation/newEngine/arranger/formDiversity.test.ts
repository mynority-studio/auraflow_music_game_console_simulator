import { describe, it, expect } from 'vitest';
import { buildArrangementPlan } from './arranger';
import { planForm } from './formPlanner';
import { planDynamics } from './dynamicsPlanner';
import type { Section } from './ArrangementPlan';
import { buildBandSpec } from '../band/bandEngine';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, pc } from '../foundation';
import {
  JAZZ_4_4_ARCHETYPE_ID,
} from './jazzArchetypePlanner';
import { ACG_PIANO_ARRANGEMENT_PROFILES } from './acgPianoArrangementProfiles';

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

  it('★ 程序化曲式【≤6 段 + 记忆点 + 必有收尾】', () => {
    const cnt = (secs: readonly { functionTag?: string }[], t: string) => secs.filter((s) => s.functionTag === t).length;
    let sawJazzFourFour = false;
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 12; seed++) {
        const planned = styleForm(style, seed);
        const secs = planned.sections;
        expect(secs.length).toBeLessThanOrEqual(6);          // ★ 放宽到 6(intro+verse×2+chorus×2+outro 标准曲式)
        expect(secs.length).toBeGreaterThanOrEqual(2);
        if (style === 'jazz') {
          sawJazzFourFour = true;
          expect(planned.arrangementArchetypeId).toBe(JAZZ_4_4_ARCHETYPE_ID);
          expect(secs.some((section) => section.id === 'headA')).toBe(true);
          expect(secs.some((section) => section.id === 'headOut')).toBe(true);
          expect(secs.some((section) => section.id === 'vamp' || section.id === 'reharm')).toBe(false);
        } else {
          // 记忆点:story/hook/loop 之一 ≥2(连续重复)
          expect(cnt(secs, 'story') >= 2 || cnt(secs, 'hook') >= 2 || cnt(secs, 'loop') >= 2).toBe(true);
        }
        // ★ 必有收尾段(修戛然而止):末段 harmonyRole='ending'(→ 终止式回归 + 能量回落)
        expect(secs[secs.length - 1].harmonyRole).toBe('ending');
      }
    }
    expect(sawJazzFourFour).toBe(true);
    for (let seed = 0; seed < 8; seed++) {
      expect(styleForm('lofi', seed).sections.some((s) => s.role === 'chorus')).toBe(false); // lofi 不套 chorus
      const jazz = styleForm('jazz', seed).sections;
      expect(jazz.some((s) => s.functionTag === 'headOut')).toBe(true);
    }
  });

  it('★ 记忆点：LOFI 用相邻 loop', () => {
    let sawLofiPair = false;
    for (let seed = 0; seed < 12; seed++) {
      const secs = styleForm('lofi', seed).sections;
      for (let i = 0; i < secs.length - 1; i++) {
        if (secs[i].functionTag === 'loop' && secs[i + 1].functionTag === 'loop') {
          sawLofiPair = true;
          expect(secs[i + 1].repeatGroup).toBe(secs[i].repeatGroup);
        }
      }
    }
    expect(sawLofiPair).toBe(true);
  });

  it('★ POP/RNB 双副歌采用 V1-C1-V2-C2；重排不改 bars/repeatGroup，且每个入副歌 verse 都 dominantLift', () => {
    for (const style of ['pop', 'rnb'] as const) {
      let matched = false;
      for (let seed = 0; seed < 32; seed++) {
        const sections = styleForm(style, seed).sections;
        const stories = sections.filter((s) => s.functionTag === 'story');
        const hooks = sections.filter((s) => s.functionTag === 'hook');
        if (stories.length !== 2 || hooks.length !== 2) continue;
        matched = true;
        const body = sections.filter((s) => s.functionTag === 'story' || s.functionTag === 'hook');
        expect(body.map((s) => s.id)).toEqual(style === 'pop'
          ? ['verse1', 'chorus1', 'verse2', 'chorus2']
          : ['verse1', 'hook1', 'verse2', 'hook2']);
        expect(stories.map((s) => s.linkOut)).toEqual(['dominantLift', 'dominantLift']);
        expect(new Set(stories.map((s) => s.repeatGroup))).toEqual(new Set(['V']));
        expect(new Set(hooks.map((s) => s.repeatGroup))).toEqual(new Set([style === 'pop' ? 'C' : 'H']));
        expect(stories[0].bars).toBe(stories[1].bars);
        expect(hooks[0].bars).toBe(hooks[1].bars);
        const expectedBars = sections.filter((s) => s.functionTag !== 'story' && s.functionTag !== 'hook').reduce((n, s) => n + s.bars, 0)
          + stories[0].bars * 2 + hooks[0].bars * 2;
        expect(sections.reduce((n, s) => n + s.bars, 0)).toBe(expectedBars);
        break;
      }
      expect(matched, `${style} seeds 覆盖 2 verse + 2 chorus`).toBe(true);
    }
  });

  it('★ 单副歌保持所有 verse 在前，仅直接进入副歌的 verse dominantLift', () => {
    for (const style of ['pop', 'rnb'] as const) {
      let matched = false;
      for (let seed = 0; seed < 64; seed++) {
        const body = styleForm(style, seed).sections.filter((s) => s.functionTag === 'story' || s.functionTag === 'hook');
        if (body.filter((s) => s.functionTag === 'hook').length !== 1) continue;
        matched = true;
        const firstHook = body.findIndex((s) => s.functionTag === 'hook');
        expect(body.slice(0, firstHook).every((s) => s.functionTag === 'story')).toBe(true);
        expect(body.slice(firstHook).every((s) => s.functionTag === 'hook')).toBe(true);
        expect(body.slice(0, firstHook).map((s) => s.linkOut)).toEqual([
          ...Array(Math.max(0, firstHook - 1)).fill(undefined),
          'dominantLift',
        ]);
        break;
      }
      expect(matched, `${style} seeds 覆盖单 chorus`).toBe(true);
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

  it('★ ACG PIANOSONG 用隐藏总谱 profile 变换开场/中段/coda，同时保留 A → A′ → return', () => {
    const acgForm = (seed: number, profileId?: typeof ACG_PIANO_ARRANGEMENT_PROFILES[number]['id']) => {
      const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'x', targetDuration: 120, key: pc(0) });
      return buildArrangementPlan(band, {
        rng: createRandomContext(seed),
        acgPianoArrangementProfileId: profileId,
      });
    };

    // Preserve the old familiar baseline for the historical seed while every
    // other seed can select a different internal blueprint.
    const baseline = acgForm(7);
    expect(baseline.acgPianoArrangementProfileId).toBe('ripple-journey');
    expect(baseline.sections.map((section) => section.id)).toEqual([
      'pianoIntro', 'themeA', 'themeA2', 'pianoLift', 'themeReturn', 'pianoCoda',
    ]);
    expect(baseline.sections.reduce((sum, section) => sum + section.bars, 0)).toBe(36);

    const seenProfiles = new Set<string>();
    const openingSignatures = new Set<string>();
    const codaSignatures = new Set<string>();
    for (let seed = 0; seed < 64; seed++) {
      const acg = acgForm(seed);
      const profileId = acg.acgPianoArrangementProfileId;
      expect(profileId, `seed ${seed}`).toBeDefined();
      seenProfiles.add(profileId!);
      openingSignatures.add(`${acg.sections[0].id}:${acg.sections[0].bars}`);
      const last = acg.sections.at(-1)!;
      codaSignatures.add(`${last.id}:${last.bars}`);

      const theme = acg.sections.filter((section) => section.repeatGroup === 'A');
      expect(theme.map((section) => section.id)).toEqual(['themeA', 'themeA2', 'themeReturn']);
      expect(new Set(theme.map((section) => section.bars)).size).toBe(1);
      expect(acg.sections.findIndex((section) => section.id === 'themeA')).toBeLessThan(
        acg.sections.findIndex((section) => section.id === 'themeA2'),
      );
      expect(acg.sections.findIndex((section) => section.id === 'themeA2')).toBeLessThan(
        acg.sections.findIndex((section) => section.id === 'themeReturn'),
      );
      expect(last.harmonyRole).toBe('ending');
    }
    expect(seenProfiles).toEqual(new Set(ACG_PIANO_ARRANGEMENT_PROFILES.map((profile) => profile.id)));
    expect(openingSignatures.size).toBeGreaterThanOrEqual(4);
    expect(codaSignatures.size).toBeGreaterThanOrEqual(4);

    const explicitShapes = new Set<string>();
    for (const profile of ACG_PIANO_ARRANGEMENT_PROFILES) {
      const acg = acgForm(7, profile.id);
      expect(acg.acgPianoArrangementProfileId).toBe(profile.id);
      explicitShapes.add(acg.sections.map((section) => section.id).join('>'));
    }
    expect(explicitShapes.size).toBe(ACG_PIANO_ARRANGEMENT_PROFILES.length);

    // No RNG keeps the original generic fallback, so fixture callers that do
    // not opt into seeded arrangement planning remain backward-compatible.
    const legacyBand = buildBandSpec({ seed: 7, styleHint: 'acg', mood: 'x', targetDuration: 120, key: pc(0) });
    const legacy = buildArrangementPlan(legacyBand);
    expect(legacy.acgPianoArrangementProfileId).toBeUndefined();
    expect(legacy.sections.map((section) => section.id)).toEqual(['intro', 'verse1', 'chorus1', 'verse2', 'chorus2', 'outro']);
  });

  it('★ ACG 钢琴 KB 限制 intro，并把 wide/ripple 的余量交给主题或发展段', () => {
    const targets = [20, 24, 28, 32, 36, 40, 44, 48, 60, 84];
    for (const profile of ACG_PIANO_ARRANGEMENT_PROFILES) {
      for (const targetBars of targets) {
        const sections = planForm({
          style: 'acg',
          rng: createRandomContext(17).substream('arranger'),
          targetBars,
          acgPianoArrangementProfileId: profile.id,
        });
        const intros = sections.filter((section) => section.role === 'intro');
        expect(intros.every((section) => section.bars <= 4),
          `${profile.id}/${targetBars} intro`).toBe(true);
        const firstThemeIndex = sections.findIndex((section) => section.id === 'themeA');
        expect(firstThemeIndex, `${profile.id}/${targetBars} themeA`).toBeGreaterThanOrEqual(0);
        expect(sections.slice(0, firstThemeIndex).reduce((sum, section) => sum + section.bars, 0),
          `${profile.id}/${targetBars} theme entrance`).toBeLessThanOrEqual(4);

        const themes = sections.filter((section) => section.repeatGroup === 'A');
        if (themes.length === 3) {
          expect(new Set(themes.map((section) => section.bars)).size,
            `${profile.id}/${targetBars} A/A'/return`).toBe(1);
        }

        if (profile.id === 'wide-cinema' || profile.id === 'ripple-journey') {
          expect(sections.reduce((sum, section) => sum + section.bars, 0),
            `${profile.id}/${targetBars} exact budget`).toBe(targetBars);
          const development = sections.find((section) =>
            section.id === 'pianoWideLift' || section.id === 'pianoLift');
          expect(development?.bars ?? 0, `${profile.id}/${targetBars} development`)
            .toBeLessThanOrEqual(8);
        }
      }
    }

    const wideForty = planForm({
      style: 'acg',
      rng: createRandomContext(17).substream('arranger'),
      targetBars: 40,
      acgPianoArrangementProfileId: 'wide-cinema',
    });
    expect(wideForty.map((section) => `${section.id}:${section.bars}`)).toEqual([
      'pianoWidePrelude:4',
      'themeA:8',
      'themeA2:8',
      'pianoWideLift:8',
      'themeReturn:8',
      'pianoFrameCoda:4',
    ]);
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
