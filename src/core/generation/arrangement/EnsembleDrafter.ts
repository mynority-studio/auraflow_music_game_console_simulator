import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft } from '../types';

export class EnsembleDrafter {
    /**
     * Fixed ensemble draft — no style-driven instrument pools.
     * PRNG slots consumed for sequence alignment with legacy code.
     */
    public static draft(_style?: unknown): EnsembleDraft {
        // Consume PRNG slots to maintain deterministic sequence alignment
        // Legacy code consumed: melodyPool pick, secondaryMelody check + pick attempts,
        // chordPool pick, ensemble rand, full-band counterMelody check,
        // bassInstruments override, counterMelodyProbability, drumProbability, drumInstruments override
        for (let i = 0; i < 10; i++) {
            PRNGManager.next();
        }

        return {
            melodySound: 'Acoustic_Grand',
            secondaryMelodySound: 'Flute',
            chordSound: 'String_Ensemble_1',
            bassSound: 'Acoustic_Bass',
            drumSound: 'Standard_DrumKit',
            counterMelodySound: 'Pad_2_Warm'
        };
    }
}
