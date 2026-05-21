// ============================================================
// BLUES DrumGrid — shuffle feel(swung 8ths)
// ============================================================
// 设计要点:
//   Blues 本是 12/8 三连音 feel,在 16-step grid 内用"swing 8th"近似:
//   每 4 step 一拍,正拍 (step 0/4/8/12) + swing offset (step 2-3 / 6-7 / ...)
//
//   Kick:强 0/8 + walking shuffle "and of 2"(6) + "and of 4"(14)
//   Snare:2/4 backbeat(4, 12)— blues 标准
//   Hihat:正拍 + swing 8th(step 2, 6, 10, 14)— 模拟 shuffle ride
// ============================================================

import type { DrumGridConfig, DrumStepConfig } from '../types';
import { STEPS_PER_BAR } from '../types';

function buildBluesGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(STEPS_PER_BAR);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    // Kick 强拍
    g[0].kickProb = 0.92;
    g[8].kickProb = 0.85;
    // Shuffle kick at "and of 2" / "and of 4"(swing 8th 位置)
    g[6].kickProb = 0.25;
    g[14].kickProb = 0.20;
    // Snare 2/4 backbeat
    g[4].snareProb = 0.88;
    g[12].snareProb = 0.88;
    // Hihat shuffle pattern:正拍强 + swing 8th 弱
    g[0].hihatProb = 0.80;
    g[4].hihatProb = 0.80;
    g[8].hihatProb = 0.80;
    g[12].hihatProb = 0.80;
    // swing 8th(三连音的第 3 个位置,近似 step 2/6/10/14 但 blues 更接近 step 3/7/11/15)
    g[2].hihatProb = 0.55;
    g[6].hihatProb = 0.55;
    g[10].hihatProb = 0.55;
    g[14].hihatProb = 0.55;
    return g;
}

export const BLUES_DRUM_GRID: DrumGridConfig = {
    grid: buildBluesGrid(),
    energyProbScale: [0.55, 0.65, 0.75, 0.85, 0.92, 0.98, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.65, 0.72, 0.80, 0.86, 0.92, 0.96, 1.00, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [80, 105],          // blues kick 偏温和
    snareVelocity: [75, 105],          // backbeat 重音
    hihatVelocity: [50, 85],           // shuffle 给 hihat 留差异空间
};
