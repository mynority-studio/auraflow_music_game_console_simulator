import { describe, it, expect } from 'vitest';
import { buildInstrumentationPlan } from './instrumentalPlanner';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext } from '../foundation';

describe('instrumental/instrumentalPlanner', () => {
  const band = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildInstrumentationPlan(band, arrangement);

  it('织体按段落功能(chorus=active-comp, intro=pad)', () => {
    expect(plan.textureBySection.chorus1).toBe('active-comp');
    expect(plan.textureBySection.intro).toBe('pad');
    expect(plan.textureBySection.verse1).toBe('arpeggio');
  });

  it('让位策略按织体分流(active-comp 让位 / pad 不让位)', () => {
    expect(plan.textureYieldPolicy['active-comp']).toBe('active');
    expect(plan.textureYieldPolicy.pad).toBe('floating');
    expect(plan.textureYieldPolicy['sustained-block']).toBe('floating');
  });

  it('每角色有 register 区间', () => {
    expect(plan.registerByRole.bass.lowMidi).toBe(36);
    expect(plan.registerByRole.lead.lowMidi).toBe(67);
  });

  it('hookAnchorSlots:覆盖所有 hook 句,主 hook(chorus)anchorRequired', () => {
    const hookPhrases = arrangement.phrases.filter((p) => p.skeletonRole === 'hook');
    expect(plan.melodyReservationPlan.hookAnchorSlots.length).toBe(hookPhrases.length);
    const chorusSlot = plan.melodyReservationPlan.hookAnchorSlots.find((s) => s.phraseId.startsWith('chorus1'))!;
    expect(chorusSlot.anchorRequired).toBe(true);
    expect(chorusSlot.maxAccompanimentDensity).toBe(0.4);
    const verseSlot = plan.melodyReservationPlan.hookAnchorSlots.find((s) => s.phraseId.startsWith('verse1'))!;
    expect(verseSlot.anchorRequired).toBe(false);
  });

  it('hookAnchorSlot.beatSlot = 绝对拍位(chorus1 在 intro4 + verse8 之后 = 12 小节*4 = 48 拍)', () => {
    // intro(4 bar) + verse1(8 bar) = 12 bar = 48 拍(4/4)
    const chorusSlot = plan.melodyReservationPlan.hookAnchorSlots.find((s) => s.phraseId === 'chorus1-p0')!;
    expect(chorusSlot.beatSlot).toBe(48);
  });

  it('reservedRegister = lead 区;densityCeiling 来自 styleProfile', () => {
    expect(plan.melodyReservationPlan.reservedRegister.lowMidi).toBe(67);
    expect(plan.melodyReservationPlan.densityCeiling).toBe(band.styleProfile.accompDensity);
  });

  it('深不可变 + 确定性', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    const again = buildInstrumentationPlan(band, arrangement);
    expect(again.melodyReservationPlan.hookAnchorSlots.map((s) => s.beatSlot))
      .toEqual(plan.melodyReservationPlan.hookAnchorSlots.map((s) => s.beatSlot));
  });

  // —— A1 编曲密度弧 ——
  it('★ A1 密度弧:pop intro 稀疏(无 bass/drum)→ chorus 全员同进 → bridge 去 drum;lead 全程;repeatGroup 一致', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) }); // seed 3 → POP_FULL
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('inst'));
    const roles = (id: string) => ip.activeRolesBySection[id] ?? [];

    expect(roles('intro')).not.toContain('bass');   // intro 稀疏
    expect(roles('intro')).not.toContain('drum');
    for (const r of b.instrumentPool) expect(roles('chorus1')).toContain(r); // chorus 全员
    expect(roles('bridge')).not.toContain('drum');  // breakdown 去 drum
    for (const s of arr.sections) expect(roles(s.id)).toContain('lead'); // lead 全程
    expect(roles('verse1')).toEqual(roles('verse2')); // repeatGroup 一致(同 functionTag)

    const ip2 = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('inst'));
    expect(ip2.activeRolesBySection).toEqual(ip.activeRolesBySection); // 确定性
  });

  it('★ A1 ∩ lineup + 无 functionTag 回退全 lineup(legacy/无 rng)', () => {
    // 无 rng = legacy verse-chorus 无 functionTag → 每段 = 全 lineup(向后兼容)
    for (const s of arrangement.sections) {
      expect([...plan.activeRolesBySection[s.id]].sort()).toEqual([...band.instrumentPool].sort());
    }
  });
});
