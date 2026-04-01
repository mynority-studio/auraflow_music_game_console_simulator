export interface RhythmPool {
    pickups: number[][];
    bodies: number[][];
    tails: { note: number }[];
}

export interface StyleGrammar {
    id?: string;
    rhythmPool: {
        highEnergy: RhythmPool;
        lowEnergy: RhythmPool;
    };
    melodyRules: {
        anticipationProbability: number;
        pentatonicGapProbability?: number;
        tailResolution?: boolean;
        preferredScales?: string[];
        repetitionProbability?: number;
        maxLeap?: number;
        maxTensionPerPhrase?: number;
        pitchWeights?: {
            root: number;
            third: number;
            fifth: number;
            seventh: number;
            ninth?: number;
            eleventh?: number;
            thirteenth?: number;
        };
    };
}
