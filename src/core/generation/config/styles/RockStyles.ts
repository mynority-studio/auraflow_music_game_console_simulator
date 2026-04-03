import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { InstrumentId } from '../InstrumentFlags';

export const PopRockStyle: StyleConfig = {
    id: StyleId.PopRock,
    name: '流行摇滚 (Pop Rock)',
    global: {
        bpmRange: [110, 140],
        timeSignaturePool: [
            { signature: [4, 4], weight: 0.8 },
            { signature: [8, 8], weight: 0.2 }
        ],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.8 },
            { tonality: Tonality.Minor, weight: 0.2 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'],
            ['I', 'V', 'vi', 'IV'],
            ['IV', 'I', 'V', 'vi']
        ],
        versePool: [
            ['I', 'vi', 'IV', 'V'],
            ['I', 'V', 'vi', 'iii'],
            ['vi', 'V', 'IV', 'I']
        ],
        preChorusPool: [
            ['IV', 'V', 'vi', 'vi'],
            ['ii', 'IV', 'V', 'V']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3,
        reharmProbability: 0.1,
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'pop-rock'
    },
    rhythm: {
        densityBase: [0.6, 0.9],
        syncopationWeight: 0.2,
        restProbability: 0.05,
        disruptionProbability: 0.1,
        humanize: 0.15,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.6,
        maxJumpInterval: 12,
        tensionTolerance: 0.2,
        mutationProbability: 0.2,
        mutationPool: ['augmentation']
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Overdriven_Guitar, InstrumentId.Overdriven_Guitar, InstrumentId.Electric_Guitar_Clean, InstrumentId.Rock_Organ, InstrumentId.Harmonica, InstrumentId.Tenor_Sax],
        chordInstruments: [InstrumentId.Overdriven_Guitar, InstrumentId.Overdriven_Guitar, InstrumentId.Distortion_Guitar, InstrumentId.Electric_Guitar_Clean],
        bassInstruments: [InstrumentId.Electric_Bass_Pick, InstrumentId.Electric_Bass_Finger, InstrumentId.Slap_Bass_1],
        drumInstruments: [InstrumentId.Standard_DrumKit, InstrumentId.Standard_DrumKit, InstrumentId.Room_DrumKit],
        counterMelodyInstruments: [InstrumentId.Rock_Organ, InstrumentId.Rock_Organ, InstrumentId.Electric_Guitar_Clean, InstrumentId.Harmonica, InstrumentId.Tenor_Sax],
        texturePool: ['Block', 'Block', 'Pulsing'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.7,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.8, comping: 0.7, color: 0.4 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'steady',
            drumStyle: 'steady'
        },
        mixingPreferences: {
            melody: { pan: 0.1, reverb: 0.4 },
            chord: { pan: -0.25, reverb: 0.5, volume: -3.0 },
            counterMelody: { pan: -0.6, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { reverb: 0.2, volume: -3.0 }
        }
    },
    performance: {
        allowedPersonas: ['Rock_Star', 'C_Pop_Balladeer']
    },
    contrast: {
        chorusPitchOffset: 7,
        verseDensityMultiplier: 0.5,
        versePitchOffset: -4
    },
    modulation: {
        probability: 0.3,
        targetSection: 'Final_Chorus',
        intervalPool: [2]
    }
};
