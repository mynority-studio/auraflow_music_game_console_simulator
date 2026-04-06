import { StyleConfig, Tonality } from '../types';

export enum StyleId {
    Default = 0,
    DarkSynthPop = 1
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.Default]: 'Default',
    [StyleId.DarkSynthPop]: 'Dark Synth Pop'
};

export const DefaultStyleConfig: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
    masteringProfileId: 'Retro_Gadget', // 🌟 Apply Retro Gadget mastering profile by default
    global: {
        bpmRange: [80, 110], // 降低基础 BPM 范围，给 mood 调制留空间
        timeSignaturePool: [{ signature: [4, 4], weight: 1 }],
        tonalityPool: [{ tonality: Tonality.Major, weight: 1 }]
    },
    harmony: {
        chorusPool: [],
        versePool: [],
        preChorusPool: []
    },
    rhythm: {
        densityBase: [0.5, 0.5],
        syncopationWeight: 0.2,
        restProbability: 0.1,
        disruptionProbability: 0.1,
        humanize: 0.1
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.3,
        mutationProbability: 0.2,
        mutationPool: ['inversion'],
        sectionalRegisterProfile: {
            verse: [48, 60], // C3 to C4
            preChorus: [50, 62], // D3 to D4
            chorus: [55, 67], // G3 to G4
            solo: [60, 72] // C4 to C5
        },
        breathingRoomProbability: 0.5,
        callAndResponseProbability: 0.6
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1
    },
    modulation: {
        probability: 0,
        targetSection: 'Final_Chorus',
        intervalPool: [1, 2]
    },
    orchestration: {
        melodyInstruments: ['Piano', 'Flute', 'Marimba', 'Electric_Piano_1', 'Alto_Sax', 'Piano'],
        chordInstruments: ['Piano', 'Electric_Piano_1', 'String_Ensemble_1', 'Synth_Pad_1'],
        bassInstruments: ['Electric_Bass_Finger', 'Acoustic_Bass', 'Contrabass', 'Fretless_Bass', 'Electric_Bass_Finger'],
        drumInstruments: ['Standard_DrumKit', 'Standard_DrumKit', 'Electronic_DrumKit'],
        counterMelodyInstruments: ['Piano', 'Violin', 'Cello', 'String_Ensemble_1', 'Oboe'],
        texturePool: ['Block', 'Arpeggio', 'Pad', 'String_Ostinato'],
        allowDrumless: true,
        allowBassless: true,
        // 🌟 Define Instrument Behaviors for Retro Gadget style
        instrumentBehaviors: {
            melody: { pitchRange: [55, 79], velocityRange: [55, 85] }, // G3-G5, 主旋律（降低力度避免刺耳）
            secondaryMelody: { pitchRange: [48, 72], velocityRange: [45, 70] }, // C3-C5, 副旋律
            bass: { pitchRange: [28, 52], velocityRange: [80, 105] }, // E1-E3, Punchy but controlled
            chord: { pitchRange: [48, 72], velocityRange: [40, 65] }, // C3-C5, Darker/Pad-like, pushed back
            counterMelody: { pitchRange: [60, 84], velocityRange: [35, 60] } // C4-C6, 背景层（降低力度避免盖过主旋律）
        },
        mixingPreferences: {
            chorusDepth: 64, // Add chorus for wider stereo image
            melody: { volume: -4, pan: 0, reverb: 0.4 }, // -4dB + 更多混响柔化高频
            vocal: { volume: -2, pan: 0, reverb: 0.35 }, // -2dB，vocal 作为第二主奏保持存在感
            chord: { volume: -5, reverb: 0.5 }, // -5dB 和弦伴奏
            bass: { volume: -2, pan: 0, reverb: 0.1 }, // -2dB 低音
            counterMelody: { volume: -8, reverb: 0.55 }, // -8dB 背景层（Cello/Choir 轻柔铺底）
            secondaryMelody: { volume: -5, reverb: 0.45 } // -5dB 副旋律
        }
    },
    performance: {
        allowedPersonas: []
    }
};

// ============================================================
// Dark Synth Pop — Weeknd / Blinding Lights / Synthwave
// ============================================================
export const DarkSynthPopStyleConfig: StyleConfig = {
    id: StyleId.DarkSynthPop,
    name: 'Dark Synth Pop',
    global: {
        bpmRange: [88, 110],
        timeSignaturePool: [{ signature: [4, 4], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Minor, weight: 0.8 },
            { tonality: Tonality.Dorian, weight: 0.15 },
            { tonality: Tonality.Major, weight: 0.05 }
        ]
    },
    harmony: {
        // 核心：极简 4 和弦循环，Verse/Chorus/PreChorus 共享相似进行
        chorusPool: [
            ['i', 'VI', 'VII', 'IV'],     // Blinding Lights 经典
            ['i', 'iv', 'VII', 'III'],     // Synthwave 标准
            ['i', 'VI', 'III', 'VII'],     // After Hours 感
            ['i', 'v', 'VI', 'VII']        // Starboy 变体
        ],
        versePool: [
            ['i', 'VI', 'VII', 'IV'],      // 和 Chorus 相同（Weeknd 特色）
            ['i', 'iv', 'VII', 'III'],
            ['i', 'VI', 'III', 'VII'],
            ['vi', 'IV', 'I', 'V']         // 偶尔大调色彩
        ],
        preChorusPool: [
            ['IV', 'V', 'i', 'i'],
            ['VI', 'VII', 'i', 'i'],
            ['iv', 'V', 'VI', 'VII']
        ]
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.2,       // 简洁，少不和谐
        reharmProbability: 0.05,           // 几乎不做和声替换（保持循环纯净）
        passingChords: ['SecondaryDominant'],
        borrowedChords: ['ModalMixture'],
        voicingStyle: 'edm',                    // 高音区和弦（冷冽感）
        globalProgressionProbability: 0.7  // 70% 全曲共用一套和弦（Weeknd 特色）
    },
    rhythm: {
        densityBase: [0.25, 0.45],         // 低密度（空间感）
        syncopationWeight: 0.15,           // 极少切分（稳定推进感）
        restProbability: 0.25,             // 较多休止（留白）
        disruptionProbability: 0.02,
        humanize: 0.08,
        swingRatio: 0,                     // 直线节奏，无 swing
        strictGrid: true                   // 严格网格（电子音乐感）
    },
    melody: {
        stepwiseRatio: 0.6,                // 级进为主但允许跳进
        maxJumpInterval: 7,                // 不超过纯五度
        tensionTolerance: 0.15,
        mutationProbability: 0.1,
        mutationPool: ['augmentation'],
        pentatonicPreference: 0.7,         // 高五声偏好（洗脑旋律）
        anchorProbability: 0.4,            // 高同音反复（Weeknd hook 特色）
        chromaticPassingProbability: 0.0,  // 无半音经过
        breathingRoomProbability: 0.3,
        sectionalRegisterProfile: {
            verse: [48, 60],               // 低沉述说
            preChorus: [50, 64],
            chorus: [55, 67],              // 副歌不飙高音，靠情绪而非音高
            solo: [58, 70]
        }
    },
    contrast: {
        chorusPitchOffset: 5,              // 副歌提升温和（不是大爆发）
        verseDensityMultiplier: 0.6,       // 主歌极度克制
        versePitchOffset: -3
    },
    modulation: {
        probability: 0.1,                  // 很少转调（循环稳定）
        targetSection: 'Final_Chorus',
        intervalPool: [1]
    },
    orchestration: {
        melodyInstruments: ['Lead_2_Sawtooth', 'Lead_2_Sawtooth', 'Electric_Piano_1', 'Flute'],
        chordInstruments: ['Synth_Strings_1', 'Pad_2_Warm', 'Electric_Piano_1'],
        bassInstruments: ['Synth_Bass_1', 'Synth_Bass_2', 'Synth_Bass_1'],
        drumInstruments: ['Standard_DrumKit', 'Standard_DrumKit', 'Electronic_DrumKit'], // Standard 优先（Electronic 的 CHH 有额外合成器层）
        counterMelodyInstruments: ['Pad_1_NewAge', 'Pad_2_Warm', 'Pad_2_Warm', 'Synth_Strings_1'],
        texturePool: ['Arpeggio', 'Pad', 'Pad', 'Block'],  // Pad 占比提高（大段铺垫）
        drumProbability: 1.0,              // 一定有鼓
        counterMelodyProbability: 1.0,     // Pad 铺底是灵魂
        allowDrumless: false,
        allowBassless: false,
        grooveRatio: { foundation: 0.5, comping: 0.3, color: 0.4 }, // 鼓组稍收敛
        instrumentBehaviors: {
            melody: { pitchRange: [50, 74], velocityRange: [50, 80] },
            secondaryMelody: { pitchRange: [48, 70], velocityRange: [40, 65] },
            bass: { pitchRange: [28, 48], velocityRange: [70, 95] },
            chord: { pitchRange: [48, 72], velocityRange: [30, 55] },
            counterMelody: { pitchRange: [48, 72], velocityRange: [45, 70] } // Pad 力度提升（从[30,55]→[45,70]）
        },
        mixingPreferences: {
            requireSidechain: true,
            melody: { pan: 0, reverb: 0.5, volume: -1 },      // 主奏 Synth Lead 要突出
            vocal: { volume: -2, pan: 0, reverb: 0.45 },
            chord: { pan: -0.3, reverb: 0.35, volume: -5 },     // 干声+清晰=冷冽
            bass: { pan: 0, reverb: 0.15, volume: -1 },
            drums: { reverb: 0.25, volume: -5 },               // 鼓声收小（-2→-5dB）
            counterMelody: { volume: -2, reverb: 0.6 },          // Pad 铺底是 Synthwave 灵魂，要有存在感
            secondaryMelody: { volume: -5, reverb: 0.5 }
        }
    },
    performance: { allowedPersonas: [] }
};
