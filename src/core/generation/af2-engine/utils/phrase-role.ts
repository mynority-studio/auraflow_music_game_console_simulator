// ============================================================
// Phrase role classifier — 3 Planner 共享 helper
// ============================================================
//
// 原各自实现于 BorrowChordPlanner / MinorBorrowPlanner / PicardyPlanner
// (2026-05-25 抽取共享,3 处 ~24 行重复)。
//
// 把 chord 在 progression 中的位置分类为 4 类:
//   start    — motif 周期开头(motifInterval > 0 && i % motifInterval === 0)
//   middle   — motif 周期中间(不满足其他条件)
//   cadence  — motif 周期末尾(motifInterval > 0 && (i+1) % motifInterval === 0)
//   ending   — 全曲最后一个 chord(i === total - 1)
//
// 各 Planner 用此分类做 phrase-aware 决策:
//   - BorrowChordPlanner:某些 rule 只在 cadence/ending fire
//   - MinorBorrowPlanner:ending 跳过(让 Picardy 主导)
//   - PicardyPlanner:只在 cadence/ending fire
// ============================================================

export type PhraseRole = 'start' | 'middle' | 'cadence' | 'ending';

export function classifyPhraseRole(i: number, total: number, motifInterval: number): PhraseRole {
    if (i === total - 1) return 'ending';
    if (motifInterval > 0 && (i + 1) % motifInterval === 0) return 'cadence';
    if (motifInterval > 0 && i % motifInterval === 0) return 'start';
    return 'middle';
}
