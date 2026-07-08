import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from './arranger';
import { createRandomContext } from '../foundation';

const plan = (seed: number, style: string, mood = 'build') =>
  buildArrangementPlan(
    buildBandSpec({ seed, styleHint: style, mood, targetDuration: 96 }),
    { rng: createRandomContext(seed), mood },
  );

describe('arranger/grooveContract(MG full-parity Phase D — 推翻零洗牌,全 MG-backed 走真 pool)', () => {
  it('★ arranger 为每首歌下发 songGrooveContract + bySection + legacy grooveBySection', () => {
    const p = plan(7, 'pop');
    expect(p.songGrooveContract).toBeTruthy();
    expect(p.songGrooveContractId).toBe(p.songGrooveContract.id);
    expect(Object.keys(p.grooveContractBySection).length).toBe(p.sections.length); // 每段一条
    expect(Object.keys(p.grooveBySection).length).toBe(p.sections.length);          // legacy 字段仍在
    expect(Object.keys(p.drumPerformanceBySection).length).toBe(p.sections.length); // 鼓手合同每段一条
    expect(Object.keys(p.rolePerformanceBySection.drum).length).toBe(p.sections.length); // 总谱每段一条
  });

  it('★ 同 seed + style → 同 contract(确定性)', () => {
    expect(plan(7, 'pop').songGrooveContractId).toBe(plan(7, 'pop').songGrooveContractId);
    expect(plan(42, 'jazz').songGrooveContractId).toBe(plan(42, 'jazz').songGrooveContractId);
  });

  // ★ MG full-parity Phase D(directive 3.2,推翻 Phase 1 零洗牌):全 MG-backed 风格(POP/JAZZ/LOFI/RNB/ACG)
  //   都从真 GrooveContract pool 选(独立 grooveContract 子流,确定性),不再 legacy 派生。render 消费真 pocket/feel/
  //   velocityHumanize → POP/JAZZ/LOFI/RNB 输出相对零洗牌时代会变(已接受,Phase F rebaseline)。
  it('★ 全 MG-backed 风格走真 pool contract(非 legacy_,style 匹配,携带真 groove)', () => {
    const styleUpper = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', acg: 'ACG' } as const;
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg'] as const) {
      const p = plan(3, style);
      const c = p.songGrooveContract;
      expect(c.id.startsWith('legacy_'), `${style} 走真 pool(非 legacy)`).toBe(false);
      expect(c.style, `${style} contract.style 匹配`).toBe(styleUpper[style]);
      expect(c.velocityHumanize, `${style} 携带真 humanize`).toBeGreaterThan(0); // pool 全 > 0
    }
  });

  it('★ feel.swingRatio 从 contract.compSwingRatio 派生(真 pool 值,不再固定现状)', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      const p = plan(11, style);
      expect(p.feel.swingRatio).toBeCloseTo(p.songGrooveContract.compSwingRatio, 5);
    }
  });

  it('★ POP 抒情 mood 复用现有 ballad contract / 柔化 BPM、鼓 groove 与收尾', () => {
    const p = plan(7, 'pop', 'calm-build');
    expect(p.songGrooveContractId).toBe('pop_ballad_halftime');
    expect(p.tempoBpm).toBeGreaterThanOrEqual(64);
    expect(p.tempoBpm).toBeLessThanOrEqual(100);
    const hook = p.sections.find((s) => s.functionTag === 'hook')!;
    const story = p.sections.find((s) => s.functionTag === 'story')!;
    expect(p.grooveBySection[hook.id]).toBe('straight');
    expect(p.grooveBySection[story.id]).toBe('sparse');
    expect(p.endingStyle).toBe('fade');
  });

  it('★ DrumPerformanceContract 由 arranger 下发:每段有 pattern/fill/entry/guard', () => {
    const p = plan(21, 'jazz');
    for (const s of p.sections) {
      const perf = p.drumPerformanceBySection[s.id];
      expect(perf.sectionId).toBe(s.id);
      expect(perf.patternFamily).toMatch(/jazz-/);
      expect(['none', 'light', 'turnaround', 'big']).toContain(perf.fillPolicy);
      expect(['strict', 'normal']).toContain(perf.foregroundGuard);
      expect(perf.densityCeiling).toBeGreaterThan(0);
      expect(perf.densityCeiling).toBeLessThanOrEqual(1);
      expect(perf.maxMoveTicks).toBeGreaterThan(0);
      expect(['none', '8th', '16th']).toContain(perf.preQuantizeGrid);
    }
  });

  it('★ LOFI 主体 loop 必须是 hiphop 鼓机语感,不能落到 minimal/tight', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const p = plan(seed, 'lofi');
      const loopSections = p.sections.filter((s) => s.functionTag === 'loop');
      expect(loopSections.length, `seed ${seed} 应有 loop 主体段`).toBeGreaterThan(0);
      for (const s of loopSections) {
        const perf = p.drumPerformanceBySection[s.id];
        expect(['lofi-boombap', 'lofi-dusty-break'], `seed ${seed}/${s.id}`).toContain(perf.patternFamily);
        expect(perf.timingProfile, `seed ${seed}/${s.id}`).toBe('dilla-late');
      }
    }
  });

  it('★ 总谱 RolePerformanceContract:每段每个 role 有演奏/时序/互斥组', () => {
    const p = plan(9, 'rnb');
    for (const role of ['bass', 'comp', 'pad', 'lead', 'drum'] as const) {
      for (const s of p.sections) {
        const perf = p.rolePerformanceBySection[role][s.id];
        expect(perf.sectionId).toBe(s.id);
        expect(perf.role).toBe(role);
        expect(perf.grooveContractId).toBe(p.grooveContractBySection[s.id].id);
        expect(perf.maxMoveTicks).toBeGreaterThan(0);
        expect(['none', 'length', 'pedal', 'breath', 'rudiment']).toContain(perf.articulationExclusionGroup);
      }
    }
  });

  it('★ 4 个 macro 风格跨 seed 至少有 3 类鼓手打法(ACG 除外)', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      const families = new Set<string>();
      for (let seed = 1; seed <= 32; seed++) {
        const p = plan(seed, style, 'build');
        for (const perf of Object.values(p.drumPerformanceBySection)) families.add(perf.patternFamily);
      }
      expect(families.size, `${style}: ${[...families].join(',')}`).toBeGreaterThanOrEqual(3);
    }
  });
});
