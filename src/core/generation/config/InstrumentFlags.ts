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
