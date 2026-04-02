import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';

export const GhibliOrchestralStyle: StyleConfig = {
    id: StyleId.GhibliOrchestral,
    name: '久石让/吉卜力 (Ghibli Orchestral)',
    global: {
        bpmRange: [70, 110], // 速度适中，充满呼吸感
        timeSignaturePool: [
            { signature: [4, 4], weight: 0.5 },
            { signature: [3, 4], weight: 0.3 }, // 圆舞曲感
            { signature: [6, 8], weight: 0.2 }
        ],
        tonalityPool: [
            { tonality: 'Major', weight: 0.6 }, // 温暖、治愈
            { tonality: 'Minor', weight: 0.4 }  // 忧伤、史诗
        ]
    },
    harmony: {
        chorusPool: [
            ['IV', 'V', 'iii', 'vi'], // 经典王道进行，久石让常用
            ['I', 'V', 'vi', 'iii', 'IV', 'I', 'ii', 'V'], // 卡农进行变体
            ['IV', 'V', 'I', 'vi']
        ],
        versePool: [
            ['I', 'vi', 'IV', 'V'],
            ['I', 'iii', 'IV', 'V'],
            ['vi', 'iii', 'IV', 'I']
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'I', 'ii', 'V']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.4, 
        reharmProbability: 0.4, // 经常使用离调和弦
        borrowedChords: ['SecondaryDominant', 'ModalMixture'], // 次属和弦和同主音调借用是久石让精髓
        voicingStyle: 'standard'
    },
    rhythm: {
        densityBase: [0.4, 0.7], 
        syncopationWeight: 0.2, // 节奏相对规整，强调旋律的如歌性
        restProbability: 0.1,
        disruptionProbability: 0.05,
        humanize: 0.3, // 极高的拟人化，模拟真实管弦乐队的呼吸
        swingRatio: 0
    },
    melody: {
        stepwiseRatio: 0.7, // 旋律如歌，级进为主
        maxJumpInterval: 12, // 偶尔有大跳（如八度、六度）增加情感张力
        tensionTolerance: 0.3,
        mutationProbability: 0.1,
        mutationPool: ['inversion']
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand', 'Acoustic_Grand', 'Flute', 'Oboe', 'Violin'], // 钢琴或木管/弦乐主奏
        chordInstruments: ['String_Ensemble', 'String_Ensemble', 'Acoustic_Grand', 'Tremolo_Strings'], // 弦乐群铺底
        bassInstruments: ['Acoustic_Bass', 'Cello', 'Contrabass', 'String_Ensemble_2'], // 真实原声贝斯或大提琴
        drumInstruments: ['Orchestral_DrumKit'], // 使用交响打击乐组，避免使用竖琴导致通道错误
        counterMelodyInstruments: ['Glockenspiel', 'Pizzicato_Strings', 'Clarinet', 'Flute', 'Orchestral_Harp'], // 竖琴移至副旋律
        texturePool: ['Arpeggio', 'Arpeggio', 'Pad', 'Block'], // 大量使用琶音和阿尔贝蒂低音
        drumProbability: 0.2, // 极少使用常规流行鼓
        counterMelodyProbability: 0.7, // 丰富的复调色彩
        grooveRatio: { foundation: 0.4, comping: 0.5, color: 0.9 },
        idiomPreferences: {
            counterMelodyStyle: 'sustained',
            bassStyle: 'sparse',
            drumStyle: 'acoustic-swing' // 即使有鼓，也是非常轻柔的刷子或点缀
        },
        mixingPreferences: {
            melody: { reverb: 0.8, delay: 0.4 },
            chord: { pan: -0.25, reverb: 0.9, volume: -4.0 },
            drums: { reverb: 0.2, volume: -2.0 },
            bass: { reverb: 0.35, volume: -3.0 },
            counterMelody: { pan: -0.6, delay: 0.3, volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['Classical_Virtuoso', 'Cinematic_Composer']
    },
    contrast: {
        chorusPitchOffset: 5, // 副歌音区适度抬高
        verseDensityMultiplier: 0.6,
        versePitchOffset: -3
    },
    modulation: {
        probability: 0.3, // 经常在副歌或桥段转调
        targetSection: 'Chorus',
        intervalPool: [1, 2, 3] // 喜欢半音、全音或小三度转调
    }
};

