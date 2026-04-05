export type ChordProgression = string[];

/** S-7 合规：生成管道专用 Error 子类，附带上下文信息 */
export class GenerationError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'GenerationError';
  }
}

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
import { MoodId } from './config/MoodFlags';
import { InstrumentId } from './config/InstrumentFlags';

export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; pitchBend?: number; pitchBendDuration?: number; fadeOutDuration?: number; isUserMotif?: boolean; }
// T-1 合规：ChordQuality 数值枚举，替代字符串联合
export enum ChordQuality {
    Major = 0,
    Minor = 1,
    Diminished = 2,
    Diminished7 = 3,
    Augmented = 4,
    Dominant7 = 5,
    Minor7 = 6,
    Major7 = 7,
    HalfDiminished = 8,
    Sus4 = 9,
    Dominant7Sus4 = 10,
    Add9 = 11,
    Minor9 = 12,
    Major9 = 13,
    Dominant9 = 14,
    Minor11 = 15,
    Dominant13 = 16,
}

// 翻译枚举：ChordQuality → 显示名
export const ChordQualityName: string[] = [];
ChordQualityName[ChordQuality.Major] = 'Major';
ChordQualityName[ChordQuality.Minor] = 'Minor';
ChordQualityName[ChordQuality.Diminished] = 'Diminished';
ChordQualityName[ChordQuality.Diminished7] = 'Diminished7';
ChordQualityName[ChordQuality.Augmented] = 'Augmented';
ChordQualityName[ChordQuality.Dominant7] = 'Dominant7';
ChordQualityName[ChordQuality.Minor7] = 'Minor7';
ChordQualityName[ChordQuality.Major7] = 'Major7';
ChordQualityName[ChordQuality.HalfDiminished] = 'HalfDiminished';
ChordQualityName[ChordQuality.Sus4] = 'Sus4';
ChordQualityName[ChordQuality.Dominant7Sus4] = 'Dominant7Sus4';
ChordQualityName[ChordQuality.Add9] = 'Add9';
ChordQualityName[ChordQuality.Minor9] = 'Minor9';
ChordQualityName[ChordQuality.Major9] = 'Major9';
ChordQualityName[ChordQuality.Dominant9] = 'Dominant9';
ChordQualityName[ChordQuality.Minor11] = 'Minor11';
ChordQualityName[ChordQuality.Dominant13] = 'Dominant13';

// 和弦音程查表（替代 HarmonyCore 中的 17 行 if-chain）
export const CHORD_INTERVALS: readonly (readonly number[])[] = [
    [0, 4, 7],           // Major
    [0, 3, 7],           // Minor
    [0, 3, 6],           // Diminished
    [0, 3, 6, 9],        // Diminished7
    [0, 4, 8],           // Augmented
    [0, 4, 7, 10],       // Dominant7
    [0, 3, 7, 10],       // Minor7
    [0, 4, 7, 11],       // Major7
    [0, 3, 6, 10],       // HalfDiminished
    [0, 5, 7],           // Sus4
    [0, 5, 7, 10],       // Dominant7Sus4
    [0, 4, 7, 14],       // Add9 (root, 3rd, 5th, 9th)
    [0, 3, 7, 10, 14],   // Minor9
    [0, 4, 7, 11, 14],   // Major9
    [0, 4, 7, 10, 14],   // Dominant9
    [0, 3, 7, 10, 14, 17], // Minor11
    [0, 4, 7, 10, 14, 17, 21], // Dominant13
];

// T-1 合规：ChordQuality 位掩码，用于分类检查（替代 .includes() 子串匹配）
export const CQ_IS_MINOR  = (1 << ChordQuality.Minor) | (1 << ChordQuality.Minor7) | (1 << ChordQuality.Minor9) | (1 << ChordQuality.Minor11);
export const CQ_IS_MAJOR  = (1 << ChordQuality.Major) | (1 << ChordQuality.Major7) | (1 << ChordQuality.Major9) | (1 << ChordQuality.Add9);
export const CQ_IS_DOM    = (1 << ChordQuality.Dominant7) | (1 << ChordQuality.Dominant9) | (1 << ChordQuality.Dominant13) | (1 << ChordQuality.Dominant7Sus4);
export const CQ_IS_DIM    = (1 << ChordQuality.Diminished) | (1 << ChordQuality.Diminished7);
export const CQ_IS_MINOR_OR_DIM = CQ_IS_MINOR | CQ_IS_DIM;
export const CQ_IS_HIGH_TENSION = (1 << ChordQuality.Major7) | (1 << ChordQuality.Minor7) | (1 << ChordQuality.Dominant7) | (1 << ChordQuality.Add9) | (1 << ChordQuality.Minor9) | (1 << ChordQuality.Major9) | (1 << ChordQuality.Dominant9) | (1 << ChordQuality.Minor11) | (1 << ChordQuality.Dominant13);

// T-1 合规：Tonality 数值枚举，替代 tonality 字符串比较
export enum Tonality {
    Major = 0,
    Minor = 1,
    Major_Pentatonic = 2,
    Minor_Pentatonic = 3,
    Blues = 4,
    Dorian = 5,
    Mixolydian = 6,
    Melodic_Minor = 7,
    Lydian = 8,
}

// 翻译枚举：Tonality → 显示名
export const TonalityName: string[] = [];
TonalityName[Tonality.Major] = 'Major';
TonalityName[Tonality.Minor] = 'Minor';
TonalityName[Tonality.Major_Pentatonic] = 'Major_Pentatonic';
TonalityName[Tonality.Minor_Pentatonic] = 'Minor_Pentatonic';
TonalityName[Tonality.Blues] = 'Blues';
TonalityName[Tonality.Dorian] = 'Dorian';
TonalityName[Tonality.Mixolydian] = 'Mixolydian';
TonalityName[Tonality.Melodic_Minor] = 'Melodic_Minor';
TonalityName[Tonality.Lydian] = 'Lydian';

// 音阶音程查表（替代 HarmonyCore.getScalePitches 中的 if-chain）
export const SCALE_INTERVALS: readonly (readonly number[])[] = [
    [0, 2, 4, 5, 7, 9, 11],     // Major
    [0, 2, 3, 5, 7, 8, 10],     // Minor
    [0, 2, 4, 7, 9],             // Major_Pentatonic
    [0, 3, 5, 7, 10],            // Minor_Pentatonic
    [0, 3, 5, 6, 7, 10],         // Blues
    [0, 2, 3, 5, 7, 9, 10],     // Dorian
    [0, 2, 4, 5, 7, 9, 10],     // Mixolydian
    [0, 2, 3, 5, 7, 9, 11],     // Melodic_Minor
    [0, 2, 4, 6, 7, 9, 11],     // Lydian（升四度，空灵感核心）
];

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
    phraseTemplate: string; // Deprecated, use phraseActions instead
    phraseActions?: PhraseAction[]; // e.g., [Repeat, Vary, Contrast]
    energyLevel: number;
    harmony: HarmonyState;
    groove: GrooveState;
    tracks: TrackState[];
    startBeat: number;
    endBeat: number;
}

export enum PhraseAction {
    Repeat = 0,
    Vary = 1,
    Contrast = 2
}

export interface MotifTemplate {
    pickupType: number; // 0: none, 1: 8th note, 2: quarter note
    bodyDensity: number; // 0.0 to 1.0
    tailLength: number; // in beats, e.g., 1.0, 2.0
    rhythmOffsets: number[]; // the actual generated rhythm
    contour: 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
    noteCount: number;
    phraseLengthBeats: number;
}

export interface MacroStructure {
    structure: string[]; 
    energyCurve: number[]; 
}
// -------------------------------------------------------

/** 通用音乐生成参数 — 纯音乐计算，零风格意识 */
export interface GenerationParams {
    global: {
        bpmRange: [number, number];
        timeSignaturePool: Array<{ signature:[number, number], weight: number }>;
        tonalityPool: Array<{ tonality: Tonality, weight: number }>;
        structureTemplate?: 'pop' | 'edm' | 'jazz' | 'bossa' | 'cinematic';
    };
    harmony: { chorusPool: ChordProgression[]; versePool: ChordProgression[]; preChorusPool: ChordProgression[]; };
    harmonyRules?: {
        maxDissonanceTolerance?: number;
        passingChords?: Array<'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished' | 'SharpFourHalfDim'>;
        allowTritoneSub?: boolean;
        reharmProbability?: number;
        melodyDrivenReharmProbability?: number;
        borrowedChords?: Array<'ModalMixture' | 'Neapolitan' | 'SecondaryDominant' | 'TritoneSubstitution'>;
        voicingStyle?: 'standard' | 'neo-soul' | 'jazz' | 'jpop' | 'edm' | 'pop-rock';
        globalProgressionProbability?: number;
        preferJPopProgressions?: boolean;
        /** 和弦色彩扩展概率 — 覆盖 voicingStyle 的默认值 (Jazz=1.0, JPop=0.8, EDM=0.6, Pop=0.65) */
        spiceProbability?: number;
        /** 乐句边界插入属和弦概率 (default 0.3, 设 0 可禁用) */
        dominantInsertionProbability?: number;
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
        leapResolutionThreshold?: number;
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
        anchorProbability?: number;
        riffDrivenProbability?: number;
        /** Chorus motif A 节奏骨架复用到 Verse/PreChorus 的概率 (0.0~1.0, 默认 0.4) */
        chorusMotifReuseProbability?: number;
        /** 复用时对每个节奏偏移的变异概率 (0.0~1.0, 默认 0.3) */
        motifRhythmMutationOnReuse?: number;
        /** 强拍偏好三音/七音的概率 (0.0~1.0, 默认 0.8) */
        strongBeatExtensionBias?: number;
        /** 强拍候选中包含根音的概率 (0.0~1.0, 默认 0.15) */
        strongBeatRootProbability?: number;
    };
    contrast: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: {
        melodyInstruments: InstrumentId[];
        chordInstruments: InstrumentId[];
        bassInstruments: InstrumentId[];
        drumInstruments: InstrumentId[];
        counterMelodyInstruments: InstrumentId[];
        texturePool: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass'>;
        drumProbability?: number;
        counterMelodyProbability?: number;
        fillStyle?: 'micro' | 'standard' | 'heavy' | 'electronic';
        drumMode?: 'standard' | 'laid-back' | 'four-on-floor';
        bassMode?: 'root-based' | 'groove-lock' | 'walking';
        pianoMode?: 'standard' | 'syncopated-comping';
        counterMelodyMode?: 'sustained' | 'melodic-response';
        vocalProbability?: number;
        outroRingOutProbability?: number;
        allowTradingFours?: boolean;
        allowIntroRiffs?: boolean;
        allowRitardando?: boolean;
        /** 段落过渡 tempo curve 概率 (0.0~1.0)，0=从不，1=总是，默认 1.0 */
        tempoTransitionProbability?: number;
        /** accelerando 幅度 (0.15 = +15%)，默认 0.15 */
        accelIntensity?: number;
        /** ritardando 幅度 (0.10 = -10%)，默认 0.10 */
        ritIntensity?: number;
        grooveRatio?: { foundation: number; comping: number; color: number; };
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
}

// T-1 合规：SectionType 数值枚举，替代 section.name.includes() 字符串子串匹配
export enum SectionType {
    Intro = 0,
    Verse = 1,
    PreChorus = 2,
    Chorus = 3,
    Bridge = 4,
    Outro = 5,
    Break = 6,
    Breakdown = 7,
    BuildUp = 8,
    Drop = 9,
    PreOutro = 10,
    Solo_Bridge = 11,
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

    // --- Riff-Driven ---
    isRiffDriven?: boolean;      // 是否由 Riff 驱动
}


export interface MixingConfig {
    pan?: number; // -1 (left) to 1 (right)
    reverb?: number; // 0 to 1 (send level)
    volume?: number; // dB offset (e.g., -6 to +6)
    delay?: number; // 0 to 1 (send level)
}

export interface EnsembleDraft {
    vocalSound?: InstrumentId;
    melodySound: InstrumentId;
    secondaryMelodySound?: InstrumentId;
    chordSound: InstrumentId | null;
    bassSound: InstrumentId | null;
    drumSound: InstrumentId | null;
    counterMelodySound: InstrumentId | null;
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
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
}

export interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    moodId?: MoodId;
}

export interface GenerationOptions {
    moodId?: MoodId;
    seed?: number;
    length?: 'short' | 'medium' | 'long';
    userMotifRoot?: number;
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    detectedTimeSignature?: [number, number];
    detectedTonality?: Tonality;
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
    mixStyle?: string;
    requireSidechain?: boolean;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    palette?: EnsembleDraft;
    sections?: SectionMetadata[];
    globalRiff?: NoteData[];
    chords?: GeneratedChord[];
    tempoCurves?: TempoCurve[];
}

/** 通用默认生成参数（基于中性流行风格） */
export function getDefaultParams(): GenerationParams {
    return {
        global: {
            bpmRange: [75, 115] as [number, number],
            timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
            tonalityPool: [
                { tonality: Tonality.Major, weight: 0.45 },
                { tonality: Tonality.Minor, weight: 0.25 },
                { tonality: Tonality.Dorian, weight: 0.1 },
                { tonality: Tonality.Mixolydian, weight: 0.1 },
                { tonality: Tonality.Lydian, weight: 0.1 },
            ]
        },
        harmony: {
            chorusPool: [
                ['IV', 'V', 'iii', 'vi'],
                ['vi', 'IV', 'I', 'V'],
                ['I', 'V', 'vi', 'iii'],
                ['I', 'vi', 'IV', 'V']
            ],
            versePool: [
                ['I', 'V', 'vi', 'iii'],
                ['I', 'vi', 'IV', 'V'],
                ['vi', 'iii', 'IV', 'I'],
                ['ii', 'V', 'I', 'vi']
            ],
            preChorusPool: [
                ['ii', 'V', 'iii', 'vi'],
                ['IV', 'V', 'vi', 'vi'],
                ['IV', 'V', 'I', 'I']
            ]
        },
        harmonyRules: {
            maxDissonanceTolerance: 0.4,
            reharmProbability: 0.2,
            borrowedChords: ['ModalMixture'],
            voicingStyle: 'standard',
            passingChords: ['SecondaryDominant', 'Diminished7'],
            allowTritoneSub: false,
            dominantInsertionProbability: 0.3,
        },
        rhythm: {
            densityBase: [0.4, 0.7] as [number, number],
            syncopationWeight: 0.4,
            restProbability: 0.15,
            disruptionProbability: 0.05,
            humanize: 0.1,
            swingRatio: 0
        },
        melody: {
            stepwiseRatio: 0.7,
            maxJumpInterval: 12,
            tensionTolerance: 0.15,
            mutationProbability: 0.25,
            mutationPool: ['inversion', 'augmentation', 'retrograde'],
            chorusMotifReuseProbability: 0.4,
            motifRhythmMutationOnReuse: 0.3,
            strongBeatExtensionBias: 0.8,
            strongBeatRootProbability: 0.15,
        },
        contrast: {
            chorusPitchOffset: 7,
            verseDensityMultiplier: 0.65,
            versePitchOffset: -2
        },
        modulation: {
            probability: 0.4,
            targetSection: 'Final_Chorus',
            intervalPool: [1, 2]
        },
        orchestration: {
            melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.String_Ensemble, InstrumentId.Warm_EP],
            chordInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Guitar_Chord, InstrumentId.Warm_EP],
            bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Electric_Bass_Pick, InstrumentId.Fretless_Bass, InstrumentId.Acoustic_Bass],
            drumInstruments: [InstrumentId.Standard_DrumKit],
            counterMelodyInstruments: [InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Pad_1_NewAge, InstrumentId.Pad_3_Polysynth],
            texturePool: ['Arpeggio', 'Arpeggio', 'Block', 'Pad'],
            drumProbability: 1.0,
            counterMelodyProbability: 0.9,
            grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
            mixingPreferences: {
                requireSidechain: true,
                melody: { pan: 0, reverb: 0.5, delay: 0.2 },
                chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
                counterMelody: { pan: -0.6, volume: -5.0 },
                drums: { reverb: 0.15, volume: -1.0 },
                bass: { reverb: 0.25, volume: -4.0 }
            }
        }
    };
}