import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const PowerBalladStyle: StyleConfig = {
    id: StyleId.PowerBallad,
    name: '欧美力量大歌 (Power Ballad)',
    global: {
        bpmRange: [60, 95], // 极慢到中慢，给巨肺留出空间
        timeSignaturePool: [{ signature: [4, 4], weight: 0.8 }, { signature: [6, 8], weight: 0.2 }], // 偶尔有 6/8 拍大歌
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.6 },
            { tonality: Tonality.Major, weight: 0.4 }
        ]
    },
    harmony: {
        chorusPool: [
            ['I', 'V', 'vi', 'IV'], // 欧美最经典的 1564 (Adele - Someone Like You)
            ['vi', 'IV', 'I', 'V'], // 6415 史诗感
            ['I', 'IV', 'vi', 'V'], // 经典大调
            ['i', 'VI', 'III', 'VII'] // 欧美小调经典
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
        maxDissonanceTolerance: 0.3, // 欧美流行大歌和声相对简单直接
        reharmProbability: 0.1, 
        passingChords: ['SecondaryDominant'],
        borrowedChords: ['ModalMixture']
    },
    rhythm: {
        densityBase: [0.3, 0.6], // 极度留白，靠长音支撑
        syncopationWeight: 0.2,  // 节奏稳重
        restProbability: 0.2,
        disruptionProbability: 0.05,
        humanize: 0.2, // 极高的人性化，强调情感起伏
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.5,
        maxJumpInterval: 12, // 允许八度甚至十度大跳，展现唱功
        tensionTolerance: 0.2,
        mutationProbability: 0.1,
        mutationPool: ['augmentation'] // 旋律拉长
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Warm_EP', 'String_Ensemble'],
        chordInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Warm_EP', 'Acoustic_Guitar_Chord'],
        bassInstruments: ['Electric_Bass', 'Acoustic_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['String_Ensemble', 'String_Ensemble', 'Pad_3_Polysynth'],
        texturePool: ['Block', 'Block', 'Arpeggio', 'Pad'], // 柱式和弦砸下去的力量感
        drumProbability: 0.9, // 主歌经常没有鼓
        counterMelodyProbability: 0.9, // 弦乐铺底是灵魂
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'pop',
            drumStyle: 'pop'
        }
    },
    performance: {
        allowedPersonas: ['Soul_Singer', 'RnB_Diva'] // 灵魂歌手，巨肺
    },
    contrast: {
        chorusPitchOffset: 9, // 极端的副歌音高提升，情绪彻底爆发
        verseDensityMultiplier: 0.5, // 主歌极度克制
        versePitchOffset: -4 // 主歌低语
    },
    modulation: {
        probability: 0.3, // 欧美大歌偶尔也会升调
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    }
};
