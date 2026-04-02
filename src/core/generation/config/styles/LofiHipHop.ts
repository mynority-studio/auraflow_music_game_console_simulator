import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const LofiHipHopStyle: StyleConfig = {
    id: StyleId.LofiHipHop,
    name: '低保真嘻哈 (Lo-Fi Hip Hop)',
    global: {
        bpmRange: [65, 85], // 慵懒、放松的节奏
        timeSignaturePool: [
            { signature: [4, 4], weight: 1.0 } // 几乎全是 4/4 拍
        ],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.7 }, // 忧郁、怀旧
            { tonality: Tonality.Major, weight: 0.3 }
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
