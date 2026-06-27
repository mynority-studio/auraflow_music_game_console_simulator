import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from './arranger';
import { createRandomContext } from '../foundation';

const plan = (seed: number, style: string) =>
  buildArrangementPlan(buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 96 }), { rng: createRandomContext(seed) });

describe('arranger/grooveContract(MG full-parity Phase D — 推翻零洗牌,全 MG-backed 走真 pool)', () => {
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
});
