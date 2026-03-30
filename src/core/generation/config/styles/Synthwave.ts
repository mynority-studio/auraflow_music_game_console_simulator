import { StyleConfig } from '../../types';

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
