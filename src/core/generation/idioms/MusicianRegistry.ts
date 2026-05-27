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
        name: 'Alex',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.MainInst,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.4,
            sparsityTendency: 0.5,
            syncopationAssault: 0.3,
            dynamicRange: [55, 100],
            wakeK: 0.05,
            peakK: 0.85,
        },
        description: 'Pop/Jazz 钢琴手,跑 mgEngine melody + chord',
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
