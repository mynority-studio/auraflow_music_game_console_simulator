import { StyleGrammar } from './StyleGrammar';

export const RnBGrammar: StyleGrammar = {
    rhythmPool: {
        highEnergy: {
            pickups: [[], [0.25, 0.5], [0.5, 0.75]],
            bodies: [[0, 0.25, 0.75, 1.25], [0, 0.5, 0.75, 1.5], [0, 0.75, 1.25]],
            tails: [{ note: 0 }, { note: 0.25 }, { note: 0.75 }]
        },
        lowEnergy: {
            pickups: [[], [0.75]],
            bodies: [[0, 0.75, 1.5], [0, 1.25], [0, 0.5, 1.25]],
            tails: [{ note: 0 }, { note: 0.75 }]
        }
    },
    melodyRules: {
        anticipationProbability: 0.4,
        pentatonicGapProbability: 0.5
    }
};
