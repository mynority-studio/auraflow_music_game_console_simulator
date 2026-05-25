// ============================================================
// Minor → Major chord type mapping — Picardy / MinorBorrow 共享
// ============================================================
//
// 原 PicardyPlanner / MinorBorrowPlanner 各定义一份(2026-05-25 抽取共享,
// 2 处 ~9 行重复)。
//
// Picardy 3rd / IV-borrow 时把 minor 家族 chord type 替换为 major 等价物:
//   min   → maj
//   m7    → maj7
//   m9    → maj9
//   m11   → maj9    (11 与 maj3 冲突 m9 clash,降级到 maj9)
//   m6    → maj6
//   m13   → maj13
// ============================================================

export const MINOR_TO_MAJOR_TYPE: Record<string, string> = {
    'min':  'maj',
    'm':    'maj',
    'm7':   'maj7',
    'm9':   'maj9',
    'm11':  'maj9',     // 11 与 maj3 m9 clash,降级 maj9
    'm6':   'maj6',
    'm13':  'maj13',
};
