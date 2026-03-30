import { StyleConfig } from '../../types';

export const PostRockStyle: StyleConfig = {
    id: 'post_rock',
    name: '后摇滚 (Post-Rock)',
    global: {
        bpmRange: [60, 100], // 速度偏慢，氛围感强
        timeSignaturePool: [
            { signature: [4, 4], weight: 0.7 },
            { signature: [6, 8], weight: 0.3 } // 6/8 拍在后摇中很常见
        ],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.8 },
            { tonality: 'Major', weight: 0.2 } // 忧郁、史诗感
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'], // 史诗感进行
            ['i', 'VI', 'III', 'VII'],
            ['IV', 'I', 'V', 'vi']
        ], 
        versePool: [
            ['vi', 'IV', 'vi', 'IV'], // 两个和弦来回交替，营造氛围
            ['i', 'VI', 'i', 'VI'],
            ['I', 'IV', 'I', 'IV']
        ],
        preChorusPool: [
            ['IV', 'IV', 'V', 'V'],
            ['VI', 'VI', 'VII', 'VII']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.6, // 允许更多延留音（sus4, sus2）和持续音（Pedal Point）
        reharmProbability: 0.05, 
        borrowedChords: ['ModalMixture'] 
    },
    rhythm: {
        densityBase: [0.2, 0.8], // 从极度稀疏到极度密集（音墙）
        syncopationWeight: 0.1,  // 节奏稳重，强调渐强
        restProbability: 0.2,    // 主歌大量留白
        disruptionProbability: 0.05,
        humanize: 0.1,
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.8, // 旋律非常连贯，类似弦乐线条
        maxJumpInterval: 8, 
        tensionTolerance: 0.5,
        mutationProbability: 0.1,
        mutationPool: ['augmentation']
    },
    orchestration: {
        melodyInstruments: ['Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Pad_3_Polysynth', 'String_Ensemble', 'Overdriven_Guitar'],
        chordInstruments: ['Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Acoustic_Grand', 'Pad_1_New_age', 'Overdriven_Guitar'],
        bassInstruments: ['Fretless_Bass', 'Electric_Bass'],
        drumInstruments: ['Standard_DrumKit', 'Room_DrumKit'],
        counterMelodyInstruments: ['Tremolo_Strings', 'Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Glockenspiel'],
        texturePool: ['Pad', 'Pad', 'Arpeggio'], // 氛围铺底和吉他分解
        drumProbability: 0.8, // 主歌可能没有鼓
        counterMelodyProbability: 0.9, // 强烈的复调感
        idiomPreferences: {
            stringStyle: 'cinematic',
            bassStyle: 'pop',
            drumStyle: 'rock'
        }
    },
    performance: {
        allowedPersonas: ['Cinematic_Composer', 'Rock_Star']
    },
    contrast: {
        chorusPitchOffset: 12, // 副歌（高潮）音高拔高一个八度，形成音墙
        verseDensityMultiplier: 0.3, // 主歌极度稀疏
        versePitchOffset: -5
    },
    modulation: {
        probability: 0.0, // 后摇极少转调，靠配器和力度堆叠情绪
        targetSection: 'Final_Chorus',
        intervalPool: []
    }
};
