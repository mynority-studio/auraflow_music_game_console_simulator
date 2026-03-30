import { StyleConfig } from '../../types';

export const RussianFolkBalladStyle: StyleConfig = {
    id: 'russian_folk',
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
        borrowedChords: ['ModalMixture']
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
        bassInstruments: ['Acoustic_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Voice_Oohs', 'String_Ensemble', 'String_Ensemble', 'Pad_3_Polysynth'],
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad'], // 民谣的灵魂：吉他分解和弦 (Arpeggio) 和铺底 (Pad)
        drumProbability: 0.2, // 民谣很少用鼓
        counterMelodyProbability: 0.6, // 增加弦乐或人声铺垫的概率
        idiomPreferences: {
            stringStyle: 'folk',
            pianoStyle: 'pop',
            drumStyle: 'folk',
            bassStyle: 'folk'
        }
    },
    performance: {
        allowedPersonas:['Folk_Storyteller'] // 李健式的沉稳述说，无转音，长线条呼吸
    }
};
