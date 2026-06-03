import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, pc } from '../foundation';

describe('harmony · Band→Arranger→Harmony 端到端', () => {
  const band = buildBandSpec({ seed: 42, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const rng = createRandomContext(42);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, rng);

  it('和弦总数 = Σ(section.bars * chordsPerBar)', () => {
    let expected = 0;
    for (const s of arrangement.sections) {
      expected += s.bars * (arrangement.harmonicRhythmTarget.chordsPerBarBySection[s.id] ?? 1);
    }
    expect(plan.chordTimeline.length).toBe(expected);
  });

  it('chorus 段和声节奏加密(chord 时长 = 半小节)', () => {
    const chorusSpans = plan.chordTimeline.filter((c) => c.sectionId === 'chorus1');
    const verseSpans = plan.chordTimeline.filter((c) => c.sectionId === 'verse1');
    // pop 4/4:verse 每和弦 4 拍,chorus 每和弦 2 拍
    expect(verseSpans[0].durationBeats).toBe(4);
    expect(chorusSpans[0].durationBeats).toBe(2);
  });

  it('根音是 C 大调 diatonic(全落在大调音阶 pc 上)', () => {
    const majorPcs = new Set([0, 2, 4, 5, 7, 9, 11]); // C 大调
    for (const c of plan.chordTimeline) {
      expect(majorPcs.has(c.rootPc)).toBe(true);
    }
  });

  it('品质 diatonic(V 级 = 属七)', () => {
    // 找一个 degree=5 的和弦(root = G = 7)
    const v = plan.chordTimeline.find((c) => c.rootPc === 7);
    if (v) expect(v.quality).toBe('7');
  });

  it('★ 铁律9 排比:verse1 与 verse2 进行相同;chorus1 与 chorus2 相同', () => {
    const roots = (sid: string) => plan.chordTimeline.filter((c) => c.sectionId === sid).map((c) => c.rootPc);
    expect(roots('verse1')).toEqual(roots('verse2'));
    expect(roots('chorus1')).toEqual(roots('chorus2'));
  });

  it('深不可变 + 每 span 有张力表', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    for (const c of plan.chordTimeline) {
      expect(plan.tensionMap[c.id]).toBeDefined();
      expect(plan.avoidNoteMap[c.id]).toBeDefined();
    }
  });

  it('确定性:同 band+arrangement+seed → 同根音序列', () => {
    const again = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(42));
    expect(again.chordTimeline.map((c) => c.rootPc)).toEqual(plan.chordTimeline.map((c) => c.rootPc));
  });
});
