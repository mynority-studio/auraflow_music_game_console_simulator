import { StyleGrammar } from './StyleGrammar';

export const PopGrammar: StyleGrammar = {
    rhythmPool: {
        highEnergy: {
            pickups: [[], [0.5], [0.75], [0.5, 0.75]],
            bodies: [[0, 0.5, 1.0, 1.5], [0, 0.75, 1.5], [0, 1.0, 1.5], [0, 0.5, 1.5]],
            tails: [{ note: 0 }, { note: 0.5 }, { note: 1.0 }]
        },
        lowEnergy: {
            pickups: [[], [0.5]],
            bodies: [[0, 1.0], [0, 1.5], [0, 0.5, 1.0]],
            tails: [{ note: 0 }, { note: 1.0 }]
        }
    },
    melodyRules: {
        anticipationProbability: 0.2,
        pentatonicGapProbability: 0.3
    }
};
