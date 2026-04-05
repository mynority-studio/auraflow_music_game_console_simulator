import { StyleConfig, Tonality } from '../types';

export enum StyleId {
    Default = 0
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.Default]: 'Default'
};

export const DefaultStyleConfig: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
    masteringProfileId: 'Retro_Gadget', // 🌟 Apply Retro Gadget mastering profile by default
    global: {
        bpmRange: [100, 120],
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
        melodyInstruments: ['Piano', 'Violin', 'Flute', 'Saxophone'],
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
            vocal: { volume: -6, pan: 0, reverb: 0.45 }, // -6dB，vocal 作为第二声部退后
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
