import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

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
        maxDissonanceTolerance: 0.1, // 极低的不和谐容忍度，确保旋律高度协和
        passingChords: [],
        reharmProbability: 0.0,
        voicingStyle: 'edm'
    },
    rhythm: {
        densityBase: [0.8, 1.0], // Very dense, lots of 16th notes
        syncopationWeight: 0.2, // Low syncopation, very straight and quantized
        restProbability: 0.05,
        disruptionProbability: 0.05,
        humanize: 0.0, // Machine-like precision
        swingRatio: 0.5, // Straight
        strictGrid: true
    },
    melody: {
        stepwiseRatio: 0.3, // More jumps and arpeggios
        maxJumpInterval: 12, // Octave jumps are common
        tensionTolerance: 0.1, // 极低的张力容忍度，确保旋律高度协和，解决紧张感
        mutationProbability: 0.1, // Highly repetitive motifs
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
        intervalPool: [1, 2] // Up a half or whole step
    },
    orchestration: {
        melodyInstruments: ['Lead_1_square', 'Lead_2_sawtooth', 'Synth_Calliope'],
        chordInstruments: ['Pad_1_new_age', 'Synth_Brass_1', 'Lead_2_sawtooth'],
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2'],
        drumInstruments: ['Standard_DrumKit'], // Or Electronic Kit if available
        counterMelodyInstruments: ['Lead_1_square', 'Pad_3_polysynth'],
        texturePool: ['Rhythmic', 'Arpeggio', 'Block'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.7,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'eurodance',
            drumStyle: 'eurodance',
            pianoStyle: 'electronic',
            humanizeAmount: 0.1 // 🌟 电子乐需要极高的量化精度
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
        allowedPersonas: ['RnB_Diva', 'C_Pop_Balladeer'] // Powerful vocals
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
            ['i', 'i', 'i', 'i'], // Static harmony for build-ups
            ['i', 'VI', 'i', 'VI']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.2, // 较低的不和谐容忍度
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
        tensionTolerance: 0.2, // 降低张力容忍度，确保旋律协和
        mutationProbability: 0.2,
        mutationPool: ['augmentation', 'diminution'],
        syncopationResolution: 'strict',
        pentatonicPreference: 0.1
    },
    contrast: {
        versePitchOffset: -7,
        verseDensityMultiplier: 0.5, // Very sparse verses (build-ups)
        chorusPitchOffset: 12 // Huge drop
    },
    modulation: {
        probability: 0.0,
        targetSection: 'Final_Chorus',
        intervalPool: []
    },
    orchestration: {
        melodyInstruments: ['Lead_2_sawtooth', 'Pad_1_new_age', 'Lead_1_square'],
        chordInstruments: ['Pad_1_new_age', 'Pad_3_polysynth', 'String_Ensemble'],
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Pad_1_new_age', 'Lead_2_sawtooth'],
        texturePool: ['Pad', 'Arpeggio', 'Rhythmic'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.9,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'trance',
            drumStyle: 'trance',
            stringStyle: 'electronic',
            pianoStyle: 'trance',
            humanizeAmount: 0.1 // 🌟 电子乐需要极高的量化精度
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
        allowedPersonas: ['Folk_Storyteller', 'RnB_Diva'] // Ethereal or powerful
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
        maxDissonanceTolerance: 0.1, // 极低的不和谐容忍度
        passingChords: [],
        reharmProbability: 0.0,
        voicingStyle: 'edm'
    },
    rhythm: {
        densityBase: [0.6, 0.8],
        syncopationWeight: 0.3,
        restProbability: 0.1,
        disruptionProbability: 0.1,
        humanize: 0.05, // Slight humanization for the 80s feel
        swingRatio: 0.5,
        strictGrid: true
    },
    melody: {
        stepwiseRatio: 0.6,
        maxJumpInterval: 7,
        tensionTolerance: 0.1, // 降低张力容忍度，确保旋律协和
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
        melodyInstruments: ['Synth_Brass_1', 'Lead_1_square', 'Lead_2_sawtooth'],
        chordInstruments: ['Synth_Brass_1', 'Pad_3_polysynth', 'Warm_EP'],
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2', 'Electric_Bass_Finger'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Lead_1_square', 'Synth_Brass_1'],
        texturePool: ['Rhythmic', 'Block', 'Arpeggio'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.6,
        outroRingOutProbability: 0.5,
        grooveRatio: { foundation: 0.9, comping: 0.2, color: 0.8 },
        idiomPreferences: {
            bassStyle: 'synthwave',
            drumStyle: 'synthwave',
            pianoStyle: 'electronic',
            humanizeAmount: 0.1 // 🌟 电子乐需要极高的量化精度
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

