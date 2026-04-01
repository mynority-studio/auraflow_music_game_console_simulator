import { StyleGrammar } from './StyleGrammar';

export const FolkGrammar: StyleGrammar = {
    id: 'folk',
    rhythmPool: {
        lowEnergy: {
            pickups: [[], [0.5], [0.0, 0.5]],
            bodies: [
                [0.0, 0.5, 1.0], // Straight 8ths
                [0.0, 1.0],
                [0.0, 0.5, 1.5]
            ],
            tails: [
                { note: 0.0 },
                { note: 0.5 }
            ]
        },
        highEnergy: {
            pickups: [[], [0.5], [0.25, 0.5]],
            bodies: [
                [0.0, 0.5, 1.0, 1.5], // Straight 8ths driving
                [0.0, 0.75, 1.0, 1.5], // Slight syncopation
                [0.0, 0.5, 1.0, 1.25] // 16th note push
            ],
            tails: [
                { note: 0.0 },
                { note: 0.5 } // Strong downbeat
            ]
        }
    },
    melodyRules: {
        preferredScales: ['Major_Pentatonic', 'Mixolydian', 'Dorian'],
        repetitionProbability: 0.5, // Folk has strong repetition
        maxLeap: 7, // Fifths are common
        anticipationProbability: 0.2, // Less anticipation, more on the beat
        pitchWeights: {
            root: 0.35, // Strong root focus
            third: 0.30,
            fifth: 0.25,
            seventh: 0.05,
            ninth: 0.05,
            eleventh: 0.0,
            thirteenth: 0.0
        },
        maxTensionPerPhrase: 1,
        tailResolution: true, // Often resolves strongly
        pentatonicGapProbability: 0.5 // Very common in folk
    }
};
