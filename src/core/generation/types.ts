export type ChordProgression = string[];

/**
 * C++ Porting Guide:
 * This interface maps directly to a C struct to avoid heap fragmentation:
 * struct NoteData {
 *   uint8_t pitch;       // 0-127
 *   uint8_t velocity;    // 0-127 (mapped from 0.0-1.0 float if needed)
 *   float onset;         // Beat position
 *   float duration;      // Beat length
 *   // Optional flags can be packed into a bitfield (uint8_t flags)
 * };
 */
export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; pitchBend?: number; pitchBendDuration?: number; fadeOutDuration?: number; isUserMotif?: boolean; }
export interface GeneratedChord { numeral: string; root: number; quality: 'Major' | 'Minor' | 'Diminished' | 'Augmented' | 'Dominant7' | 'Minor7' | 'Major7' | 'HalfDiminished' | 'Sus4' | 'Dominant7Sus4' | 'Add9' | 'Minor9' | 'Major9' | 'Dominant9' | 'Minor11' | 'Dominant13'; startBeat: number; endBeat: number; }

// --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
export interface HarmonyState {
    baseProgression: string[];
    complexityProb: number;
    harmonicRhythm: number;
}

export interface GrooveState {
    density: number;
    syncopationProb: number;
    swing: number;
}

export interface TrackBehavior {
    [key: string]: number | boolean | string;
}

export interface TrackState {
    id: string;
    instrument: string;
    role: string;
    activeEnergyThreshold: number;
    behavior: TrackBehavior;
}

export interface SectionState {
    id: string;
    type: string;
    lengthBars: number;
    phraseTemplate: string; // e.g., "A-A-B-A'"
    energyLevel: number;
    harmony: HarmonyState;
    groove: GrooveState;
    tracks: TrackState[];
    startBeat: number;
    endBeat: number;
    lofiEffect?: boolean;
}

export interface MacroStructure {
    structure: string[]; 
    energyCurve: number[]; 
}
// -------------------------------------------------------

export interface StyleConfig {
    id: string; name: string; description?: string;
    global: { bpmRange: [number, number]; timeSignaturePool: Array<{ signature:[number, number], weight: number }>; tonalityPool: Array<{ tonality: 'Major' | 'Minor' | 'Major_Pentatonic' | 'Minor_Pentatonic' | 'Blues' | 'Dorian' | 'Mixolydian', weight: number }>; };
    harmony: { chorusPool: ChordProgression[]; versePool: ChordProgression[]; preChorusPool: ChordProgression[]; };
    harmonyRules?: {
        maxDissonanceTolerance?: number;
        passingChords?: Array<'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished'>;
        allowTritoneSub?: boolean;
        reharmProbability?: number;
        borrowedChords?: Array<'ModalMixture' | 'Neapolitan' | 'SecondaryDominant' | 'TritoneSubstitution'>;
        voicingStyle?: 'standard' | 'neo-soul' | 'jazz';
    };
    rhythm: { densityBase: [number, number]; syncopationWeight: number; restProbability: number; disruptionProbability: number; humanize: number; swingRatio?: number; swingSubdivision?: 0.5 | 0.25; };
    melody: { 
        stepwiseRatio: number; 
        maxJumpInterval: number; 
        tensionTolerance: number; 
        mutationProbability: number; 
        mutationPool: Array<'inversion' | 'augmentation' | 'truncation' | 'retrograde' | 'diminution'>; 
        pentatonicPreference?: number;
        extensionPreference?: number;
        chromaticPassingProbability?: number;
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
    };
    contrast: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: { 
        melodyInstruments: string[]; 
        chordInstruments: string[]; 
        bassInstruments?: string[];
        drumInstruments?: string[];
        counterMelodyInstruments?: string[];
        texturePool: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass'>;
        drumProbability?: number; // 🌟 新增：鼓组出场率，彻底解耦
        counterMelodyProbability?: number; // 副旋律出场率
        vocalProbability?: number; // 🌟 新增：主唱出场率
        idiomPreferences?: {
            stringStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm';
            pianoStyle?: 'pop' | 'jazz' | 'cinematic' | 'classical' | 'electronic' | 'rock' | 'bossa' | 'edm';
            drumStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm';
            bassStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm';
        };
    };
    performance: { allowedPersonas: string[]; };
}

export interface SingerPersonaConfig {
    id: string; name: string;
    traits: { staccatoTendency: number; trailingFade: number; graceNoteProbability: number; syncopationPush: number; }
}

export interface SectionMetadata {
    name: string;      
    startBeat: number;
    endBeat: number;
    energyLevel: number; 
    grooveDNA?: number[]; // 🌟 这个极为重要：每一段将拥有自己独立的 Groove
    lofiEffect?: boolean; // 🌟 新增：复古留声机/黑胶质感特效
    endingType?: 'hard_stop' | 'fade_out'; // 🌟 决定结尾的收尾方式
    
    // --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
    type?: string;
    lengthBars?: number;
    phraseTemplate?: string; // e.g., "A-A-B-A'"
    harmony?: HarmonyState;
    groove?: GrooveState;
    tracks?: TrackState[];

    // --- Phase 3 & 4: Genre-Bending & Riff-Driven ---
    localStyleOverride?: string; // 局部风格覆盖 (Option B)
    isRiffDriven?: boolean;      // 是否由 Riff 驱动 (Option A)
}

export interface MixingConfig {
    pan: number; // -1 (left) to 1 (right)
    reverb: number; // 0 to 1 (send level)
    volume: number; // dB offset (e.g., -6 to +6)
    delay?: number; // 0 to 1 (send level)
}

export interface EnsembleDraft {
    vocalSound?: string;
    melodySound: string;
    secondaryMelodySound?: string;
    chordSound: string | null;
    bassSound: string | null;
    drumSound: string | null;
    counterMelodySound: string | null;
    filterSweep?: string;
    mixing?: {
        vocal?: MixingConfig;
        melody?: MixingConfig;
        secondaryMelody?: MixingConfig;
        chord?: MixingConfig;
        bass?: MixingConfig;
        drums?: MixingConfig;
        counterMelody?: MixingConfig;
    };
}

export interface GeneratedTrack { 
    chords: GeneratedChord[]; vocal?: NoteData[]; melody: NoteData[]; bpm: number; key: string; 
    keyOffset: number; tonality: string; timeSignature: [number, number]; sections: SectionMetadata[]; 
    blockIndex: number; absoluteStartBeat: number; hasIntro: boolean; 
    preSelectedPalette?: EnsembleDraft;
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    motifExpertise?: string;
}
export interface ArrangedTrack { 
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    styleId?: string;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    palette?: EnsembleDraft; 
    sections?: SectionMetadata[];
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
}