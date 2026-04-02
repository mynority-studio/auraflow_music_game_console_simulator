import { StyleConfig, Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

export const IndieRockStyle: StyleConfig = {
    id: StyleId.IndieRock,
    name: '独立摇滚 (Indie Rock)',
    global: {
        bpmRange: [120, 160], // 速度偏快，有跳跃感
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.4 },
            { tonality: Tonality.Minor, weight: 0.6 } // 偏向小调或混合调式
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
