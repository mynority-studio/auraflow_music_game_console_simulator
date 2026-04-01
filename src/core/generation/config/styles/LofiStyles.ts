import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';
import { RnBRhythmCells } from '../../melody/RhythmCells';

export const LofiHipHopStyle: StyleConfig = {
    id: StyleId.Lofi,
    name: '低保真嘻哈 (Lo-Fi Hip Hop)',
    global: {
        bpmRange: [65, 85], // 慵懒的慢板
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: 'Minor', weight: 0.7 },
            { tonality: 'Dorian', weight: 0.3 }
        ]
    },
    harmony: {
        chorusPool: [
            ['ii', 'V', 'I', 'vi'], // iv - bVII - bIII - i
            ['IV', 'iii', 'ii', 'I'], // bVI - v - iv - bIII
            ['vi', 'IV', 'I', 'V'], // i - bVI - bIII - bVII
            ['vii°', 'III7', 'vi', 'vi'], // ii° - V7 - i - i
        ], 
        versePool: [
            ['vi', 'ii', 'V', 'I'], // i - iv - bVII - bIII
            ['IV', 'V', 'iii', 'vi'], // bVI - bVII - v - i
            ['vi', 'vi', 'ii', 'iii'] // i - i - iv - v
        ],
        preChorusPool: [
            ['ii', 'V', 'I', 'vi'], // iv - bVII - bIII - i
            ['IV', 'V', 'vi', 'vi'], // bVI - bVII - i - i
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.6,
        reharmProbability: 0.2,
        melodyDrivenReharmProbability: 0.3,
        borrowedChords: ['SecondaryDominant'],
        passingChords: ['Diminished7'],
        voicingStyle: 'neo-soul' // 爵士和弦排列
    },
    rhythm: {
        densityBase: [0.3, 0.6], 
        syncopationWeight: 0.7,
        restProbability: 0.3,
        disruptionProbability: 0.1,
        humanize: 0.9, // 极高的人性化，Dilla Feel
        swingRatio: 0.5, // 明显的 Swing
        grooveTemplate: RnBRhythmCells
    },
    melody: {
        stepwiseRatio: 0.7, 
        maxJumpInterval: 8, 
        tensionTolerance: 0.4,
        mutationProbability: 0.2,
        mutationPool: ['inversion'],
        inflectionProbability: 0.2,
        pentatonicShiftProbability: 0.8
    },
    orchestration: {
        // 极端的音色替代策略 (SoundFont Hacking)
        melodyInstruments: ['Vibraphone', 'Music_Box', 'Ocarina', 'Recorder'],
        chordInstruments: ['Electric_Piano_1', 'Electric_Piano_2', 'Pad_2_warm'],
        bassInstruments: ['Synth_Bass_1', 'Acoustic_Bass', 'Electric_Bass_Finger'],
        drumInstruments: ['Standard_DrumKit', 'Electronic_Drum'],
        counterMelodyInstruments: ['Muted_Trumpet', 'Vibraphone', 'Electric_Piano_1'],
        texturePool: ['Block', 'Rhythmic'], 
        drumProbability: 1.0,
        counterMelodyProbability: 0.4, 
        grooveRatio: { foundation: 0.7, comping: 0.6, color: 0.2 },
        idiomPreferences: {
            stringStyle: 'lofi',
            bassStyle: 'lofi',
            drumStyle: 'lofi',
            pianoStyle: 'electronic',
            humanizeAmount: 1.0 // 🌟 Lo-Fi 需要极高的人性化/微小的时间偏差
        },
        mixingPreferences: {
            melody: { reverb: 0.8 },
            chord: { pan: -0.25, reverb: 0.6, volume: -4.0 },
            drums: { reverb: 0.1, volume: -1.0 },
            bass: { volume: -3.0 },
            counterMelody: { volume: -4.0 }
        }
    },
    performance: {
        allowedPersonas: ['RnB_Diva', 'Soul_Singer', 'Jazz_Cat']
    },
    contrast: {
        chorusPitchOffset: 2, 
        verseDensityMultiplier: 0.8, 
        versePitchOffset: -2
    },
    modulation: {
        probability: 0.0, // Lofi 通常不转调
        targetSection: 'Final_Chorus',
        intervalPool: [1]
    }
};
