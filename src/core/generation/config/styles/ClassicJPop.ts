import { StyleConfig } from '../../types';

export const ClassicJPopStyle: StyleConfig = {
    id: 'classic_jpop',
    name: '昭和经典流行 (Classic J-Pop)',
    global: {
        bpmRange: [70, 105], // 抒情中慢板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.6 },
            { tonality: 'Major', weight: 0.4 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'ii', 'V', 'I'],   // 经典的 6251，玉置浩二常用
            ['IV', 'V', 'iii', 'vi'], // 王道进行
            ['iv', 'VII', 'III', 'VI'], // 小调五度循环
            ['I', 'vi', 'IV', 'V']
        ], 
        versePool: [
            ['I', 'vi', 'IV', 'V'],
            ['vi', 'iv', 'V', 'i'],
            ['vi', 'ii', 'V', 'I'],
            ['I', 'iii', 'IV', 'V']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'V', 'iii', 'vi'],
            ['ii', 'IV', 'V', 'V']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.3, 
        passingChords: ['SecondaryDominant', 'Diminished7'], // 昭和流行非常喜欢用副属和弦和减七和弦做过渡
        borrowedChords: ['ModalMixture']
    },
    rhythm: {
        densityBase: [0.5, 0.8],
        syncopationWeight: 0.3, // 相对规整
        restProbability: 0.1,
        disruptionProbability: 0.05,
        humanize: 0.15,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.6,
        maxJumpInterval: 12, // 情绪爆发时的大跳
        tensionTolerance: 0.2,
        mutationProbability: 0.2,
        mutationPool: ['inversion', 'augmentation']
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Warm_EP', 'Warm_EP', 'Alto_Sax'],
        chordInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Acoustic_Guitar_Chord', 'Warm_EP'],
        bassInstruments: ['Electric_Bass', 'Electric_Bass', 'Acoustic_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['String_Ensemble', 'String_Ensemble', 'Alto_Sax'],
        texturePool: ['Arpeggio', 'Arpeggio', 'Block', 'Pad'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.9, // 弦乐或萨克斯副旋律很常见
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'pop',
            drumStyle: 'pop'
        }
    },
    performance: {
        allowedPersonas: ['HK_Pop_King', 'C_Pop_Balladeer'] // 港台老歌深受昭和影响，唱腔类似
    },
    contrast: {
        chorusPitchOffset: 5,
        verseDensityMultiplier: 0.7,
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.5, // 极高概率在结尾升调
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    }
};
