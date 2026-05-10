// ============================================================
// ChillJazzStyle — Chill Jazz（参考 ALL_SOURCE_CODE.md / styles/ChillJazzStyle.ts）
// ============================================================
// 核心人格：放松 / 7-11 度色彩扩展 / 高频抢拍 / 稀疏 / 微 swing
// tensionLimits=11 — 允许 9/11 扩展但不到 13
// densityBaseline=0.4 / passingChordProb=0.5 / anticipationProb=0.6 / swingRatio=0.55
// ============================================================

import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { ChillJazzHarmony } from './Shared';

export const ChillJazzStyle: StyleConfig = {
    id: StyleId.ChillJazz,
    name: 'Chill Jazz',
    description: 'Relaxed jazz with colorful 7-11 extensions, gentle swing, and laid-back syncopation.',

    tensionLimits: 11,
    densityBaseline: 0.4,
    passingChordProb: 0.5,
    anticipationProb: 0.6,
    swingRatio: 0.55,

    global: {
        bpmRange: [70, 105],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.40 },
            { tonality: Tonality.Minor, weight: 0.30 },
            { tonality: Tonality.Dorian, weight: 0.20 },
            { tonality: Tonality.Mixolydian, weight: 0.10 },
        ],
    },

    harmony: ChillJazzHarmony,

    rhythm: {
        swingRatio: 0.55,
        // ChillJazz：吐 ride / brushes 风格的鼓型
        drumPatterns: [
            { // 低能段
                energyMin: 4, energyMax: 5,
                fixedHits: [
                    { pitch: 36, positions: [0, 2],   velocity: 0.55, duration: 0.25 },
                    { pitch: 37, positions: [1, 3],   velocity: 0.45, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 51, positions: [0, 0.66, 1, 1.66, 2, 2.66, 3, 3.66], velocityRange: [0.35, 0.55], duration: 0.25 },
                ],
            },
            { // 中能段
                energyMin: 6, energyMax: 8,
                fixedHits: [
                    { pitch: 36, positions: [0, 2],   velocity: 0.7, duration: 0.25 },
                    { pitch: 38, positions: [1, 3],   velocity: 0.65, duration: 0.25 },
                ],
                densityHits: [
                    { pitch: 51, positions: [0, 0.66, 1, 1.66, 2, 2.66, 3, 3.66], velocityRange: [0.45, 0.65], duration: 0.25 },
                ],
                ghost: { pitch: 38, positions: [0.66, 1.66, 2.66, 3.66], velocityRange: [0.25, 0.4], duration: 0.125, energyMin: 6, densityThreshold: 0.4, probability: 0.4 },
            },
        ],
    },

    orchestration: {
        allowDrumless: true,
        allowBassless: true,
        melodyInstruments: ['Acoustic_Grand', 'Tenor_Sax'],
        chordInstruments: ['Acoustic_Grand'],
        bassInstruments: ['Acoustic_Bass'],
        drumInstruments: ['Jazz_DrumKit', 'Brush_DrumKit'],
        counterMelodyInstruments: ['Tenor_Sax'],
        counterMelodyProbability: 0.30,
        vocalProbability: 0,
    },
};
