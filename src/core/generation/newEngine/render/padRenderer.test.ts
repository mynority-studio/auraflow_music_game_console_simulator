import { describe, it, expect } from 'vitest';
import { renderPad } from './padRenderer';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildTextureSchedule } from './textureSchedule';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/padRenderer · 独立常驻轨 (1.5)', () => {
  const band = buildBandSpec({ seed: 6, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(6));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  }
  const sectionRoleById = Object.fromEntries(arrangement.sections.map((s) => [s.id, s.role]));
  const schedule = buildTextureSchedule({ plan, style: band.style, sectionRoleById, activeSectionIds, textureRng: createRandomContext(6).substream('compTexture') });

  const pad = renderPad(plan, timebase, { padDensity: band.styleProfile.padDensity, activeSectionIds });
  const comp = renderAccompaniment(plan, timebase, { style: band.style, activeSectionIds, sectionRoleById, textureSchedule: schedule }).find((t) => t.role === 'comp')!;

  it('pad 覆盖【全段落】(active + floating 都有),非空', () => {
    expect(pad.notes.length).toBeGreaterThan(0);
    const sectionsWithPad = new Set<string>();
    for (const n of pad.notes) {
      const span = plan.chordTimeline.find((c) => timebase.beatToTick(c.startBeat) === n.startTick);
      if (span) sectionsWithPad.add(span.sectionId);
    }
    // active 段也有 pad(关键:不再被 floating XOR 掉)
    const anyActiveHasPad = [...activeSectionIds].some((sid) => sectionsWithPad.has(sid));
    expect(anyActiveHasPad).toBe(true);
  });

  it('★ pad 与 comp 在同一 active 段【共存】(不再二选一)', () => {
    const activeSpan = plan.chordTimeline.find((c) => activeSectionIds.has(c.sectionId) && schedule[c.id])!;
    expect(activeSpan).toBeDefined();
    const lo = timebase.beatToTick(activeSpan.startBeat);
    const hi = lo + timebase.beatToTick(activeSpan.durationBeats);
    const inSpan = (ns: { startTick: number }[]) => ns.some((n) => n.startTick >= lo && n.startTick < hi);
    expect(inSpan(pad.notes as never), 'pad 应在 active 段出音').toBe(true);
    expect(inSpan(comp.notes as never), 'comp 应在 active 段出音').toBe(true);
  });

  it('pad 长音 + 落 [55,79];active 段比 floating 段压软', () => {
    for (const n of pad.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(55);
      expect(n.pitch).toBeLessThanOrEqual(79);
      expect(n.durationTicks).toBeGreaterThanOrEqual(480);
    }
    const velAt = (active: boolean) => {
      const span = plan.chordTimeline.find((c) => active === activeSectionIds.has(c.sectionId));
      const n = span && pad.notes.find((x) => x.startTick === timebase.beatToTick(span.startBeat));
      return n ? (n.velocity as number) : undefined;
    };
    const a = velAt(true); const f = velAt(false);
    if (a !== undefined && f !== undefined) expect(a).toBeLessThan(f); // active 更软
  });

  it('确定性', () => {
    const again = renderPad(plan, timebase, { padDensity: band.styleProfile.padDensity, activeSectionIds });
    expect(again.notes.map((n) => n.pitch)).toEqual(pad.notes.map((n) => n.pitch));
  });
});
