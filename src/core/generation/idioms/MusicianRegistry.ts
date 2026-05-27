// ============================================================
// MusicianRegistry — 1 张钢琴手卡(2026-05-27 mgEngine 接入版)
// ============================================================
//
// mgEngine 当前只产 piano 独奏(melody + chord);其他 4 槽位(bass / drums /
// atmosphere + accomp 的非钢琴选项)在 UI 下拉只剩「空」,等需要时再扩。
// ============================================================

import {
    Musician,
    BandRole,
    InstrumentFamily,
} from '../types';
import { StyleId } from '../config/StyleFlags';

export const MUSICIAN_POOL: Musician[] = [
    {
        id: 'alex_piano',
        name: 'Alex (Melody)',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.MainInst,
        // 2026-05-27 分 mg 2-Layer 路由:Alex 只承担 MainInst(mg part='melody')
        eligibleRoles: [BandRole.MainInst],
        instrumentId: 0,
        persona: {
            colorBias: 0.4,
            sparsityTendency: 0.5,
            syncopationAssault: 0.3,
            dynamicRange: [55, 100],
            wakeK: 0.05,
            peakK: 0.85,
        },
        description: 'mg 主旋律手 — 跑 mg part="melody",路由到 MainInst (ch1)',
    },
    {
        id: 'chloe_piano',
        name: 'Chloe (Harmony)',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        // Chloe 只承担 Accomp(mg part='chord' + 'bass' 合并 — 对应 mg App.tsx 的
        // "Harmony Layer",即 events.filter(e => e.part === 'chord' || e.part === 'bass'))
        eligibleRoles: [BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.4,
            sparsityTendency: 0.5,
            syncopationAssault: 0.3,
            dynamicRange: [55, 100],
            wakeK: 0.05,
            peakK: 0.85,
        },
        description: 'mg 伴奏手 — 跑 mg part="chord" + "bass" 合并,路由到 Accomp (ch2)',
    },
];

export function getMusicianById(id: string): Musician | undefined {
    for (let i = 0; i < MUSICIAN_POOL.length; i++) {
        if (MUSICIAN_POOL[i].id === id) return MUSICIAN_POOL[i];
    }
    return undefined;
}

/**
 * 按职能查询 — 走 eligibleRoles(不是单一 role)。
 * 钢琴手会同时出现在 getMusiciansByRole(MainInst) 和 getMusiciansByRole(Accomp) 的结果中。
 */
export function getMusiciansByRole(role: BandRole): Musician[] {
    const out: Musician[] = [];
    for (let i = 0; i < MUSICIAN_POOL.length; i++) {
        const m = MUSICIAN_POOL[i];
        for (let r = 0; r < m.eligibleRoles.length; r++) {
            if (m.eligibleRoles[r] === role) {
                out.push(m);
                break;
            }
        }
    }
    return out;
}
