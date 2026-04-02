import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

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
