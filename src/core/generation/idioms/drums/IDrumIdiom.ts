// IDrumIdiom — 鼓组 Idiom 接口（评分选择 + 华彩借调模型）
//
// 每个 Idiom 实现 score()（评分适配度）+ generate()（生成 NoteData[]）。
// DrumIdiomRouter 在每个 section 入口调所有 idiom 的 score，选最高的来 generate。
// 华彩借调：Bridge/PreChorus 末 phrase 有概率切到第二高分 idiom（顺滑过渡）。

import { NoteData, SectionMetadata, StyleConfig, SectionType } from '../../types';

/**
 * GM Drum Map 常量（通用 MIDI 标准）
 */
export const GM_DRUMS = {
    KICK: 36,
    SNARE: 38,
    CLAP: 39,
    TOM_LOW: 41,      // Low Floor Tom
    CHH: 42,           // Closed Hi-Hat
    PEDAL_HH: 44,     // Pedal Hi-Hat
    TOM_MID: 47,       // Low-Mid Tom
    TOM_HI: 50,        // High Tom
    OHH: 46,           // Open Hi-Hat
    CRASH: 49,
    RIDE: 51,
    CRASH2: 57,
    CROSS_STICK: 37,
} as const;

/**
 * DrumIdiomContext — 鼓组 Idiom 的输入上下文
 * 由 DrumIdiomRouter 从 Orchestrator 接收并构建
 */
export interface DrumIdiomContext {
    // 区间
    startBeat: number;
    endBeat: number;
    beatsPerBar: number;

    // 能量 / 情绪
    energyLevel: number;           // 1-10
    nextEnergyLevel: number;       // 下一段能量（用于 build-up 判定）
    isIntro: boolean;
    isOutro: boolean;
    sectionType: SectionType;
    sectionName: string;

    // 节拍模式
    is68: boolean;                 // 6/8 拍
    isHalfTime: boolean;          // 半速感（慢歌）

    // 律动参数（从 section.groove + subgenre 计算）
    grooveDensity: number;        // 0-1
    grooveSyncopation: number;    // 0-1
    swing: number;                // 0.5（直拍）- 0.66（heavy swing）

    // 🌟 Melody/Bass Listening（让鼓跟随旋律/贝斯重音）
    melodyNotes: NoteData[];
    bassNotes: NoteData[];

    // GM Drum Map（传给 Idiom 避免重复定义）
    KICK: number;
    SNARE: number;
    CHH: number;
    OHH: number;
    CRASH: number;
    CRASH2: number;
    RIDE: number;
    CROSS_STICK: number;
    TOM_LOW: number;
    TOM_MID: number;
    TOM_HI: number;

    // 🌟 laid-back timing 偏移（Lo-fi/Jazz 风格才有）
    laybackOffset: number;

    // 🌟 subgenre（作为评分加权，不是决定因素）
    subgenre: string;

    // 🌟 style 引用（部分 idiom 需要读 idiomPreferences 等）
    style?: StyleConfig;
    idiomPreferences?: {
        drumStyle?: string;
    };
}

/**
 * IDrumIdiom — 鼓组 Idiom 接口
 */
export interface IDrumIdiom {
    /** Idiom 名称（调试用） */
    readonly name: string;

    /**
     * 评分：当前上下文下该 Idiom 的适配度（0-100，越高越适合）
     * 由 DrumIdiomRouter 调用，选最高分的 Idiom 来 generate
     */
    score(ctx: DrumIdiomContext): number;

    /**
     * 生成鼓组 NoteData[]
     * 只在 score 最高时被调用（或华彩借调时第二高分也会被调用）
     */
    generate(ctx: DrumIdiomContext): NoteData[];
}
