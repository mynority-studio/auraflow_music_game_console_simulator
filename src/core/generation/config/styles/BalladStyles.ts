import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { InstrumentId } from '../InstrumentFlags';

export const PowerBalladStyle: StyleConfig = {
    id: StyleId.PowerBallad,
    name: '欧美力量大歌 (Power Ballad)',
    global: {
        bpmRange: [60, 95],
        timeSignaturePool: [{ signature: [4, 4], weight: 0.8 }, { signature: [6, 8], weight: 0.2 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.6 },
            { tonality: Tonality.Major, weight: 0.4 }
        ]
    },
    harmony: {
        chorusPool: [
            ['I', 'V', 'vi', 'IV'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'IV', 'vi', 'V'],
            ['i', 'VI', 'III', 'VII']
        ],
        versePool: [
            ['I', 'vi', 'IV', 'V'],
            ['vi', 'V', 'IV', 'IV'],
            ['i', 'v', 'VI', 'VII'],
            ['I', 'IV', 'I', 'V']
        ],
        preChorusPool: [
            ['IV', 'V', 'vi', 'V'],
            ['ii', 'IV', 'I', 'V'],
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3,
        reharmProbability: 0.1,
        passingChords: ['SecondaryDominant'],
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'standard'
    },
    rhythm: {
        densityBase: [0.3, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.2,
        disruptionProbability: 0.05,
        humanize: 0.2,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.5,
        maxJumpInterval: 12,
        tensionTolerance: 0.2,
        mutationProbability: 0.1,
        mutationPool: ['augmentation']
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Warm_EP, InstrumentId.String_Ensemble],
        chordInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Warm_EP, InstrumentId.Acoustic_Guitar_Chord],
        bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Acoustic_Bass, InstrumentId.Fretless_Bass, InstrumentId.Cello],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Pad_3_Polysynth],
        texturePool: ['Block', 'Block', 'Arpeggio', 'Pad'],
        drumProbability: 0.9,
        counterMelodyProbability: 0.9,
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
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
        allowedPersonas: ['Soul_Singer', 'RnB_Diva']
    },
    contrast: {
        chorusPitchOffset: 9,
        verseDensityMultiplier: 0.5,
        versePitchOffset: -4
    },
    modulation: {
        probability: 0.3,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    }
};


export const RussianFolkBalladStyle: StyleConfig = {
    id: StyleId.RussianFolkBallad,
    name: '俄式民谣/贝加尔湖畔 (Russian Acoustic Ballad)',
    global: {
        bpmRange: [62, 72],
        timeSignaturePool:[{ signature: [4, 4], weight: 0.7 }, { signature: [3, 4], weight: 0.3 }],
        tonalityPool:[{ tonality: Tonality.Minor, weight: 1.0 }]
    },
    harmony: {
        chorusPool: [['i', 'iv', 'bVII', 'bIII'],['bVI', 'ii7', 'V7', 'i'],['iv', 'bVII', 'bIII', 'bVI', 'ii7', 'V7', 'i', 'i']],
        versePool: [['i', 'v', 'bVI', 'V7'], ['i', 'iv', 'bVI', 'V7'],['i', 'ii7', 'V7', 'i']],
        preChorusPool:[['iv', 'i', 'ii7', 'V7'], ['bVI', 'bVII', 'i', 'i']]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        allowTritoneSub: false,
        reharmProbability: 0.2,
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'standard'
    },
    rhythm: { densityBase:[0.25, 0.45], syncopationWeight: 0.05, restProbability: 0.40, disruptionProbability: 0.0, humanize: 0.04, swingRatio: 0.5 },
    melody: {
        stepwiseRatio: 0.85,
        maxJumpInterval: 12,
        tensionTolerance: 0.30,
        mutationProbability: 0.20,
        mutationPool:['inversion'],
        pentatonicPreference: 0.8,
        extensionPreference: 0.05,
        chromaticPassingProbability: 0.0,
        syncopationResolution: 'strict'
    },
    contrast: { versePitchOffset: -5, verseDensityMultiplier: 0.7, chorusPitchOffset: 7 },
    modulation: { probability: 0.40, targetSection: 'Final_Chorus', intervalPool: [1, 2] },
    orchestration: {
        melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Warm_EP, InstrumentId.Lofi_Piano],
        chordInstruments: [InstrumentId.Acoustic_Guitar_Chord, InstrumentId.Acoustic_Guitar_Chord, InstrumentId.Acoustic_Grand],
        bassInstruments: [InstrumentId.Acoustic_Bass, InstrumentId.Cello, InstrumentId.Contrabass],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Voice_Oohs, InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Pad_3_Polysynth],
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad'],
        drumProbability: 0.2,
        counterMelodyProbability: 0.6,
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            pianoStyle: 'arpeggiated',
            drumStyle: 'sparse',
            bassStyle: 'sparse'
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
        allowedPersonas:['Folk_Storyteller']
    }
};
