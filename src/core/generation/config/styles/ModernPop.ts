import { StyleConfig } from '../../types';

export const ModernPopStyle: StyleConfig = {
    id: 'modern_pop',
    name: '现代华语流行 (Modern C-Pop)',
    global: {
        bpmRange: [75, 115], // 抒情到中板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Major', weight: 0.7 },
            { tonality: 'Minor', weight: 0.3 }
        ]
    },
    harmony: {
        chorusPool: [
            ['IV', 'V', 'iii', 'vi'], // 4536251 的核心，华语流行密码 (林俊杰、周杰伦常用)
            ['vi', 'IV', 'I', 'V'],   // 6415 流行摇滚/大歌走向 (五月天、华晨宇)
            ['I', 'V', 'vi', 'iii'],  // 卡农进行前半段 (周杰伦最爱)
            ['I', 'vi', 'IV', 'V']    // 经典流行
        ], 
        versePool: [
            ['I', 'V', 'vi', 'iii'],  // 卡农进行
            ['I', 'vi', 'IV', 'V'],
            ['vi', 'iii', 'IV', 'I'],
            ['ii', 'V', 'I', 'vi']
        ],
        preChorusPool: [
            ['ii', 'V', 'iii', 'vi'], // 经典的预副歌推升
            ['IV', 'V', 'vi', 'vi'],
            ['IV', 'V', 'I', 'I']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.4, // 华语流行旋律通常比较和谐、入耳
        reharmProbability: 0.2, 
        borrowedChords: ['ModalMixture'] // 偶尔借用小四和弦等离调和弦 (流行歌常见催泪点)
    },
    rhythm: {
        densityBase: [0.4, 0.7], // 主歌抒情留白，副歌密集
        syncopationWeight: 0.4,  // 适度切分，不太过Funk
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.1,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.7, // 华语流行旋律线条连贯、优美
        maxJumpInterval: 12, // 允许八度大跳 (情绪爆发)
        tensionTolerance: 0.1,
        mutationProbability: 0.2,
        mutationPool: ['inversion', 'augmentation']
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'String_Ensemble', 'Warm_EP'],
        chordInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Acoustic_Guitar_Chord', 'Warm_EP'],
        bassInstruments: ['Electric_Bass', 'Fretless_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['String_Ensemble', 'String_Ensemble', 'Pad_1_New_age', 'Pad_3_Polysynth'],
        texturePool: ['Arpeggio', 'Arpeggio', 'Block', 'Pad'], // 钢琴琶音和柱式和弦为主
        drumProbability: 1.0,
        counterMelodyProbability: 0.9, // 弦乐铺底非常重要
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'pop',
            drumStyle: 'pop'
        }
    },
    performance: {
        allowedPersonas: ['C_Pop_Balladeer', 'RnB_Diva']
    },
    contrast: {
        chorusPitchOffset: 7, // 副歌音高显著提升，情绪爆发
        verseDensityMultiplier: 0.6, // 主歌更稀疏
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.4, // 40% 概率在最后一段副歌升调 (华语流行经典套路)
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2] // 升半音或全音
    }
};
