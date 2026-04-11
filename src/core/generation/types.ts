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
import { MoodId } from './config/MoodFlags';
import { StyleId } from './config/StyleFlags';

export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; pitchBend?: number; pitchBendDuration?: number; fadeOutDuration?: number; isUserMotif?: boolean; }
export interface GeneratedChord { numeral: string; root: number; quality: 'Major' | 'Minor' | 'Diminished' | 'Diminished7' | 'Augmented' | 'Dominant7' | 'Minor7' | 'Major7' | 'HalfDiminished' | 'Sus4' | 'Dominant7Sus4' | 'Add9' | 'Minor9' | 'Major9' | 'Dominant9' | 'Minor11' | 'Dominant13'; startBeat: number; endBeat: number; keyOffset?: number; extensions?: string[]; isSignatureEnding?: boolean; }

// --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
export interface RhythmCell {
    durations: number[]; // e.g., [0.5, 0.5] for two 8th notes
    weight: number;      // Probability weight
    tags: string[];      // e.g., 'syncopated', 'straight', 'triplet'
}

export interface GrooveBankDef {
    name: string;               // 律动库名称（仅用于调试）
    cells: RhythmCell[];        // 节奏单元池
    syncopationWeight: number;  // 该律动库的特征切分率（影响全曲切分倾向）
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

export interface DSPNodeConfig {
    type: BiquadFilterType; // 'highpass', 'lowpass', 'peaking', 'highshelf'
    frequency: number;
    Q: number;
    gain?: number;
}

export interface MasteringProfile {
    id: string;
    nodes: DSPNodeConfig[];
    masterCompressor: { threshold: number, ratio: number, attack: number, release: number };
    makeupGain: number;
}

export interface InstrumentBehavior {
    pitchRange: [number, number]; // e.g., [60, 84] (C4 to C6)
    velocityRange: [number, number]; // e.g., [90, 115] (明亮) vs [40, 70] (暗淡)
}

// 🌟 段落模板：单个段落的纯数据描述
export interface SectionTemplate {
    name: string;       // 段落显示名 (e.g., "Verse_1", "Chorus_Main")
    bars: number;       // 小节数
    energy: number;     // 原始能量值 1-10（会被 mood.energyCap 进一步约束）
}

// ============================================================
// 🌟 层级动机系统（Hierarchical Motif System）
// ============================================================
//
// 三层结构：
//   PhraseGroup（大乐句容器，4/8/16 小节）
//     └── SubMotifSlot（子动机槽，1-2 小节，可重复/变奏）
//           └── NoteData（音符）
//
// 这取代了原本"phrase = motif = 2 小节"的扁平模型，让旋律有"完整句子"的容器感。

/**
 * 句式终止类型 — 决定 PhraseGroup 末尾应该是问句还是答句
 */
export enum CadenceType {
    Open = 0,    // 半终止：落在 V/2/7 度（导音、属音、上主音），听感"未完成"
    Closed = 1,  // 全终止：落在 I/3 度（主音、中音），听感"完成"
}

/**
 * SubMotif 在 PhraseGroup 内的角色，决定它与其它 sub-motif 的关系
 */
export type SubMotifRole = 'statement' | 'repeat' | 'vary' | 'contrast' | 'resolve' | 'climax';

/**
 * 子动机槽位 — PhraseGroup 内的一个 1-2 小节生成单元
 *
 * label 决定动机复用：相同 label 共享同一份 motif 模板，
 * 不同的 role 会触发不同的变奏（vary 用 _prime/_seq/_inv，contrast 是新动机等）
 */
export interface SubMotifSlot {
    label: string;          // 'M' | 'M_prime' | 'N' | 'M_resolve' 等
    role: SubMotifRole;
    lengthBars: number;     // 子动机长度（小节数），通常 1 或 2
    isPeak?: boolean;       // 是否是 hook 峰值位（仅 Chorus group 设置）
    pitchShift?: number;    // 相对 group 中心的半音偏移（用于 sequence）
}

/**
 * Hook 主动架构计划 — 让副歌的"那个高音"被有意放置和重复轰击
 */
export interface HookPlan {
    peakSlotIndex: number;     // 哪个 sub-motif 是峰值位
    targetPitchClass?: number; // 跨副歌共享的同一峰值音 pitch class（0-11），可选
    climbCurve: 'gradual' | 'steep' | 'plateau';  // 峰值前的爬升路径
    reinforceCount: number;    // 峰值在 group 内被重复砸的次数（>=1）
}

/**
 * 大乐句容器 — 4/8/16 小节，作为旋律生成的最小完整单元
 */
export interface PhraseGroup {
    startBeat: number;
    lengthBeats: number;        // 总长度（拍）= lengthBars × beatsPerBar
    subMotifs: SubMotifSlot[];  // 子动机槽位序列
    cadenceType: CadenceType;
    hookPlan?: HookPlan;        // 仅 Chorus PhraseGroup 设置
    formLabel?: string;         // 'AABA' | 'ABAB' | 'ABAC' | 'longform' 等，用于调试
}

/**
 * 风格层乐句长度配置 — 决定每个段落使用的 PhraseGroup 长度
 */
export interface PhraseLengthProfile {
    name: string;                                    // 'pop' | 'ballad' | 'dance' 等
    /** 各段落类型偏好的 group 长度（小节数 + 权重） */
    perSection: {
        verse?: { bars: number, weight: number }[];
        preChorus?: { bars: number, weight: number }[];
        chorus?: { bars: number, weight: number }[];
        bridge?: { bars: number, weight: number }[];
        intro?: { bars: number, weight: number }[];
        outro?: { bars: number, weight: number }[];
        default?: { bars: number, weight: number }[];
    };
    /** 子动机长度池（一般 1 或 2 小节） */
    subMotifBarsPool: { bars: number, weight: number }[];
}

// 🌟 结构模板：整曲段落序列的纯数据描述
// 取代 StructureEngine 中硬编码的 () => {...} 闭包
export interface StructureTemplate {
    id: string;                       // 模板标识，便于调试 (e.g., "standard-pop", "chorus-first")
    introBarsMultiplier?: number;     // 前奏小节数 = introBarsMultiplier × style.global.introBarsHighBpm（或 lowBpm）
    introBaseEnergy?: number;         // 前奏起始能量
    sections: SectionTemplate[];      // intro 之后的段落序列
}

export interface StyleConfig {
    id: StyleId; name: string; description?: string;
    global: {
        bpmRange: [number, number];
        timeSignaturePool: Array<{ signature:[number, number], weight: number }>;
        tonalityPool: Array<{ tonality: Tonality, weight: number }>;
        // 🌟 结构模板池：StructureEngine 从中等概率选取
        structureTemplates?: StructureTemplate[];
        // 🌟 BPM 驱动的前奏长度配置
        introBarsLowBpm?: number;       // 慢曲（bpm < introBarsBpmThreshold）使用的前奏小节数，默认 8
        introBarsHighBpm?: number;      // 快曲使用的前奏小节数，默认 4
        introBarsBpmThreshold?: number; // 慢/快曲分界 BPM，默认 90
        outroBars?: number;             // 尾奏小节数，默认 4
    };
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
        genreBendingOverrides?: StyleId[]; // 🌟 新增：段落发生风格突变时的备选曲风
        preferJPopProgressions?: boolean; // 🌟 新增：是否偏好 J-Pop 和声进行
        sectionTransitionPassingProb?: number; // 🌟 HC-2：段落交界经过和弦概率（默认 0.45）
        maxBorrowedChords?: number;            // 🌟 HC-5：全曲借调和弦上限（默认 2，作为"高光时刻"不滥用）
        extensionProbability?: number;         // 和弦扩展着色概率。0.4=Pop, 0.6=EDM, 0.8=JPop, 1.0=Jazz/Neo-Soul
    };
    rhythm: { densityBase: [number, number]; syncopationWeight: number; restProbability: number; disruptionProbability: number; humanize: number; swingRatio?: number; swingSubdivision?: 0.5 | 0.25; strictGrid?: boolean; grooveTemplate?: RhythmCell[]; approachNoteProb?: number; grooveBankPool?: GrooveBankDef[]; chordAnticipation?: number; };
    melody: { 
        stepwiseRatio: number; 
        maxJumpInterval: number; 
        tensionTolerance: number; 
        mutationProbability: number; 
        mutationPool: Array<'inversion' | 'augmentation' | 'truncation' | 'retrograde' | 'diminution'>; 
        pentatonicPreference?: number;
        extensionPreference?: number;
        chromaticPassingProbability?: number;
        chromaticApproachProbability?: number;   // 强拍半音趋近概率（默认 0.15）
        passingToneChainProbability?: number;    // 大音程经过音填充概率（默认 0.12）
        harmonicGravityStrength?: number;        // 和弦功能引力强度 0-1（默认 0.3）
        leapResolutionThreshold?: number; // 🌟 新增：多大的音程被视为大跳并需要反向解决
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
        anchorProbability?: number; // 🌟 新增：同音反复的概率
        riffDrivenProbability?: number; // 🌟 新增：段落由 Riff 驱动的概率
        sectionalRegisterProfile?: {
            verse: [number, number]; // e.g., [60, 72] (C4 to C5)
            preChorus: [number, number];
            chorus: [number, number];
            solo: [number, number];
        };
        breathingRoomProbability?: number; // 🌟 新增：强制休止符/呼吸空间的概率
        callAndResponseProbability?: number; // 🌟 新增：使用呼应手法的概率
        // 🌟 层级动机系统：PhraseGroup 长度配置
        phraseLengthProfile?: PhraseLengthProfile;
        motifRecipes?: {
            pickup: number[][];
            body: number[][];
            tail: number[][];
        };
        // --- 旋律技法插槽 (Vocal Techniques Slot) ---
        laidBackTimingMax?: number;       // 拖拍最大偏移量（拍）。0=精准，0.12=重度拖拍(R&B)，负值=抢拍(Punk)
        extensionTargeting?: boolean;     // 靶向延伸音(9/11)。true=R&B/Neo-Soul，false=流行/摇滚
        melismaProbability?: number;      // 转音瀑布触发概率。0=禁止，0.35=R&B高频
        sequenceFreezeRhythm?: boolean;   // vary/resolve 变奏时冻结节奏DNA仅做音程模进
        chordMelodyProbability?: number;  // ChordMelody 织体触发概率。0=不使用，0.7=Lo-fi/Neo-Soul
    };
    contrast: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: { 
        melodyInstruments: string[]; 
        chordInstruments: string[]; 
        bassInstruments: string[];
        drumInstruments: string[];
        counterMelodyInstruments: string[];
        texturePool: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass' | 'String_Ostinato' | 'Water_Arpeggio' | 'ChordMelody'>;
        drumProbability?: number; // 🌟 新增：鼓组出场率，彻底解耦
        counterMelodyProbability?: number; // 副旋律出场率
        fillStyle?: 'micro' | 'standard' | 'heavy' | 'electronic'; // 🌟 新增：加花风格
        vocalProbability?: number; // 🌟 新增：主唱出场率
        outroRingOutProbability?: number; // 🌟 新增：尾奏使用 BigRingOut 的概率
        allowTradingFours?: boolean; // 🌟 新增：是否允许乐器对话 (Trading Fours)
        allowIntroRiffs?: boolean; // 🌟 新增：是否允许前奏 Riff
        allowRitardando?: boolean; // 🌟 新增：是否允许结尾渐慢
        allowDrumless?: boolean; // 🌟 新增：是否允许无鼓编制
        allowBassless?: boolean; // 🌟 新增：是否允许无贝斯编制
        grooveRatio?: { foundation: number; comping: number; color: number; }; // 🌟 新增：律动比例控制器
        idiomPreferences?: {
            counterMelodyStyle?: 'sustained' | 'melodic' | 'rhythmic' | 'arpeggiated';
            pianoStyle?: 'block-chord' | 'arpeggiated' | 'rhythmic' | 'sparse';
            drumStyle?: 'steady' | 'syncopated' | 'sparse' | 'high-energy' | 'acoustic-swing';
            bassStyle?: 'steady' | 'syncopated' | 'melodic' | 'sparse' | 'riff-driven';
            riffStyle?: 'melodic' | 'rhythmic' | 'arpeggiated' | 'chordal' | 'default';
            vocalStyle?: 'pop' | 'ballad' | 'neosoul' | 'rnb' | 'gospel' | 'choir';
        };
        mixingPreferences?: {
            requireSidechain?: boolean;
            melody?: MixingConfig;
            secondaryMelody?: MixingConfig;
            vocal?: MixingConfig;
            chord?: MixingConfig;
            bass?: MixingConfig;
            drums?: MixingConfig;
            counterMelody?: MixingConfig;
            chorusDepth?: number;
        };
        instrumentBehaviors?: {
            melody?: InstrumentBehavior;
            chord?: InstrumentBehavior;
            bass?: InstrumentBehavior;
            counterMelody?: InstrumentBehavior;
            secondaryMelody?: InstrumentBehavior;
        };
    };
    performance: { allowedPersonas: string[]; };
    masteringProfileId?: string;
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
    endingType?: 'hard_stop' | 'fade_out'; // 🌟 决定结尾的收尾方式
    localKeyOffset?: number; // 🌟 局部转调偏移量 (Local Key Offset)
    
    // 🌟 P2: 律动比例控制器 (Groove Ratio Controller)
    grooveRatio?: {
        foundation: number; // Bass & Kick
        comping: number;    // Piano & Guitar
        color: number;      // Synth & Strings
    };

    // --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
    sectionType?: SectionType; // 🌟 数值枚举，逐步替代 name.includes() 字符串匹配
    type?: string;
    lengthBars?: number;
    phraseTemplate?: string; // e.g., "A-A-B-A'"
    harmony?: HarmonyState;
    groove?: GrooveState;
    tracks?: TrackState[];

    // --- Narrative Mood Arc: 段落级情绪覆盖 ---
    moodOverride?: MoodId; // 不设时使用全曲 mood，设置后本段落独立调制密度/力度/鼓色彩等

    // --- Phase 3 & 4: Genre-Bending & Riff-Driven ---
    localStyleOverride?: StyleId; // 局部风格覆盖 (Option B)
    isRiffDriven?: boolean;      // 是否由 Riff 驱动 (Option A)
}

export interface MixingConfig {
    pan?: number; // -1 (left) to 1 (right)
    reverb?: number; // 0 to 1 (send level)
    volume?: number; // dB offset (e.g., -6 to +6)
    delay?: number; // 0 to 1 (send level)
    chorus?: number; // 0 to 127 (MIDI CC 93)
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
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
}

export interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    moodId?: MoodId;
    ensemble?: EnsembleDraft;
    style?: StyleConfig;
}

export interface GenerationOptions {
    styleId?: StyleId;
    moodId?: MoodId;
    seed?: number;
    length?: 'short' | 'medium' | 'long';
    userMotifRoot?: number;
    processedUserMotif?: any[];
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
    styleId?: StyleId;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    palette?: EnsembleDraft; 
    sections?: SectionMetadata[];
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    chords?: GeneratedChord[]; // 全曲和弦进行
    tempoCurves?: TempoCurve[]; // 渐慢/渐快曲线
    introFilterSweep?: boolean; // 🌟 ST-3: Intro 低通涌动标记，PlaybackEngine 读取后注入 CC74 渐变
}

// ============================================================
// 数值枚举 & 查找表（Phase 1 cherry-pick：类型安全基础设施）
// 当前阶段仅添加定义，不修改现有代码的类型签名。
// Phase 4 将逐步把 string 类型迁移到这些枚举。
// ============================================================

// --- Tonality 数值枚举 ---
export enum Tonality {
    Major = 0, Minor = 1, Major_Pentatonic = 2, Minor_Pentatonic = 3,
    Blues = 4, Dorian = 5, Mixolydian = 6, Melodic_Minor = 7, Lydian = 8
}

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

/** 音阶音程查找表：SCALE_INTERVALS[tonality] → number[] (半音间隔) */
export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major]            = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor]            = [0, 2, 3, 5, 7, 8, 10];
SCALE_INTERVALS[Tonality.Major_Pentatonic] = [0, 2, 4, 7, 9];
SCALE_INTERVALS[Tonality.Minor_Pentatonic] = [0, 3, 5, 7, 10];
SCALE_INTERVALS[Tonality.Blues]            = [0, 3, 5, 6, 7, 10];
SCALE_INTERVALS[Tonality.Dorian]           = [0, 2, 3, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Mixolydian]       = [0, 2, 4, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Melodic_Minor]    = [0, 2, 3, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Lydian]           = [0, 2, 4, 6, 7, 9, 11];

// --- ChordQuality 数值枚举 ---
export enum ChordQuality {
    Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4,
    Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8,
    Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13,
    Dominant9 = 14, Minor11 = 15, Dominant13 = 16
}

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

/** 和弦音程查找表：CHORD_INTERVALS[quality] → number[] */
export const CHORD_INTERVALS: number[][] = [];
CHORD_INTERVALS[ChordQuality.Major]          = [0, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor]          = [0, 3, 7];
CHORD_INTERVALS[ChordQuality.Diminished]     = [0, 3, 6];
CHORD_INTERVALS[ChordQuality.Diminished7]    = [0, 3, 6, 9];
CHORD_INTERVALS[ChordQuality.Augmented]      = [0, 4, 8];
CHORD_INTERVALS[ChordQuality.Dominant7]      = [0, 4, 7, 10];
CHORD_INTERVALS[ChordQuality.Minor7]         = [0, 3, 7, 10];
CHORD_INTERVALS[ChordQuality.Major7]         = [0, 4, 7, 11];
CHORD_INTERVALS[ChordQuality.HalfDiminished] = [0, 3, 6, 10];
CHORD_INTERVALS[ChordQuality.Sus4]           = [0, 5, 7];
CHORD_INTERVALS[ChordQuality.Dominant7Sus4]  = [0, 5, 7, 10];
CHORD_INTERVALS[ChordQuality.Add9]           = [0, 2, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor9]         = [0, 3, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Major9]         = [0, 4, 7, 11, 14];
CHORD_INTERVALS[ChordQuality.Dominant9]      = [0, 4, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Minor11]        = [0, 3, 7, 10, 14, 17];
CHORD_INTERVALS[ChordQuality.Dominant13]     = [0, 4, 7, 10, 14, 21];

/** 位掩码：快速分类检查 */
export const CQ_IS_MINOR = (1 << ChordQuality.Minor) | (1 << ChordQuality.Minor7) | (1 << ChordQuality.Minor9) | (1 << ChordQuality.Minor11);
export const CQ_IS_MAJOR = (1 << ChordQuality.Major) | (1 << ChordQuality.Major7) | (1 << ChordQuality.Major9);
export const CQ_IS_DOM   = (1 << ChordQuality.Dominant7) | (1 << ChordQuality.Dominant7Sus4) | (1 << ChordQuality.Dominant9) | (1 << ChordQuality.Dominant13);
export const CQ_IS_DIM   = (1 << ChordQuality.Diminished) | (1 << ChordQuality.Diminished7) | (1 << ChordQuality.HalfDiminished);

// --- SectionType 数值枚举 ---
export enum SectionType {
    Intro = 0, Verse = 1, PreChorus = 2, Chorus = 3, Bridge = 4,
    Outro = 5, Break = 6, Breakdown = 7, BuildUp = 8, Drop = 9,
    PreOutro = 10, Solo_Bridge = 11
}

// 数值枚举 → 字符串名映射，仅供需要 hashmap key 的旧代码使用
// 新代码应直接用 SectionType.X 数值比较
export const SectionTypeName: Record<SectionType, string> = {
    [SectionType.Intro]: 'Intro',
    [SectionType.Verse]: 'Verse',
    [SectionType.PreChorus]: 'PreChorus',
    [SectionType.Chorus]: 'Chorus',
    [SectionType.Bridge]: 'Bridge',
    [SectionType.Outro]: 'Outro',
    [SectionType.Break]: 'Break',
    [SectionType.Breakdown]: 'Breakdown',
    [SectionType.BuildUp]: 'BuildUp',
    [SectionType.Drop]: 'Drop',
    [SectionType.PreOutro]: 'PreOutro',
    [SectionType.Solo_Bridge]: 'Solo_Bridge',
};