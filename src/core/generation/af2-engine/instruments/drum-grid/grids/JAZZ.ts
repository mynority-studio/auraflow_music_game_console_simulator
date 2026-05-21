// ============================================================
// JAZZ DrumGrid — feathered kick + ride-style hihat
// ============================================================
// 设计要点:
//   Kick:强拍 0/8 弱(feathered);walking 风格偶尔 4/12 触发
//   Snare:2/4 brush(velocity 低)
//   Hihat:作为 ride 骨架,8 分稳态 + 反拍 ride bell skip(6/14)
// ============================================================

import type { DrumGridConfig, DrumStepConfig } from '../types';
import { STEPS_PER_BAR } from '../types';

function buildJazzGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(STEPS_PER_BAR);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    g[0].kickProb = 0.85;
    g[8].kickProb = 0.80;
    // 偶尔 walking kick at 2/4
    g[4].kickProb = 0.10;
    g[12].kickProb = 0.10;
    // Snare 2/4 brush
    g[4].snareProb = 0.78;
    g[12].snareProb = 0.78;
    // Ride 8 分稳态
    for (let i = 0; i < 16; i += 2) {
        g[i].hihatProb = 0.85;
    }
    // 反拍 ride bell skip
    g[6].hihatProb = 0.45;
    g[14].hihatProb = 0.45;
    return g;
}

export const JAZZ_DRUM_GRID: DrumGridConfig = {
    grid: buildJazzGrid(),
    energyProbScale: [0.55, 0.65, 0.75, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.65, 0.70, 0.75, 0.82, 0.88, 0.92, 0.96, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [60, 85],
    snareVelocity: [50, 80],
    hihatVelocity: [55, 90],
};
