import { Tonality } from '../types';

export enum MoodId {
    Neutral = 0,
    Chill = 1,
    Melancholic = 2,
    Energetic = 3,
    Aggressive = 4,
    Euphoric = 5
}

export interface MoodConfig {
    id: MoodId;
    name: string;
    bpmMultiplier: [number, number]; // e.g., [0.7, 0.85] for Chill
    tonalityBias?: { tonality: Tonality, weight: number }[]; // Overrides style if present
    energyCap: [number, number]; // [minEnergy, maxEnergy] for the whole song
    densityMultiplier: number; // 通用密度（StructureEngine 段落密度基准）
    melodyDensityMultiplier?: number; // 旋律独立密度（不设时回退 densityMultiplier）
    accompanimentDensityMultiplier?: number; // 伴奏独立密度（不设时回退 densityMultiplier）
    phraseActionBias: [number, number, number]; // [Repeat, Vary, Contrast] weights
}

export const MoodRegistry: Record<MoodId, MoodConfig> = {
    [MoodId.Neutral]: {
        id: MoodId.Neutral,
        name: 'Neutral',
        bpmMultiplier: [0.9, 1.1],
        energyCap: [2, 8],
        densityMultiplier: 1.0,
        melodyDensityMultiplier: 1.0,
        accompanimentDensityMultiplier: 1.0,
        phraseActionBias: [0.4, 0.3, 0.3]
    },
    [MoodId.Chill]: {
        id: MoodId.Chill,
        name: 'Chill',
        bpmMultiplier: [0.7, 0.85],
        energyCap: [1, 4],
        densityMultiplier: 0.6,
        melodyDensityMultiplier: 0.5,          // 旋律极简
        accompanimentDensityMultiplier: 0.7,    // 伴奏略疏但有支撑
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Melancholic]: {
        id: MoodId.Melancholic,
        name: 'Melancholic',
        bpmMultiplier: [0.6, 0.8],
        tonalityBias: [{tonality: Tonality.Minor, weight: 0.9}, {tonality: Tonality.Major, weight: 0.1}],
        energyCap: [1, 5],
        densityMultiplier: 0.7,
        melodyDensityMultiplier: 0.6,          // 旋律稀疏叹息
        accompanimentDensityMultiplier: 0.8,    // 伴奏略密支撑
        phraseActionBias: [0.2, 0.3, 0.5]
    },
    [MoodId.Energetic]: {
        id: MoodId.Energetic,
        name: 'Energetic',
        bpmMultiplier: [1.0, 1.15],   // 收敛：最高 ~126
        energyCap: [4, 8],
        densityMultiplier: 1.1,                 // 从 1.2 降到 1.1
        melodyDensityMultiplier: 1.0,
        accompanimentDensityMultiplier: 1.15,   // 从 1.3 降到 1.15
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Aggressive]: {
        id: MoodId.Aggressive,
        name: 'Aggressive',
        bpmMultiplier: [1.05, 1.25],  // 收敛：不再飙到 150+
        tonalityBias: [{tonality: Tonality.Minor, weight: 0.8}, {tonality: Tonality.Major, weight: 0.2}],
        energyCap: [5, 8],
        densityMultiplier: 1.2,                 // 从 1.3 降到 1.2
        melodyDensityMultiplier: 1.15,          // 从 1.3 降到 1.15
        accompanimentDensityMultiplier: 1.1,    // 从 1.2 降到 1.1
        phraseActionBias: [0.3, 0.4, 0.3]
    },
    [MoodId.Euphoric]: {
        id: MoodId.Euphoric,
        name: 'Euphoric',
        bpmMultiplier: [1.1, 1.25],
        tonalityBias: [{tonality: Tonality.Major, weight: 0.9}, {tonality: Tonality.Minor, weight: 0.1}],
        energyCap: [4, 8],
        densityMultiplier: 1.1,
        melodyDensityMultiplier: 0.9,          // 旋律微收（朗朗上口）
        accompanimentDensityMultiplier: 1.2,    // 伴奏密集欢快
        phraseActionBias: [0.6, 0.2, 0.2]
    }
};
