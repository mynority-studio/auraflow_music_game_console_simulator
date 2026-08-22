// ============================================================
// auraRoaming · judgement(Perfect/普通/Miss 判定 + 计分,纯函数)
// ------------------------------------------------------------
// Δt = (按压时刻 − 提示音符发声时刻 − 用户延迟补偿)。
//   |Δt| ≤ 60ms  → perfect(律光 +2)
//   |Δt| ≤ 150ms → good  (律光 +1)
//   |Δt| ≤ 300ms → 按偏 missAttempt(清 combo,打断律光音轨)
//   更远 / 未亮键 → 自由弹奏,不判定
// 到期未按 → missIgnore(清 combo,不打断音轨 → 支持 A→C 跨越)。
// ============================================================

import {
  CHARGE_COMBO,
  DEFAULT_JUDGE_WINDOWS,
  LUX_PER_GOOD,
  LUX_PER_PERFECT,
  type AuraJudgeWindows,
  type AuraJudgementKind,
} from '../types';

/** 按压相对提示的分类;null = 窗外,视作自由弹奏。 */
export function classifyPressDelta(
  deltaMs: number,
  windows: AuraJudgeWindows = DEFAULT_JUDGE_WINDOWS,
): 'perfect' | 'good' | 'missAttempt' | null {
  const abs = Math.abs(deltaMs);
  if (abs <= windows.perfectMs) return 'perfect';
  if (abs <= windows.goodMs) return 'good';
  if (abs <= windows.attemptMs) return 'missAttempt';
  return null;
}

export function isSuccessJudgement(kind: AuraJudgementKind): boolean {
  return kind === 'perfect' || kind === 'good';
}

export function luxFor(kind: AuraJudgementKind): number {
  if (kind === 'perfect') return LUX_PER_PERFECT;
  if (kind === 'good') return LUX_PER_GOOD;
  return 0;
}

export interface AuraScoreState {
  lux: number;
  combo: number;
  bestCombo: number;
  charging: boolean;
  judged: Record<AuraJudgementKind, number>;
}

export const INITIAL_SCORE_STATE: AuraScoreState = {
  lux: 0,
  combo: 0,
  bestCombo: 0,
  charging: false,
  judged: { perfect: 0, good: 0, missAttempt: 0, missIgnore: 0 },
};

/** 计分 reducer:成功加律光 + 连击,任一 miss 清 combo(充能随之熄灭)。 */
export function applyJudgement(state: AuraScoreState, kind: AuraJudgementKind): AuraScoreState {
  const judged = { ...state.judged, [kind]: state.judged[kind] + 1 };
  if (isSuccessJudgement(kind)) {
    const combo = state.combo + 1;
    return {
      lux: state.lux + luxFor(kind),
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      charging: combo >= CHARGE_COMBO,
      judged,
    };
  }
  return { ...state, combo: 0, charging: false, judged };
}
