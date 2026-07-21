import { describe, it, expect } from 'vitest';
import { buildSongBundle, generateSong } from '../generation/GenerationController';
import { buildBandSpec } from './bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { toHarmonyStyle } from '../harmony/progressionSelector';
import { PROGRESSION_POOL } from '../knowledge/progressions';
import { ACG_RENDERED_TEXTURE_CASES } from '../render/textureRenderer';
import { pocketedRoles } from '../render/groovePocket';
import { planMotifBindingReplays } from '../render/repeatGroupReplay';
import { pc, createRandomContext } from '../foundation';

// ============================================================
// ACG PIANOSONG 风格注册端到端验收（原创日式电影感钢琴短篇）
// ============================================================

describe('band/acgStyleRegistration(MG 升级 Phase 2a)', () => {
  it('★ acg → HarmonyStyle ACG;保留 7 条旧池并新增 5 条 rooted-minor piano profile', () => {
    expect(toHarmonyStyle('acg')).toBe('ACG');
    const acgProtos = PROGRESSION_POOL.filter((p) => p.style === 'ACG');
    expect(acgProtos.length).toBe(12);
    expect(acgProtos.filter((p) => p.subStyles?.includes('ACG PIANOSONG Rooted Minor'))).toHaveLength(5);
    expect(acgProtos.some((p) => p.mode === 'Minor')).toBe(true);
    expect(acgProtos.every((p) => p.slots.length > 0)).toBe(true);
  });

  it('★ ACG minor 的 4-bar intro / lift / coda 命中 rooted-minor profile，不退回通用和声', () => {
    const seed = 7;
    const rng = createRandomContext(seed);
    const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'minor' });
    const arrangement = buildArrangementPlan(band, { rng });
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, rng);
    const inSection = (id: string) => harmonic.chordTimeline.filter((span) => span.sectionId === id);

    const intro = inSection('pianoIntro');
    expect(intro).toHaveLength(4);
    expect(intro.every((span) => span.rootPc === 0 && span.bassRole === 'pedal')).toBe(true);

    const theme = inSection('themeA');
    expect(theme.slice(0, 8).map((span) => span.rootPc)).toEqual([0, 8, 3, 10, 0, 5, 8, 10]);
    expect(theme.every((span) => span.bassRole === 'root')).toBe(true);

    const lift = inSection('pianoLift');
    expect(lift.map((span) => span.rootPc)).toEqual([0, 3, 10, 7]);
    expect(lift[0].forcedScale).toBe('Dorian');
    expect(lift.every((span) => span.bassRole === 'root')).toBe(true);

    const coda = inSection('pianoCoda');
    expect(coda.slice(-2).map((span) => [span.rootPc, span.quality])).toEqual([[7, '7'], [0, 'm7']]);
  });

  it('★ ACG 端到端生成:多 seed 不失败、IR 非空、音符合法', () => {
    for (const seed of [3, 7, 42, 128]) {
      const r = generateSong({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      expect(r.status, `seed ${seed}`).not.toBe('failed');
      expect(r.ir, `seed ${seed} ir`).toBeTruthy();
      const notes = r.ir!.tracks.flatMap((t) => t.notes);
      expect(notes.length, `seed ${seed} notes`).toBeGreaterThan(0);
      for (const n of notes) expect(n.pitch).toBeGreaterThanOrEqual(0);
    }
  });

  it('★ ACG rooted-minor profile 端到端生成:多 seed 不失败、三层钢琴仍可渲染', () => {
    for (const seed of [3, 7, 42, 128]) {
      const r = generateSong({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'minor' });
      expect(r.status, `minor seed ${seed}`).not.toBe('failed');
      const roles = new Set(r.ir?.tracks.map((track) => track.role));
      for (const role of ['bass', 'comp', 'lead'] as const) expect(roles.has(role), `minor seed ${seed}: ${role}`).toBe(true);
    }
  });

  it('★ 键盘写作多轨:lead/comp/bass 统一为同一原声钢琴,lead+comp+bass 常驻', () => {
    const r = generateSong({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
    const byRole = (role: string) => r.ir!.tracks.find((t) => t.role === role);
    const lead = byRole('lead'), comp = byRole('comp'), bass = byRole('bass');
    expect(lead, 'lead 常驻').toBeTruthy();
    expect(comp, 'comp 常驻').toBeTruthy();
    expect(bass, 'bass 常驻').toBeTruthy();
    expect(lead!.program, 'lead 原声钢琴').toBe(0);
    expect(comp!.program, 'comp 原声钢琴').toBe(0);
    expect(bass!.program, 'bass 左手钢琴').toBe(0);
  });

  it('★ ACG 段级 richTextureBySection 用 ACG 钢琴织体(Phase 2b 端到端接线)', () => {
    for (const seed of [7, 42]) {
      const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
      const tcs = Object.values(ip.richTextureBySection);
      expect(tcs.length, `seed ${seed}`).toBeGreaterThan(0); // ACG 进 RICH_STYLE → 段级下发
      for (const tc of tcs) expect(ACG_RENDERED_TEXTURE_CASES, `seed ${seed}: ${tc}`).toContain(tc);
    }
  });

  it('★ ACG PIANOSONG 的 motifBindings 真正产生主题 body 重放计划', () => {
    for (const seed of [0, 7, 42, 99]) {
      const bundle = buildSongBundle({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const plans = planMotifBindingReplays(bundle.arrangement, bundle.harmonic.chordTimeline, bundle.timebase);
      expect(plans.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(plans.some((plan) => plan.sourcePhraseId === 'themeA-p0' && plan.targetPhraseId === 'themeA2-p0'), `seed ${seed}`).toBe(true);
    }
  });

  // ★ MG full-parity Phase D(directive 3.2,推翻 Phase 1 零洗牌):全 MG-backed 风格走真 pool contract,
  //   都携带真 pocket(lead/bass 至少一个非 0)→ render lay-back 全风格生效(POP/JAZZ/LOFI/RNB 输出会变,已接受)。
  it('★ Phase D:全 MG-backed contract 有非零 pocket(ACG=rubato,POP/JAZZ/LOFI/RNB=真 lay-back)', () => {
    const acgArr = buildArrangementPlan(buildBandSpec({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' }), { rng: createRandomContext(7) });
    expect(acgArr.songGrooveContract.style).toBe('ACG');
    for (const style of ['acg', 'pop', 'jazz', 'lofi', 'rnb']) {
      const arr = buildArrangementPlan(buildBandSpec({ seed: 7, styleHint: style, mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' }), { rng: createRandomContext(7) });
      expect(pocketedRoles(arr.songGrooveContract).size, `${style} 真 pocket(lead/bass 至少一个)`).toBeGreaterThan(0);
    }
  });

  it('★ ACG 确定性:同 seed 同 style 两次产物字节一致', () => {
    const gen = () => generateSong({ seed: 11, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' })
      .ir!.tracks.map((t) => `${t.role}:${t.program}:` + t.notes.map((n) => `${n.pitch}@${n.startTick}`).join(',')).join('|');
    expect(gen()).toBe(gen());
  });
});
