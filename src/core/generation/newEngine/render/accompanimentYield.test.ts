import { describe, it, expect } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/accompaniment 让位 (melody-aware)', () => {
  const band = buildBandSpec({ seed: 2, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(2));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

  // 复现 renderSongFull 的让位上下文构造
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  }
  const anchorBeats = new Set<number>();
  for (const slot of instrumentation.melodyReservationPlan.hookAnchorSlots) {
    if (slot.anchorRequired) anchorBeats.add(slot.beatSlot);
  }

  const noYield = renderAccompaniment(plan, timebase);
  const withYield = renderAccompaniment(plan, timebase, { anchorBeats, activeSectionIds });

  it('chorus 是 active 段;有主 hook 锚点拍', () => {
    expect(activeSectionIds.has('chorus1')).toBe(true);
    expect(anchorBeats.size).toBeGreaterThan(0);
  });

  it('让位后 comp 总音数 < 不让位(锚点拍瘦身成 shell)', () => {
    const compCount = (tracks: typeof noYield) => tracks.find((t) => t.role === 'comp')!.notes.length;
    expect(compCount(withYield)).toBeLessThan(compCount(noYield));
  });

  it('锚点拍处 comp 瘦身到 ≤2 音(3+7 shell)', () => {
    const anchorBeat = [...anchorBeats][0];
    const tick = anchorBeat * 480; // 4/4 ppq=480
    const comp = withYield.find((t) => t.role === 'comp')!;
    const atAnchor = comp.notes.filter((n) => n.startTick === tick);
    expect(atAnchor.length).toBeGreaterThan(0);
    expect(atAnchor.length).toBeLessThanOrEqual(2);
  });
});
