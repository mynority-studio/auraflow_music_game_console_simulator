// ============================================================
// newEngine · harmony · ProgressionRealizer / Loop 2 测试
// ------------------------------------------------------------
// 锁 Loop 2:prototype slot → ResolvedChord(rootPc/durationBeats/窄品质/宽chordType/borrowed);
// borrowedSource 进 HarmonicPlan;beats split → 半小节 span;同 repeatGroup 同 prototype。
// ============================================================

import { describe, expect, it } from 'vitest';
import { realizeProgressionSlots, narrowQuality } from './progressionRealizer';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { PROGRESSION_POOL } from '../knowledge/progressions';
import { createRandomContext, pc } from '../foundation';
import type { Section } from '../arranger/ArrangementPlan';

const POP_EPIC = PROGRESSION_POOL.find((p) => p.id === 'pop_epic_cadence_8')!; // 含 bVI/bVII modal_interchange
const sec = { id: 'verse1', role: 'verse', bars: 8, hookPolicy: 'main' } as unknown as Section;

describe('narrowQuality 宽 chordType → 窄 ChordQuality', () => {
  it('映射正确', () => {
    expect(narrowQuality('maj9')).toBe('maj7');
    expect(narrowQuality('m9')).toBe('m7');
    expect(narrowQuality('m11')).toBe('m7');
    expect(narrowQuality('13sus4')).toBe('7');
    expect(narrowQuality('7b13')).toBe('7');
    expect(narrowQuality('add9')).toBe('maj');
    expect(narrowQuality('6/9')).toBe('maj');
    expect(narrowQuality('m7b5')).toBe('m7b5');
    expect(narrowQuality('dim7')).toBe('dim7');
  });
});

describe('realizeProgressionSlots', () => {
  it('rootPc = sectionKey + rootOffset · durationBeats · 宽 chordType + borrowedSource 保留', () => {
    const rc = realizeProgressionSlots({ slots: POP_EPIC.slots, section: sec, sectionKey: pc(0), isModulated: false, beatsPerBar: 4, style: 'POP', colorBudget: 0.5, random: createRandomContext(1).substream('harmony') });
    expect(rc.length).toBe(POP_EPIC.slots.length);
    expect(rc[0].durationBeats).toBe(4); // 整小节
    // bVI(rootOffset 8)→ rootPc 8,chordType maj9,borrowedSource modal_interchange
    const bvi = rc.find((c) => c.rootPc === 8 && c.borrowedSource === 'modal_interchange');
    expect(bvi).toBeDefined();
    expect(bvi!.chordType).toBe('maj9');
    expect(bvi!.quality).toBe('maj7'); // 窄品质
  });

  it('beats=2 → 半小节 span', () => {
    const slots = POP_EPIC.slots.map((s, i) => (i === 0 ? { ...s, beats: 2 } : s));
    const rc = realizeProgressionSlots({ slots, section: sec, sectionKey: pc(0), isModulated: false, beatsPerBar: 4, style: 'POP', colorBudget: 0.5, random: createRandomContext(1).substream('harmony') });
    expect(rc[0].durationBeats).toBe(2);
  });

  it('转调段:isModulated → sectionKeyPc 标记 + 整体移调', () => {
    const rc = realizeProgressionSlots({ slots: POP_EPIC.slots, section: sec, sectionKey: pc(1), isModulated: true, beatsPerBar: 4, style: 'POP', colorBudget: 0.5, random: createRandomContext(1).substream('harmony') });
    expect(rc[0].sectionKeyPc).toBe(1);
    // bVI 在 Db:rootPc = 1 + 8 = 9
    expect(rc.some((c) => c.rootPc === 9 && c.borrowedSource === 'modal_interchange')).toBe(true);
  });

  it('应用属和弦同时保留局部 V/X 与可移调的目标中心', () => {
    const slots = [{
      roman: 'V/iv',
      type: '7',
      rootOffset: 0,
      scaleDegree: 5,
      appliedTarget: { roman: 'iv', rootOffset: 5 },
      lockType: true,
      borrowedSource: 'secondary_dominant' as const,
    }];
    const inE = realizeProgressionSlots({
      slots,
      section: sec,
      sectionKey: pc(4),
      isModulated: false,
      beatsPerBar: 5,
      style: 'JAZZ',
      colorBudget: 0.5,
      random: createRandomContext(1).substream('harmony'),
    })[0];
    expect(inE.rootPc).toBe(4); // E7
    expect(inE.roman).toMatchObject({
      degree: 5,
      quality: '7',
      secondaryTarget: { degree: 4, accidental: 'natural', quality: 'm7' },
    });
    expect(inE.localTonalCenterPc).toBe(9); // A = iv of E minor
    expect(inE.analysisKeyPc).toBe(9);
    expect(inE.localRoman).toBe('V');

    const inD = realizeProgressionSlots({
      slots,
      section: sec,
      sectionKey: pc(2),
      isModulated: false,
      beatsPerBar: 5,
      style: 'JAZZ',
      colorBudget: 0.5,
      random: createRandomContext(1).substream('harmony'),
    })[0];
    expect(inD.rootPc).toBe(2); // D7
    expect(inD.localTonalCenterPc).toBe(7); // G
  });
});

describe('端到端:prototype 元数据进 HarmonicPlan', () => {
  it('prototype borrowedSource 进 HarmonicPlan(多 seed 至少一次)', () => {
    let found = false;
    for (let seed = 0; seed < 10 && !found; seed++) {
      const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
      const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(seed));
      if (plan.chordTimeline.some((c) => c.borrowedSource !== undefined)) found = true;
    }
    expect(found).toBe(true);
  });

  it('宽 chordType 进 HarmonicPlan(prototype 色彩类型)', () => {
    const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(5));
    expect(plan.chordTimeline.some((c) => (c.chordType ?? '').match(/maj9|m9|sus4|add9|6\/9/))).toBe(true);
  });

  it('同 repeatGroup:verse1 ≡ verse2 的 chordType 序列一致', () => {
    const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(5));
    const types = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.chordType);
    if (plan.chordTimeline.some((c) => c.sectionId === 'verse2')) {
      expect(types('verse1')).toEqual(types('verse2'));
    }
  });
});
