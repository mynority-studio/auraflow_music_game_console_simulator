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
        chorusPool: [
            ['I', 'V', 'vi', 'IV'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'IV', 'vi', 'V'],
            ['I', 'vi', 'IV', 'V'],
        ],
        versePool: [
            ['I', 'IV', 'V', 'vi'],
            ['I', 'vi', 'IV', 'V'],
            ['vi', 'IV', 'I', 'V'],
        ],
        preChorusPool: [
            ['ii', 'V', 'IV', 'I'],
            ['IV', 'V', 'vi', 'I'],
            ['ii', 'V', 'I', 'vi'],
        ],
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.1,
        passingChords: ['SecondaryDominant'],
        voicingStyle: 'standard',
        allowTritoneSub: false,
        extensionProbability: 0.4,
        borrowedChords: ['ModalMixture'],
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
            'Acoustic_Grand', 'Electric_Piano_1', 'Flute',
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
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: -5, chorus: 40 },  // 45
            chord:           { pan: 0.7,  reverb: 0.8,  volume: -6, chorus: 80 },  // 40 — Pad 退到幕后
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
