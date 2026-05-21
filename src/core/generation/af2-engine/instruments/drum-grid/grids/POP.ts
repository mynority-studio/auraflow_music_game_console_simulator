// ============================================================
// POP DrumGrid — 直拍 + and-of-beat syncopate
// ============================================================
// 设计要点:
//   Kick:强拍 0/8 + 弱拍 7/15(Pop "and of 2 / and of 4" syncopate)
//   Snare:2/4 backbeat(step 4, 12)
//   Hihat:8 分稳态(偶数 step)+ 16 分弱位 ghost(step 3, 11)
// ============================================================

import type { DrumGridConfig, DrumStepConfig } from '../types';
import { STEPS_PER_BAR } from '../types';

function buildPopGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(STEPS_PER_BAR);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    // Kick 强拍
    g[0].kickProb = 0.95;
    g[8].kickProb = 0.90;
    // Kick 弱拍 syncopate
    g[7].kickProb = 0.20;
    g[15].kickProb = 0.15;
    // Snare 2/4 拍
    g[4].snareProb = 0.92;
    g[12].snareProb = 0.92;
    // Hihat 8 分稳态
    const hihatSteps = [0, 2, 4, 6, 8, 10, 12, 14];
    for (let i = 0; i < hihatSteps.length; i++) {
        g[hihatSteps[i]].hihatProb = 0.80;
    }
    // 16 分弱位 ghost hihat
    g[3].hihatProb = 0.25;
    g[11].hihatProb = 0.25;
    return g;
}

export const POP_DRUM_GRID: DrumGridConfig = {
    grid: buildPopGrid(),
    energyProbScale: [0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [95, 115],
    snareVelocity: [90, 115],
    hihatVelocity: [55, 85],
};
