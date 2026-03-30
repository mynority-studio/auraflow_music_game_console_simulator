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


export const IndieRockStyle: StyleConfig = {
    id: 'indie_rock',
    name: '独立摇滚 (Indie Rock)',
    global: {
        bpmRange: [120, 160], // 速度偏快，有跳跃感
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Major', weight: 0.4 },
            { tonality: 'Minor', weight: 0.6 } // 偏向小调或混合调式
        ]
    },
    harmony: {
        chorusPool: [
            ['i', 'VI', 'III', 'VII'], // 小调经典
            ['VI', 'VII', 'i', 'v'],
            ['I', 'vi', 'IV', 'V']
        ], 
        versePool: [
            ['i', 'iv', 'v', 'i'],
            ['I', 'IV', 'I', 'V'],
            ['vi', 'IV', 'I', 'V']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i'],
            ['iv', 'v', 'VI', 'VII']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5, // 允许更多不协和音，如大七和弦、九和弦
        reharmProbability: 0.3, 
        borrowedChords: ['ModalMixture', 'SecondaryDominant'] 
    },
    rhythm: {
        densityBase: [0.5, 0.8], 
        syncopationWeight: 0.6,  // 较多切分，如16分音符的吉他Riff
        restProbability: 0.15,   // 鼓点和贝斯有停顿感
        disruptionProbability: 0.2,
        humanize: 0.2, // 更加生动、粗糙的演奏感
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.5, // 旋律跳跃感强
        maxJumpInterval: 14, 
        tensionTolerance: 0.4,
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde']
    },
    orchestration: {
        melodyInstruments: ['Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Lead_1_Square', 'Overdriven_Guitar'],
        chordInstruments: ['Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Electric_Guitar_Jazz', 'Clavinet'],
        bassInstruments: ['Picked_Bass', 'Picked_Bass', 'Electric_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Electric_Guitar_Clean', 'Electric_Guitar_Clean', 'Lead_2_Sawtooth', 'Synth_Brass_1'],
        texturePool: ['Arpeggio', 'Pulsing', 'Rhythmic'], // 强调吉他分解和Riff
        drumProbability: 1.0,
        counterMelodyProbability: 0.8, // 双吉他交织
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'rock',
            drumStyle: 'rock'
        }
    },
    performance: {
        allowedPersonas: ['Indie_Rocker', 'Rock_Star']
    },
    contrast: {
        chorusPitchOffset: 5, 
        verseDensityMultiplier: 0.7, 
        versePitchOffset: -3
    },
    modulation: {
        probability: 0.1, // 独立摇滚较少使用传统的升调
        targetSection: 'Final_Chorus',
        intervalPool: [2]
    }
};


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

