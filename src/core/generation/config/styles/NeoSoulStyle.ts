// ============================================================
// NeoSoulStyle — Neo-Soul（参考 ALL_SOURCE_CODE.md / styles/NeoSoulStyle.ts）
// ============================================================
// 核心人格：色彩扩展全开（7/9/11/13）/ 重切分 / 中度 swing / EP 优先
// tensionLimits=13 / densityBaseline=0.5 / passingChordProb=0.6 / anticipationProb=0.7 / swingRatio=0.6
// ============================================================

import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { DefaultHarmony } from './Shared';

export const NeoSoulStyle: StyleConfig = {
    id: StyleId.NeoSoul,
    name: 'Neo-Soul',
    description: 'Full extensions (9/11/13), heavy syncopation, slight swing — Erykah/D\'Angelo territory.',

    tensionLimits: 13,
    densityBaseline: 0.5,
    passingChordProb: 0.6,
    anticipationProb: 0.7,
    swingRatio: 0.6,

    global: {
        bpmRange: [78, 100],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.30 },
            { tonality: Tonality.Minor, weight: 0.40 },
            { tonality: Tonality.Dorian, weight: 0.25 },
            { tonality: Tonality.Mixolydian, weight: 0.05 },
        ],
    },

    harmony: DefaultHarmony,

    rhythm: {
        swingRatio: 0.6,
        // Neo-Soul：拖拍 + 鬼音密集
        drumPatterns: [
            {
                energyMin: 4, energyMax: 5,
                fixedHits: [
                    { pitch: 36, positions: [0, 2.5], velocity: 0.7, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],   velocity: 0.7, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 42, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.4, 0.6], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.25, 2.75, 3.25, 3.75], velocityRange: [0.25, 0.45], duration: 0.125, energyMin: 5, densityThreshold: 0.4, probability: 0.5 },
            },
            {
                energyMin: 6, energyMax: 8,
                fixedHits: [
                    { pitch: 36, positions: [0, 2.5],     velocity: 0.85, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],       velocity: 0.9,  duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 42, positions: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], velocityRange: [0.5, 0.7], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.75, 1.25, 2.25, 2.75, 3.25, 3.75], velocityRange: [0.3, 0.5], duration: 0.125, energyMin: 5, densityThreshold: 0.4, probability: 0.6 },
            },
        ],
    },

    orchestration: {
        allowDrumless: false,
        allowBassless: false,
        melodyInstruments: ['Electric_Piano_1', 'Tenor_Sax'],
        chordInstruments: ['Electric_Piano_1', 'Acoustic_Grand'],
        bassInstruments: ['Electric_Bass_finger', 'Synth_Bass_1'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Strings_1'],
        counterMelodyProbability: 0.25,
        vocalProbability: 0,
    },
};
