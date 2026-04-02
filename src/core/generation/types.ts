export type ChordProgression = string[];

// ★ ChordQuality — 数值枚举，替代 chord.quality 字符串比较
export enum ChordQuality {
  Major = 0, Minor, Diminished, Diminished7, Augmented,
  Dominant7, Minor7, Major7, HalfDiminished,
  Sus4, Dominant7Sus4, Add9, Minor9, Major9,
  Dominant9, Minor11, Dominant13                         // 共 17 种
}

// ★ SectionType — 数值枚举，替代 section.type / section.name 字符串比较
export enum SectionType {
  Intro = 0, Verse, PreChorus, Chorus, Bridge, Outro,
  Break, Breakdown, BuildUp, Drop, PreOutro, Solo_Bridge  // 共 12 种
}

// ★ Tonality — 数值枚举，替代 tonality 字符串比较
export enum Tonality {
  Major = 0, Minor, Major_Pentatonic, Minor_Pentatonic,
  Blues, Dorian, Mixolydian, Melodic_Minor               // 共 8 种
}

export type MotifRole = 'Foreground' | 'Middleground' | 'Background';

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
export interface GeneratedChord { numeral: string; root: number; quality: ChordQuality; startBeat: number; endBeat: number; keyOffset?: number; extensions?: string[]; isSignatureEnding?: boolean; }

// --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
export interface RhythmCell {
    durations: number[]; // e.g., [0.5, 0.5] for two 8th notes
    weight: number;      // Probability weight
    tags: string[];      // e.g., 'syncopated', 'straight', 'triplet'
}

export interface HarmonyState {
    baseProgression: string[];
    complexityProb: number;
    harmonicRhythm: number;
}

export interface GrooveState {
    density: number;
    syncopationProb: number;
    swing: number;
    feel?: "half-time" | "normal" | "double-time";
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
}

export interface MacroStructure {
    structure: string[]; 
    energyCurve: number[]; 
}
// -------------------------------------------------------

import { StyleId } from './config/StyleFlags';

export interface IdiomPreferences {
    stringStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm' | 'reggae' | 'neosoul' | 'eurodance' | 'synthwave' | 'trance' | 'ballad';
    pianoStyle?: 'pop' | 'jazz' | 'cinematic' | 'classical' | 'electronic' | 'rock' | 'bossa' | 'edm' | 'reggae' | 'neosoul' | 'eurodance' | 'synthwave' | 'trance' | 'ballad' | 'latin' | 'house';
    drumStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm' | 'reggae' | 'neosoul' | 'eurodance' | 'synthwave' | 'trance' | 'ballad' | 'house';
    bassStyle?: 'cinematic' | 'lofi' | 'jazz' | 'funk' | 'folk' | 'pop' | 'electronic' | 'rock' | 'bossa' | 'edm' | 'reggae' | 'neosoul' | 'eurodance' | 'synthwave' | 'trance' | 'ballad';
    riffStyle?: 'pop' | 'jazz' | 'cinematic' | 'classical' | 'electronic' | 'rock' | 'bossa' | 'edm' | 'reggae' | 'neosoul' | 'eurodance' | 'synthwave' | 'trance' | 'ballad' | 'default';
    guitarStyle?: string;
    synthStyle?: string;
    humanizeAmount?: number;
    sections?: SectionMetadata[];
    arpPattern?: 'up' | 'down' | 'updown' | 'random';
    arpRate?: number;
}

export interface StyleConfig {
    id: StyleId; name: string; description?: string;
    global: { bpmRange: [number, number]; timeSignaturePool: Array<{ signature:[number, number], weight: number }>; tonalityPool: Array<{ tonality: Tonality, weight: number }>; };
    harmony: { chorusPool: ChordProgression[]; versePool: ChordProgression[]; preChorusPool: ChordProgression[]; };
    harmonyRules?: {
        maxDissonanceTolerance?: number;
        passingChords?: Array<'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished' | 'SharpFourHalfDim'>;
        allowTritoneSub?: boolean;
        reharmProbability?: number;
        melodyDrivenReharmProbability?: number; // 🌟 新增：旋律引导的和声替换概率
        borrowedChords?: Array<'ModalMixture' | 'Neapolitan' | 'SecondaryDominant' | 'TritoneSubstitution'>;
        voicingStyle?: 'standard' | 'neo-soul' | 'jazz' | 'jpop' | 'edm' | 'pop-rock';
        globalProgressionProbability?: number; // 🌟 新增：全曲共用一套和弦的概率
        genreBendingProbability?: number; // 🌟 新增：段落发生风格突变的概率
    };
    rhythm: { densityBase: [number, number]; syncopationWeight: number; restProbability: number; disruptionProbability: number; humanize: number; swingRatio?: number; swingSubdivision?: 0.5 | 0.25; strictGrid?: boolean; grooveTemplate?: RhythmCell[]; };
    melody: { 
        stepwiseRatio: number; 
        maxJumpInterval: number; 
        tensionTolerance: number; 
        mutationProbability: number; 
        mutationPool: Array<'inversion' | 'augmentation' | 'truncation' | 'retrograde' | 'diminution'>; 
        pentatonicPreference?: number;
        extensionPreference?: number;
        chromaticPassingProbability?: number;
        leapResolutionThreshold?: number; // 🌟 新增：多大的音程被视为大跳并需要反向解决
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
        anchorProbability?: number; // 🌟 新增：同音反复的概率
        riffDrivenProbability?: number; // 🌟 新增：段落由 Riff 驱动的概率
    };
    contrast: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: {
        melodyInstruments: string[];
        chordInstruments: string[];
        bassInstruments: string[];
        drumInstruments: string[];
        counterMelodyInstruments: string[];
        texturePool: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass'>;
        drumProbability?: number; // 🌟 新增：鼓组出场率，彻底解耦
        counterMelodyProbability?: number; // 副旋律出场率
        fillStyle?: 'micro' | 'standard' | 'heavy' | 'electronic'; // 🌟 新增：加花风格
        vocalProbability?: number; // 🌟 新增：主唱出场率
        outroRingOutProbability?: number; // 🌟 新增：尾奏使用 BigRingOut 的概率
        grooveRatio?: { foundation: number; comping: number; color: number; }; // 🌟 新增：律动比例控制器
        idiomPreferences?: IdiomPreferences;
        mixingPreferences?: {
            requireSidechain?: boolean;
            melody?: MixingConfig;
            secondaryMelody?: MixingConfig;
            vocal?: MixingConfig;
            chord?: MixingConfig;
            bass?: MixingConfig;
            drums?: MixingConfig;
            counterMelody?: MixingConfig;
        };
    };
    performance: { allowedPersonas: string[]; };
}

export interface SingerPersonaConfig {
    id: string; name: string;
    traits: { staccatoTendency: number; trailingFade: number; graceNoteProbability: number; syncopationPush: number; }
}

export interface FusionProfile {
    primaryStyle: StyleId;
    fusionStyle?: StyleId;
    applyToDrums: boolean;
    applyToBass: boolean;
    applyToChords: boolean;
    applyToMelody: boolean;
}

export interface GrooveMask {
    accents: number[]; // Array of 1s and 0s representing 16th note accents (e.g., [1, 0, 0, 1, 0, 0, 1, 0, ...])
    resolution: number; // e.g., 0.25 for 16th notes
}

export interface TextureAllocation {
    bassDensity: number;
    chordDensity: number;
    drumDensity: number;
    melodyDensity: number;
}

export interface SectionMetadata {
    name: string;      
    startBeat: number;
    endBeat: number;
    energyLevel: number; 
    grooveDNA?: number[]; // 🌟 这个极为重要：每一段将拥有自己独立的 Groove
    endingType?: 'hard_stop' | 'fade_out'; // 🌟 决定结尾的收尾方式
    localKeyOffset?: number; // 🌟 局部转调偏移量 (Local Key Offset)
    
    // 🌟 P2: 律动比例控制器 (Groove Ratio Controller)
    grooveRatio?: {
        foundation: number; // Bass & Kick
        comping: number;    // Piano & Guitar
        color: number;      // Synth & Strings
    };

    // --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
    type?: SectionType;
    lengthBars?: number;
    phraseTemplate?: string; // e.g., "A-A-B-A'"
    harmony?: HarmonyState;
    groove?: GrooveState;
    tracks?: TrackState[];

    // --- Phase 3 & 4: Genre-Bending & Riff-Driven ---
    localStyleOverride?: StyleId; // 局部风格覆盖 (Option B)
    isRiffDriven?: boolean;      // 是否由 Riff 驱动 (Option A)
    fusionProfile?: FusionProfile; // 🌟 融合配置
    grooveMask?: GrooveMask;       // 🌟 律动骨架
    textureAllocation?: TextureAllocation; // 🌟 织体密度分配
}

export interface MixingConfig {
    pan?: number; // -1 (left) to 1 (right)
    reverb?: number; // 0 to 1 (send level)
    volume?: number; // dB offset (e.g., -6 to +6)
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
    keyOffset: number; tonality: Tonality; timeSignature: [number, number]; sections: SectionMetadata[];
    blockIndex: number; absoluteStartBeat: number; hasIntro: boolean;
    preSelectedPalette?: EnsembleDraft;
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    processedUserMotif?: NoteData[];
    motifRole?: MotifRole;
}

export interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    singerPersona: SingerPersonaConfig | null;
}

export interface TempoCurve {
    startTick: number;
    endTick: number;
    startBpm: number;
    endBpm: number;
    curveType: 'linear' | 'exponential';
}

export interface ArrangedTrack { 
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    styleId?: StyleId;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    palette?: EnsembleDraft; 
    sections?: SectionMetadata[];
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    chords?: GeneratedChord[]; // 全曲和弦进行
    tempoCurves?: TempoCurve[]; // 渐慢/渐快曲线
}