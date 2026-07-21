import { describe, it, expect } from 'vitest';
import { buildInstrumentationPlan } from './instrumentalPlanner';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext } from '../foundation';
import { playableRangeForRole } from '../knowledge/instruments';
import { JAZZ_4_4_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { ACG_PIANOSONG_PIANO_VOICES, DREAM5504_TARGET_ID, isGMBK5X128VoiceAddressable } from '../../../sound/GMBK5X128Voices';
import { DREAM5504_DRUM_KIT_COUNT, DREAM5504_MODERN_MELODIC_VOICE_COUNT, DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT, DREAM5504_VOICE_FAMILY_COUNTS } from './dreamVoiceProfiles';

describe('instrumental/instrumentalPlanner', () => {
  const band = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildInstrumentationPlan(band, arrangement);

  it('织体按段落功能，首段再消费 openingGesture textureEntry', () => {
    expect(plan.textureBySection.chorus1).toBe('active-comp');
    expect(arrangement.openingGesture.textureEntry).toBe('pianoRiff');
    expect(plan.textureBySection.intro).toBe('arpeggio');
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

  it('原声钢琴由器配层按段落下发低频 CC11 乐句表情；非钢琴不生成控制器计划', () => {
    const pianoBand = buildBandSpec({ seed: 1662, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const pianoArrangement = buildArrangementPlan(pianoBand);
    const pianoPlan = buildInstrumentationPlan(pianoBand, pianoArrangement);
    expect(pianoPlan.roleProgram.comp).toBe(0);
    const events = pianoPlan.controllerPlanByRole.comp?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map((event) => event.controller))).toEqual(new Set([11]));
    expect(events.map((event) => event.value).every((value) => [70, 80, 90, 100].includes(value))).toBe(true);
    expect(events.map((event) => event.value)).toEqual(expect.arrayContaining([70, 90]));
    expect(events.every((event) => ['piano-phrase-expression', 'piano-motion-expression'].includes(event.reason))).toBe(true);
    expect(pianoPlan.controllerPlanByRole.pad).toBeUndefined();
  });

  it('JAZZ 原声钢琴 comp 消费总谱：切分演奏段禁 CC64、按小节用 CC11；抒情收束段才保留换和声踏板', () => {
    const jazzBand = buildBandSpec({ seed: 9, styleHint: 'jazz', mood: 'build', targetDuration: 96 });
    const jazzArrangement = buildArrangementPlan(jazzBand, { rng: createRandomContext(9) });
    const jazzPlan = buildInstrumentationPlan(jazzBand, jazzArrangement, createRandomContext(9).substream('timbre'));
    expect([0, 1, 3]).toContain(jazzPlan.roleProgram.comp);
    const fastSections = jazzArrangement.sections.filter((section) =>
      jazzArrangement.rolePerformanceBySection.comp[section.id].keyboardMotion === 'syncopated-comp');
    const lyricalSections = jazzArrangement.sections.filter((section) =>
      jazzArrangement.rolePerformanceBySection.comp[section.id].keyboardMotion === 'lyrical');
    expect(fastSections.length).toBeGreaterThan(0);
    expect(lyricalSections.length).toBeGreaterThan(0);
    for (const section of fastSections) {
      expect(jazzPlan.pedalPlanByRole.comp?.disabledBySection[section.id]).toBe('fast-keyboard-motion');
    }
    expect((jazzPlan.pedalPlanByRole.comp?.events ?? []).every((event) =>
      lyricalSections.some((section) => section.id === event.sectionId))).toBe(true);
    const cc11 = jazzPlan.controllerPlanByRole.comp?.events ?? [];
    expect(cc11.length).toBe(
      fastSections.reduce((sum, section) => sum + section.bars, 0) + lyricalSections.length,
    );
    expect(cc11.filter((event) => fastSections.some((section) => section.id === event.sectionId))
      .every((event) => event.reason === 'piano-motion-expression')).toBe(true);
    expect(cc11.every((event) => event.controller === 11 && [70, 80, 90, 100].includes(event.value))).toBe(true);
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
  it('★ A1 密度弧:首段角色来自 openingGesture → chorus 全员同进;core 段含 lead;verse1≡verse2', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(3) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    const roles = (id: string) => ip.activeRolesBySection[id] ?? [];

    const first = arr.sections[0];
    const expectedOpeningRoles = b.instrumentPool.filter((role) => {
      const delay = arr.openingGesture.roleDelayBars[role];
      return delay !== undefined && delay < first.bars;
    });
    expect([...roles(first.id)].sort()).toEqual([...expectedOpeningRoles].sort());
    for (const r of b.instrumentPool) expect(roles('chorus1')).toContain(r); // chorus 全员
    // core 段(story/hook)恒含 lead(旋律扛歌;intro/outro 可缺席)
    for (const s of arr.sections) if (['story', 'hook'].includes(s.functionTag ?? '')) expect(roles(s.id)).toContain('lead');
    expect(roles('verse1')).toEqual(roles('verse2'));             // repeatGroup 一致(verse×2 同活动 = 记忆点)

    const ip2 = buildInstrumentationPlan(b, arr, createRandomContext(3).substream('timbre'));
    expect(ip2.activeRolesBySection).toEqual(ip.activeRolesBySection); // 确定性
  });

  it('★ openingGesture 是首段 activeRoles 唯一真源', () => {
    const b = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    for (let seed = 0; seed < 16; seed++) {
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      const first = arr.sections[0];
      const expected = b.instrumentPool.filter((role) => {
        const delay = arr.openingGesture.roleDelayBars[role];
        return delay !== undefined && delay < first.bars;
      });
      expect([...(ip.activeRolesBySection[first.id] ?? [])].sort(), `seed ${seed}`)
        .toEqual([...expected].sort());
    }
  });

  it('★ openingGesture.textureEntry 覆盖首段既有 texture 真源；none 保持原计划', () => {
    const seed = 3;
    const b = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
    const firstId = arr.sections[0].id;
    const noneArrangement = {
      ...arr,
      openingGesture: { ...arr.openingGesture, textureEntry: 'none' as const },
    };
    const original = buildInstrumentationPlan(b, noneArrangement, createRandomContext(seed).substream('timbre'));
    const forced = original.textureBySection[firstId] === 'active-comp'
      ? { entry: 'padSwell' as const, texture: 'pad' as const }
      : { entry: 'synthPulse' as const, texture: 'active-comp' as const };
    const forcedArrangement = {
      ...arr,
      openingGesture: { ...arr.openingGesture, textureEntry: forced.entry },
    };
    const overridden = buildInstrumentationPlan(b, forcedArrangement, createRandomContext(seed).substream('timbre'));

    expect(overridden.textureBySection[firstId]).toBe(forced.texture);
    expect(overridden.textureBySection[firstId]).not.toBe(original.textureBySection[firstId]);
    for (const section of arr.sections.slice(1)) {
      expect(overridden.textureBySection[section.id]).toBe(original.textureBySection[section.id]);
    }
  });

  it('★ opening texture 复用既有 yield 调度：Rhodes 由 comp 发声，padSwell 由 pad 托底', () => {
    const seed = 3;
    const b = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
    const firstId = arr.sections[0].id;
    const withTexture = (textureEntry: 'rhodesDust' | 'padSwell') => buildInstrumentationPlan(b, {
      ...arr,
      openingGesture: {
        ...arr.openingGesture,
        textureEntry,
        roleDelayBars: { comp: 0, pad: 0 },
      },
    }, createRandomContext(seed).substream('timbre'));
    const primaryHarmonyOwner = (ip: ReturnType<typeof buildInstrumentationPlan>): 'comp' | 'pad' | 'none' => {
      const roles = ip.activeRolesBySection[firstId] ?? [];
      const activeCompTexture = ip.textureYieldPolicy[ip.textureBySection[firstId]] === 'active';
      if (roles.includes('comp') && activeCompTexture) return 'comp';
      if (roles.includes('pad')) return 'pad';
      if (roles.includes('comp')) return 'comp';
      return 'none';
    };

    const rhodes = withTexture('rhodesDust');
    expect(rhodes.textureBySection[firstId]).toBe('arpeggio');
    expect(primaryHarmonyOwner(rhodes)).toBe('comp');

    const swell = withTexture('padSwell');
    expect(swell.textureBySection[firstId]).toBe('pad');
    expect(primaryHarmonyOwner(swell)).toBe('pad');
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

  it('器配计划消费完整 Dream 5504 硬件世界，而风格链仍保留自身的音乐性约束', () => {
    expect(plan.hardwareVoiceWorld).toEqual({
      targetId: DREAM5504_TARGET_ID,
      melodicVoiceCount: DREAM5504_MODERN_MELODIC_VOICE_COUNT,
      drumKitCount: DREAM5504_DRUM_KIT_COUNT,
      excludedMt32CompatibilityVoiceCount: DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
      familyCounts: DREAM5504_VOICE_FAMILY_COUNTS,
    });
    expect(plan.orchestrationChain.decisions.some(decision => decision.includes('Dream5504 modern-GM melodic='))).toBe(true);
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

  it('★ ACG downbeat comp anchor 合同与 renderer 的 pedal-support 策略一致', () => {
    const b = buildBandSpec({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 90 });
    const arr = buildArrangementPlan(b, { rng: createRandomContext(7) });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(7).substream('timbre'));
    const compWithoutPad = arr.sections.filter((section) => {
      const roles = ip.activeRolesBySection[section.id] ?? [];
      return roles.includes('comp') && !roles.includes('pad');
    });

    expect(compWithoutPad.length).toBeGreaterThan(0);
    for (const section of arr.sections) {
      expect(ip.needsDownbeatCompAnchorBySection[section.id], section.id).toBe(false);
    }
  });

  it('★ ACG PIANOSONG 每个实际段落保留低根与中部琶音：允许 motif-first 直接入主题', () => {
    const requiredTags = new Set(['setup', 'head', 'build', 'headOut', 'tag']);
    for (const seed of [0, 7, 42, 99]) {
      const b = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      const seen = new Set<string>();
      for (const section of arr.sections) {
        if (!requiredTags.has(section.functionTag ?? '')) continue;
        seen.add(section.functionTag!);
        const roles = ip.activeRolesBySection[section.id] ?? [];
        expect(roles, `seed ${seed} ${section.id}=${section.functionTag} 左手低根`).toContain('bass');
        expect(roles, `seed ${seed} ${section.id}=${section.functionTag} 中部琶音`).toContain('comp');
      }
      // Hidden ACG arrangement profiles may deliberately start with the motif
      // instead of a setup prelude. The invariant is the three musical anchors
      // and the piano-trio ownership of every section that actually exists.
      for (const tag of ['head', 'headOut', 'tag']) {
        expect(seen, `seed ${seed} ACG 必备段 ${tag}`).toContain(tag);
      }
    }
  });

  it('★ ACG PIANOSONG 每首只选一组官方 CC0+Program，三轨/所有段完全一致且跨 seed 有受控调色', () => {
    const allow = new Set(ACG_PIANOSONG_PIANO_VOICES.map((voice) => `${voice.bank}/${voice.program}`));
    const selected = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      const b = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(
        b,
        arr,
        createRandomContext(seed).substream('timbre'),
        undefined,
        createRandomContext(seed).substream('acgPianoVoice'),
      );
      const first = arr.sections[0].id;
      const address = `${ip.bankByRoleSection.lead[first] ?? 0}/${ip.programByRoleSection.lead[first]}`;
      expect(allow.has(address), `seed ${seed} ${address}`).toBe(true);
      for (const role of ['lead', 'comp', 'bass'] as const) {
        expect(`${ip.roleBank[role] ?? 0}/${ip.roleProgram[role]}`, `seed ${seed} ${role} base`).toBe(address);
        for (const section of arr.sections) {
          expect(`${ip.bankByRoleSection[role][section.id] ?? 0}/${ip.programByRoleSection[role][section.id]}`, `seed ${seed} ${role}/${section.id}`)
            .toBe(address);
        }
      }
      selected.add(address);
    }
    expect(selected.size).toBeGreaterThan(1);
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
import { canPlayComp, instrumentInfo, isBassRoleProgram, isSustainedInstrument } from '../knowledge/instruments';

describe('instrumental/instrumentalPlanner — 链式协同 GM 选择', () => {
  const styles = ['pop', 'lofi', 'rnb', 'jazz'];

  it('InstrumentationPlan.roleProgram 存在且为最终生效;orchestrationChain 诊断齐全', () => {
    for (const style of styles) {
      const b = buildBandSpec({ seed: 5, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(5) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(5).substream('timbre'));
      for (const r of b.instrumentPool) expect(ip.roleProgram[r], `${style} ${r}`).toBeTypeOf('number');
      for (const r of b.instrumentPool) {
        const firstSection = arr.sections[0].id;
        const program = ip.programByRoleSection[r][firstSection];
        const bank = ip.bankByRoleSection[r][firstSection];
        expect(isGMBK5X128VoiceAddressable(bank, program, r), `${style} ${r} GM${program} bank=${bank}`).toBe(true);
        expect(ip.voiceNameByRoleSection[r][firstSection], `${style} ${r} voice name`).toBeTruthy();
      }
      expect(ip.orchestrationChain.world).toBeTruthy();
      expect(ip.orchestrationChain.profileId).toBeTruthy();
      expect(ip.orchestrationChain.ensembleWorld).toBeTruthy();
      expect(ip.orchestrationChain.voiceNames).toBeTruthy();
      expect(ip.orchestrationChain.decisions.length).toBeGreaterThan(0);
    }
  });

  it('五种 macro 的最终计划消费真实编制模板，且鼓 kit 保持 arranger 合同', () => {
    const expectedWorlds: Record<string, readonly string[]> = {
      pop: ['cityPopElectricBand', 'cityPopPianoBand'],
      jazz: ['jazzPianoTrio', 'jazzSaxQuartet', 'smoothJazzQuartet'],
      lofi: ['lofiBoomBap'],
      rnb: ['rnbPocket'],
      acg: ['acgPianoTrio'],
    };
    for (const style of Object.keys(expectedWorlds)) {
      for (const seed of [1, 7, 19]) {
        const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
        const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
        const plan = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
        expect(expectedWorlds[style], `${style}/${seed}`).toContain(plan.orchestrationChain.ensembleWorld);
        if (band.instrumentPool.includes('drum')) expect(plan.roleProgram.drum).toBe(arrangement.songGrooveContract.drum.kitProgram);
      }
    }
  });

  it('RNB 的 St.FM 只给 comp、lead 使用独立主音色；Jazz/Sax bank 仍由器配层下发', () => {
    const rnbBase = buildBandSpec({ seed: 0, styleHint: 'rnb', mood: 'build', targetDuration: 90 });
    const rnbBand = { ...rnbBase, roleProgram: { ...rnbBase.roleProgram, lead: 5, comp: 5, bass: 38 } };
    const rnbArr = buildArrangementPlan(rnbBand, { rng: createRandomContext(0) });
    const rnbIp = buildInstrumentationPlan(rnbBand, rnbArr, createRandomContext(0).substream('timbre'));
    expect(rnbIp.roleProgram.lead).toBe(0);
    expect(rnbIp.roleBank.lead).toBe(0);
    expect(rnbIp.roleBank.comp).toBe(16);
    expect(rnbIp.voiceNameByRole.lead).toBe('Acoustic Grand Piano');
    expect(rnbIp.voiceNameByRole.comp).toBe('St.FM Electric Piano');
    expect(rnbIp.bankByRoleSection.lead[rnbArr.sections[0].id]).toBe(0);

    const jazzBase = buildBandSpec({ seed: 8, styleHint: 'jazz', mood: 'build', targetDuration: 120 });
    const jazzBand = { ...jazzBase, roleProgram: { ...jazzBase.roleProgram, lead: 66, comp: 0, bass: 32, drum: 40 } };
    const jazzArr = buildArrangementPlan(jazzBand, {
      rng: createRandomContext(8),
      jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    const jazzIp = buildInstrumentationPlan(jazzBand, jazzArr, createRandomContext(8).substream('timbre'));
    expect(jazzIp.roleProgram.lead).toBe(66);
    expect(jazzIp.roleBank.lead).toBe(8);
    expect(jazzIp.voiceNameByRole.lead).toBe('Breathy Tenor');
  });

  it('ACG 可将 bass 职能下发为 GM0 左手钢琴，并锁在低音 bass register', () => {
    const base = buildBandSpec({ seed: 12, styleHint: 'acg', mood: 'build', targetDuration: 90 });
    const band = { ...base, roleProgram: { ...base.roleProgram, lead: 0, comp: 0, bass: 0 } };
    const arrangement = buildArrangementPlan(band, { rng: createRandomContext(12) });
    const plan = buildInstrumentationPlan(band, arrangement, createRandomContext(12).substream('timbre'));
    expect(plan.orchestrationChain.ensembleWorld).toBe('acgPianoTrio');
    expect(plan.roleProgram.bass).toBe(0);
    expect(plan.roleBank.bass).toBe(0);
    expect(plan.registerByRole.bass).toEqual({ lowMidi: 28, highMidi: 55 });
    expect(plan.gestureExpressionByRole.bass.kind).toBe('keyboard-touch');
    for (const program of Object.values(plan.programByRoleSection.bass)) expect(program).toBe(0);
  });

  it('常规 seed 会在钢琴导向的 Pop/ACG 编制中实际选中 GM0 左手 bass', () => {
    for (const style of ['pop', 'acg']) {
      let selected = false;
      for (let seed = 0; seed < 64; seed++) {
        const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
        const plan = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
        if (plan.roleProgram.bass === 0) {
          selected = true;
          expect(['cityPopPianoBand', 'acgPianoTrio']).toContain(plan.orchestrationChain.ensembleWorld);
          expect(plan.registerByRole.bass).toEqual({ lowMidi: 28, highMidi: 55 });
          break;
        }
      }
      expect(selected, `${style} 应有至少一个 seed 选中 GM0 piano-left-hand bass`).toBe(true);
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
    const arr = buildArrangementPlan(b, {
      rng: createRandomContext(8),
      jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(8).substream('timbre'));
    expect(ip.roleProgram.lead).toBe(67);
    expect(ip.gestureExpressionByRole.lead.kind).toBe('sax-breath-legato');
    expect(ip.gestureExpressionByRole.lead.breathModel).toBe('reed-continuous');
    expect(ip.gestureExpressionByRole.comp.kind).toBe('keyboard-touch');
    expect(ip.gestureExpressionByRole.bass.kind).toBe('bass-walk');
    expect(ip.gestureExpressionByRole.drum.kind).toBe('drum-rudiment');
  });

  it('原声调试调色板在最终器配入口封住非原声音色与 808 回流', () => {
    const band = buildBandSpec({ seed: 5, styleHint: 'rnb', mood: 'build', targetDuration: 120 });
    const arrangement = buildArrangementPlan(band, { rng: createRandomContext(5) });
    const plan = buildInstrumentationPlan(
      band,
      arrangement,
      createRandomContext(5).substream('timbre'),
      undefined,
      undefined,
      'acoustic-debug',
    );

    expect(plan.orchestrationChain.profileId).toBe('acoustic-debug');
    expect(arrangement.acousticInstrumentationIntent?.id).toBe('rnb-piano-strings');
    if (band.instrumentPool.includes('comp')) expect([0, 1, 3]).toContain(plan.roleProgram.comp);
    if (band.instrumentPool.includes('lead')) expect([0, 1, 3, 40, 41, 42]).toContain(plan.roleProgram.lead);
    if (band.instrumentPool.includes('bass')) expect([32, 43]).toContain(plan.roleProgram.bass);
    if (band.instrumentPool.includes('pad')) expect([44, 48, 49]).toContain(plan.roleProgram.pad);
    if (band.instrumentPool.includes('drum')) expect([0, 8, 16, 32, 40]).toContain(plan.roleProgram.drum);
    const acousticAddressesByRole = {
      comp: [[0, 0], [0, 1], [0, 3]],
      lead: [[0, 0], [0, 1], [0, 3], [0, 40], [0, 41], [0, 42]],
      bass: [[0, 32], [0, 43]],
      pad: [[0, 44], [0, 48], [0, 49], [8, 48]],
    } as const;
    const melodicRoles = band.instrumentPool.filter((role): role is 'comp' | 'lead' | 'bass' | 'pad' => role !== 'drum');
    for (const role of melodicRoles) {
      const bank = plan.roleBank[role] ?? 0;
      expect(acousticAddressesByRole[role]).toContainEqual([bank, plan.roleProgram[role]]);
      for (const section of arrangement.sections) {
        expect([plan.roleBank[role]]).toContain(plan.bankByRoleSection[role][section.id]);
      }
    }
    if (band.instrumentPool.includes('pad')) {
      expect(plan.voiceProfileByRole.pad?.expressionFamily).toBe('bowed-string');
    }
    for (const profile of Object.values(plan.voiceProfileByRole)) {
      expect(profile?.performanceFamily).not.toBe('wind');
      expect(profile?.performanceFamily).not.toBe('guitar');
      expect(profile?.performanceFamily).not.toBe('synth');
    }
  });

  it('ACG 原声模板重新锁成一架钢琴的三种手部职责', () => {
    const acgBand = buildBandSpec({ seed: 17, styleHint: 'acg', mood: 'build', targetDuration: 90 });
    const acgArrangement = buildArrangementPlan(acgBand, { rng: createRandomContext(17) });
    const plan = buildInstrumentationPlan(
      acgBand,
      acgArrangement,
      createRandomContext(17).substream('timbre'),
      undefined,
      undefined,
      'acoustic-debug',
    );
    expect(acgArrangement.acousticInstrumentationIntent?.id).toBe('acg-piano-solo');
    expect([0, 1, 3]).toContain(plan.roleProgram.comp);
    expect(plan.roleProgram.lead).toBe(plan.roleProgram.comp);
    expect(plan.roleProgram.bass).toBe(plan.roleProgram.comp);
  });

  it('所有在场角色都有最终 program;comp 必 canPlayComp;bass 必为 bass 家族或钢琴左手;pad 必 pad/持续', () => {
    for (let seed = 1; seed <= 40; seed++) for (const style of styles) {
      const b = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
      const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
      for (const r of b.instrumentPool) expect(ip.roleProgram[r]).toBeTypeOf('number');
      if (b.instrumentPool.includes('comp')) expect(canPlayComp(ip.roleProgram.comp), `${seed}/${style} comp`).toBe(true);
      if (b.instrumentPool.includes('bass')) expect(isBassRoleProgram(ip.roleProgram.bass), `${seed}/${style} bass`).toBe(true);
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
