import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { InstrumentId } from '../InstrumentFlags';

export const GhibliOrchestralStyle: StyleConfig = {
    id: StyleId.GhibliOrchestral,
    name: '久石让/吉卜力 (Ghibli Orchestral)',
    global: {
        bpmRange: [70, 110],
        timeSignaturePool: [
            { signature: [4, 4], weight: 0.5 },
            { signature: [3, 4], weight: 0.3 },
            { signature: [6, 8], weight: 0.2 }
        ],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.6 },
            { tonality: Tonality.Minor, weight: 0.4 }
        ]
    },
    harmony: {
        chorusPool: [
            ['IV', 'V', 'iii', 'vi'],
            ['I', 'V', 'vi', 'iii', 'IV', 'I', 'ii', 'V'],
            ['IV', 'V', 'I', 'vi']
        ],
        versePool: [
            ['I', 'vi', 'IV', 'V'],
            ['I', 'iii', 'IV', 'V'],
            ['vi', 'iii', 'IV', 'I']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'I', 'ii', 'V']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.4,
        reharmProbability: 0.4,
        borrowedChords: ['SecondaryDominant', 'ModalMixture'],
        voicingStyle: 'standard'
    },
    rhythm: {
        densityBase: [0.4, 0.7],
        syncopationWeight: 0.2,
        restProbability: 0.1,
        disruptionProbability: 0.05,
        humanize: 0.3,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 12,
        tensionTolerance: 0.3,
        mutationProbability: 0.1,
        mutationPool: ['inversion']
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Flute, InstrumentId.Oboe, InstrumentId.Violin],
        chordInstruments: [InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Acoustic_Grand, InstrumentId.Tremolo_Strings],
        bassInstruments: [InstrumentId.Acoustic_Bass, InstrumentId.Cello, InstrumentId.Contrabass, InstrumentId.String_Ensemble_2],
        drumInstruments: [InstrumentId.Orchestral_DrumKit],
        counterMelodyInstruments: [InstrumentId.Glockenspiel, InstrumentId.Pizzicato_Strings, InstrumentId.Clarinet, InstrumentId.Flute, InstrumentId.Orchestral_Harp],
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad', 'Block'],
        drumProbability: 0.2,
        counterMelodyProbability: 0.7,
        grooveRatio: { foundation: 0.4, comping: 0.5, color: 0.9 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'sparse',
            drumStyle: 'acoustic-swing'
        },
        mixingPreferences: {
            melody: { reverb: 0.8, delay: 0.4 },
            chord: { pan: -0.25, reverb: 0.9, volume: -4.0 },
            drums: { reverb: 0.2, volume: -2.0 },
            bass: { reverb: 0.35, volume: -3.0 },
            counterMelody: { pan: -0.6, delay: 0.3, volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['Classical_Virtuoso', 'Cinematic_Composer']
    },
    contrast: {
        chorusPitchOffset: 5,
        verseDensityMultiplier: 0.6,
        versePitchOffset: -3
    },
    modulation: {
        probability: 0.3,
        targetSection: 'Chorus',
        intervalPool: [1, 2, 3]
    }
};
