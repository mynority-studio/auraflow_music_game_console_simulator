// ============================================================
// PopStyle — Modern Pop（参考 ALL_SOURCE_CODE.md / styles/PopStyle.ts）
// ============================================================
// 核心人格：直拍 / 7-9 度扩展 / 适度切分 / 中等密度
// tensionLimits=9 — IdiomUtils 用 degree>9 剔除高扩展（Pop 不上 11/13）
// densityBaseline=0.6 / passingChordProb=0.2 / anticipationProb=0.3 / 无 swing
// ============================================================

import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { DefaultHarmony } from './Shared';

export const PopStyle: StyleConfig = {
    id: StyleId.ModernPop,
    name: 'Modern Pop',
    description: 'Solid 7-9 chord pop with steady drums and moderate syncopation.',

    tensionLimits: 9,
    densityBaseline: 0.6,
    passingChordProb: 0.2,
    anticipationProb: 0.3,

    global: {
        bpmRange: [88, 128],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.55 },
            { tonality: Tonality.Minor, weight: 0.30 },
            { tonality: Tonality.Mixolydian, weight: 0.10 },
            { tonality: Tonality.Major_Pentatonic, weight: 0.05 },
        ],
    },

    harmony: DefaultHarmony,

    rhythm: {
        // 三档鼓型（按段落 energyLevel 分派）
        // GM Drum Map: 36=Kick, 38=Snare, 42=ClosedHiHat, 46=OpenHiHat, 49=Crash
        drumPatterns: [
            { // 低能段 (4)
                energyMin: 4, energyMax: 4,
                fixedHits: [
                    { pitch: 36, positions: [0, 2],     velocity: 0.7, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],     velocity: 0.7, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 42, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.4, 0.6], duration: 0.25 },
                ],
            },
            { // 中能段 (5-7)
                energyMin: 5, energyMax: 7,
                fixedHits: [
                    { pitch: 36, positions: [0, 2],     velocity: 0.85, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],     velocity: 0.85, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 42, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.5, 0.7], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.75, 3.25], velocityRange: [0.3, 0.5], duration: 0.125, energyMin: 6, densityThreshold: 0.5, probability: 0.25 },
            },
            { // 高能段 (8-10)
                energyMin: 8, energyMax: 10,
                fixedHits: [
                    { pitch: 36, positions: [0, 2, 2.5], velocity: 0.95, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],      velocity: 0.95, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 46, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.6, 0.8], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.75, 3.25], velocityRange: [0.3, 0.5], duration: 0.125, energyMin: 6, densityThreshold: 0.5, probability: 0.3 },
                crashOnSectionStart: { pitch: 49, velocity: 0.95, duration: 1.0 },
            },
        ],
    },

    orchestration: {
        allowDrumless: false,
        allowBassless: false,
        melodyInstruments: ['Acoustic_Grand', 'Synth_Lead_1'],
        chordInstruments: ['Acoustic_Grand'],
        bassInstruments: ['Electric_Bass_finger', 'Synth_Bass_1'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: [],
        counterMelodyProbability: 0.15,
        vocalProbability: 0,
    },
};
