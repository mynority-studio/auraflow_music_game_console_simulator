import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { InstrumentId } from '../InstrumentFlags';

export const EurodanceStyle: StyleConfig = {
    id: StyleId.Eurodance,
    name: 'Eurodance (90s)',
    description: 'High-energy 90s dance music with four-on-the-floor beats, off-beat bass, and bright synthesizer melodies.',
    global: {
        bpmRange: [130, 140],
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.8 },
            { tonality: Tonality.Dorian, weight: 0.2 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'],
            ['i', 'VI', 'III', 'VII'],
            ['i', 'VII', 'VI', 'VII'],
            ['i', 'iv', 'VII', 'III']
        ],
        versePool: [
            ['i', 'VI', 'iv', 'V'],
            ['i', 'i', 'VI', 'VII'],
            ['i', 'iv', 'i', 'V']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.1,
        passingChords: [],
        reharmProbability: 0.0,
        voicingStyle: 'edm'
    },
    rhythm: {
        densityBase: [0.8, 1.0],
        syncopationWeight: 0.2,
        restProbability: 0.05,
        disruptionProbability: 0.05,
        humanize: 0.0,
        swingRatio: 0.5,
        strictGrid: true
    },
    melody: {
        stepwiseRatio: 0.3,
        maxJumpInterval: 12,
        tensionTolerance: 0.1,
        mutationProbability: 0.1,
        mutationPool: ['truncation', 'inversion'],
        syncopationResolution: 'strict',
        pentatonicPreference: 0.2
    },
    contrast: {
        versePitchOffset: -5,
        verseDensityMultiplier: 0.8,
        chorusPitchOffset: 7
    },
    modulation: {
        probability: 0.1,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Lead_1_Square, InstrumentId.Lead_2_Sawtooth, InstrumentId.Synth_Calliope],
        chordInstruments: [InstrumentId.Pad_1_NewAge, InstrumentId.Synth_Brass_1, InstrumentId.Lead_2_Sawtooth],
        bassInstruments: [InstrumentId.Synth_Bass_1, InstrumentId.Synth_Bass_2],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Lead_1_Square, InstrumentId.Pad_3_Polysynth],
        texturePool: ['Rhythmic', 'Arpeggio', 'Block'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.7,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'steady',
            drumStyle: 'high-energy',
            pianoStyle: 'block-chord'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.8, delay: 0.5 },
            chord: { pan: -0.25, reverb: 0.85, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { volume: -3.0 },
            counterMelody: { volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['RnB_Diva', 'C_Pop_Balladeer']
    }
};

export const TranceStyle: StyleConfig = {
    id: StyleId.Trance,
    name: 'Progressive Trance',
    description: 'Deep, driving electronic music with rolling basslines, atmospheric pads, and epic build-ups.',
    global: {
        bpmRange: [135, 140],
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.9 },
            { tonality: Tonality.Dorian, weight: 0.1 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'],
            ['i', 'VI', 'III', 'VII'],
            ['VI', 'VII', 'i', 'i']
        ],
        versePool: [
            ['i', 'i', 'i', 'i'],
            ['i', 'VI', 'i', 'VI']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.2,
        passingChords: [],
        reharmProbability: 0.0,
        voicingStyle: 'edm'
    },
    rhythm: {
        densityBase: [0.7, 0.9],
        syncopationWeight: 0.1,
        restProbability: 0.05,
        disruptionProbability: 0.0,
        humanize: 0.0,
        swingRatio: 0.5,
        strictGrid: true
    },
    melody: {
        stepwiseRatio: 0.5,
        maxJumpInterval: 8,
        tensionTolerance: 0.2,
        mutationProbability: 0.2,
        mutationPool: ['augmentation', 'diminution'],
        syncopationResolution: 'strict',
        pentatonicPreference: 0.1
    },
    contrast: {
        versePitchOffset: -7,
        verseDensityMultiplier: 0.5,
        chorusPitchOffset: 12
    },
    modulation: {
        probability: 0.0,
        targetSection: 'Final_Chorus',
        intervalPool: []
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Lead_2_Sawtooth, InstrumentId.Pad_1_NewAge, InstrumentId.Lead_1_Square],
        chordInstruments: [InstrumentId.Pad_1_NewAge, InstrumentId.Pad_3_Polysynth, InstrumentId.String_Ensemble],
        bassInstruments: [InstrumentId.Synth_Bass_1, InstrumentId.Synth_Bass_2],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Pad_1_NewAge, InstrumentId.Lead_2_Sawtooth],
        texturePool: ['Pad', 'Arpeggio', 'Rhythmic'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.9,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'steady',
            drumStyle: 'high-energy',
            counterMelodyStyle: 'rhythmic',
            pianoStyle: 'block-chord'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.8, delay: 0.5 },
            chord: { pan: -0.25, reverb: 0.85, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { volume: -3.0 },
            counterMelody: { volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['Folk_Storyteller', 'RnB_Diva']
    }
};

export const SynthwaveStyle: StyleConfig = {
    id: StyleId.Synthwave,
    name: 'Synthwave / Retrowave',
    description: '80s-inspired retro-futuristic electronic music with driving 8th-note basslines and synth brass.',
    global: {
        bpmRange: [100, 115],
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.8 },
            { tonality: Tonality.Dorian, weight: 0.2 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'],
            ['i', 'VII', 'VI', 'V'],
            ['iv', 'i', 'VI', 'VII']
        ],
        versePool: [
            ['i', 'VI', 'iv', 'V'],
            ['i', 'v', 'VI', 'VII']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.1,
        passingChords: [],
        reharmProbability: 0.0,
        voicingStyle: 'edm'
    },
    rhythm: {
        densityBase: [0.6, 0.8],
        syncopationWeight: 0.3,
        restProbability: 0.1,
        disruptionProbability: 0.1,
        humanize: 0.05,
        swingRatio: 0.5,
        strictGrid: true
    },
    melody: {
        stepwiseRatio: 0.6,
        maxJumpInterval: 7,
        tensionTolerance: 0.1,
        mutationProbability: 0.2,
        mutationPool: ['truncation', 'inversion'],
        syncopationResolution: 'strict',
        pentatonicPreference: 0.3
    },
    contrast: {
        versePitchOffset: -4,
        verseDensityMultiplier: 0.7,
        chorusPitchOffset: 5
    },
    modulation: {
        probability: 0.2,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Synth_Brass_1, InstrumentId.Lead_1_Square, InstrumentId.Lead_2_Sawtooth],
        chordInstruments: [InstrumentId.Synth_Brass_1, InstrumentId.Pad_3_Polysynth, InstrumentId.Warm_EP],
        bassInstruments: [InstrumentId.Synth_Bass_1, InstrumentId.Synth_Bass_2, InstrumentId.Electric_Bass_Finger],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Lead_1_Square, InstrumentId.Synth_Brass_1],
        texturePool: ['Rhythmic', 'Block', 'Arpeggio'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.6,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'steady',
            drumStyle: 'high-energy',
            pianoStyle: 'block-chord'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.8, delay: 0.5 },
            chord: { pan: -0.25, reverb: 0.85, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { volume: -3.0 },
            counterMelody: { volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['C_Pop_Balladeer', 'RnB_Diva']
    }
};
