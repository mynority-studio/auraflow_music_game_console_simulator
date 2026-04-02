import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const NeoSoulStyle: StyleConfig = {
    id: StyleId.NeoSoul,
    name: '新灵魂乐 (Neo-Soul)',
    global: {
        bpmRange: [70, 85], // 慵懒、律动感强的中慢板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.8 },
            { tonality: Tonality.Dorian, weight: 0.2 }
        ]
    },
    harmony: {
        chorusPool: [
            ['ii', 'V', 'I', 'vi'], // 经典 2-5-1
            ['IV', 'iii', 'ii', 'I'], // 下行级进
            ['vi', 'IV', 'I', 'V'],
            ['ii', 'v', 'i', 'IV']
        ], 
        versePool: [
            ['ii', 'V', 'I', 'I'],
            ['IV', 'V', 'iii', 'vi'],
            ['i', 'i', 'iv', 'v']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'V', 'vi', 'vi']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.8, // 极高，允许复杂的延伸音 (9, 11, 13)
        reharmProbability: 0.4, // 经常避开传统的 V-I 终止
        borrowedChords: ['SecondaryDominant', 'TritoneSubstitution', 'ModalMixture'],
        voicingStyle: 'neo-soul' // 触发高级声位排列 (如 5 over 1)
    },
    rhythm: {
        densityBase: [0.4, 0.7], 
        syncopationWeight: 0.8,  // 极强的切分感
        restProbability: 0.2,
        disruptionProbability: 0.1,
        humanize: 0.5, // 极高的人性化，Dilla Feel
        swingRatio: 0.4 // 明显的 Swing
    },
    melody: {
        stepwiseRatio: 0.6, 
        maxJumpInterval: 10, 
        tensionTolerance: 0.8, // 允许停留在 11音、13音等延伸音上
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde'],
        inflectionProbability: 0.7, // 大量使用倚音、转音
        pentatonicShiftProbability: 0.5 // 经常使用五声音阶错位 (如在大和弦上弹小调五声)
    },
    orchestration: {
        melodyInstruments: ['Electric_Piano_1', 'Electric_Piano_2', 'Vibraphone', 'Acoustic_Guitar_Nylon'],
        chordInstruments: ['Electric_Piano_1', 'Electric_Piano_2', 'Clavinet', 'Pad_2_warm'],
        bassInstruments: ['Acoustic_Bass', 'Electric_Bass_finger', 'Fretless_Bass'],
        drumInstruments: ['Standard_DrumKit', 'Electronic_Drum'],
        counterMelodyInstruments: ['Muted_Trumpet', 'Vibraphone', 'Electric_Piano_1'],
        texturePool: ['Block', 'Rhythmic', 'Octave_Melody_Bass'], // 引入八度旋律贝斯织体
        drumProbability: 1.0,
        counterMelodyProbability: 0.6, 
        idiomPreferences: {
            stringStyle: 'jazz',
            bassStyle: 'jazz',
            drumStyle: 'lofi'
        }
    },
    performance: {
        allowedPersonas: ['RnB_Diva', 'Soul_Singer', 'Jazz_Cat']
    },
    contrast: {
        chorusPitchOffset: 4, 
        verseDensityMultiplier: 0.7, 
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.2, 
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    }
};
