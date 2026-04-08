import { Tonality, TonalityName, SCALE_INTERVALS } from '@/src/core/generation/types';

export interface ScaleState {
    key: number;          // 0-11 (pitch class)
    tonality: Tonality;
    noteMap: number[];    // 14 MIDI notes, ascending
    keyName: string;      // 显示用 ("C", "Db", ...)
    tonalityName: string; // 显示用 ("Major", "Blues", ...)
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const ALL_TONALITIES = [
    Tonality.Major, Tonality.Minor, Tonality.Major_Pentatonic,
    Tonality.Minor_Pentatonic, Tonality.Blues, Tonality.Dorian,
    Tonality.Mixolydian, Tonality.Melodic_Minor, Tonality.Lydian
];

function generateScaleNotes(key: number, tonality: Tonality): number[] {
    const intervals = SCALE_INTERVALS[tonality];
    const notes: number[] = [];
    // 起始八度：C3 附近，确保音域在 C3~C5 左右（MIDI 48~72）
    let octave = Math.floor((key + 48) / 12);
    let scaleIdx = 0;
    for (let i = 0; i < 14; i++) {
        notes.push(intervals[scaleIdx] + octave * 12 + key);
        scaleIdx++;
        if (scaleIdx >= intervals.length) {
            scaleIdx = 0;
            octave++;
        }
    }
    return notes;
}

export class ScaleEngine {
    private state: ScaleState;

    constructor() {
        // 初始就随机，不要每次都是 C Major
        this.state = ScaleEngine.generate(0, Tonality.Major);
        this.refresh(() => Math.random());
    }

    /** 随机刷新音阶（需外部先 seed PRNG 或用 Math.random） */
    refresh(randFn: () => number): ScaleState {
        const key = Math.floor(randFn() * 12);
        const tonality = ALL_TONALITIES[Math.floor(randFn() * ALL_TONALITIES.length)];
        this.state = ScaleEngine.generate(key, tonality);
        return this.state;
    }

    getState(): ScaleState {
        return this.state;
    }

    noteAt(padIndex: number): number {
        return this.state.noteMap[padIndex] ?? 60;
    }

    /** (c, r) → pad 索引（0-13），FN 键返回 -1 */
    static padIndex(c: number, r: number): number {
        if (c === 4 && r === 0) return -1; // FN key
        if (r === 2) return c;             // 底行 0-4
        if (r === 1) return 5 + c;         // 中行 5-9
        if (r === 0 && c < 4) return 10 + c; // 顶行 10-13
        return -1;
    }

    private static generate(key: number, tonality: Tonality): ScaleState {
        return {
            key,
            tonality,
            noteMap: generateScaleNotes(key, tonality),
            keyName: KEY_NAMES[key % 12],
            tonalityName: TonalityName[tonality] || 'Major'
        };
    }
}
