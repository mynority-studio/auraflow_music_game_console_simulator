import { describe, it, expect } from 'vitest';
import { buildRetryLocator, findingToOverride, escalateOverride } from './retryMapping';
import { runGenerationControl, type RenderFn } from './GenerationController';
import { nextRetryContext, DEFAULT_BUDGET } from './RetryPolicy';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { beats, createRandomContext, createTimebase, pc } from '../foundation';
import type { AuditFinding } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';

// ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):locator 瘦成只 spanAtTick,
//   撞音消解阶梯收为 voicing→fallback(无 binding/candidateSwap/降锁)。

function realPieces(seed = 5) {
  const seedRng = createRandomContext(seed);
  const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  const locator = buildRetryLocator(harmonic, timebase);
  return { harmonic, timebase, locator };
}

describe('generation · finding→精确返回点 (5.1,退役 Motif 后)', () => {
  it('buildRetryLocator.spanAtTick:tick → 命中 ChordSpan;越界 → undefined', () => {
    const { harmonic, timebase, locator } = realPieces();
    const firstTick = timebase.beatToTick(harmonic.chordTimeline[0].startBeat) as number;
    expect(locator.spanAtTick(firstTick)).toBe(harmonic.chordTimeline[0].id);
    expect(locator.spanAtTick(9_999_999)).toBeUndefined();
  });

  it('findingToOverride:任意轨 finding 命中 span → voicingSafer[span];越界 → 空', () => {
    const { harmonic, timebase, locator } = realPieces();
    const tick = timebase.beatToTick(harmonic.chordTimeline[1].startBeat) as number;
    for (const role of ['comp', 'lead', 'bass', 'pad']) {
      const f: AuditFinding = { severity: 'error', location: { trackRole: role, startTick: tick }, ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-accompaniment' };
      expect(findingToOverride(f, locator).voicingSafer).toEqual({ [harmonic.chordTimeline[1].id]: true });
    }
    const oob: AuditFinding = { severity: 'error', location: { trackRole: 'lead', startTick: 9_999_999 }, ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-melody' };
    expect(findingToOverride(oob, locator)).toEqual({});
  });

  it('★ 阶梯 2 级:span 未瘦 → rung1 voicing;span 已瘦 → rung4 fallback(单调前进)', () => {
    const { harmonic, timebase, locator } = realPieces();
    const span = harmonic.chordTimeline[0].id;
    const tick = timebase.beatToTick(harmonic.chordTimeline[0].startBeat) as number;
    const finding: AuditFinding = { severity: 'error', location: { trackRole: 'lead', startTick: tick }, ruleId: 'avoid', reason: 'hard', suggestedReturnPoint: 'rewind-melody' };

    const e1 = escalateOverride(finding, locator, undefined);
    expect(e1.rung).toBe('voicing');
    expect(e1.returnPoint).toBe('rewind-accompaniment');
    expect(e1.patch.voicingSafer).toEqual({ [span]: true });

    const prev = { voicingSafer: { [span]: true } } as unknown as RetryContext;
    const e2 = escalateOverride(finding, locator, prev);
    expect(e2.rung).toBe('fallback');
    expect(e2.returnPoint).toBe('render-fallback');
    expect(e2.patch).toEqual({}); // fallback 无新 override,靠 advance melody 子流重掷
  });

  it('★ 注入撞音 → rung1 voicingSafer 修好 → 2 attempts pass', () => {
    const COLLIDE_TICK = 1920;
    const SPAN = 'S-collide';
    const fakeLocator = { spanAtTick: (tick: number) => (tick === COLLIDE_TICK ? SPAN : undefined) };
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 120 }] });
    const ir = freezeMusicalIR({ tracks: [{ role: 'lead', notes: [] }], timebase: tb, durationTicks: tb.beatToTick(beats(4)) });

    let appliedVoicing: Record<string, true> | undefined;
    const render: RenderFn = (retry) => {
      if (retry) appliedVoicing = { ...retry.voicingSafer };
      const fixed = retry?.voicingSafer?.[SPAN] !== undefined; // 瘦该 span 即修好
      return {
        ir,
        audit: fixed ? { findings: [] } : { findings: [{ severity: 'error', location: { trackRole: 'lead', startTick: COLLIDE_TICK }, ruleId: 'avoid-exposed', reason: 'injected', suggestedReturnPoint: 'rewind-melody' }] },
      };
    };
    const result = runGenerationControl(render, createRandomContext(1), DEFAULT_BUDGET, fakeLocator);
    expect(result.status).toBe('pass');
    expect(result.attempts).toBe(2);
    expect(appliedVoicing?.[SPAN]).toBe(true);
  });

  it('无 locator → 退回纯 rng 推进(voicingSafer 不填,仍收敛兜底)', () => {
    const finding: AuditFinding = { severity: 'error', location: { trackRole: 'lead', startTick: 0 }, ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-melody' };
    const ctx = nextRetryContext(undefined, { findings: [finding] }, createRandomContext(2));
    expect(ctx.voicingSafer).toEqual({});
  });
});
