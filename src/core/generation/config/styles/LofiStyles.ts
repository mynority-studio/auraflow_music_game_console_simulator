import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { RnBRhythmCells } from '../../melody/RhythmCells';
import { InstrumentId } from '../InstrumentFlags';

export const LofiHipHopStyle: StyleConfig = {
    id: StyleId.Lofi,
    name: '低保真嘻哈 (Lo-Fi Hip Hop)',
    global: {
        bpmRange: [65, 85], // 慵懒的慢板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.7 },
            { tonality: Tonality.Dorian, weight: 0.3 }
        ]
    },
    harmony: {
        chorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'iii', 'ii', 'I'],
            ['vi', 'IV', 'I', 'V'],
            ['vii°', 'III7', 'vi', 'vi'],
        ],
        versePool: [
            ['vi', 'ii', 'V', 'I'],
            ['IV', 'V', 'iii', 'vi'],
            ['vi', 'vi', 'ii', 'iii']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'V', 'vi', 'vi'],
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.6,
        reharmProbability: 0.2,
        melodyDrivenReharmProbability: 0.3,
        borrowedChords: ['SecondaryDominant'],
        passingChords: ['Diminished7'],
        voicingStyle: 'neo-soul'
    },
    rhythm: {
        densityBase: [0.3, 0.6],
        syncopationWeight: 0.7,
        restProbability: 0.3,
        disruptionProbability: 0.1,
        humanize: 0.9,
        swingRatio: 0.5,
        grooveTemplate: RnBRhythmCells
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 8,
        tensionTolerance: 0.4,
        mutationProbability: 0.2,
        mutationPool: ['inversion'],
        inflectionProbability: 0.2,
        pentatonicShiftProbability: 0.8
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Vibraphone, InstrumentId.Music_Box, InstrumentId.Ocarina, InstrumentId.Recorder],
        chordInstruments: [InstrumentId.Electric_Piano_1, InstrumentId.Electric_Piano_2, InstrumentId.Pad_2_Warm],
        bassInstruments: [InstrumentId.Synth_Bass_1, InstrumentId.Acoustic_Bass, InstrumentId.Electric_Bass_Finger],
        drumInstruments: [InstrumentId.Standard_DrumKit, InstrumentId.Electronic_DrumKit],
        counterMelodyInstruments: [InstrumentId.Muted_Trumpet, InstrumentId.Vibraphone, InstrumentId.Electric_Piano_1],
        texturePool: ['Block', 'Rhythmic'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.4,
        grooveRatio: { foundation: 0.7, comping: 0.6, color: 0.2 },
        idiomPreferences: {
            counterMelodyStyle: 'melodic',
            bassStyle: 'syncopated',
            drumStyle: 'sparse',
            pianoStyle: 'block-chord'
        },
        mixingPreferences: {
            melody: { reverb: 0.8 },
            chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
            drums: { reverb: 0.1, volume: -1.0 },
            bass: { volume: -3.0 },
            counterMelody: { volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['RnB_Diva', 'Soul_Singer', 'Jazz_Cat']
    },
    contrast: {
        chorusPitchOffset: 2,
        verseDensityMultiplier: 0.8,
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.0,
        targetSection: 'Final_Chorus',
        intervalPool: [1]
    }
};
