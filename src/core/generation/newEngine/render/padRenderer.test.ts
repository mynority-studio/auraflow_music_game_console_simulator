import { describe, it, expect } from 'vitest';
import { renderPad } from './padRenderer';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/padRenderer (1.5)', () => {
  const band = buildBandSpec({ seed: 6, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(6));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

  // 织体分流:active = textureYieldPolicy active 段;floating = 其余
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  }
  const floatingSectionIds = new Set<string>();
  for (const s of arrangement.sections) if (!activeSectionIds.has(s.id)) floatingSectionIds.add(s.id);

  const pad = renderPad(plan, timebase, floatingSectionIds);
  const comp = renderAccompaniment(plan, timebase, { style: band.style, activeSectionIds }).find((t) => t.role === 'comp')!;

  it('pad 只在 floating 段(intro/outro/bridge),非空', () => {
    expect(floatingSectionIds.has('intro')).toBe(true);
    expect(pad.notes.length).toBeGreaterThan(0);
    // pad 的每个音都落在 floating 段的 chord span 上
    const floatingTicks = new Set(
      plan.chordTimeline.filter((c) => floatingSectionIds.has(c.sectionId)).map((c) => timebase.beatToTick(c.startBeat)),
    );
    for (const n of pad.notes) expect(floatingTicks.has(n.startTick)).toBe(true);
  });

  it('pad 长音(持续整段)+ 落 [55,79]', () => {
    for (const n of pad.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(55);
      expect(n.pitch).toBeLessThanOrEqual(79);
      expect(n.durationTicks).toBeGreaterThanOrEqual(480); // 至少 1 拍持续
    }
  });

  it('★ 织体分流不重叠:comp 不进 floating 段', () => {
    const floatingTickRanges = plan.chordTimeline
      .filter((c) => floatingSectionIds.has(c.sectionId))
      .map((c) => [timebase.beatToTick(c.startBeat), timebase.beatToTick(c.startBeat) + timebase.beatToTick(c.durationBeats)] as const);
    for (const n of comp.notes) {
      const inFloating = floatingTickRanges.some(([lo, hi]) => n.startTick >= lo && n.startTick < hi);
      expect(inFloating).toBe(false);
    }
  });

  it('确定性', () => {
    const again = renderPad(plan, timebase, floatingSectionIds);
    expect(again.notes.map((n) => n.pitch)).toEqual(pad.notes.map((n) => n.pitch));
  });
});
