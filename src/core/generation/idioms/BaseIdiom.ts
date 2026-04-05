import { GeneratedChord, NoteData, StyleConfig, MusicContext } from '../types';

export interface IdiomContext {
    chord: GeneratedChord;
    energyLevel: number;
    playBass: boolean;
    playDrums: boolean;
    melodyNotes: NoteData[];
    prevVoicing?: number[];
    densityMultiplier: number;
    styleConfig?: StyleConfig;
    musicContext?: MusicContext;
    textureType: string;
    isSparseSection?: boolean;
    isSectionEnd?: boolean;
    nextChord?: GeneratedChord;
}

export interface InstrumentIdiom {
    generate(context: IdiomContext): NoteData[];
}
