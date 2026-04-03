import { GenerationParams, Tonality } from '../types';
import { InstrumentId } from '../config/InstrumentFlags';

/** Lo-Fi Hip Hop 风格预设 — 极度低保真、磁带感、爵士颓废、伪侧链律动 */
export const LofiPreset: Partial<GenerationParams> = {
    global: {
        bpmRange: [70, 82] as [number, number],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.6 },
            { tonality: Tonality.Dorian, weight: 0.3 },
            { tonality: Tonality.Major, weight: 0.1 }
        ]
    },
    harmony: {
        chorusPool: [
            ['IV', 'iii', 'ii', 'I'],       // 下行叹息
            ['ii', 'V', 'I', 'vi'],          // 爵士 2516
            ['iv', 'bVII', 'III', 'VI']      // Nujabes 风格
        ],
        versePool: [
            ['IV', 'iii', 'ii', 'I'],
            ['ii', 'v', 'i', 'VI']           // 小属和弦(v)的颓废进行
        ],
        preChorusPool: [
            ['IV', 'IV', 'iii', 'vi']        // 平缓过渡
        ]
    },
    harmonyRules: {
        voicingStyle: 'jazz',
        reharmProbability: 0.6,
        maxDissonanceTolerance: 0.8,
        borrowedChords: ['ModalMixture', 'TritoneSubstitution'],
        globalProgressionProbability: 0.8,
    },
    rhythm: {
        densityBase: [0.2, 0.4] as [number, number],
        syncopationWeight: 0.7,
        restProbability: 0.45,
        disruptionProbability: 0.05,
        humanize: 0.9,
        swingRatio: 0.66,
        swingSubdivision: 0.5 as 0.5,
    },
    melody: {
        stepwiseRatio: 0.65,
        maxJumpInterval: 10,
        tensionTolerance: 0.5,
        mutationProbability: 0.1,
        mutationPool: ['inversion', 'augmentation'],
        pentatonicPreference: 0.3,
        chromaticPassingProbability: 0.4,
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 0.8,
        chorusPitchOffset: 0,
    },
    modulation: {
        probability: 0.0,
        targetSection: 'Final_Chorus',
        intervalPool: [1],
    },
    orchestration: {
        melodyInstruments: [InstrumentId.Electric_Piano_1, InstrumentId.Vibraphone, InstrumentId.Warm_EP],
        chordInstruments: [InstrumentId.Electric_Piano_1, InstrumentId.Electric_Piano_2],
        bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Acoustic_Bass],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Pad_2_Warm],
        drumMode: 'laid-back',
        bassMode: 'groove-lock',
        pianoMode: 'syncopated-comping',
        texturePool: ['Block', 'Arpeggio', 'Pad'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.3,
        fillStyle: 'micro',
        allowRitardando: false,
        grooveRatio: { foundation: 0.7, comping: 0.2, color: 0.1 },
        mixingPreferences: {
            requireSidechain: true,
            melody: { pan: 0, reverb: 0.5, delay: 0.1, volume: -4.0 },
            chord: { pan: -0.2, reverb: 0.2, volume: -4.0 },
            bass: { reverb: 0.0, volume: -1.0 },
            drums: { reverb: 0.1, volume: 0.0 },
            counterMelody: { pan: 0.3, reverb: 0.4, volume: -7.0 },
        }
    },
};
