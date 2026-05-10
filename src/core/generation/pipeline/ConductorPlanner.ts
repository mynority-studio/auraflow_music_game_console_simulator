// ============================================================
// ConductorPlanner — 段落级智能配器避让
// ============================================================
// 基于段落 energyLevel 决定每段的 focus / support / silent 乐器：
//
//   energyLevel <= 3   静谧段落（Intro / Outro 极弱）
//     → silent: drums, bass, counter, secondary
//     → 只剩 melody + chord 维持极简织体
//
//   energyLevel <= 5   中等段落（Verse / Outro）
//     → silent: counter, secondary
//     → 主旋律 + 鼓 + 贝斯 + 和弦，counter 不出场
//
//   energyLevel >= 6   高能段落（Chorus）
//     → support 加入 counter, drums
//     → 全员上阵，counter 与 melody 形成对位
//
// Orchestrator 读取 silentInstruments 做物理消音（按段落过滤音符 onset）。
// ============================================================

import { SectionMetadata, ConductorPlan, InstrumentRole, ConductorSectionPlan } from '../types';

const ENERGY_LOW = 3;
const ENERGY_MID = 5;

export class ConductorPlanner {
    public static plan(sections: SectionMetadata[]): ConductorPlan {
        const planSections: ConductorSectionPlan[] = [];

        for (let i = 0; i < sections.length; i++) {
            const sec = sections[i];
            const silent: InstrumentRole[] = [];
            const support: InstrumentRole[] = ['bass', 'chord'];
            const focus: InstrumentRole = 'melody';

            if (sec.energyLevel <= ENERGY_LOW) {
                silent.push('drums', 'bass', 'counter', 'secondary');
            } else if (sec.energyLevel <= ENERGY_MID) {
                silent.push('counter', 'secondary');
            } else {
                support.push('counter', 'drums');
            }

            planSections.push({
                sectionName: sec.name,
                startBeat: sec.startBeat,
                endBeat: sec.endBeat,
                focusInstrument: focus,
                supportInstruments: support,
                silentInstruments: silent,
                rhythmCenter: 'downbeat',
                counterpointPairs: [],
                fillWindows: [],
            });
        }

        return {
            sections: planSections,
            globalRhythmProfile: 'four-on-floor',
        };
    }
}
