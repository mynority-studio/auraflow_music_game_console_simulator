import { StyleConfig } from '../../types';

export const PopRockStyle: StyleConfig = {
    id: 'pop_rock',
    name: '流行摇滚 (Pop Rock)',
    global: {
        bpmRange: [110, 140],
        timeSignaturePool: [
            { signature: [4, 4], weight: 0.8 },
            { signature: [8, 8], weight: 0.2 }
        ],
        tonalityPool: [
            { tonality: 'Major', weight: 0.8 },
            { tonality: 'Minor', weight: 0.2 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'],   // 经典的流行摇滚进行
            ['I', 'V', 'vi', 'IV'],   // 流行朋克常用
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
        borrowedChords: ['ModalMixture'] 
    },
    rhythm: {
        densityBase: [0.6, 0.9], // 密集的8分音符驱动
        syncopationWeight: 0.2,  // 摇滚相对方正，强调正拍和反拍的稳定交替
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
        melodyInstruments: ['Overdriven_Guitar', 'Overdriven_Guitar', 'Electric_Guitar_Clean', 'Rock_Organ'],
        chordInstruments: ['Overdriven_Guitar', 'Overdriven_Guitar', 'Distortion_Guitar', 'Electric_Guitar_Clean'],
        bassInstruments: ['Electric_Bass', 'Electric_Bass', 'Slap_Bass_1'],
        drumInstruments: ['Standard_DrumKit', 'Standard_DrumKit', 'Room_DrumKit'],
        counterMelodyInstruments: ['Rock_Organ', 'Rock_Organ', 'Electric_Guitar_Clean', 'String_Ensemble'],
        texturePool: ['Block', 'Block', 'Pulsing'], // 柱式和弦和脉冲(8分音符扫弦)为主
        drumProbability: 1.0,
        counterMelodyProbability: 0.7, 
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'rock',
            drumStyle: 'rock'
        }
    },
    performance: {
        allowedPersonas: ['Rock_Star', 'C_Pop_Balladeer']
    },
    contrast: {
        chorusPitchOffset: 7, // 副歌极具爆发力
        verseDensityMultiplier: 0.5, // 主歌吉他可以分解和弦，副歌扫弦
        versePitchOffset: -4
    },
    modulation: {
        probability: 0.3, 
        targetSection: 'Final_Chorus',
        intervalPool: [2] // 升全音
    }
};
