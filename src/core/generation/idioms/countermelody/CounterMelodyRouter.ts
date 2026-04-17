// CounterMelodyRouter — 副旋律 Idiom 路由
// 按 section 类型 + 能量选 interplay 模式，调对应 Idiom
// Pitch Space: RELATIVE

import { NoteData, GeneratedChord, Tonality, SectionType } from '../../types';
import { CounterMelodyContext, pickInterplayMode, InterplayMode } from './ICounterMelodyIdiom';
import { ParallelHarmonyIdiom } from './ParallelHarmonyIdiom';
import { CallAndResponseIdiom } from './CallAndResponseIdiom';

const parallelHarmony = new ParallelHarmonyIdiom();
const callAndResponse = new CallAndResponseIdiom();

export class CounterMelodyRouter {
    /**
     * 为一个 chord 区间生成副旋律
     * 根据 sectionType + energy 选 interplay 模式
     */
    public static generate(
        chord: GeneratedChord,
        energyLevel: number,
        melodyNotes: NoteData[],
        tonality: Tonality,
        sectionType: SectionType,
        sectionName: string,
        beatsPerBar: number,
    ): NoteData[] {
        const ctx: CounterMelodyContext = {
            chord,
            energyLevel,
            melodyNotes,
            tonality,
            sectionType,
            sectionName,
            beatsPerBar,
        };

        const mode = pickInterplayMode(sectionType, sectionName, energyLevel);

        if (mode === 'ParallelHarmony' || mode === 'OctaveDoubling') {
            // OctaveDoubling 暂用 ParallelHarmony 代替（未来独立 Idiom）
            return parallelHarmony.generate(ctx);
        } else {
            return callAndResponse.generate(ctx);
        }
    }
}
