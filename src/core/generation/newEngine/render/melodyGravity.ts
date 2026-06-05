// ============================================================
// newEngine · render · MelodyGravity(scaleGravity 旋律消费,忠实 mg 逻辑)
// ------------------------------------------------------------
// 港自 melodygenerative 的 scale-gravity 消费(pending-resolution 状态机,历史活实现):
//   每音后:若该音不稳定(有引力规则且非 hang)→ ARM 一个解决目标 + 4 拍窗口。
//   后续音:应解决到 target(toInterval)或【级进 line】朝它走(≤2 半音);窗口过期则消散。
//   - soft:所有风格,引向 target(× strictness);newEngine 单音确定性 → 实现为 hard-steer。
//   - hard:仅强规则(score≥18)+ 严格风格(strictness≥0.45)→ 强制解决到 target。
//   引用 frame = scale root(tonal=调中心)。'hang' 规则永不 arm(特征挂留音)。
// ★ 引力只"引向解决",合同 gate 仍是最高权威(steer 后过 gate;target 非合同则 gate 收回)。
// ============================================================

import { mod12, pc as pcBrand, type PitchClass } from '../foundation';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import type { ScaleGravityRule } from '../knowledge/scaleGravity';

const HARD_MIN_SCORE = 18;
const HARD_MIN_STRICTNESS = 0.45;
const WINDOW_BEATS = 4;

export interface GravityState {
  target: number | null; // 解决目标(相对 scale root 半音)
  rootPc: number;
  score: number;         // 触发规则的引力强度
  windowEnd: number;     // absBeat + 4
  lineLastMidi: number;  // line 尾(级进延续判定)
}

export function newGravityState(): GravityState {
  return { target: null, rootPc: 0, score: 0, windowEnd: -1, lineLastMidi: -1 };
}

const ivFrom = (midi: number, rootPc: number): number => (((midi - rootPc) % 12) + 12) % 12;

/**
 * hard-steer:pending 解决期内,把【强规则 + 严格风格】的音引向 target(否则原样,交合同 gate)。
 * 已解决/级进延续 → 不动。返回 steer 后的 raw midi(仍需过合同 gate)。
 */
export function gravitySteer(
  rawMidi: number, absBeat: number, st: GravityState, strictness: number, low: number, high: number,
): number {
  if (st.target === null || absBeat > st.windowEnd) return rawMidi;
  const iv = ivFrom(rawMidi, st.rootPc);
  const isResolve = iv === st.target;
  const isLine = st.lineLastMidi > 0 && Math.abs(rawMidi - st.lineLastMidi) <= 2;
  if (isResolve || isLine) return rawMidi;
  if (st.score >= HARD_MIN_SCORE && strictness >= HARD_MIN_STRICTNESS) {
    const targetPc: PitchClass = pcBrand(mod12(st.rootPc + st.target));
    return pcToMidiInRange(targetPc, low, high); // 强解决到目标
  }
  return rawMidi;
}

/** 每【实际发出】音后更新状态:expire / resolve / line-advance / arm(不稳定且非 hang)。 */
export function gravityUpdate(
  st: GravityState, emittedMidi: number, absBeat: number,
  rules: Readonly<Record<number, ScaleGravityRule>>, rootPc: number,
): void {
  const iv = ivFrom(emittedMidi, rootPc);
  if (st.windowEnd > 0 && absBeat > st.windowEnd) st.target = null;           // 窗口过期
  if (st.target !== null && iv === st.target) st.target = null;               // 解决
  else if (st.target !== null && st.lineLastMidi > 0 && Math.abs(emittedMidi - st.lineLastMidi) <= 2) {
    st.lineLastMidi = emittedMidi;                                            // line 延续
  }
  if (st.target === null) {                                                   // arm(仅无 pending 时)
    const rule = rules[iv];
    if (rule && rule.type !== 'hang') {
      st.target = rule.toInterval;
      st.rootPc = rootPc;
      st.score = rule.score;
      st.windowEnd = absBeat + WINDOW_BEATS;
      st.lineLastMidi = emittedMidi;
    }
  }
}
