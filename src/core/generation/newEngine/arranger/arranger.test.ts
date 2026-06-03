import { describe, it, expect } from 'vitest';
import { buildArrangementPlan } from './arranger';
import { buildBandSpec } from '../band/bandEngine';

describe('arranger/arranger (composed ArrangementPlan)', () => {
  const band = buildBandSpec({ seed: 1, styleHint: 'lofi', mood: 'calm-build', targetDuration: 120 });
  const plan = buildArrangementPlan(band);

  it('曲式:intro-verse-chorus-verse-chorus-outro', () => {
    expect(plan.sections.map((s) => s.role)).toEqual(['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro']);
  });

  it('时间:lofi → 78bpm 4/4 straight', () => {
    expect(plan.tempoBpm).toBe(78);
    expect(plan.meter).toEqual({ numerator: 4, denominator: 4 });
    expect(plan.feel.kind).toBe('straight');
  });

  it('动力:chorus 能量最高 + 和声节奏加密(2 chord/bar)', () => {
    const chorusId = plan.sections.find((s) => s.role === 'chorus')!.id;
    const verseId = plan.sections.find((s) => s.role === 'verse')!.id;
    expect(plan.energyBySection[chorusId]).toBeGreaterThan(plan.energyBySection[verseId]);
    expect(plan.harmonicRhythmTarget.chordsPerBarBySection[chorusId]).toBe(2);
    expect(plan.harmonicRhythmTarget.chordsPerBarBySection[verseId]).toBe(1);
  });

  it('高潮 = 最后一个 chorus(chorus2)', () => {
    expect(plan.climaxMap.length).toBe(1);
    expect(plan.climaxMap[0].sectionId).toBe('chorus2');
    expect(plan.climaxMap[0].intensity).toBe(1);
  });

  it('phrases + motifBindings 一一对应,排比生效', () => {
    expect(plan.motifBindings.length).toBe(plan.phrases.length);
    const v1 = plan.motifBindings.find((b) => b.phraseId === 'verse1-p0')!;
    const v2 = plan.motifBindings.find((b) => b.phraseId === 'verse2-p0')!;
    expect(v1.motifId).toBe(v2.motifId);
  });

  it('ArrangementPlan 深不可变', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sections)).toBe(true);
    expect(() => { (plan as unknown as { sections: unknown[] }).sections.push({}); }).toThrow(TypeError);
  });

  it('确定性:同 BandSpec → 同段落/动机', () => {
    const again = buildArrangementPlan(band);
    expect(again.motifBindings.map((b) => b.motifId)).toEqual(plan.motifBindings.map((b) => b.motifId));
  });
});
