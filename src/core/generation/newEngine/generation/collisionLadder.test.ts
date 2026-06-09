import { describe, it, expect } from 'vitest';
import { escalateOverride, type RetryLocator } from './retryMapping';
import { runGenerationControl, generateSong, type RenderFn } from './GenerationController';
import { nextRetryContext, DEFAULT_BUDGET } from './RetryPolicy';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { beats, createRandomContext, createTimebase, pc } from '../foundation';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';

// ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):阶梯收为 2 级 voicing → fallback。
//   fallback 无新 override,靠 advance 'melody' 子流重掷 MG 旋律。
const TICK = 1920;
const SPAN = 'S0';
const hardLocator: RetryLocator = { spanAtTick: (tick) => (tick === TICK ? SPAN : undefined) };
// ★ Loop 3(strict parity):阶梯由【非-lead】finding 驱动(comp 撞音 → 瘦 voicing → fallback);lead 不重跑。
const compFinding: AuditFinding = {
  severity: 'error', location: { trackRole: 'comp', startTick: TICK },
  ruleId: 'avoid', reason: 'hard', suggestedReturnPoint: 'rewind-accompaniment',
};
const report: AuditReport = { findings: [compFinding] };

describe('generation · 撞音消解阶梯 (5.2,退役 Motif 后 = 2 级)', () => {
  it('★ 阶梯 2 级:rung1 voicing(span 未瘦)→ rung4 fallback(span 已瘦),单调前进', () => {
    const e1 = escalateOverride(compFinding, hardLocator, undefined);
    expect(e1.rung).toBe('voicing');
    expect(e1.patch.voicingSafer).toEqual({ [SPAN]: true });
    expect(e1.returnPoint).toBe('rewind-accompaniment');
    const c1 = nextRetryContext(undefined, report, createRandomContext(1), hardLocator);
    expect(c1.voicingSafer[SPAN]).toBe(true);

    const e2 = escalateOverride(compFinding, hardLocator, c1);
    expect(e2.rung).toBe('fallback');
    expect(e2.returnPoint).toBe('render-fallback');
    expect(e2.patch).toEqual({}); // fallback 无新 override
  });

  it('★ 难例端到端:render 只在【fallback rung】放行 → voicing→fallback 收敛(3 attempts)', () => {
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 120 }] });
    const ir = freezeMusicalIR({ tracks: [{ role: 'lead', notes: [] }], timebase: tb, durationTicks: tb.beatToTick(beats(4)) });
    const rungs: string[] = [];
    const render: RenderFn = (retry?: RetryContext) => {
      if (retry) rungs.push(retry.returnPoint === 'render-fallback' ? 'fallback' : retry.voicingSafer[SPAN] ? 'voicing' : 'other');
      const fixed = retry?.returnPoint === 'render-fallback'; // 只有兜底重掷(melody 子流)修好
      return { ir, audit: fixed ? { findings: [] } : report };
    };
    const result = runGenerationControl(render, createRandomContext(1), DEFAULT_BUDGET, hardLocator);
    expect(result.status).toBe('pass');
    expect(rungs).toEqual(['voicing', 'fallback']);
    expect(result.attempts).toBe(3); // 初次 + rung1 + rung4
  });

  it('持续撞音(永不放行)→ 阶梯耗尽 budget → failed report(绝不静默输出非法)', () => {
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 120 }] });
    const ir = freezeMusicalIR({ tracks: [{ role: 'lead', notes: [] }], timebase: tb, durationTicks: tb.beatToTick(beats(4)) });
    const render: RenderFn = () => ({ ir, audit: report }); // 怎么改都撞
    const result = runGenerationControl(render, createRandomContext(1), DEFAULT_BUDGET, hardLocator);
    expect(result.status).toBe('failed');
    expect(result.attempts).toBe(DEFAULT_BUDGET.wholeSong);
    expect(result.ir).toBeUndefined(); // 不输出非法结果
  });

  it('overlay 消费不破正常生成:多 seed generateSong 仍 pass(rung 仅难例触发)', () => {
    for (let seed = 0; seed < 6; seed++) {
      const r = generateSong({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 120, key: pc(0) });
      expect(r.status).not.toBe('failed');
    }
  });
});
