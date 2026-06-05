import { describe, it, expect } from 'vitest';
import { renderPad } from './padRenderer';
import { renderAccompaniment } from './accompanimentRenderer';
import { renderBass } from './bassRenderer';
import { buildTextureSchedule } from './textureSchedule';
import { decidePadComp, type PadCompDecision } from './padCompPolicy';
import { freezeHarmonicPlan, type HarmonicPlanData } from '../harmony/HarmonicPlan';
import { createTimebase, createRandomContext, beats, pc } from '../foundation';

// ============================================================
// render/padCompInteraction · Golden Case Fmaj7 → Fm7(docs/pad_comp_interaction_directive §12)
// ------------------------------------------------------------
// comp active + pad active 时进入 pad-aware mode:pad 退成 guide-tone(≤2 音,省 root/5th),
//   comp 保 GM 手感只避同绝对音高。验证 bass 有 F、pad 不复制完整和弦、无低 root、
//   comp/pad exact-overlap≈0、comp 时值短于 pad、comp GM 不回退(仅丢避让音)。
// ============================================================

const PC = { F: 5, A: 9, C: 0, E: 4, Ab: 8, Eb: 3 };

// 合成最小 HarmonicPlan:F 大三和弦七(Fmaj7)→ F 小七(Fm7),同属 chorus 段(comp active)。
function makePlan(): ReturnType<typeof freezeHarmonicPlan> {
  const data: HarmonicPlanData = {
    romanProgression: [
      { degree: 4, accidental: 'natural', quality: 'maj7' },
      { degree: 4, accidental: 'natural', quality: 'm7' },
    ],
    chordTimeline: [
      { id: 's0', roman: { degree: 4, accidental: 'natural', quality: 'maj7' }, rootPc: pc(PC.F), quality: 'maj7', chordType: 'maj7', startBeat: beats(0), durationBeats: beats(4), sectionId: 'chorus1' },
      { id: 's1', roman: { degree: 4, accidental: 'natural', quality: 'm7' }, rootPc: pc(PC.F), quality: 'm7', chordType: 'm7', startBeat: beats(4), durationBeats: beats(4), sectionId: 'chorus1' },
    ],
    chordFunctionTimeline: ['S', 'S'],
    chordScaleMap: { s0: [PC.F, 7, PC.A, PC.C, 2, PC.E].map(pc), s1: [PC.F, 7, PC.Ab, PC.C, 2, PC.Eb].map(pc) },
    tensionMap: {},
    stableToneMap: { s0: [PC.F, PC.A, PC.C, PC.E].map(pc), s1: [PC.F, PC.Ab, PC.C, PC.Eb].map(pc) },
    colorToneMap: { s0: [], s1: [] },
    avoidNoteMap: { s0: [], s1: [] },
    borrowedChordMap: {},
    modulationMap: {},
  };
  return freezeHarmonicPlan(data);
}

describe('render/padCompInteraction · Golden Fmaj7 → Fm7', () => {
  const plan = makePlan();
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const reservedLow = 67;

  // chorus1:pop comp active + pad active → guide-tone(thin)。
  const dec: PadCompDecision = decidePadComp({
    style: 'pop', sectionId: 'chorus1', sectionRole: 'chorus',
    padDensity: 0.5, padActive: true, compActive: true, bassActive: true,
    leadReservedLow: reservedLow, leadReservedHigh: 84,
  });
  const decisionBySection = { chorus1: dec };

  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection, leadReservedLow: reservedLow });
  const padBySpan: Record<string, number[]> = {};
  for (const n of pad.notes) {
    const sid = n.startTick === timebase.beatToTick(beats(0)) ? 's0' : 's1';
    (padBySpan[sid] ??= []).push(n.pitch as number);
  }

  const bass = renderBass(plan, timebase, 'pop');

  const activeSectionIds = new Set(['chorus1']);
  const sectionRoleById = { chorus1: 'chorus' as const };
  const schedule = buildTextureSchedule({ plan, style: 'pop', sectionRoleById, activeSectionIds, textureRng: createRandomContext(1).substream('compTexture') });
  const compCtxBase = { style: 'pop', activeSectionIds, sectionRoleById, textureSchedule: schedule, compProgram: 0 };
  const compWith = renderAccompaniment(plan, timebase, { ...compCtxBase, padCompDecisionBySection: decisionBySection, padOccupiedPitchesBySpan: padBySpan }).find((t) => t.role === 'comp')!;
  const compBase = renderAccompaniment(plan, timebase, compCtxBase).find((t) => t.role === 'comp')!;

  it('guide-tone 决策:省 root + 省 5th + ≤2 音', () => {
    expect(dec.padMode).toBe('guide-tone');
    expect(dec.padOmitRoot).toBe(true);
    expect(dec.padOmitFifth).toBe(true);
    expect(dec.padMaxVoices).toBe(2);
    expect(dec.avoidExactPitchOverlap).toBe(true);
  });

  it('bass 含 F(根音在场)', () => {
    expect(bass.notes.some((n) => ((n.pitch as number) % 12) === PC.F)).toBe(true);
  });

  it('★ pad 每 span ≤ 2 音,且 < stableToneMap 长度(4)', () => {
    for (const sid of ['s0', 's1']) {
      expect(padBySpan[sid].length).toBeLessThanOrEqual(2);
      expect(padBySpan[sid].length).toBeLessThan(plan.stableToneMap[sid].length);
    }
  });

  it('★ Fmaj7 pad 不输出完整 F-A-C-E;Fm7 不输出完整 F-Ab-C-Eb', () => {
    const pcsOf = (sid: string) => new Set(padBySpan[sid].map((m) => ((m % 12) + 12) % 12));
    const s0 = pcsOf('s0'); const s1 = pcsOf('s1');
    // 完整四音集合不被复制
    expect([PC.F, PC.A, PC.C, PC.E].every((pc) => s0.has(pc))).toBe(false);
    expect([PC.F, PC.Ab, PC.C, PC.Eb].every((pc) => s1.has(pc))).toBe(false);
    // guide tone = 3rd + 7th(无 root、无 5th)
    expect([...s0].sort()).toEqual([PC.E, PC.A].sort()); // E(7th) + A(3rd)
    expect([...s1].sort()).toEqual([PC.Eb, PC.Ab].sort());
  });

  it('★ pad 不输出低 root F(无 pc=F 的音,更无低区 root)', () => {
    for (const n of pad.notes) expect((n.pitch as number) % 12).not.toBe(PC.F);
  });

  it('★ comp 与 pad 在同 span 内 exact MIDI overlap = 0', () => {
    const spanOf = (tick: number) => (tick < (timebase.beatToTick(beats(4)) as number) ? 's0' : 's1');
    let overlap = 0;
    for (const n of compWith.notes) {
      const sid = spanOf(n.startTick as number);
      if ((padBySpan[sid] ?? []).includes(n.pitch as number)) overlap++;
    }
    expect(overlap).toBe(0);
  });

  it('★ comp hit 时值短于 pad sustain(pad 铺整段)', () => {
    const maxComp = Math.max(...compWith.notes.map((n) => n.durationTicks as number));
    const padDur = timebase.beatToTick(beats(4)) as number; // pad 铺整 span
    expect(maxComp).toBeLessThan(padDur);
  });

  it('★ comp GM 不回退:withPad ⊆ baseline(仅丢避让音,时值/力度不变)', () => {
    const key = (n: { startTick: unknown; pitch: unknown }) => `${n.startTick}:${n.pitch}`;
    const baseSet = new Map(compBase.notes.map((n) => [key(n), n]));
    // 每个 withPad 音都存在于 baseline,且 duration/velocity 完全一致(无 GM 改动)
    for (const n of compWith.notes) {
      const b = baseSet.get(key(n));
      expect(b, 'withPad 音应来自 baseline').toBeDefined();
      expect(n.durationTicks).toBe(b!.durationTicks);
      expect(n.velocity).toBe(b!.velocity);
    }
    // baseline 比 withPad 多出的,正是与 pad 同绝对音高的避让音
    expect(compWith.notes.length).toBeLessThanOrEqual(compBase.notes.length);
  });

  it('comp 仍走 texture schedule(非空)', () => {
    expect(compWith.notes.length).toBeGreaterThan(0);
  });
});
