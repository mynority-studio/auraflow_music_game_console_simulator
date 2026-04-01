import { StyleGrammar } from './StyleGrammar';

export const RockGrammar: StyleGrammar = {
    id: 'rock',
    rhythmPool: {
        lowEnergy: {
            pickups: [[], [0.5], [0.0, 0.5]],
            bodies: [
                [0.0, 0.5, 1.0, 1.5], // Straight 8ths
                [0.0, 1.0, 1.5],
                [0.0, 0.5, 1.5]
            ],
            tails: [
                { note: 0.0 },
                { note: 0.5 }
            ]
        },
        highEnergy: {
            pickups: [[-0.5], [0.5], [0.25, 0.5]],
            bodies: [
                [0.0, 0.5, 1.0, 1.5], // Driving straight 8ths
                [0.0, 0.75, 1.0, 1.5], // Syncopated push
                [0.0, 0.5, 0.75, 1.25] // Driving 16ths
            ],
            tails: [
                { note: 0.0 },
                { note: 0.5 }, // Strong downbeat
                { note: -0.5 } // Anticipated crash
            ]
        }
    },
    melodyRules: {
        preferredScales: ['Minor_Pentatonic', 'Blues_Scale', 'Mixolydian'],
        repetitionProbability: 0.6, // Rock has strong repetition
        maxLeap: 7, // Fifths are common
        anticipationProbability: 0.5, // Pushing the beat
        pitchWeights: {
            root: 0.40, // Strong root focus
            third: 0.20,
            fifth: 0.25,
            seventh: 0.10,
            ninth: 0.05,
            eleventh: 0.0,
            thirteenth: 0.0
        },
        maxTensionPerPhrase: 1,
        tailResolution: true, // Often resolves strongly
        pentatonicGapProbability: 0.4 // Very common in rock solos
    }
};
