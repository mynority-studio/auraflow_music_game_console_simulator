import { StyleConfig } from '../../types';
import { Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

const DefaultStyle: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
    // 🌟 PR #2: 启用双阶段 Viterbi 和声管线（影子骨架 → 骨架旋律 → Viterbi 选和弦）
    // 跳过旧版 reharmonize，让 Viterbi 的 Top Voice + Common Tone 算法直接产出最终和弦。
    useViterbiHarmony: true,
    global: {
        bpmRange: [80, 120],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.30 },
            { tonality: Tonality.Minor, weight: 0.25 },
            { tonality: Tonality.Dorian, weight: 0.15 },
            { tonality: Tonality.Mixolydian, weight: 0.15 },
            { tonality: Tonality.Major_Pentatonic, weight: 0.08 },
            { tonality: Tonality.Minor_Pentatonic, weight: 0.07 },
        ],
    },
    harmony: {
        chorusPool: [
            ['I', 'V', 'vi', 'IV'],           // Pop 万能进行
            ['vi', 'IV', 'I', 'V'],            // Axis 变体（Despacito 起手）
            ['I', 'IV', 'vi', 'V'],            // Let It Be 型
            ['I', 'vi', 'IV', 'V'],            // 50s 经典
            ['IV', 'V', 'iii', 'vi'],          // J-Pop 王道（小室进行）
            ['I', 'V', 'IV', 'V'],             // Rock anthem
            ['vi', 'V', 'IV', 'V'],            // Minor dramatic
            ['I', 'iii', 'IV', 'iv'],          // Creep 型（大→小四级借调）
            ['I', 'bVII', 'IV', 'I'],          // Mixolydian vamp（Hey Jude 尾段）
            ['I', 'V', 'vi', 'iii', 'IV'],     // Pachelbel Canon 5 和弦
        ],
        versePool: [
            ['I', 'IV', 'V', 'vi'],            // 标准叙事
            ['I', 'vi', 'IV', 'V'],            // 50s doo-wop
            ['vi', 'IV', 'I', 'V'],            // Minor 开头叙事
            ['I', 'V', 'ii', 'IV'],            // Country/Folk
            ['I', 'bVII', 'IV', 'I'],          // Mixolydian 放松
            ['ii', 'IV', 'I', 'V'],            // Pre-funk groove
            ['I', 'iii', 'vi', 'IV'],          // 下行三度链
            ['vi', 'ii', 'V', 'I'],            // Minor-to-major 解决
        ],
        preChorusPool: [
            ['ii', 'V', 'IV', 'I'],            // 经典蓄力
            ['IV', 'V', 'vi', 'I'],            // 上行推进
            ['ii', 'V', 'I', 'vi'],            // 2-5-1 jazz touch
            ['IV', 'iv', 'I', 'V'],            // 大小四级切换
            ['vi', 'V', 'IV', 'V'],            // 半音下行低音
            ['ii', 'iii', 'IV', 'V'],          // 阶梯上行
        ],
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.2,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        voicingStyle: 'standard',
        allowTritoneSub: true,
        extensionProbability: 0.5,
        borrowedChords: ['ModalMixture', 'SecondaryDominant'],
        sectionTransitionPassingProb: 0.5,
    },
    rhythm: {
        // 🌟 F-Groove2: 扩大 base 区间。densityBase 是与 energy 联动的端点；
        // syncopationWeight/restProbability/swingRatio 是 base，StructureEngine 在其基础上 PRNG 抽样
        // 让歌与歌之间律动有质感差异。
        densityBase: [0.3, 0.85],
        syncopationWeight: 0.3,    // base 0.3 + PRNG ±0.225 → 全曲 [0.075, 0.525]
        restProbability: 0.18,     // base 0.18 + PRNG ±0.125 → 全曲 [0.055, 0.305]
        disruptionProbability: 0.08,
        humanize: 0.01,
        swingRatio: 0.5,           // base 0.5 + PRNG +0~0.16 → 全曲 [0.5, 0.66]（直拍 → 中等摇摆）
        strictGrid: false,
        chordAnticipation: 0.1,    // 0 → 0.1：偶尔出现和弦前奏增加 rhythmic 张力
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.5,
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde'],
        leapResolutionThreshold: 5,
        breathingRoomProbability: 0.2,
        anchorProbability: 0.5,
        pentatonicPreference: 0.3,
        pentatonicShiftProbability: 0,
        chromaticPassingProbability: 0,
        chromaticApproachProbability: 0.15,
        passingToneChainProbability: 0.12,
        harmonicGravityStrength: 0.3,
        inflectionProbability: 0.15,
        laidBackTimingMax: 0,
        extensionTargeting: false,
        melismaProbability: 0,
        sequenceFreezeRhythm: false,
        chordMelodyProbability: 0,
        // 🌟 V3.6 MomentumStage：物理动量与阻尼（Luis 旋律连贯性诊断 #1）
        // 详见 docs/momentum_stage_design.md
        useMomentum: true,
        phraseLengthProfile: {
            name: 'pop',
            perSection: {
                verse:     [{ bars: 4, weight: 0.6 }, { bars: 8, weight: 0.4 }],
                preChorus: [{ bars: 4, weight: 0.7 }, { bars: 8, weight: 0.3 }],
                chorus:    [{ bars: 8, weight: 0.7 }, { bars: 4, weight: 0.3 }],
                bridge:    [{ bars: 8, weight: 0.6 }, { bars: 4, weight: 0.4 }],
                intro:     [{ bars: 4, weight: 1.0 }],
                outro:     [{ bars: 4, weight: 0.6 }, { bars: 8, weight: 0.4 }],
                default:   [{ bars: 4, weight: 1.0 }],
            },
            subMotifBarsPool: [
                { bars: 2, weight: 0.7 },
                { bars: 1, weight: 0.3 },
            ],
        },
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1.0,
        chorusPitchOffset: 5,
    },
    orchestration: {
        melodyInstruments: [
            // 🌟 F-Melody-Pool: 用户指定，只保留键盘 / 敲击类（避免吹奏 + 弦乐 + 吉他作主旋律）
            // - Piano / EP1: 温暖键盘
            // - Music_Box / Marimba: 偶尔可做敲击式抒情主旋律（user 主动加回）
            // 注意：Music_Box 仍在 EnsembleDrafter 的 BELL_INSTRUMENTS_BANNED_FROM_SECONDARY 里，
            // 不会被选作副旋律，避免副旋律廉价 spotlight 感
            'Acoustic_Grand', 'Electric_Piano_1',
            'Music_Box', 'Marimba',
        ],
        chordInstruments: [
            'String_Ensemble', 'Pad_2_Warm', 'Acoustic_Guitar_Nylon',
            'Electric_Piano_2', 'Synth_Strings_1',
        ],
        bassInstruments: [
            'Acoustic_Bass', 'Electric_Bass_Finger', 'Synth_Bass_1',
        ],
        drumInstruments: [
            // 🌟 F-Drum-Kit: 扩展鼓组音色池（5 种 GM kit），让歌与歌之间鼓音色有差异
            'Standard_DrumKit', 'Electronic_DrumKit',
            'Room_DrumKit', 'TR808_DrumKit', 'Orchestral_DrumKit',
        ],
        counterMelodyInstruments: [
            // 🌟 F-Counter-Pool: 用户指定，counterMelody 仅保留 pad / 人声铺底 / 键盘类
            // 移除 Violin / Acoustic_Guitar_Nylon（弦乐 / 吉他作 counter 也不要）
            'Pad_2_Warm', 'Choir_Aahs', 'Electric_Piano_2',
        ],
        texturePool: ['Block'],
        counterMelodyProbability: 0.5,
        vocalProbability: 0,
        allowTradingFours: false,
        // 🌟 增益级联重构：留出 headroom 防爆音
        // CC7 天花板 115（不再 clamp 127），各声部留出动态余量
        // 公式：baseVol = 80 × 10^(dB/20)，+3dB=100, 0dB=80, -3dB=57, -6dB=40
        mixingPreferences: {
            vocal:           { pan: 0,    reverb: 0.43, volume: 3 },     // 100 — 主角但不爆
            melody:          { pan: 0,    reverb: 0.43, volume: 2 },     // 🌟 0 → +2 dB 提升主旋律
            secondaryMelody: { pan: 0.4,  reverb: 0.59, volume: 2, chorus: 40 },   // 🌟 +1 → +2 dB
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: -1, chorus: 40 },  // 🌟 F-Vol: -4 → -1 dB
            chord:           { pan: 0.7,  reverb: 0.8,  volume: -4, chorus: 80 },  // 50
            drums:           { pan: 0,    reverb: 0.08, volume: 1 },     // 89
            // 🌟 F-Bass-Stage: 贝斯加 reverb 0 → 0.20（空间感）+ chorus 60（stereo width，制造声场感）
            // volume 0 → -1（按用户要求调小一档）
            bass:            { pan: 0,    reverb: 0.20, volume: -1, chorus: 60 },
        },
    },
    modulation: {
        probability: 0,
        targetSection: 'Chorus',
        intervalPool: [5, 7],
    },
    performance: {
        allowedPersonas: ['neutral'],
    },
};

export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.Default]: DefaultStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    return StyleRegistry[styleId] || DefaultStyle;
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
