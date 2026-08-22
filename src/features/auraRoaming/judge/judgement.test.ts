import { describe, expect, it } from 'vitest';
import { INITIAL_SCORE_STATE, applyJudgement, classifyPressDelta } from './judgement';

describe('auraRoaming/judgement — 判定窗口与计分', () => {
  it('判定窗口:±60 Perfect / ±150 普通 / ±300 按偏 / 更远自由弹奏', () => {
    expect(classifyPressDelta(0)).toBe('perfect');
    expect(classifyPressDelta(-59)).toBe('perfect');
    expect(classifyPressDelta(60)).toBe('perfect');
    expect(classifyPressDelta(61)).toBe('good');
    expect(classifyPressDelta(-149)).toBe('good');
    expect(classifyPressDelta(151)).toBe('missAttempt');
    expect(classifyPressDelta(-299)).toBe('missAttempt');
    expect(classifyPressDelta(301)).toBeNull();
    expect(classifyPressDelta(-500)).toBeNull();
  });

  it('计分:perfect +2 / good +1;连续成功 5 次进入充能;任一 miss 清 combo', () => {
    let state = INITIAL_SCORE_STATE;
    state = applyJudgement(state, 'perfect');
    expect(state.lux).toBe(2);
    for (const kind of ['good', 'good', 'good'] as const) state = applyJudgement(state, kind);
    expect(state.lux).toBe(5);
    expect(state.combo).toBe(4);
    expect(state.charging).toBe(false);
    state = applyJudgement(state, 'perfect');
    expect(state.combo).toBe(5);
    expect(state.charging).toBe(true);
    state = applyJudgement(state, 'missIgnore');
    expect(state.combo).toBe(0);
    expect(state.charging).toBe(false);
    expect(state.bestCombo).toBe(5);
    expect(state.lux).toBe(7); // miss 不扣律光
    expect(state.judged).toEqual({ perfect: 2, good: 3, missAttempt: 0, missIgnore: 1 });
  });
});
