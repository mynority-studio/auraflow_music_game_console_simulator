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
    tonalityBias?: { tonality: 'Major' | 'Minor', weight: number }[]; // Overrides style if present
    energyCap: [number, number]; // [minEnergy, maxEnergy] for the whole song
    densityMultiplier: number;
    phraseActionBias: [number, number, number]; // [Repeat, Vary, Contrast] weights
}

export const MoodRegistry: Record<MoodId, MoodConfig> = {
    [MoodId.Neutral]: { 
        id: MoodId.Neutral, 
        name: 'Neutral', 
        bpmMultiplier: [0.9, 1.1], 
        energyCap: [2, 8], 
        densityMultiplier: 1.0,
        phraseActionBias: [0.4, 0.3, 0.3]
    },
    [MoodId.Chill]: { 
        id: MoodId.Chill, 
        name: 'Chill', 
        bpmMultiplier: [0.7, 0.85], 
        energyCap: [1, 4], 
        densityMultiplier: 0.6,
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Melancholic]: { 
        id: MoodId.Melancholic, 
        name: 'Melancholic', 
        bpmMultiplier: [0.6, 0.8], 
        tonalityBias: [{tonality: 'Minor', weight: 0.9}, {tonality: 'Major', weight: 0.1}], 
        energyCap: [1, 5], 
        densityMultiplier: 0.7,
        phraseActionBias: [0.2, 0.3, 0.5] // More wandering/contrast
    },
    [MoodId.Energetic]: { 
        id: MoodId.Energetic, 
        name: 'Energetic', 
        bpmMultiplier: [1.1, 1.3], 
        energyCap: [4, 8], 
        densityMultiplier: 1.2,
        phraseActionBias: [0.5, 0.3, 0.2]
    },
    [MoodId.Aggressive]: { 
        id: MoodId.Aggressive, 
        name: 'Aggressive', 
        bpmMultiplier: [1.2, 1.5], 
        tonalityBias: [{tonality: 'Minor', weight: 0.8}, {tonality: 'Major', weight: 0.2}], 
        energyCap: [5, 8], 
        densityMultiplier: 1.3,
        phraseActionBias: [0.3, 0.4, 0.3]
    },
    [MoodId.Euphoric]: { 
        id: MoodId.Euphoric, 
        name: 'Euphoric', 
        bpmMultiplier: [1.1, 1.25], 
        tonalityBias: [{tonality: 'Major', weight: 0.9}, {tonality: 'Minor', weight: 0.1}], 
        energyCap: [4, 8], 
        densityMultiplier: 1.1,
        phraseActionBias: [0.6, 0.2, 0.2] // Highly repetitive/catchy
    }
};
