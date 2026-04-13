// T-1 合规：禁止字符串子串匹配做乐器路由，改用枚举查表
export const enum InstrumentFamily {
    Drums   = 0,
    String  = 1,
    Wind    = 2,
    Guitar  = 3,
    Bass    = 4,
    Synth   = 5,
    Piano   = 6,
    Voice   = 7,
    Unknown = 8,
}

/** T-1 合规：从 InstrumentId 枚举直接查表获取 InstrumentFamily */
export function resolveInstrumentFamily(id: InstrumentId): InstrumentFamily {
    const family = InstrumentIdFamily[id];
    return family !== undefined ? family : InstrumentFamily.Unknown;
}

// T-1 合规：InstrumentId 数值枚举，替代乐器名称字符串
export enum InstrumentId {
    // Piano / Keys
    Acoustic_Grand = 0,
    Electric_Piano_1 = 1,
    Electric_Piano_2 = 2,
    Warm_EP = 3,
    Lofi_Piano = 4,
    Rock_Organ = 5,
    // Strings
    Violin = 6,
    Cello = 7,
    Contrabass = 8,
    String_Ensemble = 9,
    String_Ensemble_2 = 10,
    Tremolo_Strings = 11,
    Pizzicato_Strings = 12,
    // Wind
    Flute = 13,
    Oboe = 14,
    Clarinet = 15,
    Alto_Sax = 16,
    Tenor_Sax = 17,
    Muted_Trumpet = 18,
    Recorder = 19,
    Ocarina = 20,
    // Guitar
    Acoustic_Guitar_Nylon = 21,
    Acoustic_Guitar_Steel = 22,
    Acoustic_Guitar_Chord = 23,
    Clean_Guitar = 24,
    Electric_Guitar_Clean = 25,
    Overdriven_Guitar = 26,
    Distortion_Guitar = 27,
    Harmonica = 28,
    // Bass
    Acoustic_Bass = 29,
    Electric_Bass_Finger = 30,
    Electric_Bass_Pick = 31,
    Fretless_Bass = 32,
    Synth_Bass_1 = 33,
    Synth_Bass_2 = 34,
    Slap_Bass_1 = 35,
    // Synth / Pad / Lead
    Lead_1_Square = 36,
    Lead_2_Sawtooth = 37,
    Synth_Calliope = 38,
    Synth_Brass_1 = 39,
    Synth_Lead = 40,
    Pad_1_NewAge = 41,
    Pad_2_Warm = 42,
    Pad_3_Polysynth = 43,
    Synth_Strings_1 = 44,
    // Voice / Percussion
    Choir_Aahs = 45,
    Voice_Oohs = 46,
    Solo_Vox = 47,
    Marimba = 48,
    Vibraphone = 49,
    // Drums
    Standard_DrumKit = 50,
    Electronic_DrumKit = 51,
    TR808_DrumKit = 52,
    Orchestral_DrumKit = 53,
    Room_DrumKit = 54,
    // Special
    Reverse_Cymbal = 55,
    Music_Box = 56,
    Glockenspiel = 57,
    Orchestral_Harp = 58,
    System_Aura = 59,
    Breath_Noise = 60,
}

// 翻译枚举：InstrumentId -> 显示名（用于日志和音频层桥接）
export const InstrumentIdName: string[] = [];
InstrumentIdName[InstrumentId.Acoustic_Grand] = 'Acoustic_Grand';
InstrumentIdName[InstrumentId.Electric_Piano_1] = 'Electric_Piano_1';
InstrumentIdName[InstrumentId.Electric_Piano_2] = 'Electric_Piano_2';
InstrumentIdName[InstrumentId.Warm_EP] = 'Warm_EP';
InstrumentIdName[InstrumentId.Lofi_Piano] = 'Lofi_Piano';
InstrumentIdName[InstrumentId.Rock_Organ] = 'Rock_Organ';
InstrumentIdName[InstrumentId.Violin] = 'Violin';
InstrumentIdName[InstrumentId.Cello] = 'Cello';
InstrumentIdName[InstrumentId.Contrabass] = 'Contrabass';
InstrumentIdName[InstrumentId.String_Ensemble] = 'String_Ensemble';
InstrumentIdName[InstrumentId.String_Ensemble_2] = 'String_Ensemble_2';
InstrumentIdName[InstrumentId.Tremolo_Strings] = 'Tremolo_Strings';
InstrumentIdName[InstrumentId.Pizzicato_Strings] = 'Pizzicato_Strings';
InstrumentIdName[InstrumentId.Flute] = 'Flute';
InstrumentIdName[InstrumentId.Oboe] = 'Oboe';
InstrumentIdName[InstrumentId.Clarinet] = 'Clarinet';
InstrumentIdName[InstrumentId.Alto_Sax] = 'Alto_Sax';
InstrumentIdName[InstrumentId.Tenor_Sax] = 'Tenor_Sax';
InstrumentIdName[InstrumentId.Muted_Trumpet] = 'Muted_Trumpet';
InstrumentIdName[InstrumentId.Recorder] = 'Recorder';
InstrumentIdName[InstrumentId.Ocarina] = 'Ocarina';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Nylon] = 'Acoustic_Guitar_Nylon';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Steel] = 'Acoustic_Guitar_Steel';
InstrumentIdName[InstrumentId.Acoustic_Guitar_Chord] = 'Acoustic_Guitar_Chord';
InstrumentIdName[InstrumentId.Clean_Guitar] = 'Clean_Guitar';
InstrumentIdName[InstrumentId.Electric_Guitar_Clean] = 'Electric_Guitar_Clean';
InstrumentIdName[InstrumentId.Overdriven_Guitar] = 'Overdriven_Guitar';
InstrumentIdName[InstrumentId.Distortion_Guitar] = 'Distortion_Guitar';
InstrumentIdName[InstrumentId.Harmonica] = 'Harmonica';
InstrumentIdName[InstrumentId.Acoustic_Bass] = 'Acoustic_Bass';
InstrumentIdName[InstrumentId.Electric_Bass_Finger] = 'Electric_Bass_Finger';
InstrumentIdName[InstrumentId.Electric_Bass_Pick] = 'Electric_Bass_Pick';
InstrumentIdName[InstrumentId.Fretless_Bass] = 'Fretless_Bass';
InstrumentIdName[InstrumentId.Synth_Bass_1] = 'Synth_Bass_1';
InstrumentIdName[InstrumentId.Synth_Bass_2] = 'Synth_Bass_2';
InstrumentIdName[InstrumentId.Slap_Bass_1] = 'Slap_Bass_1';
InstrumentIdName[InstrumentId.Lead_1_Square] = 'Lead_1_square';
InstrumentIdName[InstrumentId.Lead_2_Sawtooth] = 'Lead_2_Sawtooth';
InstrumentIdName[InstrumentId.Synth_Calliope] = 'Synth_Calliope';
InstrumentIdName[InstrumentId.Synth_Brass_1] = 'Synth_Brass_1';
InstrumentIdName[InstrumentId.Synth_Lead] = 'Synth_Lead';
InstrumentIdName[InstrumentId.Pad_1_NewAge] = 'Pad_1_NewAge';
InstrumentIdName[InstrumentId.Pad_2_Warm] = 'Pad_2_warm';
InstrumentIdName[InstrumentId.Pad_3_Polysynth] = 'Pad_3_Polysynth';
InstrumentIdName[InstrumentId.Synth_Strings_1] = 'Synth_Strings_1';
InstrumentIdName[InstrumentId.Choir_Aahs] = 'Choir_Aahs';
InstrumentIdName[InstrumentId.Voice_Oohs] = 'Voice_Oohs';
InstrumentIdName[InstrumentId.Solo_Vox] = 'Solo_Vox';
InstrumentIdName[InstrumentId.Marimba] = 'Marimba';
InstrumentIdName[InstrumentId.Vibraphone] = 'Vibraphone';
InstrumentIdName[InstrumentId.Standard_DrumKit] = 'Standard_DrumKit';
InstrumentIdName[InstrumentId.Electronic_DrumKit] = 'Electronic_Drum';
InstrumentIdName[InstrumentId.TR808_DrumKit] = 'TR808_DrumKit';
InstrumentIdName[InstrumentId.Orchestral_DrumKit] = 'Orchestral_DrumKit';
InstrumentIdName[InstrumentId.Room_DrumKit] = 'Room_DrumKit';
InstrumentIdName[InstrumentId.Reverse_Cymbal] = 'Reverse_Cymbal';
InstrumentIdName[InstrumentId.Music_Box] = 'Music_Box';
InstrumentIdName[InstrumentId.Glockenspiel] = 'Glockenspiel';
InstrumentIdName[InstrumentId.Orchestral_Harp] = 'Orchestral_Harp';
InstrumentIdName[InstrumentId.System_Aura] = 'System_Aura';
InstrumentIdName[InstrumentId.Breath_Noise] = 'Breath_Noise';

// InstrumentId -> GM Program Number（音频层 MIDI 桥接）
export const InstrumentGMProgram: number[] = [];
InstrumentGMProgram[InstrumentId.Acoustic_Grand] = 0;
InstrumentGMProgram[InstrumentId.Electric_Piano_1] = 4;
InstrumentGMProgram[InstrumentId.Electric_Piano_2] = 5;
InstrumentGMProgram[InstrumentId.Warm_EP] = 4;
InstrumentGMProgram[InstrumentId.Lofi_Piano] = 4;
InstrumentGMProgram[InstrumentId.Rock_Organ] = 0;
InstrumentGMProgram[InstrumentId.Violin] = 40;
InstrumentGMProgram[InstrumentId.Cello] = 42;
InstrumentGMProgram[InstrumentId.Contrabass] = 43;
InstrumentGMProgram[InstrumentId.String_Ensemble] = 48;
InstrumentGMProgram[InstrumentId.String_Ensemble_2] = 48;
InstrumentGMProgram[InstrumentId.Tremolo_Strings] = 44;
InstrumentGMProgram[InstrumentId.Pizzicato_Strings] = 45;
InstrumentGMProgram[InstrumentId.Flute] = 73;
InstrumentGMProgram[InstrumentId.Oboe] = 68;
InstrumentGMProgram[InstrumentId.Clarinet] = 71;
InstrumentGMProgram[InstrumentId.Alto_Sax] = 65;
InstrumentGMProgram[InstrumentId.Tenor_Sax] = 66;
InstrumentGMProgram[InstrumentId.Muted_Trumpet] = 59;
InstrumentGMProgram[InstrumentId.Recorder] = 74;
InstrumentGMProgram[InstrumentId.Ocarina] = 79;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Nylon] = 24;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Steel] = 25;
InstrumentGMProgram[InstrumentId.Acoustic_Guitar_Chord] = 24;
InstrumentGMProgram[InstrumentId.Clean_Guitar] = 27;
InstrumentGMProgram[InstrumentId.Electric_Guitar_Clean] = 27;
InstrumentGMProgram[InstrumentId.Overdriven_Guitar] = 29;
InstrumentGMProgram[InstrumentId.Distortion_Guitar] = 30;
InstrumentGMProgram[InstrumentId.Harmonica] = 22;
InstrumentGMProgram[InstrumentId.Acoustic_Bass] = 32;
InstrumentGMProgram[InstrumentId.Electric_Bass_Finger] = 33;
InstrumentGMProgram[InstrumentId.Electric_Bass_Pick] = 34;
InstrumentGMProgram[InstrumentId.Fretless_Bass] = 35;
InstrumentGMProgram[InstrumentId.Synth_Bass_1] = 38;
InstrumentGMProgram[InstrumentId.Synth_Bass_2] = 39;
InstrumentGMProgram[InstrumentId.Slap_Bass_1] = 36;
InstrumentGMProgram[InstrumentId.Lead_1_Square] = 80;
InstrumentGMProgram[InstrumentId.Lead_2_Sawtooth] = 81;
InstrumentGMProgram[InstrumentId.Synth_Calliope] = 82;
InstrumentGMProgram[InstrumentId.Synth_Brass_1] = 62;
InstrumentGMProgram[InstrumentId.Synth_Lead] = 81;
InstrumentGMProgram[InstrumentId.Pad_1_NewAge] = 88;
InstrumentGMProgram[InstrumentId.Pad_2_Warm] = 89;
InstrumentGMProgram[InstrumentId.Pad_3_Polysynth] = 90;
InstrumentGMProgram[InstrumentId.Synth_Strings_1] = 50;
InstrumentGMProgram[InstrumentId.Choir_Aahs] = 52;
InstrumentGMProgram[InstrumentId.Voice_Oohs] = 53;
InstrumentGMProgram[InstrumentId.Solo_Vox] = 85;
InstrumentGMProgram[InstrumentId.Marimba] = 12;
InstrumentGMProgram[InstrumentId.Vibraphone] = 11;
InstrumentGMProgram[InstrumentId.Standard_DrumKit] = 0;
InstrumentGMProgram[InstrumentId.Electronic_DrumKit] = 24;
InstrumentGMProgram[InstrumentId.TR808_DrumKit] = 25;
InstrumentGMProgram[InstrumentId.Orchestral_DrumKit] = 48;
InstrumentGMProgram[InstrumentId.Room_DrumKit] = 0;
InstrumentGMProgram[InstrumentId.Reverse_Cymbal] = 119;
InstrumentGMProgram[InstrumentId.Music_Box] = 10;
InstrumentGMProgram[InstrumentId.Glockenspiel] = 9;
InstrumentGMProgram[InstrumentId.Orchestral_Harp] = 46;
InstrumentGMProgram[InstrumentId.System_Aura] = 81;
InstrumentGMProgram[InstrumentId.Breath_Noise] = 122;

// InstrumentId -> InstrumentFamily（替代 INSTRUMENT_FAMILY_TABLE Record）
export const InstrumentIdFamily: InstrumentFamily[] = [];
// Piano / Keys
InstrumentIdFamily[InstrumentId.Acoustic_Grand] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Electric_Piano_1] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Electric_Piano_2] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Warm_EP] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Lofi_Piano] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Rock_Organ] = InstrumentFamily.Piano;
// Strings
InstrumentIdFamily[InstrumentId.Violin] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Cello] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Contrabass] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.String_Ensemble] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.String_Ensemble_2] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Tremolo_Strings] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.Pizzicato_Strings] = InstrumentFamily.String;
// Wind
InstrumentIdFamily[InstrumentId.Flute] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Oboe] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Clarinet] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Alto_Sax] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Tenor_Sax] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Muted_Trumpet] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Recorder] = InstrumentFamily.Wind;
InstrumentIdFamily[InstrumentId.Ocarina] = InstrumentFamily.Wind;
// Guitar
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Nylon] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Steel] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Acoustic_Guitar_Chord] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Clean_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Electric_Guitar_Clean] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Overdriven_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Distortion_Guitar] = InstrumentFamily.Guitar;
InstrumentIdFamily[InstrumentId.Harmonica] = InstrumentFamily.Guitar;
// Bass
InstrumentIdFamily[InstrumentId.Acoustic_Bass] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Electric_Bass_Finger] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Electric_Bass_Pick] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Fretless_Bass] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Synth_Bass_1] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Synth_Bass_2] = InstrumentFamily.Bass;
InstrumentIdFamily[InstrumentId.Slap_Bass_1] = InstrumentFamily.Bass;
// Synth / Pad / Lead
InstrumentIdFamily[InstrumentId.Lead_1_Square] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Lead_2_Sawtooth] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Calliope] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Brass_1] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Lead] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_1_NewAge] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_2_Warm] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Pad_3_Polysynth] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Synth_Strings_1] = InstrumentFamily.Synth;
// Voice / Percussion
InstrumentIdFamily[InstrumentId.Choir_Aahs] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Voice_Oohs] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Solo_Vox] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Marimba] = InstrumentFamily.Voice;
InstrumentIdFamily[InstrumentId.Vibraphone] = InstrumentFamily.Voice;
// Drums
InstrumentIdFamily[InstrumentId.Standard_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Electronic_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.TR808_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Orchestral_DrumKit] = InstrumentFamily.Drums;
InstrumentIdFamily[InstrumentId.Room_DrumKit] = InstrumentFamily.Drums;
// Special
InstrumentIdFamily[InstrumentId.Reverse_Cymbal] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Music_Box] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Glockenspiel] = InstrumentFamily.Piano;
InstrumentIdFamily[InstrumentId.Orchestral_Harp] = InstrumentFamily.String;
InstrumentIdFamily[InstrumentId.System_Aura] = InstrumentFamily.Synth;
InstrumentIdFamily[InstrumentId.Breath_Noise] = InstrumentFamily.Wind;

// InstrumentId 位掩码分类标志（用于快速批量分类检查）
export const IF_IS_PIANO   = (1 << InstrumentId.Acoustic_Grand) | (1 << InstrumentId.Electric_Piano_1) | (1 << InstrumentId.Electric_Piano_2) | (1 << InstrumentId.Warm_EP) | (1 << InstrumentId.Lofi_Piano);
export const IF_IS_GUITAR  = (1 << InstrumentId.Acoustic_Guitar_Nylon) | (1 << InstrumentId.Acoustic_Guitar_Steel) | (1 << InstrumentId.Acoustic_Guitar_Chord) | (1 << InstrumentId.Clean_Guitar) | (1 << InstrumentId.Electric_Guitar_Clean) | (1 << InstrumentId.Overdriven_Guitar) | (1 << InstrumentId.Distortion_Guitar);
export const IF_IS_SYNTH   = (1 << InstrumentId.Lead_1_Square) | (1 << InstrumentId.Lead_2_Sawtooth) | (1 << InstrumentId.Synth_Calliope) | (1 << InstrumentId.Synth_Brass_1) | (1 << InstrumentId.Synth_Lead);
export const IF_IS_PAD     = (1 << InstrumentId.Pad_1_NewAge) | (1 << InstrumentId.Pad_2_Warm) | (1 << InstrumentId.Pad_3_Polysynth) | (1 << InstrumentId.Synth_Strings_1);
export const IF_IS_STRING  = (1 << InstrumentId.String_Ensemble) | (1 << InstrumentId.String_Ensemble_2) | (1 << InstrumentId.Tremolo_Strings) | (1 << InstrumentId.Pizzicato_Strings) | (1 << InstrumentId.Violin) | (1 << InstrumentId.Cello) | (1 << InstrumentId.Contrabass);
export const IF_IS_VOICE   = (1 << InstrumentId.Voice_Oohs) | (1 << InstrumentId.Choir_Aahs) | (1 << InstrumentId.Solo_Vox);
export const IF_IS_DRUM    = (1 << InstrumentId.Standard_DrumKit) | (1 << InstrumentId.Electronic_DrumKit) | (1 << InstrumentId.TR808_DrumKit) | (1 << InstrumentId.Orchestral_DrumKit) | (1 << InstrumentId.Room_DrumKit);

/** T-1 合规：判断 InstrumentId 是否属于「钢琴/键盘」家族 */
export function isPianoFamily(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Piano;
}

/** T-1 合规：判断 InstrumentId 是否属于「吉他」家族 */
export function isGuitarFamily(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Guitar;
}

/** T-1 合规：判断 InstrumentId 是否属于 Pad/Synth/String/Voice（铺底音色） */
export function isPadLikeInstrument(id: InstrumentId): boolean {
    const fam = InstrumentIdFamily[id];
    return fam === InstrumentFamily.Synth || fam === InstrumentFamily.String || fam === InstrumentFamily.Voice;
}

/** T-1 合规：判断 InstrumentId 是否属于鼓组 */
export function isDrumInstrument(id: InstrumentId): boolean {
    return InstrumentIdFamily[id] === InstrumentFamily.Drums;
}

// ============================================================
// 🌟 声学包络分类 (Acoustic Envelope) — 配器规划系统
// ============================================================
export const enum AcousticEnvelope {
    Plucked   = 0, // 衰减打击类：钢琴/吉他/马林巴
    Sustained = 1, // 持续呼吸类：弦乐/管乐
    Pad       = 2, // 合成氛围类：Pad/Choir
    Bass      = 3, // 低频独占类：贝斯
}

export interface WindProfile {
    type: 'sax' | 'flute' | 'brass' | 'reed';
    intervalWeights: { step: number; third: number; fourth: number; leap: number };
    legatoOverlap: number;
    legatoVelocityDrop: number;
    maxBreathBeats: number;
    breathRestBeats: number;
    vibratoOnsetRatio: number;
    vibratoDepth: number;
    vibratoRate: number;
    allowScoop: boolean;
    allowFall: boolean;
    scoopBendRange: number;
    shadowProgram: number;
    shadowVelocityRatio: number;
    shadowDynamicExponent: number;
}

export const WIND_PROFILES: Record<string, WindProfile> = {
    sax: {
        type: 'sax',
        intervalWeights: { step: 0.60, third: 0.25, fourth: 0.10, leap: 0.05 },
        legatoOverlap: 0.025,
        legatoVelocityDrop: 0.65,
        maxBreathBeats: 12,
        breathRestBeats: 0.5,
        vibratoOnsetRatio: 0.6,
        vibratoDepth: 400,
        vibratoRate: 5.5,
        allowScoop: true,
        allowFall: true,
        scoopBendRange: -4096,
        shadowProgram: 122,
        shadowVelocityRatio: 0.15,
        shadowDynamicExponent: 1.5,
    },
    flute: {
        type: 'flute',
        intervalWeights: { step: 0.65, third: 0.20, fourth: 0.10, leap: 0.05 },
        legatoOverlap: 0.015,
        legatoVelocityDrop: 0.70,
        maxBreathBeats: 10,
        breathRestBeats: 0.25,
        vibratoOnsetRatio: 0.5,
        vibratoDepth: 250,
        vibratoRate: 5.0,
        allowScoop: false,
        allowFall: false,
        scoopBendRange: 0,
        shadowProgram: 122,
        shadowVelocityRatio: 0.10,
        shadowDynamicExponent: 1.2,
    },
    reed: {
        type: 'reed',
        intervalWeights: { step: 0.60, third: 0.22, fourth: 0.12, leap: 0.06 },
        legatoOverlap: 0.020,
        legatoVelocityDrop: 0.68,
        maxBreathBeats: 10,
        breathRestBeats: 0.35,
        vibratoOnsetRatio: 0.55,
        vibratoDepth: 300,
        vibratoRate: 5.2,
        allowScoop: false,
        allowFall: false,
        scoopBendRange: 0,
        shadowProgram: 122,
        shadowVelocityRatio: 0.12,
        shadowDynamicExponent: 1.3,
    },
    brass: {
        type: 'brass',
        intervalWeights: { step: 0.55, third: 0.25, fourth: 0.12, leap: 0.08 },
        legatoOverlap: 0.020,
        legatoVelocityDrop: 0.70,
        maxBreathBeats: 14,
        breathRestBeats: 0.4,
        vibratoOnsetRatio: 0.65,
        vibratoDepth: 350,
        vibratoRate: 5.0,
        allowScoop: true,
        allowFall: true,
        scoopBendRange: -3000,
        shadowProgram: 122,
        shadowVelocityRatio: 0.12,
        shadowDynamicExponent: 1.4,
    },
};

export interface InstrumentProfile {
    envelope: AcousticEnvelope;
    safeRange: [number, number];
    maxVelocity: number;
    needsCC11: boolean;
    windProfile?: WindProfile;
}

export const InstrumentProfiles: InstrumentProfile[] = [
    /* 0  Acoustic_Grand    */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 1  Electric_Piano_1  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 90,  needsCC11: false },
    /* 2  Electric_Piano_2  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 90,  needsCC11: false },
    /* 3  Warm_EP           */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 85,  needsCC11: false },
    /* 4  Lofi_Piano        */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 79], maxVelocity: 80,  needsCC11: false },
    /* 5  Rock_Organ        */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 95,  needsCC11: false },
    /* 6  Violin            */ { envelope: AcousticEnvelope.Sustained, safeRange: [55, 84], maxVelocity: 80, needsCC11: true },
    /* 7  Cello             */ { envelope: AcousticEnvelope.Sustained, safeRange: [36, 65], maxVelocity: 85, needsCC11: true },
    /* 8  Contrabass        */ { envelope: AcousticEnvelope.Sustained, safeRange: [28, 55], maxVelocity: 85, needsCC11: true },
    /* 9  String_Ensemble   */ { envelope: AcousticEnvelope.Pad,       safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 10 String_Ensemble_2 */ { envelope: AcousticEnvelope.Pad,       safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 11 Tremolo_Strings   */ { envelope: AcousticEnvelope.Sustained, safeRange: [48, 79], maxVelocity: 80, needsCC11: true },
    /* 12 Pizzicato_Strings */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 79], maxVelocity: 95, needsCC11: false },
    /* 13 Flute             */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 85, needsCC11: true, windProfile: WIND_PROFILES.flute },
    /* 14 Oboe              */ { envelope: AcousticEnvelope.Sustained, safeRange: [58, 79], maxVelocity: 80, needsCC11: true, windProfile: WIND_PROFILES.reed },
    /* 15 Clarinet          */ { envelope: AcousticEnvelope.Sustained, safeRange: [50, 79], maxVelocity: 85, needsCC11: true, windProfile: WIND_PROFILES.reed },
    /* 16 Alto_Sax          */ { envelope: AcousticEnvelope.Sustained, safeRange: [55, 76], maxVelocity: 90, needsCC11: true, windProfile: WIND_PROFILES.sax },
    /* 17 Tenor_Sax         */ { envelope: AcousticEnvelope.Sustained, safeRange: [44, 72], maxVelocity: 90, needsCC11: true, windProfile: WIND_PROFILES.sax },
    /* 18 Muted_Trumpet     */ { envelope: AcousticEnvelope.Sustained, safeRange: [52, 79], maxVelocity: 85, needsCC11: true, windProfile: WIND_PROFILES.brass },
    /* 19 Recorder          */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 80, needsCC11: true, windProfile: WIND_PROFILES.flute },
    /* 20 Ocarina           */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 84], maxVelocity: 80, needsCC11: true, windProfile: WIND_PROFILES.flute },
    /* 21 Acoustic_Guitar_Nylon */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 95,  needsCC11: false },
    /* 22 Acoustic_Guitar_Steel */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 100, needsCC11: false },
    /* 23 Acoustic_Guitar_Chord */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 76], maxVelocity: 100, needsCC11: false },
    /* 24 Clean_Guitar          */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 95,  needsCC11: false },
    /* 25 Electric_Guitar_Clean */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 100, needsCC11: false },
    /* 26 Overdriven_Guitar     */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 110, needsCC11: false },
    /* 27 Distortion_Guitar     */ { envelope: AcousticEnvelope.Plucked, safeRange: [40, 79], maxVelocity: 115, needsCC11: false },
    /* 28 Harmonica              */ { envelope: AcousticEnvelope.Sustained, safeRange: [60, 79], maxVelocity: 85, needsCC11: true, windProfile: WIND_PROFILES.reed },
    /* 29 Acoustic_Bass      */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 110, needsCC11: false },
    /* 30 Electric_Bass_Finger */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 115, needsCC11: false },
    /* 31 Electric_Bass_Pick */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 115, needsCC11: false },
    /* 32 Fretless_Bass      */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 100, needsCC11: false },
    /* 33 Synth_Bass_1       */ { envelope: AcousticEnvelope.Bass, safeRange: [24, 43], maxVelocity: 100, needsCC11: false },
    /* 34 Synth_Bass_2       */ { envelope: AcousticEnvelope.Bass, safeRange: [24, 43], maxVelocity: 100, needsCC11: false },
    /* 35 Slap_Bass_1        */ { envelope: AcousticEnvelope.Bass, safeRange: [28, 43], maxVelocity: 110, needsCC11: false },
    /* 36 Lead_1_Square      */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 37 Lead_2_Sawtooth    */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 38 Synth_Calliope     */ { envelope: AcousticEnvelope.Sustained, safeRange: [48, 79], maxVelocity: 85,  needsCC11: true },
    /* 39 Synth_Brass_1      */ { envelope: AcousticEnvelope.Sustained, safeRange: [36, 79], maxVelocity: 90,  needsCC11: false },
    /* 40 Synth_Lead         */ { envelope: AcousticEnvelope.Plucked,   safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 41 Pad_1_NewAge       */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 42 Pad_2_Warm         */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 43 Pad_3_Polysynth    */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 44 Synth_Strings_1    */ { envelope: AcousticEnvelope.Pad, safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 45 Choir_Aahs   */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 46 Voice_Oohs   */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 70, needsCC11: true },
    /* 47 Solo_Vox     */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 75, needsCC11: true },
    /* 48 Marimba      */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 76], maxVelocity: 105, needsCC11: false },
    /* 49 Vibraphone   */ { envelope: AcousticEnvelope.Plucked, safeRange: [60, 84], maxVelocity: 95,  needsCC11: false },
    /* 50-54 Drums     */ { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    { envelope: AcousticEnvelope.Plucked, safeRange: [35, 81], maxVelocity: 127, needsCC11: false },
    /* 55 Reverse_Cymbal  */ { envelope: AcousticEnvelope.Plucked, safeRange: [48, 84], maxVelocity: 100, needsCC11: false },
    /* 56 Music_Box       */ { envelope: AcousticEnvelope.Plucked, safeRange: [72, 96], maxVelocity: 85,  needsCC11: false },
    /* 57 Glockenspiel    */ { envelope: AcousticEnvelope.Plucked, safeRange: [72, 96], maxVelocity: 90,  needsCC11: false },
    /* 58 Orchestral_Harp */ { envelope: AcousticEnvelope.Plucked, safeRange: [36, 84], maxVelocity: 95,  needsCC11: false },
    /* 59 System_Aura     */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 70,  needsCC11: false },
    /* 60 Breath_Noise    */ { envelope: AcousticEnvelope.Pad,     safeRange: [48, 72], maxVelocity: 80,  needsCC11: false },
];

export function getInstrumentIdByName(name: string): InstrumentId {
    for (let id = 0; id < 61; id++) {
        if (InstrumentId[id] === name) return id as InstrumentId;
    }
    return InstrumentId.Acoustic_Grand;
}
