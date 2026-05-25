// ============================================================
// DropBuildupDynamics v1.2 — Drop / BuildUp 段落动态
// ============================================================
//
// 原 Reconciler.applyDropBuildupDynamics(2026-05-25 拆 plugin)。
//
// Drop 段(energy < 3):velocity multiplier 按 kind 表:
//   melody=1.0(hero 不动)/ accomp=0.5(让位)/ bass=0.6(保 anchor)
//   / pad=1.2(反向突出接管 ambient)
//
// BuildUp 段(next.energy > cur+2):最后 1 bar 内 velocity 线性 ramp:
//   per-kind ramp max(accomp 上到 1.20、melody/bass 1.15、pad 1.10)
//
// Drums 由调用方跳过 — DrumIdiom 内部已感知 isBuildUp(Tom Fill)。
// ============================================================

import type { NoteData, SectionMetadata } from '../../../types';
import { findSectionIdxForBeat } from '../../Conductor';
import type { ReconcilerPluginMeta } from './types';

/** Drop section 阈值:energyLevel < 此值视为 drop 段 */
const DROP_ENERGY_THRESHOLD = 3;
/** BuildUp 触发阈值:下一段 energy 比当前段高 ≥ 此值视为 BuildUp */
const BUILDUP_ENERGY_DELTA = 2;

export type InstrumentKind = 'melody' | 'accomp' | 'bass' | 'pad';

const DYNAMICS_TABLE: Record<InstrumentKind, { drop: number; buildupRampMax: number }> = {
    melody: { drop: 1.0,  buildupRampMax: 1.15 },   // hero:drop 不动,buildup 突出
    accomp: { drop: 0.5,  buildupRampMax: 1.20 },   // 让位 + 强突出
    bass:   { drop: 0.6,  buildupRampMax: 1.15 },   // 保留 anchor + 突出
    pad:    { drop: 1.2,  buildupRampMax: 1.10 },   // 反向突出(drop 接管 ambient)
};

type SectionDynamicState = 'drop' | 'buildup' | 'normal';

function classifySectionDynamic(idx: number, sections: SectionMetadata[]): SectionDynamicState {
    const cur = sections[idx];
    if (cur.energyLevel < DROP_ENERGY_THRESHOLD) return 'drop';
    if (idx + 1 < sections.length) {
        const next = sections[idx + 1];
        if (next.energyLevel > cur.energyLevel + BUILDUP_ENERGY_DELTA) return 'buildup';
    }
    return 'normal';
}

export const DropBuildupDynamics: ReconcilerPluginMeta & {
    apply(
        events: NoteData[],
        sections: SectionMetadata[],
        kind: InstrumentKind,
        beatsPerMeasure?: number,
    ): NoteData[];
} = {
    name: 'DropBuildupDynamics',
    version: 'v1.2',
    prngConsumption: 'zero',
    description: 'Drop 段(energy<3)kind-specific 缩放 + BuildUp 末 1 bar velocity 线性 ramp',

    apply(events, sections, kind, beatsPerMeasure = 4) {
        if (events.length === 0 || sections.length === 0) return events;

        const sectionStates = sections.map((_, i) => classifySectionDynamic(i, sections));
        const config = DYNAMICS_TABLE[kind];

        const out: NoteData[] = new Array(events.length);
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const sIdx = findSectionIdxForBeat(ev.onset, sections);
            if (sIdx < 0) {
                out[i] = { ...ev };
                continue;
            }
            const state = sectionStates[sIdx];
            const section = sections[sIdx];

            let velMul = 1.0;

            if (state === 'drop') {
                velMul = config.drop;
            } else if (state === 'buildup') {
                const lastBarStart = section.endBeat - beatsPerMeasure;
                if (ev.onset >= lastBarStart) {
                    const progress = (ev.onset - lastBarStart) / beatsPerMeasure;
                    const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
                    velMul = 1.0 + (config.buildupRampMax - 1.0) * clamped;
                }
            }

            if (velMul === 1.0) {
                out[i] = { ...ev };
            } else {
                const newVel = ev.velocity * velMul;
                out[i] = {
                    ...ev,
                    velocity: newVel < 0 ? 0 : newVel > 1 ? 1 : newVel,
                };
            }
        }
        return out;
    },
};
