import { describe, it, expect } from 'vitest';
import { buildInstrumentationPlan } from './instrumentalPlanner';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext } from '../foundation';
import { playableRangeForRole } from '../knowledge/instruments';

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
    const [leadLo, leadHi] = playableRangeForRole('lead', plan.roleProgram.lead);
    const [bassLo, bassHi] = playableRangeForRole('bass', plan.roleProgram.bass);
    expect(plan.registerByRole.bass.lowMidi).toBeGreaterThanOrEqual(bassLo);
    expect(plan.registerByRole.bass.highMidi).toBeLessThanOrEqual(bassHi);
    expect(plan.registerByRole.lead.lowMidi).toBeGreaterThanOrEqual(leadLo);
    expect(plan.registerByRole.lead.highMidi).toBeLessThanOrEqual(leadHi);
    expect(plan.registerByRole.lead.lowMidi).toBeLessThanOrEqual(plan.registerByRole.lead.highMidi);
    expect(plan.registerByRole.comp.highMidi as number).toBeLessThan(plan.registerByRole.lead.highMidi as number);
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

  it('reservedRegister 在 lead 区内且优先高区;densityCeiling 来自 styleProfile', () => {
    const reserved = plan.melodyReservationPlan.reservedRegister;
    const lead = plan.registerByRole.lead;
    expect(reserved.lowMidi).toBeGreaterThanOrEqual(lead.lowMidi as number);
    expect(reserved.highMidi).toBe(lead.highMidi);
    expect(reserved.lowMidi).toBeLessThanOrEqual(reserved.highMidi);
    expect(reserved.lowMidi).toBeGreaterThanOrEqual(Math.min(67, lead.highMidi as number));
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

  it('★ ACG 前景空间保持键盘主导,不把 chorus 统一到 mallet/kalimba 上', () => {
    const b = buildBandSpec({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 90 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(7) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(7).substream('timbre'));
    expect(instrumentInfo(ip.roleProgram.lead).family).toBe('keyboard');
    for (const s of arr.sections) {
      expect(ip.mixByRoleSection.lead[s.id].pan).toBe(64);
    }
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

// ============================================================
// ★ 链式协同(gm128_chain_orchestration):器配层【拥有】最终 GM 选择
// ============================================================
import { canPlayComp, instrumentInfo, isSustainedInstrument } from '../knowledge/instruments';

describe('instrumental/instrumentalPlanner — 链式协同 GM 选择', () => {
  const styles = ['pop', 'lofi', 'rnb', 'jazz'];

  it('InstrumentationPlan.roleProgram 存在且为最终生效;orchestrationChain 诊断齐全', () => {
    for (const style of styles) {
      const b = buildBandSpec({ seed: 5, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(5) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(5).substream('timbre'));
      for (const r of b.instrumentPool) expect(ip.roleProgram[r], `${style} ${r}`).toBeTypeOf('number');
      expect(ip.orchestrationChain.world).toBeTruthy();
      expect(ip.orchestrationChain.profileId).toBeTruthy();
      expect(ip.orchestrationChain.decisions.length).toBeGreaterThan(0);
    }
  });

  it('programByRoleSection 派生自 InstrumentationPlan.roleProgram(非 band.roleProgram)', () => {
    for (const style of styles) {
      const b = buildBandSpec({ seed: 7, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(7) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(7).substream('timbre'));
      // 每个非 chorus 段(无音色切换)的 program == 生效 roleProgram
      const baseSec = arr.sections.find((s) => s.role !== 'chorus') ?? arr.sections[0];
      for (const r of b.instrumentPool) {
        expect(ip.programByRoleSection[r][baseSec.id]).toBe(ip.roleProgram[r]);
      }
    }
  });

  it('吹奏手势计划由器配层随最终 program 下发,render 不再自行猜 GM 号', () => {
    const b0 = buildBandSpec({ seed: 8, styleHint: 'jazz', mood: 'build', targetDuration: 120 });
    const b = { ...b0, roleProgram: { ...b0.roleProgram, lead: 67, comp: 4, bass: 32, drum: 40 } };
    const arr = buildArrangementPlan(b, { rng: createRandomContext(8) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(8).substream('timbre'));
    expect(ip.roleProgram.lead).toBe(67);
    expect(ip.gestureExpressionByRole.lead.kind).toBe('sax-breath-legato');
    expect(ip.gestureExpressionByRole.lead.breathModel).toBe('reed-continuous');
    expect(ip.gestureExpressionByRole.comp.kind).toBe('keyboard-touch');
    expect(ip.gestureExpressionByRole.bass.kind).toBe('bass-walk');
    expect(ip.gestureExpressionByRole.drum.kind).toBe('drum-rudiment');
  });

  it('所有在场角色都有最终 program;comp 必 canPlayComp;bass 必 bass 族;pad 必 pad/持续', () => {
    for (let seed = 1; seed <= 40; seed++) for (const style of styles) {
      const b = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      for (const r of b.instrumentPool) expect(ip.roleProgram[r]).toBeTypeOf('number');
      if (b.instrumentPool.includes('comp')) expect(canPlayComp(ip.roleProgram.comp), `${seed}/${style} comp`).toBe(true);
      if (b.instrumentPool.includes('bass')) expect(instrumentInfo(ip.roleProgram.bass).family, `${seed}/${style} bass`).toBe('bass');
      if (b.instrumentPool.includes('pad')) {
        const p = ip.roleProgram.pad;
        const okPad = isSustainedInstrument(p) || ['pad', 'strings'].includes(instrumentInfo(p).family);
        expect(okPad, `${seed}/${style} pad GM${p}`).toBe(true);
      }
    }
  });

  it('jazz 永不合成贝斯(链 hard-reject)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const b = buildBandSpec({ seed, styleHint: 'jazz', mood: 'build', targetDuration: 120 });
      if (!b.instrumentPool.includes('bass')) continue;
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      expect([38, 39]).not.toContain(ip.roleProgram.bass);
    }
  });
});
