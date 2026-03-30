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


export const ModernJPopStyle: StyleConfig = {
    id: 'modern_jpop',
    name: '现代日系流行 (Modern J-Pop)',
    global: {
        bpmRange: [120, 175], // 极快，米津玄师/YOASOBI 风格
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.7 },
            { tonality: 'Major', weight: 0.3 }
        ]
    },
    harmony: {
        chorusPool: [
            ['IV', 'V', 'iii', 'vi'], // 王道进行 (Oudou Shinkou)
            ['vi', 'IV', 'I', 'V'],   // 小室进行 (Komuro Progression)
            ['IV', 'V', 'vi', 'vi'],
            ['ii', 'V', 'I', 'vi']
        ], 
        versePool: [
            ['vi', 'IV', 'V', 'I'],
            ['IV', 'V', 'iii', 'vi'],
            ['vi', 'ii', 'V', 'I'],
            ['i', 'VI', 'VII', 'III']
        ],
        preChorusPool: [
            ['IV', 'V', 'iii', 'vi'],
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'V', 'I', 'I']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.6, // 允许更多和弦外音和色彩和弦
        reharmProbability: 0.4, 
        passingChords: ['SecondaryDominant', 'Diminished7'], // 频繁使用副属和弦
        borrowedChords: ['ModalMixture'] 
    },
    rhythm: {
        densityBase: [0.7, 0.95], // 极高密度的音符
        syncopationWeight: 0.8,   // 大量切分音，律动感极强
        restProbability: 0.05,
        disruptionProbability: 0.1,
        humanize: 0.05, // 偏向电子化、精准的节奏
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.5, // 旋律跳跃性强
        maxJumpInterval: 14, // 经常有大跳
        tensionTolerance: 0.3,
        mutationProbability: 0.4,
        mutationPool: ['inversion', 'truncation']
    },
    orchestration: {
        melodyInstruments: ['Synth_Lead', 'Synth_Lead', 'Acoustic_Grand', 'Clean_Guitar'],
        chordInstruments: ['Clean_Guitar', 'Clean_Guitar', 'Acoustic_Grand', 'Synth_Lead'],
        bassInstruments: ['Electric_Bass', 'Synth_Bass_1'], // 经常使用Slap Bass或合成贝斯
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: ['Synth_Lead', 'Pad_3_Polysynth', 'String_Ensemble'],
        texturePool: ['Rhythmic', 'Arpeggio', 'Block'], // 强烈的节奏型织体
        drumProbability: 1.0,
        counterMelodyProbability: 0.8,
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'funk', // 偏向Funk的贝斯律动
            drumStyle: 'pop'
        }
    },
    performance: {
        allowedPersonas: ['RnB_Diva', 'C_Pop_Balladeer'] // 需要爆发力和节奏感强的女声
    },
    contrast: {
        chorusPitchOffset: 6,
        verseDensityMultiplier: 0.8,
        versePitchOffset: -3
    },
    modulation: {
        probability: 0.6, // J-Pop 极其喜欢转调
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    }
};


export const DarkPopStyle: StyleConfig = {
    id: 'dark_pop',
    name: '暗黑流行 (Dark Pop)',
    global: {
        bpmRange: [90, 125], // 中板，强调律动和低频
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.9 },
            { tonality: 'Dorian', weight: 0.1 }
        ]
    },
    harmony: {
        chorusPool: [
            ['i', 'iv', 'v', 'i'], // 极简小调
            ['i', 'VI', 'III', 'VII'], // 欧美暗黑经典
            ['i', 'i', 'iv', 'v'], // 极度静态
            ['i', 'VII', 'VI', 'V'] // 安达卢西亚进行 (Billie Eilish 爱用)
        ], 
        versePool: [
            ['i', 'i', 'i', 'i'], // 主歌几乎不换和弦，靠Bassline驱动
            ['i', 'i', 'iv', 'i'],
            ['i', 'VI', 'i', 'VI'],
            ['i', 'v', 'i', 'v']
        ],
        preChorusPool: [
            ['VI', 'VII', 'i', 'i'],
            ['iv', 'v', 'i', 'i'],
            ['VI', 'iv', 'V', 'V']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.8, // 允许极度不和谐音 (如小二度摩擦)
        reharmProbability: 0.05, // 和声极简
        passingChords: ['Diminished7'], // 偶尔用减七制造诡异感
        borrowedChords: ['Neapolitan'] // 降二级和弦，极度黑暗
    },
    rhythm: {
        densityBase: [0.3, 0.6], // 极度稀疏，大量留白
        syncopationWeight: 0.7,  // 诡异的切分
        restProbability: 0.4, // 经常突然停顿 (Drop)
        disruptionProbability: 0.2, // 节奏错位
        humanize: 0.05, // 冰冷的机器感
        swingRatio: 0.3 // 偶尔带点怪异的Swing
    },
    melody: {
        stepwiseRatio: 0.8, // 旋律多为级进或同音反复 (呢喃感)
        maxJumpInterval: 7, // 很少大跳
        tensionTolerance: 0.6, // 允许停留在不和谐音上
        mutationProbability: 0.1,
        mutationPool: ['truncation'] // 旋律经常被突然切断
    },
    orchestration: {
        melodyInstruments: ['Warm_EP', 'Warm_EP', 'Synth_Lead', 'Acoustic_Grand'], // 经常是闷闷的电钢琴或诡异的合成器
        chordInstruments: ['Pad_3_Polysynth', 'Pad_3_Polysynth', 'Warm_EP', 'Clean_Guitar'],
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_1', 'Electric_Bass'], // 灵魂：极低极重的 Sub Bass
        drumInstruments: ['Standard_DrumKit'], // 最好是 Lofi 或电子鼓，这里用 Standard 替代
        counterMelodyInstruments: ['Synth_Lead', 'Pad_3_Polysynth'],
        texturePool: ['Rhythmic', 'Pad', 'Block'], // 极简织体
        drumProbability: 0.8, // 经常有无鼓的段落
        counterMelodyProbability: 0.3, // 极少副旋律，保持空旷
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'funk', // 贝斯是主角
            drumStyle: 'pop'
        }
    },
    performance: {
        allowedPersonas: ['Folk_Storyteller', 'RnB_Diva'] // 呢喃式唱腔，气声为主
    },
    contrast: {
        chorusPitchOffset: 2, // 副歌音高几乎不提升，靠低频和鼓组爆发 (Drop)
        verseDensityMultiplier: 0.6, // 主歌极度空旷
        versePitchOffset: -2 // 主歌极低
    },
    modulation: {
        probability: 0.0, // 暗黑流行几乎不转调
        targetSection: 'Final_Chorus',
        intervalPool: []
    }
};

