// ============================================================
// Velocity utils — 全系统 velocity 合法范围 clamp
// ============================================================
//
// 2026-05-25 抽取(原散落于 VelocityHumanizer / PhraseEndingDecider /
// Af2AccompGen / BassIdiom 4 处)。
//
// AF2 velocity 全系统合法范围:[0.1, 1.0] float。
//   下限 0.1:避免完全静音(MIDI vel 0 = note off);最弱可听限
//   上限 1.0:MIDI vel 127 等价
//
// 不在 plugins/ 因为它是跨 layer 共享的物理约束(orchestrator + idiom 都用)。
// ============================================================

/** Clamp velocity 到合法范围 [0.1, 1.0]。 */
export function clampVelocity(v: number): number {
    return Math.max(0.1, Math.min(1, v));
}
