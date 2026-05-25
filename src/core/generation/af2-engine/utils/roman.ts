// ============================================================
// Roman numeral parsing helpers — 多 Planner 共享
// ============================================================
//
// 原各自实现于 BorrowChordPlanner / MinorBorrowPlanner
// (2026-05-25 抽取共享,2 处 ~10 行重复)。
// ============================================================

/**
 * Strip leading accidentals(b/#/n)+ extract Roman head('IV' / 'iv' / 'V' /
 * 'vi' / 'I' / 'bII' 等会变成 'II' / 'iv' 等)。返回空串当 roman 为空 / 无法 parse。
 */
export function romanHead(roman: string): string {
    if (!roman) return '';
    const stripped = roman.replace(/^[b#n]+/, '');
    return stripped.match(/^[IVivXx]+/)?.[0] ?? '';
}
