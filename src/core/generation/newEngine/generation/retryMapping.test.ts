import { describe, it, expect } from 'vitest';
import { buildRetryLocator, findingToOverride, type RetryLocator } from './retryMapping';
import { runGenerationControl, type RenderFn } from './GenerationController';
import { nextRetryContext, DEFAULT_BUDGET } from './RetryPolicy';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { runPrepass } from '../render/motifAnchorPrepass';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { beats, createRandomContext, createTimebase, pc } from '../foundation';
import type { AuditFinding } from '../ir/AuditReport';

function realPieces(seed = 5) {
  const seedRng = createRandomContext(seed);
  const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, harmonic, seedRng);
  const locator = buildRetryLocator(arrangement, anchorPlan, motifStore, harmonic, timebase);
  return { arrangement, harmonic, timebase, anchorPlan, motifStore, locator };
}

describe('generation · finding→精确返回点 (5.1)', () => {
  it('buildRetryLocator:lead tick → 命中 binding;非 lead → undefined;span 命中 c0', () => {
    const { harmonic, timebase, anchorPlan, locator } = realPieces();
    // 第一个 chord span 起点 tick 落在第一个 binding 的 phrase 内
    const firstChordTick = timebase.beatToTick(harmonic.chordTimeline[0].startBeat) as number;
    const binding = locator.bindingAtTick('lead', firstChordTick);
    expect(binding).toBeDefined();
    expect(anchorPlan.entries.some((e) => e.bindingId === binding)).toBe(true);
    expect(locator.bindingAtTick('comp', firstChordTick)).toBeUndefined(); // 非 lead 不映射 binding
    expect(locator.spanAtTick(firstChordTick)).toBe(harmonic.chordTimeline[0].id);
  });

  it('alternateCandidate:池>1 → 返回 ≠ 当前的候选;命中后再问(swap 已占)→ 继续轮换', () => {
    const { motifStore, locator } = realPieces();
    const multi = Object.values(motifStore.bindingCandidates).find((p) => p.candidateOrder.length > 1);
    if (!multi) return; // 该 seed 无多候选池 → 跳过(其它断言已覆盖)
    const alt = locator.alternateCandidate(multi.bindingId, {});
    expect(alt).toBeDefined();
    expect(alt).not.toBe(multi.selectedCandidateId);
    expect(multi.candidateOrder).toContain(alt); // 必在冻结池内(不越界)
  });

  it('findingToOverride:comp 轨 finding → voicingSafer[span];lead 无定位 → 空 patch', () => {
    const { harmonic, timebase, locator } = realPieces();
    const tick = timebase.beatToTick(harmonic.chordTimeline[1].startBeat) as number;
    const compFinding: AuditFinding = {
      severity: 'error', location: { trackRole: 'comp', startTick: tick },
      ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-accompaniment',
    };
    expect(findingToOverride(compFinding, locator, {}).voicingSafer).toEqual({ [harmonic.chordTimeline[1].id]: true });
    // lead 轨但 tick 越界(超出全曲)→ 无 binding → 空
    const oob: AuditFinding = {
      severity: 'error', location: { trackRole: 'lead', startTick: 9_999_999 },
      ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-melody',
    };
    expect(findingToOverride(oob, locator, {})).toEqual({});
  });

  it('★ 注入撞音 → controller 映射到对应 binding 的 candidateSwap → 下一轮修好(2 attempts 收敛)', () => {
    const COLLIDE_TICK = 1920;
    const BIND = 'B-hook';
    const ALT = 'B-hook#alt';
    const fakeLocator: RetryLocator = {
      bindingAtTick: (role, tick) => (role === 'lead' && tick === COLLIDE_TICK ? BIND : undefined),
      alternateCandidate: (bindingId, swap) => (bindingId === BIND && swap[bindingId] === undefined ? ALT : undefined),
      spanAtTick: () => undefined,
    };
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 120 }] });
    const ir = freezeMusicalIR({ tracks: [{ role: 'lead', notes: [] }], timebase: tb, durationTicks: tb.beatToTick(beats(4)) });

    let secondSwap: Record<string, string> | undefined;
    const render: RenderFn = (retry) => {
      if (retry) secondSwap = { ...retry.candidateSwap };
      const fixed = retry?.candidateSwap?.[BIND] === ALT;
      return {
        ir,
        audit: fixed
          ? { findings: [] }
          : {
              findings: [{
                severity: 'error', location: { trackRole: 'lead', startTick: COLLIDE_TICK },
                ruleId: 'avoid-exposed', reason: 'injected', suggestedReturnPoint: 'rewind-melody',
              }],
            },
      };
    };

    const result = runGenerationControl(render, createRandomContext(1), DEFAULT_BUDGET, fakeLocator);
    expect(result.status).toBe('pass'); // 修好
    expect(result.attempts).toBe(2); // 一次重跑即收敛(精确 override,非盲推)
    expect(secondSwap?.[BIND]).toBe(ALT); // ★ 切到了正确 binding 的替代候选
  });

  it('无 locator → 退回纯 rng 推进(candidateSwap 不动,仍收敛兜底)', () => {
    const finding: AuditFinding = {
      severity: 'error', location: { trackRole: 'lead', startTick: 0 },
      ruleId: 'x', reason: 'x', suggestedReturnPoint: 'rewind-melody',
    };
    const ctx = nextRetryContext(undefined, { findings: [finding] }, createRandomContext(2));
    expect(ctx.candidateSwap).toEqual({}); // 无 locator → 不填 override
  });
});
