import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const ProgressiveHouseStyle: StyleConfig = {
    id: StyleId.ProgressiveHouse,
    name: '前卫浩室 (Progressive House)',
    global: {
        bpmRange: [120, 128], // 经典 House 速度
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.8 }, // 80% 小调，忧郁深邃
            { tonality: Tonality.Dorian, weight: 0.2 } // 20% 多利亚调式，带点神秘感
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
