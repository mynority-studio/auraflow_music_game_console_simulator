// ============================================================
// AF2 DrumGrid 类型定义(Phase 2b.2)
// ============================================================
//
// Port 自 AF DrumIdiom 设计:16-step grid + per-style 概率表 + energy 双轴 +
// Dynamic Override(Crash/Fill/Ride)。
//
// AF2 独有扩展(Phase 2b.2):chord/bass modifier — 每 step gate 概率受 bass
// strong onset / chord syncopate 影响(modifier multiplier)。
// ============================================================

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const ENERGY_LEVELS = 10;

/**
 * 单 step 的三鼓概率(grid 内一项)。
 * 各概率 ∈ [0, 1],经 energy + modifier 缩放后再与 PRNG.next() 比较。
 */
export interface DrumStepConfig {
    /** Kick 触发概率 0~1 */
    kickProb: number;
    /** Snare 触发概率 0~1 */
    snareProb: number;
    /** Closed Hihat 触发概率 0~1 */
    hihatProb: number;
}

/**
 * 鼓机 Grid 配置(per mgStyle)。
 *
 *   - grid.length === 16,多小节按 step % 16 循环
 *   - energyProbScale / energyVelScale length === 10,下标 = energyLevel - 1
 *   - snareEnergyGate:energy < gate 时 Snare prob → 0(PRNG 仍消耗保持锁帧)
 *   - velocity [min, max]:每击点在范围内 PRNG 抽样
 */
export interface DrumGridConfig {
    grid: DrumStepConfig[];                    // length === 16
    energyProbScale: number[];                 // length === 10
    energyVelScale: number[];                  // length === 10
    snareEnergyGate: number;
    kickVelocity:  [number, number];           // MIDI 0~127
    snareVelocity: [number, number];
    hihatVelocity: [number, number];
}
