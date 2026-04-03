import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';
import { InstrumentId } from '../InstrumentFlags';

export const ModernPopStyle: StyleConfig = {
    id: StyleId.ModernPop,
    name: '现代华语流行 (Modern C-Pop)',
    global: {
        bpmRange: [75, 115], // 抒情到中板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.7 },
            { tonality: Tonality.Minor, weight: 0.3 }
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
        borrowedChords: ['ModalMixture'], // 偶尔借用小四和弦等离调和弦 (流行歌常见催泪点)
        voicingStyle: 'standard'
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
        melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.String_Ensemble, InstrumentId.Warm_EP],
        chordInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Guitar_Chord, InstrumentId.Warm_EP],
        bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Electric_Bass_Pick, InstrumentId.Fretless_Bass, InstrumentId.Acoustic_Bass],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Pad_1_NewAge, InstrumentId.Pad_3_Polysynth],
        texturePool: ['Arpeggio', 'Arpeggio', 'Block', 'Pad'], // 钢琴琶音和柱式和弦为主
        drumProbability: 1.0,
        counterMelodyProbability: 0.9, // 弦乐铺底非常重要
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'steady',
            drumStyle: 'steady'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.5, delay: 0.2 },
            chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
            counterMelody: { pan: -0.6, volume: -5.0 },
            drums: { reverb: 0.15, volume: -1.0 },
            bass: { reverb: 0.25, volume: -4.0 }
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
    id: StyleId.ClassicJPop,
    name: '昭和经典流行 (Classic J-Pop)',
    global: {
        bpmRange: [70, 105], // 抒情中慢板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.6 },
            { tonality: Tonality.Major, weight: 0.4 }
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
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'jpop'
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
        melodyInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Warm_EP, InstrumentId.Warm_EP, InstrumentId.Alto_Sax],
        chordInstruments: [InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Grand, InstrumentId.Acoustic_Guitar_Chord, InstrumentId.Warm_EP],
        bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Electric_Bass_Pick, InstrumentId.Acoustic_Bass, InstrumentId.Fretless_Bass],
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.String_Ensemble, InstrumentId.String_Ensemble, InstrumentId.Alto_Sax],
        texturePool: ['Arpeggio', 'Arpeggio', 'Block', 'Pad'],
        drumProbability: 1.0,
        counterMelodyProbability: 0.9, // 弦乐或萨克斯副旋律很常见
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'steady',
            drumStyle: 'steady'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.5, delay: 0.2 },
            chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
            counterMelody: { pan: -0.6, volume: -5.0 },
            drums: { reverb: 0.15, volume: -1.0 },
            bass: { reverb: 0.25, volume: -4.0 }
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
    id: StyleId.ModernJPop,
    name: '现代日系流行 (Modern J-Pop)',
    global: {
        bpmRange: [120, 175], // 极快，米津玄师/YOASOBI 风格
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.7 },
            { tonality: Tonality.Major, weight: 0.3 }
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
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'jpop'
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
        melodyInstruments: [InstrumentId.Synth_Lead, InstrumentId.Synth_Lead, InstrumentId.Acoustic_Grand, InstrumentId.Clean_Guitar],
        chordInstruments: [InstrumentId.Clean_Guitar, InstrumentId.Clean_Guitar, InstrumentId.Acoustic_Grand, InstrumentId.Synth_Lead],
        bassInstruments: [InstrumentId.Electric_Bass_Finger, InstrumentId.Synth_Bass_1, InstrumentId.Slap_Bass_1], // 经常使用Slap Bass或合成贝斯
        drumInstruments: [InstrumentId.Standard_DrumKit],
        counterMelodyInstruments: [InstrumentId.Synth_Lead, InstrumentId.Pad_3_Polysynth, InstrumentId.String_Ensemble],
        texturePool: ['Rhythmic', 'Arpeggio', 'Block'], // 强烈的节奏型织体
        drumProbability: 1.0,
        counterMelodyProbability: 0.8,
        grooveRatio: { foundation: 0.5, comping: 0.6, color: 0.7 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'syncopated', // 偏向Funk的贝斯律动
            drumStyle: 'steady'
        },
        mixingPreferences: {
            melody: { pan: 0, reverb: 0.5, delay: 0.2 },
            chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
            counterMelody: { pan: -0.6, volume: -5.0 },
            drums: { reverb: 0.15, volume: -1.0 },
            bass: { reverb: 0.25, volume: -4.0 }
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
