import { StyleConfig } from '../../types';


export const LofiHipHopStyle: StyleConfig = {
    id: 'lofi_hiphop',
    name: '低保真嘻哈 (Lo-Fi Hip Hop)',
    global: {
        bpmRange: [65, 85], // 慵懒、放松的节奏
        timeSignaturePool: [
            { signature: [4, 4], weight: 1.0 } // 几乎全是 4/4 拍
        ],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.7 }, // 忧郁、怀旧
            { tonality: 'Major', weight: 0.3 }
        ]
    },
    harmony: {
        chorusPool: [
            ['ii', 'V', 'I', 'vi'], // 爵士 2-5-1
            ['IV', 'iii', 'ii', 'I'], // 下行级进，极度放松
            ['vi', 'IV', 'I', 'V']
        ],
        versePool: [
            ['ii', 'V', 'I', 'I'], // 循环 2-5-1
            ['IV', 'V', 'iii', 'vi']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.8, // 大量使用 7、9、11 音等爵士和弦色彩
        reharmProbability: 0.3,
        borrowedChords: ['SecondaryDominant', 'TritoneSubstitution'] // 三全音替代、次属和弦
    },
    rhythm: {
        densityBase: [0.3, 0.6], // 节奏稀疏，留白多
        syncopationWeight: 0.6, // 大量切分，制造 Groove
        restProbability: 0.3, // 旋律经常停顿
        disruptionProbability: 0.1,
        humanize: 0.8, // 极高的拟人化，模拟手指敲击 MPC 的微弱不准
        swingRatio: 0.6 // 强烈的 Swing 感，Dilla Feel
    },
    melody: {
        stepwiseRatio: 0.6,
        maxJumpInterval: 7,
        tensionTolerance: 0.7, // 允许旋律音与和弦产生摩擦（如 11音、13音）
        mutationProbability: 0.2,
        mutationPool: ['retrograde']
    },
    orchestration: {
        melodyInstruments: ['Electric_Piano_1', 'Electric_Piano_1', 'Vibraphone', 'Vibraphone', 'Acoustic_Guitar_Nylon', 'Muted_Trumpet'], // 经典 Lo-Fi 音色
        chordInstruments: ['Electric_Piano_1', 'Electric_Piano_1', 'Electric_Piano_2', 'Electric_Piano_2', 'Pad_2_warm'], // Rhodes 或 Wurlitzer 铺底
        bassInstruments: ['Acoustic_Bass', 'Acoustic_Bass', 'Electric_Bass_finger'], // 温暖、低沉的贝斯
        drumInstruments: ['Standard_DrumKit', 'Standard_DrumKit', 'Electronic_Drum'], // 采样感重的鼓
        counterMelodyInstruments: ['Music_Box', 'Music_Box', 'Glockenspiel', 'Ocarina', 'Electric_Piano_1'], // 增加童真、怀旧感
        texturePool: ['Block', 'Block', 'Block', 'Pad'], // 以柱式和弦为主，极少琶音
        drumProbability: 1.0, // 鼓是核心
        counterMelodyProbability: 0.3, // 偶尔有副旋律点缀
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'jazz', // 贝斯走位偏爵士
            drumStyle: 'lofi' // 专属的 lofi 鼓组律动
        }
    },
    performance: {
        allowedPersonas: ['Jazz_Cat', 'Rhythm_Master']
    },
    contrast: {
        chorusPitchOffset: 2, // 副歌变化不大，保持平稳情绪
        verseDensityMultiplier: 0.8,
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.0, // Lo-Fi 极少转调，通常是一个 Loop 循环到底
        targetSection: 'Chorus',
        intervalPool: []
    }
};


export const ProgressiveHouseStyle: StyleConfig = {
    id: 'progressive_house',
    name: '前卫浩室 (Progressive House)',
    global: {
        bpmRange: [120, 128], // 经典 House 速度
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.8 }, // 80% 小调，忧郁深邃
            { tonality: 'Dorian', weight: 0.2 } // 20% 多利亚调式，带点神秘感
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'], // 史诗感进行
            ['IV', 'I', 'V', 'vi'], // 经典 EDM 走向
            ['vi', 'V', 'IV', 'IV'], // 悬念感
            ['i', 'VII', 'VI', 'v'] // 纯小调下行
        ], 
        versePool: [
            ['vi', 'vi', 'IV', 'IV'], // 铺垫感
            ['i', 'i', 'v', 'v'], // 极简
            ['vi', 'V', 'vi', 'V'], // 徘徊
            ['IV', 'IV', 'vi', 'vi'] // 期待感
        ],
        preChorusPool: [
            ['IV', 'V', 'vi', 'V'], // 情绪爬升
            ['ii', 'IV', 'vi', 'V'],
            ['IV', 'IV', 'V', 'V'] // 明显的推向高潮
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5, // 保持和弦相对干净，突出律动和旋律
        reharmProbability: 0.05, // 很少使用复杂和弦替换
        borrowedChords: [] 
    },
    rhythm: {
        densityBase: [0.7, 0.9], // 节奏紧凑
        syncopationWeight: 0.8, // 强烈的切分音，House 的灵魂
        restProbability: 0.1, // 较少休止，保持律动连续性
        disruptionProbability: 0.05,
        humanize: 0.02, // 电子乐需要精准，稍微带一点点人性化即可
        swingRatio: 0.1 // 轻微的 Swing 增加 Groove
    },
    melody: {
        stepwiseRatio: 0.7, // 70% 级进，蓄力
        maxJumpInterval: 12, // 允许八度大跳
        tensionTolerance: 0.3,
        mutationProbability: 0.2,
        mutationPool: ['inversion', 'augmentation'],
        pentatonicPreference: 0.7, // 电子乐旋律通常比较简单，偏向五声或小调音阶
        extensionPreference: 0.2,  // 偶尔使用 9 音增加色彩
        chromaticPassingProbability: 0.1, // 较少使用半音
        syncopationResolution: 'strict' // 电子乐律动需要精准解决
    },
    orchestration: {
        melodyInstruments: ['Synth_Lead', 'Square_Wave', 'Saw_Wave', 'Pluck_Synth'], // 纯电音主导，移除钢琴
        chordInstruments: ['Pad_3_Polysynth', 'Synth_Brass', 'Square_Wave'], // 铺底与琶音
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2'], // 纯电子贝斯
        drumInstruments: ['Electronic_DrumKit'], // 纯电子鼓
        counterMelodyInstruments: ['Pad_3_Polysynth', 'String_Ensemble', 'Saw_Wave'], // 氛围层或副旋律
        texturePool: ['Arpeggio', 'Pulsing', 'Pad'], // 强调 16分音符琶音 (Stranger Things 风格) 和 脉冲
        drumProbability: 1.0,
        counterMelodyProbability: 1.0, // 100% 概率出现副旋律/Pad，保证编制丰满 (至少3-4件乐器)
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'electronic', // 电子贝斯律动
            drumStyle: 'electronic' // 电子鼓律动 (Four-on-the-floor)
        }
    },
    performance: {
        allowedPersonas: ['Electronic_Producer'] // 纯电音制作人，精准无装饰
    },
    contrast: {
        chorusPitchOffset: 7, // 副歌音高大幅提升，制造 Epic 感
        verseDensityMultiplier: 0.6, // 主歌节奏稀疏
        versePitchOffset: -5 // 主歌音高压低
    },
    modulation: {
        probability: 0.0, // House 极少转调，靠音色和层次推动
        targetSection: 'Final_Chorus',
        intervalPool: []
    }
};


export const SynthwaveStyle: StyleConfig = {
    id: 'synthwave',
    name: '合成器波 (Synthwave / Cyberpunk)',
    global: {
        bpmRange: [100, 130], // 80年代复古电子舞曲速度
        timeSignaturePool: [
            { signature: [4, 4], weight: 1.0 } // 绝对的 4/4 拍，强烈的四四拍律动
        ],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.9 }, // 赛博朋克、霓虹灯的暗黑感
            { tonality: 'Major', weight: 0.1 }
        ]
    },
    harmony: {
        chorusPool: [
            ['vi', 'IV', 'I', 'V'], // 经典史诗进行
            ['i', 'bVI', 'bIII', 'bVII'], // 小调经典下行
            ['i', 'v', 'bVI', 'IV'] // 偏暗黑深邃
        ],
        versePool: [
            ['i', 'i', 'bVI', 'bVI'], // 两个和弦循环，营造紧张感
            ['vi', 'vi', 'IV', 'IV']
        ],
        preChorusPool: [
            ['IV', 'V', 'vi', 'V'], // 情绪爬升
            ['bVI', 'bVII', 'i', 'i']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.3, // 和弦相对简单，主要靠音色和琶音堆叠
        reharmProbability: 0.1,
        borrowedChords: ['ModalMixture'] // 偶尔借用同主音调和弦
    },
    rhythm: {
        densityBase: [0.6, 0.9], // 密集的十六分音符琶音和贝斯
        syncopationWeight: 0.3, // 旋律有切分，但贝斯和鼓非常稳
        restProbability: 0.05, // 几乎没有留白，音墙填满
        disruptionProbability: 0.0, // 极度机械、精准
        humanize: 0.0, // 0 拟人化，完全的机器感、量化感
        swingRatio: 0 // 绝对的 Straight 节奏
    },
    melody: {
        stepwiseRatio: 0.5,
        maxJumpInterval: 12, // 经常有八度大跳（典型的合成器 Lead 旋律）
        tensionTolerance: 0.4,
        mutationProbability: 0.2,
        mutationPool: ['augmentation', 'diminution']
    },
    orchestration: {
        melodyInstruments: ['Lead_2_sawtooth', 'Lead_1_square', 'Lead_8_bass_and_lead'], // 锯齿波、方波主音
        chordInstruments: ['Pad_2_warm', 'Pad_1_new_age', 'Synth_Brass_1'], // 温暖的模拟合成器 Pad 或 Brass
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2'], // 极具攻击性的合成器贝斯
        drumInstruments: ['Electronic_Drum', 'Synth_Drum'], // 80年代鼓机（如 808, LinnDrum）
        counterMelodyInstruments: ['Lead_8_bass_and_lead', 'Lead_2_sawtooth'], // 琶音器 (Arpeggiator) 专用音色
        texturePool: ['Arpeggio', 'Pad'], // 核心：十六分音符琶音 + 柱式 Pad
        drumProbability: 1.0, // 鼓是核心驱动力
        counterMelodyProbability: 0.9, // 几乎全程都有 16 分音符的琶音在跑
        idiomPreferences: {
            stringStyle: 'pop',
            bassStyle: 'edm', // 持续的八分音符或十六分音符根音轰炸
            drumStyle: 'edm' // Four-on-the-floor 律动
        }
    },
    performance: {
        allowedPersonas: ['Rhythm_Master', 'Rock_Star'] // 充满能量的演奏
    },
    contrast: {
        chorusPitchOffset: 12, // 副歌主音拔高八度，能量爆发
        verseDensityMultiplier: 0.5, // 主歌减少琶音，副歌火力全开
        versePitchOffset: -12
    },
    modulation: {
        probability: 0.1, // 偶尔转调提升能量
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2] // 半音或全音转调
    }
};

