import { describe, it, expect } from 'vitest';
import { escalateOverride, type RetryLocator } from './retryMapping';
import { runGenerationControl, generateSong, type RenderFn } from './GenerationController';
import { nextRetryContext, DEFAULT_BUDGET } from './RetryPolicy';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { beats, createRandomContext, createTimebase, pc } from '../foundation';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';
import type { RetryContext } from './RetryContext';

// lead 撞音难例:span=S0,binding=B0,候选池有替代。
const TICK = 1920;
const SPAN = 'S0';
const BIND = 'B0';
const hardLocator: RetryLocator = {
  bindingAtTick: (role, tick) => (role === 'lead' && tick === TICK ? BIND : undefined),
  alternateCandidate: (b, swap) => (b === BIND && swap[b] === undefined ? 'B0#alt' : undefined),
  spanAtTick: (tick) => (tick === TICK ? SPAN : undefined),
};
const leadFinding: AuditFinding = {
  severity: 'error', location: { trackRole: 'lead', startTick: TICK },
  ruleId: 'avoid', reason: 'hard', suggestedReturnPoint: 'rewind-melody',
};
const report: AuditReport = { findings: [leadFinding] };

describe('generation · 撞音消解阶梯 (5.2)', () => {
  it('★ 阶梯逐级升级:voicing → 降锁 → 换hook → fallback(单调,每级新增一个 override)', () => {
    // rung1
    const e1 = escalateOverride(leadFinding, hardLocator, undefined);
    expect(e1.rung).toBe('voicing');
    expect(e1.patch.voicingSafer).toEqual({ [SPAN]: true });
    expect(e1.returnPoint).toBe('rewind-accompaniment');
    const c1 = nextRetryContext(undefined, report, createRandomContext(1), hardLocator);

    // rung2(voicing 已占)
    const e2 = escalateOverride(leadFinding, hardLocator, c1);
    expect(e2.rung).toBe('lower-lock');
    expect(e2.patch.restatementOverride).toEqual({ [BIND]: 0.3 });
    expect(e2.returnPoint).toBe('rewind-melody');
    const c2 = nextRetryContext(c1, report, createRandomContext(1), hardLocator);

    // rung3(voicing+降锁 已占)
    const e3 = escalateOverride(leadFinding, hardLocator, c2);
    expect(e3.rung).toBe('swap-hook');
    expect(e3.patch.candidateSwap).toEqual({ [BIND]: 'B0#alt' });
    const c3 = nextRetryContext(c2, report, createRandomContext(1), hardLocator);

    // rung4(三 rung 用尽)→ fallback
    const e4 = escalateOverride(leadFinding, hardLocator, c3);
    expect(e4.rung).toBe('fallback');
    expect(e4.returnPoint).toBe('render-fallback');

    // 单调累积:c3 同时带 voicing + 降锁 + 换hook
    expect(c3.voicingSafer[SPAN]).toBe(true);
    expect(c3.restatementOverride[BIND]).toBe(0.3);
    expect(c3.candidateSwap[BIND]).toBe('B0#alt');
  });

  it('★ 难例端到端:render 只在【换hook rung】才放行 → 阶梯走到 rung3 收敛(4 attempts)', () => {
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 120 }] });
    const ir = freezeMusicalIR({ tracks: [{ role: 'lead', notes: [] }], timebase: tb, durationTicks: tb.beatToTick(beats(4)) });
    const rungs: string[] = [];
    const render: RenderFn = (retry?: RetryContext) => {
      if (retry) {
        if (retry.candidateSwap[BIND]) rungs.push('swap');
        else if (retry.restatementOverride[BIND] !== undefined) rungs.push('lower-lock');
        else if (retry.voicingSafer[SPAN]) rungs.push('voicing');
      }
      const fixed = retry?.candidateSwap?.[BIND] === 'B0#alt'; // 只有换 hook 能修好
      return { ir, audit: fixed ? { findings: [] } : report };
    };
    const result = runGenerationControl(render, createRandomContext(1), DEFAULT_BUDGET, hardLocator);
    expect(result.status).toBe('pass');
    expect(rungs).toEqual(['voicing', 'lower-lock', 'swap']); // 逐级升级到换 hook 才放行
    expect(result.attempts).toBe(4); // 初次 + 3 rung
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
