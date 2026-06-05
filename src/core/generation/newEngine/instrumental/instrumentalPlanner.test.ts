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
  it('★ A1 密度弧:intro 稀疏(无 drum,非全员)→ chorus 全员同进;core 段含 lead;verse1≡verse2', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    const roles = (id: string) => ip.activeRolesBySection[id] ?? [];

    expect(roles('intro')).not.toContain('drum');                 // intro 无鼓(先行档不含 drum)
    expect(roles('intro').length).toBeLessThan(b.instrumentPool.length); // intro 稀疏(非全员)
    for (const r of b.instrumentPool) expect(roles('chorus1')).toContain(r); // chorus 全员
    // core 段(story/hook)恒含 lead(旋律扛歌;intro/outro 可缺席)
    for (const s of arr.sections) if (['story', 'hook'].includes(s.functionTag ?? '')) expect(roles(s.id)).toContain('lead');
    expect(roles('verse1')).toEqual(roles('verse2'));             // repeatGroup 一致(verse×2 同活动 = 记忆点)

    const ip2 = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    expect(ip2.activeRolesBySection).toEqual(ip.activeRolesBySection); // 确定性
  });

  it('★ intro 先行档多样性:跨 seed 出 ≥3 种 intro 组合(不再恒定 bass/pad 先行)', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const shapes = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      const introId = arr.sections.find((s) => s.functionTag === 'setup')?.id;
      if (introId) shapes.add([...(ip.activeRolesBySection[introId] ?? [])].sort().join('+'));
    }
    expect(shapes.size).toBeGreaterThanOrEqual(3); // intro 有多样性
  });

  it('★ A1 ∩ lineup + 无 functionTag 回退全 lineup(legacy/无 rng)', () => {
    // 无 rng = legacy verse-chorus 无 functionTag → 每段 = 全 lineup(向后兼容)
    for (const s of arrangement.sections) {
      expect([...plan.activeRolesBySection[s.id]].sort()).toEqual([...band.instrumentPool].sort());
    }
  });

  it('★ A4 lead-gating:core 段(story/hook)恒含 lead;framing 段(intro/outro)跨 seed 可缺席(多样性)', () => {
    const b = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    let sawLeadlessFraming = false;
    for (let seed = 0; seed < 16; seed++) {
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      const roles = (id: string) => ip.activeRolesBySection[id] ?? [];
      for (const s of arr.sections) {
        if (['story', 'hook'].includes(s.functionTag ?? '')) expect(roles(s.id)).toContain('lead'); // core 恒含
        if (['setup', 'outro'].includes(s.functionTag ?? '') && !roles(s.id).includes('lead')) sawLeadlessFraming = true;
      }
      // 确定性
      const ip2 = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      expect(ip2.activeRolesBySection).toEqual(ip.activeRolesBySection);
    }
    expect(sawLeadlessFraming).toBe(true); // 至少一首 intro/outro 纯器乐(先行档 solo/pad 或 lead-drop)
  });

  it('★ RNB call-response hook 也算主 hook(anchorRequired):重心修', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'rnb', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    const req = ip.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired);
    expect(req.length).toBeGreaterThan(0); // RNB hook 现在是主锚(原 call-response → isMain=false → 0)
    const hookIds = arr.sections.filter((s) => s.functionTag === 'hook').map((s) => s.id);
    expect(req.every((h) => hookIds.some((id) => h.phraseId.startsWith(id)))).toBe(true); // 主锚都落 hook 段
  });

  it('★ 音色世界:plan 带 timbreWorld(可观测);确定性', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'jazz', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    expect(ip.timbreWorld).toBe('jazzCombo'); // jazz → jazzCombo
    const ip2 = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    expect(ip2.timbreWorld).toBe(ip.timbreWorld);
    expect(ip2.programByRoleSection).toEqual(ip.programByRoleSection); // repair 不破确定性
  });

  it('★ A3 织体按 functionTag:story→arpeggio / hook→active-comp / setup→pad(或 intro 先行档覆盖)', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    expect(ip.textureBySection.verse1).toBe('arpeggio');     // story → 分解
    expect(ip.textureBySection.chorus1).toBe('active-comp'); // hook → 富织体
    // intro texture 由先行档掷定(pad / arpeggio / active-comp 之一)
    expect(['pad', 'arpeggio', 'active-comp']).toContain(ip.textureBySection.intro);
  });
});
