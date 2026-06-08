import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, pc } from '../foundation';

describe('harmony · Band→Arranger→Harmony 端到端', () => {
  const band = buildBandSpec({ seed: 42, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
  const arrangement = buildArrangementPlan(band);
  const rng = createRandomContext(42);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, rng);

  it('和声时长恰好铺满曲式(Σ durationBeats = Σ bars × beatsPerBar;split-bar 槽 ⇒ 和弦数 ≥ 小节数)', () => {
    // ★ 修(2026-06-08):prototype 可含半小节槽(beats:2,如副属 ii-V)→ 和弦数 > 小节数是正常的;
    //   真正的不变量 = 时长铺满(每段 cov = bars × beatsPerBar)→ 时间线与 arrangement 对齐(否则 outro 被挤掉)。
    const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
    const totalBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
    const totalBeats = plan.chordTimeline.reduce((n, c) => n + (c.durationBeats as number), 0);
    expect(totalBeats).toBe(totalBars * beatsPerBar);
    // 每段都恰好铺满(无短缺)
    for (const s of arrangement.sections) {
      const cov = plan.chordTimeline.filter((c) => c.sectionId === s.id).reduce((n, c) => n + (c.durationBeats as number), 0);
      expect(cov).toBe(s.bars * beatsPerBar);
    }
    expect(plan.chordTimeline.length).toBeGreaterThanOrEqual(totalBars); // split 槽 ⇒ ≥
  });

  it('prototype = 1 和弦/小节(verse/chorus 同;chordsPerBar 加密退役)', () => {
    const chorusSpans = plan.chordTimeline.filter((c) => c.sectionId === 'chorus1');
    const verseSpans = plan.chordTimeline.filter((c) => c.sectionId === 'verse1');
    expect(verseSpans[0].durationBeats).toBe(4);  // pop 4/4 整小节
    expect(chorusSpans[0].durationBeats).toBe(4);
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
