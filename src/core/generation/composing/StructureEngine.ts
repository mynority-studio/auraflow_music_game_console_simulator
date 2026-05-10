// ============================================================
// StructureEngine — Phase 6 多段式曲式生成
// ============================================================
// 从 3 种典型流行曲式中随机抽取，按 SECTION_CONFIG 的小节数 + 基准能量
// 装配 SectionMetadata[]，能量再用 mood.energyCap 钳制（Chill 压扁 Chorus、
// Aggressive 抬高 Intro 等）。
//
// 当前 3 种 form：
//   1) Intro → Verse → Chorus → Verse → Chorus → Outro          (24 bars / 96 beats)
//   2) Intro → Verse → PreChorus → Chorus → Verse → Chorus → Outro   (32 bars / 128 beats)
//   3) Intro → Verse → PreChorus → Chorus → Bridge → Chorus → Outro  (32 bars / 128 beats)
// ============================================================

import { SectionMetadata, StyleConfig } from '../types';
import { MoodConfig } from '../config/MoodFlags';
import { PRNGManager } from '../../utils/PRNG';

const FORMS: string[][] = [
    ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'],
    ['Intro', 'Verse', 'PreChorus', 'Chorus', 'Verse', 'Chorus', 'Outro'],
    ['Intro', 'Verse', 'PreChorus', 'Chorus', 'Bridge', 'Chorus', 'Outro'],
];

interface SectionConfig {
    bars: number;
    baseEnergy: number;
}

const SECTION_CONFIG: Record<string, SectionConfig> = {
    'Intro':     { bars: 4, baseEnergy: 3 },
    'Verse':     { bars: 8, baseEnergy: 5 },
    'PreChorus': { bars: 4, baseEnergy: 6 },
    'Chorus':    { bars: 8, baseEnergy: 8 },
    'Bridge':    { bars: 4, baseEnergy: 7 },
    'Outro':     { bars: 4, baseEnergy: 4 },
};

const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

export class StructureEngine {
    public static generateStructure(
        _bpm: number,
        _style: StyleConfig,
        mood: MoodConfig,
        timeSignature: [number, number] = DEFAULT_TIME_SIGNATURE,
    ): SectionMetadata[] {
        const selectedForm = FORMS[PRNGManager.nextInt(0, FORMS.length - 1)];

        // 拍号驱动的小节拍数：4/4=4, 3/4=3, 6/8=3, 12/8=6
        const barBeats = (timeSignature[0] * 4) / timeSignature[1];

        const sections: SectionMetadata[] = [];
        let currentBeat = 0;

        for (let i = 0; i < selectedForm.length; i++) {
            const name = selectedForm[i];
            const c = SECTION_CONFIG[name];
            const beats = c.bars * barBeats;

            let e = c.baseEnergy;
            e = Math.max(mood.energyCap[0], Math.min(mood.energyCap[1], e));

            sections.push({
                name,
                startBeat: currentBeat,
                endBeat: currentBeat + beats,
                energyLevel: e,
            });
            currentBeat += beats;
        }

        return sections;
    }
}
