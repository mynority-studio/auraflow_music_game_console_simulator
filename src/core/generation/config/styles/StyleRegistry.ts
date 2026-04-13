/**
 * StyleRegistry — 风格配置注册表
 * DefaultStyle 作为通用基线，激活所有 idiom/groove/和声色彩/旋律技法。
 */
import { StyleConfig, Tonality } from '../../types';
import { StyleId, StyleIdName } from '../StyleFlags';

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

    // ── 和弦进行池 ──
    harmony: {
        chorusPool: [
            ['I', 'V', 'vi', 'IV'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'IV', 'vi', 'V'],
            ['I', 'vi', 'IV', 'V'],
            ['IV', 'V', 'iii', 'vi'],
            ['I', 'V', 'IV', 'V'],
            ['vi', 'V', 'IV', 'V'],
            ['I', 'iii', 'IV', 'iv'],
            ['I', 'bVII', 'IV', 'I'],
            ['I', 'V', 'vi', 'iii', 'IV'],
        ],
        versePool: [
            ['I', 'IV', 'V', 'vi'],
            ['I', 'vi', 'IV', 'V'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'V', 'ii', 'IV'],
            ['I', 'bVII', 'IV', 'I'],
            ['ii', 'IV', 'I', 'V'],
            ['I', 'iii', 'vi', 'IV'],
            ['vi', 'ii', 'V', 'I'],
        ],
        preChorusPool: [
            ['ii', 'V', 'IV', 'I'],
            ['IV', 'V', 'vi', 'I'],
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'iv', 'I', 'V'],
            ['vi', 'V', 'IV', 'V'],
            ['ii', 'iii', 'IV', 'V'],
        ],
    },

    // ── 和声规则（解锁全部色彩） ──
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.2,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        voicingStyle: 'standard',
        allowTritoneSub: true,
        extensionProbability: 0.5,
        borrowedChords: ['ModalMixture', 'SecondaryDominant'],
        sectionTransitionPassingProb: 0.45,
        maxBorrowedChords: 2,
    },

    // ── 节奏 ──
    rhythm: {
        densityBase: [0.4, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.01,
        swingRatio: 0.5,
        swingSubdivision: 0.5,
        strictGrid: false,
        chordAnticipation: 0,
        approachNoteProb: 0.15,
    },

    // ── 旋律（全技法解锁） ──
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
        sectionalRegisterProfile: {
            verse:     [58, 72] as [number, number],
            preChorus: [60, 74] as [number, number],
            chorus:    [62, 79] as [number, number],
            solo:      [60, 79] as [number, number],
        },
        phraseLengthProfile: {
            name: 'default',
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

    // ── 编配（多乐器池 + idiom 全激活） ──
    orchestration: {
        leadInstruments: [
            'Acoustic_Grand', 'Electric_Piano_1',
            'Violin', 'Vibraphone', 'Music_Box',
            'Flute', 'Alto_Sax', 'Tenor_Sax',
        ],
        accompInstruments: [
            'String_Ensemble', 'Pad_2_Warm', 'Acoustic_Guitar_Nylon',
            'Electric_Piano_2', 'Synth_Strings_1', 'Acoustic_Grand',
        ],
        bassInstruments: [
            'Acoustic_Bass', 'Electric_Bass_Finger', 'Synth_Bass_1',
        ],
        drumInstruments: [
            'Standard_DrumKit', 'Electronic_DrumKit',
        ],
        padInstruments: [
            'Pad_2_Warm', 'Choir_Aahs', 'Flute', 'Violin',
            'Vibraphone', 'Marimba', 'String_Ensemble',
        ],
        texturePool: ['Block', 'Arpeggio', 'Pad'],
        drumProbability: 0.85,
        padProbability: 0.5,
        fillStyle: 'standard',
        vocalProbability: 0,
        outroRingOutProbability: 0.3,
        allowTradingFours: false,
        allowIntroRiffs: true,
        allowRitardando: true,
        allowDrumless: false,
        allowBassless: false,
        allowAccompless: false,
        idiomPreferences: {
            pianoStyle: 'block-chord',
            drumStyle: 'steady',
            bassStyle: 'steady',
            padStyle: 'sustained',
        },
        mixingPreferences: {
            vocal:  { pan: 0,    reverb: 0.43, volume: 3 },
            lead:   { pan: 0,    reverb: 0.43, volume: 0 },
            accomp: { pan: 0.7,  reverb: 0.8,  volume: -4, chorus: 80 },
            pad:    { pan: -0.4, reverb: 0.59, volume: -4, chorus: 40 },
            drums:  { pan: 0,    reverb: 0.08, volume: 1 },
            bass:   { pan: 0,    reverb: 0,    volume: -2 },
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

// ── 注册表 ──
export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.Default]: DefaultStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    const registered = StyleRegistry[styleId];
    if (registered) return registered;
    const displayName = StyleIdName[styleId] || `Style_${styleId}`;
    return { ...DefaultStyle, id: styleId, name: displayName };
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
