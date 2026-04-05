import { StyleConfig, Tonality } from '../types';

export enum StyleId {
    Default = 0,
    PowerBallad = 1,
    RussianFolkBallad = 2
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.Default]: 'Default',
    [StyleId.PowerBallad]: 'Power Ballad',
    [StyleId.RussianFolkBallad]: 'Russian Folk Ballad'
};

export const DefaultStyleConfig: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
    masteringProfileId: 'Retro_Gadget', // 🌟 Apply Retro Gadget mastering profile by default
    global: {
        bpmRange: [80, 110], // 降低基础 BPM 范围，给 mood 调制留空间
        timeSignaturePool: [{ signature: [4, 4], weight: 1 }],
        tonalityPool: [{ tonality: Tonality.Major, weight: 1 }]
    },
    harmony: {
        chorusPool: [],
        versePool: [],
        preChorusPool: []
    },
    rhythm: {
        densityBase: [0.5, 0.5],
        syncopationWeight: 0.2,
        restProbability: 0.1,
        disruptionProbability: 0.1,
        humanize: 0.1
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.3,
        mutationProbability: 0.2,
        mutationPool: ['inversion'],
        sectionalRegisterProfile: {
            verse: [48, 60], // C3 to C4
            preChorus: [50, 62], // D3 to D4
            chorus: [55, 67], // G3 to G4
            solo: [60, 72] // C4 to C5
        },
        breathingRoomProbability: 0.5,
        callAndResponseProbability: 0.6
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1
    },
    modulation: {
        probability: 0,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    },
    orchestration: {
        melodyInstruments: ['Piano', 'Flute', 'Marimba', 'Violin', 'Flute', 'Piano'], // Piano/Flute 权重更高
        chordInstruments: ['Piano', 'Electric_Piano_1', 'String_Ensemble_1', 'Synth_Pad_1'],
        bassInstruments: ['Bass', 'Acoustic_Bass', 'Electric_Bass_Finger'],
        drumInstruments: ['Drums'],
        counterMelodyInstruments: ['Piano', 'Violin', 'Cello', 'String_Ensemble_1', 'Oboe'],
        texturePool: ['Block', 'Arpeggio', 'Pad', 'String_Ostinato'],
        allowDrumless: true,
        allowBassless: true,
        // 🌟 Define Instrument Behaviors for Retro Gadget style
        instrumentBehaviors: {
            melody: { pitchRange: [55, 79], velocityRange: [55, 85] }, // G3-G5, 主旋律（降低力度避免刺耳）
            secondaryMelody: { pitchRange: [48, 72], velocityRange: [45, 70] }, // C3-C5, 副旋律
            bass: { pitchRange: [28, 52], velocityRange: [80, 105] }, // E1-E3, Punchy but controlled
            chord: { pitchRange: [48, 72], velocityRange: [40, 65] }, // C3-C5, Darker/Pad-like, pushed back
            counterMelody: { pitchRange: [60, 84], velocityRange: [55, 80] } // C4-C6, Supportive
        },
        mixingPreferences: {
            chorusDepth: 64, // Add chorus for wider stereo image
            melody: { volume: -4, pan: 0, reverb: 0.4 }, // -4dB + 更多混响柔化高频
            vocal: { volume: -2, pan: 0, reverb: 0.35 }, // -2dB，vocal 作为第二主奏保持存在感
            chord: { volume: -5, reverb: 0.5 }, // -5dB 和弦伴奏
            bass: { volume: -2, pan: 0, reverb: 0.1 }, // -2dB 低音
            counterMelody: { volume: -6, reverb: 0.45 }, // -6dB 对位
            secondaryMelody: { volume: -6, reverb: 0.45 } // -6dB 副旋律
        }
    },
    performance: {
        allowedPersonas: []
    }
};

// ============================================================
// Power Ballad — 欧美力量大歌
// ============================================================
export const PowerBalladStyleConfig: StyleConfig = {
    id: StyleId.PowerBallad,
    name: 'Power Ballad',
    global: {
        bpmRange: [60, 90],
        timeSignaturePool: [{ signature: [4, 4], weight: 0.8 }, { signature: [6, 8], weight: 0.2 }],
        tonalityPool: [{ tonality: Tonality.Minor, weight: 0.6 }, { tonality: Tonality.Major, weight: 0.4 }]
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
        mutationPool: ['augmentation'],
        sectionalRegisterProfile: {
            verse: [45, 57],
            preChorus: [48, 62],
            chorus: [53, 67],
            solo: [58, 72]
        },
        breathingRoomProbability: 0.4
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
    },
    orchestration: {
        melodyInstruments: ['Piano', 'Piano', 'Violin', 'Flute'],
        chordInstruments: ['Piano', 'Piano', 'String_Ensemble_1', 'Acoustic_Guitar_Steel'],
        bassInstruments: ['Electric_Bass_Finger', 'Acoustic_Bass', 'Cello'],
        drumInstruments: ['Drums'],
        counterMelodyInstruments: ['String_Ensemble_1', 'String_Ensemble_1', 'Cello', 'Pad_1_NewAge'],
        texturePool: ['Block', 'Block', 'Arpeggio', 'Pad'],
        drumProbability: 0.9,
        counterMelodyProbability: 0.9,
        allowDrumless: true,
        allowBassless: false,
        allowRitardando: true,
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        instrumentBehaviors: {
            melody: { pitchRange: [50, 74], velocityRange: [50, 85] },
            secondaryMelody: { pitchRange: [45, 70], velocityRange: [40, 70] },
            bass: { pitchRange: [28, 52], velocityRange: [70, 95] },
            chord: { pitchRange: [45, 70], velocityRange: [35, 60] },
            counterMelody: { pitchRange: [55, 79], velocityRange: [45, 70] }
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.45, volume: -3 },
            vocal: { volume: -2, pan: 0, reverb: 0.4 },
            chord: { pan: -0.25, reverb: 0.5, volume: -5 },
            counterMelody: { pan: -0.5, reverb: 0.5, volume: -5 },
            drums: { reverb: 0.2, volume: -2 },
            bass: { reverb: 0.2, volume: -3 }
        }
    },
    performance: { allowedPersonas: [] }
};

// ============================================================
// Russian Folk Ballad — 俄式民谣 / 贝加尔湖畔
// ============================================================
export const RussianFolkBalladStyleConfig: StyleConfig = {
    id: StyleId.RussianFolkBallad,
    name: 'Russian Folk Ballad',
    global: {
        bpmRange: [62, 72],
        timeSignaturePool: [{ signature: [4, 4], weight: 0.7 }, { signature: [3, 4], weight: 0.3 }],
        tonalityPool: [{ tonality: Tonality.Minor, weight: 1.0 }]
    },
    harmony: {
        chorusPool: [
            ['i', 'iv', 'VII', 'III'],
            ['VI', 'ii', 'V', 'i'],
            ['iv', 'VII', 'III', 'VI']
        ],
        versePool: [
            ['i', 'v', 'VI', 'V'],
            ['i', 'iv', 'VI', 'V'],
            ['i', 'ii', 'V', 'i']
        ],
        preChorusPool: [
            ['iv', 'i', 'ii', 'V'],
            ['VI', 'VII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        allowTritoneSub: false,
        reharmProbability: 0.2,
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'standard'
    },
    rhythm: {
        densityBase: [0.25, 0.45],
        syncopationWeight: 0.05,
        restProbability: 0.40,
        disruptionProbability: 0.0,
        humanize: 0.04,
        swingRatio: 0.5
    },
    melody: {
        stepwiseRatio: 0.85,
        maxJumpInterval: 12,
        tensionTolerance: 0.30,
        mutationProbability: 0.20,
        mutationPool: ['inversion'],
        pentatonicPreference: 0.8,
        extensionPreference: 0.05,
        chromaticPassingProbability: 0.0,
        syncopationResolution: 'strict',
        sectionalRegisterProfile: {
            verse: [45, 57],
            preChorus: [48, 60],
            chorus: [52, 65],
            solo: [55, 67]
        },
        breathingRoomProbability: 0.5
    },
    contrast: {
        versePitchOffset: -5,
        verseDensityMultiplier: 0.7,
        chorusPitchOffset: 7
    },
    modulation: {
        probability: 0.40,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    },
    orchestration: {
        melodyInstruments: ['Piano', 'Piano', 'Flute', 'Violin'],
        chordInstruments: ['Acoustic_Guitar_Steel', 'Acoustic_Guitar_Steel', 'Piano'],
        bassInstruments: ['Acoustic_Bass', 'Cello', 'Contrabass'],
        drumInstruments: ['Drums'],
        counterMelodyInstruments: ['Voice_Oohs', 'String_Ensemble_1', 'Cello', 'Violin'],
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad'],
        drumProbability: 0.2,
        counterMelodyProbability: 0.7,
        allowDrumless: true,
        allowBassless: true,
        allowRitardando: true,
        grooveRatio: { foundation: 0.4, comping: 0.5, color: 0.6 },
        instrumentBehaviors: {
            melody: { pitchRange: [48, 72], velocityRange: [45, 75] },
            secondaryMelody: { pitchRange: [45, 67], velocityRange: [40, 65] },
            bass: { pitchRange: [28, 50], velocityRange: [65, 90] },
            chord: { pitchRange: [45, 67], velocityRange: [30, 55] },
            counterMelody: { pitchRange: [55, 76], velocityRange: [40, 65] }
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.5, volume: -3 },
            vocal: { volume: -2, pan: 0, reverb: 0.45 },
            chord: { pan: -0.3, reverb: 0.55, volume: -5 },
            counterMelody: { pan: -0.5, reverb: 0.5, volume: -5 },
            drums: { reverb: 0.25, volume: -3 },
            bass: { reverb: 0.25, volume: -3 }
        }
    },
    performance: { allowedPersonas: [] }
};
