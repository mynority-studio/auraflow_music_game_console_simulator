import { StyleGrammar } from './StyleGrammar';

export const JazzGrammar: StyleGrammar = {
    id: 'jazz',
    rhythmPool: {
        lowEnergy: {
            pickups: [[], [0.666], [0.333, 0.666]], // Swing triplets
            bodies: [
                [0.0, 0.666, 1.333], // Swing 8ths
                [0.0, 1.0, 1.666],
                [0.0, 0.333, 0.666, 1.0] // Triplets
            ],
            tails: [
                { note: 0.0 },
                { note: 0.666 } // Swing tail
            ]
        },
        highEnergy: {
            pickups: [[-0.334], [0.666], [0.333, 0.666]],
            bodies: [
                [0.0, 0.666, 1.0, 1.666], // Bebop phrasing
                [0.0, 0.333, 0.666, 1.333], // Triplet runs
                [0.0, 0.75, 1.5, 1.75] // Syncopated pushes
            ],
            tails: [
                { note: 0.0 },
                { note: -0.334 }, // Anticipated swing tail
                { note: 0.666 }
            ]
        }
    },
    melodyRules: {
        preferredScales: ['Dorian', 'Mixolydian', 'Lydian', 'Altered', 'Diminished'],
        repetitionProbability: 0.1, // Jazz rarely repeats exactly
        maxLeap: 14, // Large leaps (e.g., 7ths, 9ths) are common
        anticipationProbability: 0.7, // Heavy syncopation
        pitchWeights: {
            root: 0.05, // Root is avoided in melody often
            third: 0.20,
            fifth: 0.15,
            seventh: 0.20, // 7ths are strong
            ninth: 0.20, // 9ths are strong
            eleventh: 0.10, // 11ths (#11)
            thirteenth: 0.10 // 13ths
        },
        maxTensionPerPhrase: 4, // High tension tolerance
        tailResolution: false, // Often ends on extensions (9, 11, 13)
        pentatonicGapProbability: 0.05 // Less pentatonic, more scalar/arpeggio
    }
};
