import { StyleGrammar } from './StyleGrammar';

export const EDMGrammar: StyleGrammar = {
    id: 'edm',
    rhythmPool: {
        lowEnergy: {
            pickups: [[], [0.5]],
            bodies: [
                [0.0, 0.5, 1.0], 
                [0.0, 0.75, 1.5], // Syncopated
                [0.0, 1.0, 1.5],
                [0.0, 0.5, 1.5], // Sparse
                [0.0, 1.0, 2.0], // Half notes
                [0.5, 1.5, 2.5]  // Offbeats
            ],
            tails: [
                { note: 0.0 },
                { note: 0.5 }
            ]
        },
        highEnergy: {
            pickups: [[], [-0.25], [0.5]],
            bodies: [
                [0.0, 0.25, 0.5, 0.75], // 16th note driving
                [0.0, 0.5, 0.75, 1.25], // Syncopated dance rhythm
                [0.0, 0.375, 0.75, 1.5], // Tresillo variant
                [0.0, 0.25, 0.75, 1.0],
                [0.0, 0.5, 1.0, 1.5], // Straight 8ths
                [0.0, 0.75, 1.0, 1.75], // Offbeat heavy
                [0.0, 0.25, 1.0, 1.25], // Broken 16ths
                [0.0, 0.5, 0.75, 1.0, 1.5] // Dense syncopation
            ],
            tails: [
                { note: 0.0 },
                { note: 0.25 }, // Short stab
                { note: -0.25 } // Anticipated stab
            ]
        }
    },
    melodyRules: {
        preferredScales: ['Minor_Pentatonic', 'Dorian', 'Phrygian'],
        repetitionProbability: 0.7, // EDM has high repetition
        maxLeap: 12, // Octave jumps are common in EDM
        anticipationProbability: 0.6, // High anticipation for drive
        pitchWeights: {
            root: 0.30,
            third: 0.20,
            fifth: 0.30,
            seventh: 0.10,
            ninth: 0.10,
            eleventh: 0.0,
            thirteenth: 0.0
        },
        maxTensionPerPhrase: 2,
        tailResolution: false, // Often ends on unresolved notes for tension
        pentatonicGapProbability: 0.1
    }
};
