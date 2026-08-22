// ============================================================
// auraRoaming · luxTrail(律光音轨状态机,纯函数)
// ------------------------------------------------------------
// 定义:两次成功命中的亮灯键之间,穿插按过 ≥1 个未亮键 → 记一条。
// 用户裁定的关键语义:
//   · "错过" = 完全没按(missIgnore)→ 不打断,允许 A→C 跨越被无视的 B;
//   · 按了但时机偏(missAttempt)→ 用户主动参与失败,打断当前音轨;
//   · 两次成功命中相距 > TRAIL_MAX_GAP_BEATS 拍 → 锚点过期,只重新起锚。
// ============================================================

import { TRAIL_MAX_GAP_BEATS } from '../types';

export interface LuxTrailState {
  anchorCueId: number | null;
  anchorBeat: number;
  sawUnlitPress: boolean;
}

export const INITIAL_LUX_TRAIL_STATE: LuxTrailState = {
  anchorCueId: null,
  anchorBeat: 0,
  sawUnlitPress: false,
};

export interface LuxTrailResult {
  state: LuxTrailState;
  completedTrail: boolean;
}

/** 成功命中:可能收口一条音轨,并总是把该命中设为新锚点。 */
export function trailOnCueSuccess(
  state: LuxTrailState,
  cueId: number,
  beat: number,
  maxGapBeats: number = TRAIL_MAX_GAP_BEATS,
): LuxTrailResult {
  const completedTrail =
    state.anchorCueId !== null
    && state.sawUnlitPress
    && beat - state.anchorBeat <= maxGapBeats
    && beat > state.anchorBeat;
  return {
    state: { anchorCueId: cueId, anchorBeat: beat, sawUnlitPress: false },
    completedTrail,
  };
}

/** 未亮键按压:锚点开着才算音轨材料。 */
export function trailOnUnlitPress(state: LuxTrailState): LuxTrailState {
  if (state.anchorCueId === null) return state;
  if (state.sawUnlitPress) return state;
  return { ...state, sawUnlitPress: true };
}

/** 按偏(missAttempt):打断进行中的音轨。missIgnore 故意无此对应函数。 */
export function trailOnAttemptMiss(_state: LuxTrailState): LuxTrailState {
  return INITIAL_LUX_TRAIL_STATE;
}
