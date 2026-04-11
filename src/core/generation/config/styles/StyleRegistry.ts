import { StyleConfig } from '../../types';
import { Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

const DefaultStyle: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
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
        densityBase: [0.4, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.01,
        swingRatio: 0.5,
        strictGrid: false,
        chordAnticipation: 0,
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
            'Acoustic_Grand', 'Electric_Piano_1',
            'Violin', 'Vibraphone', 'Music_Box',
        ],
        chordInstruments: [
            'String_Ensemble', 'Pad_2_Warm', 'Acoustic_Guitar_Nylon',
            'Electric_Piano_2', 'Synth_Strings_1',
        ],
        bassInstruments: [
            'Acoustic_Bass', 'Electric_Bass_Finger', 'Synth_Bass_1',
        ],
        drumInstruments: [
            'Standard_DrumKit', 'Electronic_DrumKit',
        ],
        counterMelodyInstruments: [
            'Pad_2_Warm', 'Choir_Aahs', 'Flute', 'Violin',
            'Vibraphone', 'Marimba',
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
            melody:          { pan: 0,    reverb: 0.43, volume: 0 },     // 80 — 适中，不抢不弱
            secondaryMelody: { pan: 0.4,  reverb: 0.59, volume: -3, chorus: 40 },  // 57
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: -4, chorus: 40 },  // 50
            chord:           { pan: 0.7,  reverb: 0.8,  volume: -4, chorus: 80 },  // 50
            drums:           { pan: 0,    reverb: 0.08, volume: 1 },     // 89
            bass:            { pan: 0,    reverb: 0,    volume: -2 },    // 64
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
