import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const DarkPopStyle: StyleConfig = {
    id: StyleId.DarkPop,
    name: '暗黑流行 (Dark Pop)',
    global: {
        bpmRange: [90, 125], // 中板，强调律动和低频
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.9 },
            { tonality: Tonality.Dorian, weight: 0.1 }
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
