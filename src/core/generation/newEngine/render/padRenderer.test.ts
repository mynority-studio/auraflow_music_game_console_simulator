import { describe, it, expect } from 'vitest';
import { renderPad } from './padRenderer';
import { decidePadComp, type PadCompDecision } from './padCompPolicy';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

// ============================================================
// render/padRenderer · pad = sustain/air/慢声部层
//   默认来自当前和弦:comp active → chord-bed/drone,pad-only → full-support。
//   注:直接构造 padActive=true 的决策(隔离 band lineup,聚焦渲染行为)。
// ============================================================

describe('render/padRenderer · mode-based voicing (pad-comp 第一期)', () => {
  const band = buildBandSpec({ seed: 6, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(6));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const reservedReg = instrumentation.melodyReservationPlan.reservedRegister;

  // 偶数段 → comp active(chord-bed/breath-space);奇数段 → comp inactive(pad-only full-support)。
  const decisionBySection: Record<string, PadCompDecision> = {};
  arrangement.sections.forEach((s, i) => {
    decisionBySection[s.id] = decidePadComp({
      style: band.style, sectionId: s.id, sectionRole: s.role,
      padDensity: 0.5, padActive: true, compActive: i % 2 === 0, bassActive: true,
      leadReservedLow: reservedReg.lowMidi, leadReservedHigh: reservedReg.highMidi,
    });
  });

  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection, leadReservedLow: reservedReg.lowMidi });
  const activePitchesForSpan = (span: (typeof plan.chordTimeline)[number]): number[] => {
    const lo = timebase.beatToTick(span.startBeat) as number;
    const hi = lo + (timebase.beatToTick(span.durationBeats) as number);
    return pad.notes.filter((note) => {
      const start = note.startTick as number;
      return start < hi && start + (note.durationTicks as number) > lo;
    }).map((note) => note.pitch as number);
  };

  it('pad 非空,长 sustain,落在器配 Pad 音区 [48, leadReservedLow)', () => {
    expect(pad.notes.length).toBeGreaterThan(0);
    for (const n of pad.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThan(reservedReg.lowMidi); // 顶须低于旋律保留区(避让 lead)
      expect(n.durationTicks).toBeGreaterThanOrEqual(480);
    }
  });

  it('★ 有 bass 时 Pad 永不含 root，因此不会复制含 root 的完整和弦', () => {
    let checked = 0;
    for (const span of plan.chordTimeline) {
      const pitches = activePitchesForSpan(span);
      const inter = decisionBySection[span.sectionId].interactionMode;
      if (inter === 'pad-under-comp' || inter === 'breath-space') {
        expect(pitches.length).toBeLessThanOrEqual(3);
        checked++;
      }
      // 所有段:bass 在场 → pad 省 root → 永不复制"含 root 的完整和弦"。
      for (const p of pitches) expect(((p % 12) + 12) % 12).not.toBe(span.rootPc);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('★ comp active 段:pad 每 span ≤ 3 音、省 root(pc 不含和弦 root)', () => {
    let compActiveChecked = 0;
    for (const span of plan.chordTimeline) {
      const pitches = activePitchesForSpan(span);
      const dec = decisionBySection[span.sectionId];
      if (dec.interactionMode !== 'pad-under-comp' && dec.interactionMode !== 'breath-space') continue;
      expect(pitches.length).toBeLessThanOrEqual(3);            // thin chord-bed
      for (const p of pitches) expect(((p % 12) + 12) % 12).not.toBe(span.rootPc); // 省 root
      compActiveChecked++;
    }
    expect(compActiveChecked).toBeGreaterThan(0);
  });

  it('★ pad-only 段:pad 可达 3 音(full-support 承担更多和声)', () => {
    let maxPadOnly = 0;
    for (const span of plan.chordTimeline) {
      const pitches = activePitchesForSpan(span);
      if (decisionBySection[span.sectionId].interactionMode !== 'pad-only') continue;
      maxPadOnly = Math.max(maxPadOnly, pitches.length);
    }
    expect(maxPadOnly).toBeGreaterThanOrEqual(2); // pad-only 比 comp-active 厚
  });

  it('确定性:同输入两次结果一致', () => {
    const again = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection, leadReservedLow: reservedReg.lowMidi });
    expect(again.notes.map((n) => [n.pitch, n.startTick, n.velocity])).toEqual(pad.notes.map((n) => [n.pitch, n.startTick, n.velocity]));
  });

  it('silent 决策 → 该段无 pad 音', () => {
    const silentDec: Record<string, PadCompDecision> = {};
    for (const s of arrangement.sections) silentDec[s.id] = { ...decisionBySection[s.id], padMode: 'silent', padMaxVoices: 0 };
    const silent = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: silentDec, leadReservedLow: reservedReg.lowMidi });
    expect(silent.notes.length).toBe(0);
  });
});
