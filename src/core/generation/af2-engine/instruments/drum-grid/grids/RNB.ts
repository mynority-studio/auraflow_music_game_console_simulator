// ============================================================
// RNB DrumGrid — neo-soul / dilla feel(syncopated kick + ghost snare)
// ============================================================
// 设计要点:
//   Kick:强拍 + "and of 2 / and of 3" pocket(syncopate)
//   Snare:2/4 + 16 分弱位 ghost(Neo-Soul 灵魂)
//   Hihat:16 分稳态 + 偶数 step 强(D'Angelo 风)
// ============================================================

import type { DrumGridConfig, DrumStepConfig } from '../types';
import { STEPS_PER_BAR } from '../types';

function buildRnbGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(STEPS_PER_BAR);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    // Kick
    g[0].kickProb = 0.92;
    g[6].kickProb = 0.55;     // "and of 2" pocket
    g[10].kickProb = 0.50;    // "and of 3" pocket
    g[8].kickProb = 0.30;     // 弱化 3 拍(让 syncopate 主导)
    g[14].kickProb = 0.20;
    // Snare 2/4 backbeat
    g[4].snareProb = 0.90;
    g[12].snareProb = 0.90;
    // Ghost snare(Neo-Soul 16 分鬼音)
    g[3].snareProb = 0.30;
    g[7].snareProb = 0.25;
    g[11].snareProb = 0.30;
    g[15].snareProb = 0.20;
    // Hihat 16 分稳态
    for (let i = 0; i < 16; i++) {
        g[i].hihatProb = 0.65;
    }
    // 偶数 step 略强
    g[0].hihatProb = 0.85;
    g[4].hihatProb = 0.85;
    g[8].hihatProb = 0.85;
    g[12].hihatProb = 0.85;
    return g;
}

export const RNB_DRUM_GRID: DrumGridConfig = {
    grid: buildRnbGrid(),
    energyProbScale: [0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.70, 0.75, 0.82, 0.88, 0.92, 0.96, 1.00, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [85, 110],
    snareVelocity: [60, 105],          // 跨度大 → ghost 弱 + 反拍重
    hihatVelocity: [45, 80],
};
