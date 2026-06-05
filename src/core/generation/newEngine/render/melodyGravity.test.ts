// ============================================================
// newEngine · render · melodyGravity 单测(忠实 mg pending-resolution 状态机)
// ------------------------------------------------------------
// 锁:不稳定音 arm 解决目标(非 hang)· 强规则+严格风格 hard-steer · 级进 line 放行 ·
//   soft-only 风格不强制 · 窗口过期消散 · 确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { gravitySteer, gravityUpdate, newGravityState } from './melodyGravity';
import { getScaleGravity, gravityStrictnessFor } from '../knowledge/scaleGravity';

const AEOLIAN = getScaleGravity('Aeolian'); // b6(8)→5(7) score 25;b7(10)→0 score 18
const midiOf = (pcv: number, oct = 5) => 12 * oct + pcv;

describe('melodyGravity · pending-resolution 状态机', () => {
  it('不稳定音 arm 解决目标(Aeolian b6 → 5,score 25,4 拍窗口)', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0); // C 小调 root=0,发 b6=pc8
    expect(st.target).toBe(7); // → 5 度
    expect(st.score).toBe(25);
    expect(st.windowEnd).toBe(4);
  });

  it('POP(strictness 0.85)+ 强规则(25≥18):远离音被 hard-steer 强制解决到 target', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0); // arm → target 7
    // grammar 给一个远音(pc3,距 b6 5 个半音 → 非 line、非 resolve)
    const steered = gravitySteer(midiOf(3), 1, st, gravityStrictnessFor('pop'), 67, 84);
    expect(steered % 12).toBe(7); // 强制到 5 度(解决)
  });

  it('JAZZ(strictness 0.35 < 0.45):soft-only,不 hard-steer(留挂留张力)', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0);
    const steered = gravitySteer(midiOf(3), 1, st, gravityStrictnessFor('jazz'), 67, 84);
    expect(steered % 12).toBe(3); // 原样不强制
  });

  it('级进 line(≤2 半音)放行(即便方向偏离 target)', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0); // lineLast = b6(68)
    const steered = gravitySteer(midiOf(10), 1, st, gravityStrictnessFor('pop'), 67, 84); // b7=70,距 68 = 2
    expect(steered % 12).toBe(10); // 级进 line,不强制
  });

  it('落到 target 即解决 → 清 pending', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0);
    gravityUpdate(st, midiOf(7), 1, AEOLIAN, 0); // 落 5 度 = target → 解决
    expect(st.target).toBeNull();
  });

  it('窗口过期(>4 拍未解决)→ pending 消散', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(8), 0, AEOLIAN, 0);
    gravityUpdate(st, midiOf(0), 5, AEOLIAN, 0); // 第 5 拍(>windowEnd 4)→ 过期清空,再 arm(主音 pc0 无规则)
    expect(st.target).toBeNull();
  });

  it('稳定音(无引力规则)不 arm', () => {
    const st = newGravityState();
    gravityUpdate(st, midiOf(0), 0, AEOLIAN, 0); // 主音 pc0
    expect(st.target).toBeNull();
  });
});
