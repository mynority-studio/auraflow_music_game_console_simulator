// ============================================================
// newEngine · render · bassRole 消费 / Loop 7 测试
// ------------------------------------------------------------
// 锁:bass 按 ChordSpan.bassRole 出转位(3rd/5th/7th)/ pedal 持续低音。
// ============================================================

import { describe, expect, it } from 'vitest';
import { renderBass } from './bassRenderer';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, createTimebase, beats, mod12, pc } from '../foundation';
import type { HarmonicPlan, RomanChord } from '../harmony/HarmonicPlan';

const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 90 }] });
const rc: RomanChord = { degree: 1, accidental: 'natural', quality: 'maj7' };

// 手搭最小 plan(直接验 bassRenderer 的 bassRole 消费)
const handPlan = {
  chordTimeline: [
    { id: 'c0', roman: rc, rootPc: pc(0), quality: 'maj7', chordType: 'maj7', startBeat: beats(0), durationBeats: beats(4), sectionId: 'v', bassRole: '3rd' },
    { id: 'c1', roman: rc, rootPc: pc(0), quality: 'maj9', chordType: 'maj9', startBeat: beats(4), durationBeats: beats(4), sectionId: 'v', bassRole: 'pedal', bassPedalPc: pc(0) },
    { id: 'c2', roman: rc, rootPc: pc(7), quality: 'maj7', chordType: 'maj7', startBeat: beats(8), durationBeats: beats(4), sectionId: 'v' }, // 无 bassRole = root
  ],
  stableToneMap: { c0: [0, 4, 7, 11], c1: [0, 4, 7, 11], c2: [7, 11, 2, 6] },
  avoidNoteMap: { c0: [5], c1: [5], c2: [0] },
} as unknown as HarmonicPlan;

describe('bassRole 消费(手搭 plan)', () => {
  const bass = renderBass(handPlan, tb, 'lofi');
  const atBeat = (b: number) => bass.notes.find((n) => (n.startTick as number) === (tb.beatToTick(beats(b)) as number));

  it('3rd 转位:c0 bass downbeat = E(maj7 的 3 音),≠ root', () => {
    const n = atBeat(0);
    expect(n).toBeDefined();
    expect((n!.pitch as number) % 12).toBe(mod12(4)); // E
  });
  it('pedal:c1 bass = C(pedal pc),不是它自己的 root(也是0这里)且持续整 span', () => {
    const n = atBeat(4);
    expect(n).toBeDefined();
    expect((n!.pitch as number) % 12).toBe(0); // pedal C
    expect(n!.durationTicks as number).toBe(tb.beatToTick(beats(4)) as number); // 持续整 span
  });
  it('无 bassRole:c2 bass = root(G)', () => {
    const n = atBeat(8);
    expect(n).toBeDefined();
    expect((n!.pitch as number) % 12).toBe(7); // G root
  });
});

describe('bassRole 端到端(pop seed5 真选到 POP_CANON_8 的转位)', () => {
  it('有 bassRole span,且 bass 在该 span downbeat 落转位音(≠ root)', () => {
    const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(5));
    const inv = plan.chordTimeline.find((c) => c.bassRole === '3rd' || c.bassRole === '5th');
    expect(inv).toBeDefined();
    const bass = renderBass(plan, tb, 'pop');
    const lo = tb.beatToTick(inv!.startBeat) as number;
    const n = bass.notes.find((x) => (x.startTick as number) === lo);
    expect(n).toBeDefined();
    expect((n!.pitch as number) % 12).not.toBe(inv!.rootPc as number); // 不是 root(是转位音)
  });
});
