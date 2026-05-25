// ============================================================
// EnergyHumanizer v1.0 — 段落能量驱动 velocity 缩放
// ============================================================
//
// 原 Reconciler.applyEnergyHumanization(2026-05-25 拆 plugin)。
//
// 对每个 event 按 onset 查段落 energy,缩放 velocity:
//   energy 1 → ×0.70(intro 弱)/ 5 → ×1.00 / 10 → ×1.10(chorus 略强)
//
// 调用方应只对**不自带 energy 响应**的轨道用(melody / accomp / bass)。
// drums / atmosphere 已自带响应,二次缩放会过度。
// ============================================================

import type { NoteData, SectionMetadata } from '../../../types';
import { findSectionIdxForBeat } from '../../Conductor';
import type { ReconcilerPluginMeta } from './types';

/**
 * energyLevel(1-10)→ velocity 缩放因子。
 *   1-5  线性 0.70 → 1.00(每级 +0.075)
 *   5-10 线性 1.00 → 1.10(每级 +0.020,曲线更平避免 clip)
 */
const ENERGY_VEL_SCALE: ReadonlyArray<number> = [
    0.70, 0.775, 0.85, 0.925, 1.00,   // energy 1-5
    1.02, 1.04, 1.06, 1.08, 1.10,     // energy 6-10
];

function energyScale(energyLevel: number | undefined): number {
    if (energyLevel === undefined || !Number.isFinite(energyLevel)) return 1.0;
    const i = (energyLevel | 0);
    if (i < 1) return ENERGY_VEL_SCALE[0];
    if (i > 10) return ENERGY_VEL_SCALE[9];
    return ENERGY_VEL_SCALE[i - 1];
}

export const EnergyHumanizer: ReconcilerPluginMeta & {
    apply(events: NoteData[], sections: SectionMetadata[]): NoteData[];
} = {
    name: 'EnergyHumanizer',
    version: 'v1.0',
    prngConsumption: 'zero',
    description: '段落能量驱动 velocity humanization(energy 1→×0.70 / 5→×1.00 / 10→×1.10)',

    apply(events, sections) {
        if (events.length === 0 || sections.length === 0) return events;

        const out: NoteData[] = new Array(events.length);
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const sIdx = findSectionIdxForBeat(ev.onset, sections);
            const scale = sIdx >= 0 ? energyScale(sections[sIdx].energyLevel) : 1.0;
            const newVel = ev.velocity * scale;
            out[i] = {
                ...ev,
                velocity: newVel < 0 ? 0 : newVel > 1 ? 1 : newVel,
            };
        }
        return out;
    },
};
