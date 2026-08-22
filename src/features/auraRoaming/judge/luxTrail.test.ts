import { describe, expect, it } from 'vitest';
import {
  INITIAL_LUX_TRAIL_STATE,
  trailOnAttemptMiss,
  trailOnCueSuccess,
  trailOnUnlitPress,
} from './luxTrail';

describe('auraRoaming/luxTrail — 律光音轨状态机', () => {
  it('A 成功 → 滑按未亮键 → B 成功 ⇒ 记一条', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    expect(r.completedTrail).toBe(false);
    const withUnlit = trailOnUnlitPress(r.state);
    r = trailOnCueSuccess(withUnlit, 1, 6);
    expect(r.completedTrail).toBe(true);
    expect(r.state.anchorCueId).toBe(1); // 锚点移到 B,可连续成轨
  });

  it('两次成功之间没按未亮键 ⇒ 不记', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    r = trailOnCueSuccess(r.state, 1, 6);
    expect(r.completedTrail).toBe(false);
  });

  it('B 完全没按(missIgnore 无状态机调用)⇒ A→C 仍成轨', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    const withUnlit = trailOnUnlitPress(r.state);
    // B 被无视:用户裁定"错过 = 没按",不打断 → 直接到 C
    r = trailOnCueSuccess(withUnlit, 2, 9);
    expect(r.completedTrail).toBe(true);
  });

  it('按偏(missAttempt)打断进行中的音轨', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    let state = trailOnUnlitPress(r.state);
    state = trailOnAttemptMiss(state);
    r = trailOnCueSuccess(state, 2, 6);
    expect(r.completedTrail).toBe(false); // 锚点已被打断,C 只是新锚
  });

  it('两次成功相距超 8 拍 ⇒ 锚点过期只重新起锚', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    const withUnlit = trailOnUnlitPress(r.state);
    r = trailOnCueSuccess(withUnlit, 1, 13.5);
    expect(r.completedTrail).toBe(false);
    expect(r.state.anchorCueId).toBe(1);
  });

  it('没有锚点时未亮键按压不积累', () => {
    const state = trailOnUnlitPress(INITIAL_LUX_TRAIL_STATE);
    expect(state.sawUnlitPress).toBe(false);
  });
});
