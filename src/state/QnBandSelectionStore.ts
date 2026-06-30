// ============================================================
// QnBandSelectionStore — Q+N Band Selection 三态(qn_main_engine_takeover §8.4)
// ------------------------------------------------------------
// 三态(每 role:lead/comp/bass/drum/pad):
//   auto     = 用户未指定 → Q+N 按 style/seed 选默认乐器(缺省即此态,别误解为 disabled)。
//   selected = 用户指定 GM program → 覆盖该 role 的 TrackIR.program。
//   disabled = 用户明确关闭 → 该 role 不出现在 IR(静音)。
// 模块级 singleton(同其它 store 模式)。runPipeline / service 读 getSelection()。
// ============================================================

import type { QnBandSelection, QnRole, QnRoleSelection } from '../core/generation/musicGeneration/types';

export const QN_ROLE_ORDER: QnRole[] = ['lead', 'comp', 'bass', 'pad', 'drum'];

// 缺省 = 全 auto(空对象 → service 视每 role 为 auto)。
let _selection: QnBandSelection = {};

export const QnBandSelectionStore = {
    getSelection(): QnBandSelection { return { ..._selection }; },
    setSelection(sel: QnBandSelection): void { _selection = { ...sel }; },
    getRole(role: QnRole): QnRoleSelection { return _selection[role] ?? { kind: 'auto' }; },
    setRole(role: QnRole, sel: QnRoleSelection): void {
        const next = { ..._selection };
        if (sel.kind === 'auto') delete next[role]; else next[role] = sel;
        _selection = next;
    },
};
