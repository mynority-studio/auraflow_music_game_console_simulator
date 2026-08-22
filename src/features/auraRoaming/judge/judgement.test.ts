import { describe, expect, it } from 'vitest';
import { INITIAL_SCORE_STATE, applyJudgement, classifyPressDelta } from './judgement';

describe('auraRoaming/judgement — 判定窗口与计分', () => {
  it('判定窗口:±80 Perfect / ±220 普通 / ±380 按偏 / 更远自由弹奏', () => {
    expect(classifyPressDelta(0)).toBe('perfect');
    expect(classifyPressDelta(-79)).toBe('perfect');
    expect(classifyPressDelta(80)).toBe('perfect');
    expect(classifyPressDelta(81)).toBe('good');
    expect(classifyPressDelta(-219)).toBe('good');
    expect(classifyPressDelta(221)).toBe('missAttempt');
    expect(classifyPressDelta(-379)).toBe('missAttempt');
    expect(classifyPressDelta(381)).toBeNull();
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
