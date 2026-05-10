import { StyleConfig } from '../../types';
import { Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

// 🌟 ACG 轻音乐 — 当前唯一注册风格（包含春日、史诗、落日的基因）
const AcgStyle: StyleConfig = {
    id: StyleId.AcgLightMusic,
    name: '二次元轻音乐 (ACG Light Music)',
    global: {
        bpmRange: [80, 140],
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
            ['IVmaj7', 'V', 'iii', 'vi'],                   // 王道进行
            ['vi', 'IVmaj7', 'I', 'V'],                     // 小室进行
            ['IVmaj7', 'III7', 'vi', 'I7'],                 // 丸谷进行
            ['bVI', 'bVII', 'I', 'I']                       // 史诗进行
        ],
        versePool: [
            ['I', 'V/VII', 'vi', 'I/V'],
            ['IVmaj7', 'I', 'IVmaj7', 'I'],
            ['vi', 'IV', 'I', 'V']
        ],
        preChorusPool: [
            ['ii7', 'V7', 'iii', 'vi'],
            ['IVmaj7', 'v', 'vi', 'I7']
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
        // 三档鼓型（按段落 energyLevel 分派）
        // GM Drum Map: 36=Kick, 37=SideStick, 38=Snare, 42=ClosedHiHat, 46=OpenHiHat, 49=Crash
        drumPatterns: [
            // 低能段：仅 kick 主拍 + side stick 反拍（极简）
            {
                energyMin: 4, energyMax: 4,
                fixedHits: [
                    { pitch: 36, positions: [0],     velocity: 0.5, duration: 0.25 },
                    { pitch: 37, positions: [1, 3],  velocity: 0.6, duration: 0.25 },
                ],
                densityHits: [],
            },
            // 中能段：kick 1/3 + snare 2/4 + closed hi-hat 8 分撒点 + 鬼音
            {
                energyMin: 5, energyMax: 7,
                fixedHits: [
                    { pitch: 36, positions: [0, 2],  velocity: 0.8, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],  velocity: 0.8, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 42, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.5, 0.7], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.75, 3.25], velocityRange: [0.3, 0.5], duration: 0.125, energyMin: 6, densityThreshold: 1.1, probability: 0.25 },
            },
            // 高能段：kick 1/3+2.5 切分 + snare 2/4 + open hi-hat + 段首 crash + 鬼音
            {
                energyMin: 8, energyMax: 10,
                fixedHits: [
                    { pitch: 36, positions: [0, 2, 2.5], velocity: 0.9, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],      velocity: 0.95, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 46, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.6, 0.8], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.75, 3.25], velocityRange: [0.3, 0.5], duration: 0.125, energyMin: 6, densityThreshold: 1.1, probability: 0.25 },
                crashOnSectionStart: { pitch: 49, velocity: 0.95, duration: 1.0 },
            },
        ],
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.5,
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde'],
        leapResolutionThreshold: 4,
        breathingRoomProbability: 0.2,
        anchorProbability: 0.5,
        pentatonicPreference: 0.3,
        pentatonicShiftProbability: 0,
        chromaticPassingProbability: 0,
        chromaticApproachProbability: 0.3,        // 更多半音趋近
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
        allowDrumless: true,
        allowBassless: true,
        melodyInstruments: ['Acoustic_Grand'],
        chordInstruments: ['Acoustic_Grand'],
        bassInstruments: ['Acoustic_Bass', 'Synth_Bass_1'],
        drumInstruments: ['Standard_DrumKit', 'Room_DrumKit'],
        counterMelodyInstruments: [],
        texturePool: ['Block'],
        counterMelodyProbability: 0.0,
        vocalProbability: 0,
        allowTradingFours: false,
        mixingPreferences: {
            vocal:           { pan: 0,    reverb: 0.43, volume: 3 },
            melody:          { pan: 0,    reverb: 0.43, volume: 0 },
            secondaryMelody: { pan: 0.4,  reverb: 0.59, volume: -3, chorus: 40 },
            counterMelody:   { pan: -0.4, reverb: 0.59, volume: -4, chorus: 40 },
            chord:           { pan: 0.7,  reverb: 0.8,  volume: -4, chorus: 80 },
            drums:           { pan: 0,    reverb: 0.08, volume: 1 },
            bass:            { pan: 0,    reverb: 0,    volume: -2 },
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
    [StyleId.AcgLightMusic]: AcgStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    return StyleRegistry[styleId] || AcgStyle;
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
