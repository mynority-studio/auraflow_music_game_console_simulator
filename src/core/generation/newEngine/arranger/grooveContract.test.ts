import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from './arranger';
import { createRandomContext } from '../foundation';

const plan = (seed: number, style: string) =>
  buildArrangementPlan(buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 96 }), { rng: createRandomContext(seed) });

describe('arranger/grooveContract(MG 升级 Phase 1 — 零洗牌)', () => {
  it('★ arranger 为每首歌下发 songGrooveContract + bySection + legacy grooveBySection', () => {
    const p = plan(7, 'pop');
    expect(p.songGrooveContract).toBeTruthy();
    expect(p.songGrooveContractId).toBe(p.songGrooveContract.id);
    expect(Object.keys(p.grooveContractBySection).length).toBe(p.sections.length); // 每段一条
    expect(Object.keys(p.grooveBySection).length).toBe(p.sections.length);          // legacy 字段仍在
  });

  it('★ 同 seed + style → 同 contract(确定性)', () => {
    expect(plan(7, 'pop').songGrooveContractId).toBe(plan(7, 'pop').songGrooveContractId);
    expect(plan(42, 'jazz').songGrooveContractId).toBe(plan(42, 'jazz').songGrooveContractId);
  });

  it('★ 非 ACG = legacy 派生(零洗牌):swing=feel.swingRatio、pocket 全 0、velocityHumanize 0', () => {
    for (const [style, sw] of [['pop', 0.5], ['jazz', 0.66], ['lofi', 0.5], ['rnb', 0.5]] as const) {
      const p = plan(3, style);
      const c = p.songGrooveContract;
      expect(c.id.startsWith('legacy_'), `${style} legacy`).toBe(true);
      expect(c.compSwingRatio).toBeCloseTo(sw, 5);            // = 现 feel.swingRatio
      expect(c.melodySwingRatio).toBeCloseTo(sw, 5);
      expect(c.bassPocketMs).toEqual([0, 0]);                 // pocket 0 → render 不漂
      expect(c.melodyStrongPocketMs).toEqual([0, 0]);
      expect(c.velocityHumanize).toBe(0);
    }
  });

  it('★ feel.swingRatio 从 contract.compSwingRatio 派生(非 ACG 等值不变)', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb']) {
      const p = plan(11, style);
      expect(p.feel.swingRatio).toBeCloseTo(p.songGrooveContract.compSwingRatio, 5);
    }
  });
});
