import { NoteData, GeneratedChord } from '../types';

/** Piano Idiom 标准化上下文 */
export interface PianoIdiomContext {
    chord: GeneratedChord;
    chordTones: number[];
    energyLevel: number;
    textureType: string;
    chordStart: number;
    chordEnd: number;
    humanize: number;
    syncopationWeight: number;
    swingRatio: number;
    isSparseSection: boolean;
    isSectionEnd: boolean;
}

/** Piano Idiom 公共接口 */
export interface PianoIdiom {
    generate(ctx: PianoIdiomContext): NoteData[];
}
