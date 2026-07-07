// ============================================================
// QnBandSelectionStore — Band Selection「参与乐手/职能」三态(qn_takeover_followup §3/§7)
// ------------------------------------------------------------
// ★ 新语义:选「谁参与编配」,不选 GM 音色。每个 participant(键盘手/贝斯手/鼓手/吉他手/
//   合成氛围/主奏)一个三态:
//   auto     = 未表态(缺省即此)→ Q+N 按默认乐队决定是否参与。
//   selected = 明确加入 → 进入白名单(仅 selected 乐手覆盖的职责参与编配)。
//   disabled = 明确排除 → 该乐手职责不生成。
//   全 auto → Q+N 默认完整乐队。具体音色一律由器配层按 style/seed/音色世界 rng 决定(本 store 不存 GM program)。
// 模块级 singleton。runPipeline / service 读 getParticipants()。
// ============================================================

import type { BandParticipantRole, BandParticipantSelection, BandParticipantState } from '../core/generation/musicGeneration/types';

export const QN_PARTICIPANT_ORDER: BandParticipantRole[] = ['keyboardist', 'guitarist', 'bassist', 'drummer', 'synthPlayer', 'leadPlayer'];

/** participant 中文显示名(UI roster/toggle 用)。 */
export const QN_PARTICIPANT_LABEL: Record<BandParticipantRole, string> = {
  keyboardist: '键盘手', guitarist: '吉他手', bassist: '贝斯手', drummer: '鼓手', synthPlayer: '合成/氛围', leadPlayer: '主奏',
};

// 缺省 = 全 auto(空对象)。
let _states: Partial<Record<BandParticipantRole, BandParticipantState>> = {};

export const QnBandSelectionStore = {
  getStates(): Partial<Record<BandParticipantRole, BandParticipantState>> { return { ..._states }; },
  getState(role: BandParticipantRole): BandParticipantState { return _states[role] ?? 'auto'; },
  setState(role: BandParticipantRole, state: BandParticipantState): void {
    const next = { ..._states };
    if (state === 'auto') delete next[role]; else next[role] = state;
    _states = next;
  },
  reset(): void { _states = {}; },
  /** 非 auto 的 participant → service/pipeline 消费的选择数组(auto 不入数组 = 无约束默认)。 */
  getParticipants(): BandParticipantSelection[] {
    return QN_PARTICIPANT_ORDER
      .filter((r) => _states[r] && _states[r] !== 'auto')
      .map((r) => ({ role: r, state: _states[r]! }));
  },
};
