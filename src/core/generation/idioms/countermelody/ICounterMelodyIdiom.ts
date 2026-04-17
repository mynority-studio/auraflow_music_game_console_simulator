// ICounterMelodyIdiom — 副旋律 Idiom 接口
//
// 3 种 Interplay 模式：
//   - ParallelHarmony: 与主旋律三度/六度并行
//   - OctaveDoubling: 八度加厚
//   - CallAndResponse: 呼应填空（主旋律休止时填补）
//
// 由 section 类型 + 能量决定模式，不强绑风格。

import { NoteData, GeneratedChord, Tonality, SectionType } from '../../types';

export interface CounterMelodyContext {
    chord: GeneratedChord;
    energyLevel: number;
    melodyNotes: NoteData[];
    tonality: Tonality;
    sectionType: SectionType;
    sectionName: string;
    beatsPerBar: number;
}

export type InterplayMode = 'ParallelHarmony' | 'OctaveDoubling' | 'CallAndResponse';

export interface ICounterMelodyIdiom {
    readonly name: string;
    generate(ctx: CounterMelodyContext): NoteData[];
}

/**
 * 根据 section 类型 + 能量确定性地选择 interplay 模式
 * 不消耗 PRNG（用 sectionName hash 做确定性选择）
 */
export function pickInterplayMode(sectionType: SectionType, sectionName: string, energyLevel: number): InterplayMode {
    let hash = 0;
    for (let i = 0; i < sectionName.length; i++) {
        hash = ((hash << 5) - hash + sectionName.charCodeAt(i)) | 0;
    }
    hash = Math.abs(hash);

    if (sectionType === SectionType.Chorus || sectionType === SectionType.Drop) {
        // 高能量段：三度平行或八度加厚
        const modes: InterplayMode[] = ['ParallelHarmony', 'OctaveDoubling', 'CallAndResponse'];
        return modes[hash % 3];
    } else if (sectionType === SectionType.PreChorus || sectionType === SectionType.BuildUp) {
        // 上升段：平行或呼应
        const modes: InterplayMode[] = ['ParallelHarmony', 'CallAndResponse'];
        return modes[hash % 2];
    } else {
        // Verse/Intro/Bridge：主要呼应，偶尔平行
        const modes: InterplayMode[] = ['CallAndResponse', 'CallAndResponse', 'ParallelHarmony'];
        return modes[hash % 3];
    }
}
