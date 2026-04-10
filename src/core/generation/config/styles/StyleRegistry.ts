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
            { tonality: Tonality.Major, weight: 0.6 },
            { tonality: Tonality.Minor, weight: 0.4 },
        ],
    },
    harmony: {
        chorusPool: [['I', 'V', 'vi', 'IV']],
        versePool: [['I', 'IV', 'V', 'vi']],
        preChorusPool: [['ii', 'V', 'IV', 'I']],
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.1,
        passingChords: ['SecondaryDominant'],
        voicingStyle: 'standard',
        allowTritoneSub: false,
        // 🌟 HC-1: 启用调式互换（ModalMixture），让 reharmonize 可以借用平行调的和弦
        // 例如大调中偶尔出现 iv（小四级）、bVI（降六级），增加色彩但不突兀
        borrowedChords: ['ModalMixture'],
        // 🌟 HC-2: 段落交界经过和弦概率（默认 45%，让 Verse→Chorus 更平滑过渡）
        sectionTransitionPassingProb: 0.45,
    },
    rhythm: {
        densityBase: [0.4, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.01,
        swingRatio: 0.5,
        strictGrid: false,
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
        inflectionProbability: 0.15,
        // 🌟 层级动机系统：流行歌曲默认 profile
        // - Verse:    4-bar 主流，偶尔 8-bar 长气息（叙事感）
        // - PreChorus: 4-bar 起势
        // - Chorus:   8-bar 大乐句为主（hook 长度需要 8 小节才能展开）
        // - Bridge:   8-bar，给情绪转折空间
        // - 子动机:   2-bar 主流（流行歌的标准 atomic 单元）
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
                { bars: 2, weight: 0.7 },  // 标准 2-bar atomic motif
                { bars: 1, weight: 0.3 },  // 偶尔 1-bar 短动机
            ],
        },
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1.0,
        chorusPitchOffset: 5,
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand'],
        chordInstruments: ['String_Ensemble_1'],
        bassInstruments: ['Acoustic_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: [],
        texturePool: ['Block'],
        counterMelodyProbability: 0,
        vocalProbability: 0,
        allowTradingFours: false,
        // 🌟 3D 全景声增益级联（迁出自 Orchestrator 硬编码）
        // Z 轴深度：聚光灯(干/近) → 侧前(微湿/中距) → 天幕(极湿/宽) → 地下室(极干/底座)
        mixingPreferences: {
            vocal:           { pan: 0,    reverb: 0.43, volume: 10 },              // 聚光灯中心
            melody:          { pan: 0,    reverb: 0.43, volume: 4 },               // 聚光灯中心
            secondaryMelody: { pan: 0.4,  reverb: 0.59, volume: 1, chorus: 40 },   // 右前方
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: 1, chorus: 40 },   // 左前方
            chord:           { pan: 0.8,  reverb: 0.87, volume: 3, chorus: 90 },   // 天幕声墙
            drums:           { pan: 0,    reverb: 0.08, volume: 7 },               // 地下室
            bass:            { pan: 0,    reverb: 0,    volume: -1 },              // 地下室，零混响，压低
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
