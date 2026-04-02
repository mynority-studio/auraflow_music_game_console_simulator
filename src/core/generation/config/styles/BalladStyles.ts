import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';

export const PowerBalladStyle: StyleConfig = {
    id: StyleId.PowerBallad,
    name: '欧美力量大歌 (Power Ballad)',
    global: {
        bpmRange: [60, 95], // 极慢到中慢，给巨肺留出空间
        timeSignaturePool: [{ signature: [4, 4], weight: 0.8 }, { signature: [6, 8], weight: 0.2 }], // 偶尔有 6/8 拍大歌
        tonalityPool: [
            { tonality: 'Minor', weight: 0.6 },
            { tonality: 'Major', weight: 0.4 }
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
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'standard'
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
        bassInstruments: ['Electric_Bass_Finger', 'Acoustic_Bass', 'Fretless_Bass', 'Cello'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['String_Ensemble', 'String_Ensemble', 'Pad_3_Polysynth'],
        texturePool: ['Block', 'Block', 'Arpeggio', 'Pad'], // 柱式和弦砸下去的力量感
        drumProbability: 0.9, // 主歌经常没有鼓
        counterMelodyProbability: 0.9, // 弦乐铺底是灵魂
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'steady',
            drumStyle: 'steady'
        },
        mixingPreferences: {
            melody: { pan: 0.1, reverb: 0.4 },
            chord: { pan: -0.25, reverb: 0.5, volume: -3.0 },
            counterMelody: { pan: -0.6, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { reverb: 0.2, volume: -3.0 }
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


export const RussianFolkBalladStyle: StyleConfig = {
    id: StyleId.RussianFolkBallad,
    name: '俄式民谣/贝加尔湖畔 (Russian Acoustic Ballad)',
    global: {
        bpmRange: [62, 72], 
        timeSignaturePool:[{ signature: [4, 4], weight: 0.7 }, { signature: [3, 4], weight: 0.3 }],
        tonalityPool:[{ tonality: 'Minor', weight: 1.0 }] // 100% 纯小调
    },
    harmony: {
        chorusPool: [['i', 'iv', 'bVII', 'bIII'],['bVI', 'ii7', 'V7', 'i'],['iv', 'bVII', 'bIII', 'bVI', 'ii7', 'V7', 'i', 'i']], 
        versePool: [['i', 'v', 'bVI', 'V7'], ['i', 'iv', 'bVI', 'V7'],['i', 'ii7', 'V7', 'i']],
        preChorusPool:[['iv', 'i', 'ii7', 'V7'], ['bVI', 'bVII', 'i', 'i']]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3,
        passingChords: ['SecondaryDominant', 'Diminished7'],
        allowTritoneSub: false,
        reharmProbability: 0.2,
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'standard'
    },
    rhythm: { densityBase:[0.25, 0.45], syncopationWeight: 0.05, restProbability: 0.40, disruptionProbability: 0.0, humanize: 0.04, swingRatio: 0.5 },
    melody: { 
        stepwiseRatio: 0.85, 
        maxJumpInterval: 12, 
        tensionTolerance: 0.30, 
        mutationProbability: 0.20, 
        mutationPool:['inversion'],
        pentatonicPreference: 0.8, // 民谣极度偏好五声音阶（小调五声）
        extensionPreference: 0.05, // 极少使用延伸音，保持纯粹
        chromaticPassingProbability: 0.0, // 几乎不用半音经过
        syncopationResolution: 'strict' // 律动规整，娓娓道来
    },
    contrast: { versePitchOffset: -5, verseDensityMultiplier: 0.7, chorusPitchOffset: 7 },
    modulation: { probability: 0.40, targetSection: 'Final_Chorus', intervalPool: [1, 2] },
    
    // 🌟 V2.0 新增：民谣的编曲与演唱基因
    orchestration: {
        melodyInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Warm_EP', 'Lofi_Piano'], // 目前主奏只用钢琴
        chordInstruments: ['Acoustic_Guitar_Chord', 'Acoustic_Guitar_Chord', 'Acoustic_Grand'], // 木吉他扫弦或原声钢琴
        bassInstruments: ['Acoustic_Bass', 'Cello', 'Contrabass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Voice_Oohs', 'String_Ensemble', 'String_Ensemble', 'Pad_3_Polysynth'],
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad'], // 民谣的灵魂：吉他分解和弦 (Arpeggio) 和铺底 (Pad)
        drumProbability: 0.2, // 民谣很少用鼓
        counterMelodyProbability: 0.6, // 增加弦乐或人声铺垫的概率
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            pianoStyle: 'arpeggiated',
            drumStyle: 'sparse',
            bassStyle: 'sparse'
        },
        mixingPreferences: {
            melody: { pan: 0.1, reverb: 0.4 },
            chord: { pan: -0.25, reverb: 0.5, volume: -3.0 },
            counterMelody: { pan: -0.6, volume: -4.0 },
            drums: { reverb: 0.2, volume: -1.0 },
            bass: { reverb: 0.2, volume: -3.0 }
        }
    },
    performance: {
        allowedPersonas:['Folk_Storyteller'] // 李健式的沉稳述说，无转音，长线条呼吸
    }
};

