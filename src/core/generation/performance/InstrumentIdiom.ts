import { NoteData, GeneratedChord, RuntimeIdiomPreferences } from '../types';
import { PianoIdiom } from './idioms/PianoIdiom';
import { GuitarIdiom } from './idioms/GuitarIdiom';
import { StringIdiom } from './idioms/StringIdiom';
import { DrumIdiom } from './idioms/DrumIdiom';
import { WindIdiom } from './idioms/WindIdiom';
import { BassIdiom } from './idioms/BassIdiom';
import { SynthVoiceIdiom } from './idioms/SynthVoiceIdiom';
import { SynthIdiom } from './idioms/SynthIdiom';

// T-1 合规：禁止字符串子串匹配做乐器路由，改用枚举查表
// InstrumentIndex[name] → InstrumentFamily 仅在 API 入口处使用一次
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

/** 从乐器名称（API 入口处唯一允许的字符串查表）映射到 InstrumentFamily */
const INSTRUMENT_FAMILY_TABLE: Record<string, InstrumentFamily> = {
    // Drums
    'Standard_DrumKit':   InstrumentFamily.Drums,
    'Electronic_Drum':    InstrumentFamily.Drums,
    'Orchestral_DrumKit': InstrumentFamily.Drums,
    'Room_DrumKit':       InstrumentFamily.Drums,
    'Drums':              InstrumentFamily.Drums,
    // Strings
    'String_Ensemble':    InstrumentFamily.String,
    'String_Ensemble_2':  InstrumentFamily.String,
    'Tremolo_Strings':    InstrumentFamily.String,
    'Pizzicato_Strings':  InstrumentFamily.String,
    'Violin':             InstrumentFamily.String,
    'Cello':              InstrumentFamily.String,
    'Contrabass':         InstrumentFamily.String,
    // Wind
    'Flute':              InstrumentFamily.Wind,
    'Oboe':               InstrumentFamily.Wind,
    'Clarinet':           InstrumentFamily.Wind,
    'Alto_Sax':           InstrumentFamily.Wind,
    'Tenor_Sax':          InstrumentFamily.Wind,
    'Muted_Trumpet':      InstrumentFamily.Wind,
    'Recorder':           InstrumentFamily.Wind,
    'Ocarina':            InstrumentFamily.Wind,
    // Guitar
    'Acoustic_Guitar_Chord':  InstrumentFamily.Guitar,
    'Clean_Guitar':           InstrumentFamily.Guitar,
    'Electric_Guitar_Clean':  InstrumentFamily.Guitar,
    'Overdriven_Guitar':      InstrumentFamily.Guitar,
    'Distortion_Guitar':      InstrumentFamily.Guitar,
    'Harmonica':              InstrumentFamily.Guitar,
    // Bass
    'Electric_Bass_Finger':   InstrumentFamily.Bass,
    'Electric_Bass_Pick':     InstrumentFamily.Bass,
    'Fretless_Bass':          InstrumentFamily.Bass,
    'Acoustic_Bass':          InstrumentFamily.Bass,
    'Synth_Bass_1':           InstrumentFamily.Bass,
    'Synth_Bass_2':           InstrumentFamily.Bass,
    'Slap_Bass_1':            InstrumentFamily.Bass,
    // Synth / Pad / Lead
    'Lead_1_square':          InstrumentFamily.Synth,
    'Lead_2_sawtooth':        InstrumentFamily.Synth,
    'Synth_Calliope':         InstrumentFamily.Synth,
    'Synth_Brass_1':          InstrumentFamily.Synth,
    'Synth_Lead':             InstrumentFamily.Synth,
    'Pad_1_New_age':          InstrumentFamily.Synth,
    'Pad_1_new_age':          InstrumentFamily.Synth,
    'Pad_2_warm':             InstrumentFamily.Synth,
    'Pad_3_Polysynth':        InstrumentFamily.Synth,
    'Pad_3_polysynth':        InstrumentFamily.Synth,
    // Piano / Keys
    'Acoustic_Grand':         InstrumentFamily.Piano,
    'Warm_EP':                InstrumentFamily.Piano,
    'Electric_Piano_1':       InstrumentFamily.Piano,
    'Electric_Piano_2':       InstrumentFamily.Piano,
    'Lofi_Piano':             InstrumentFamily.Piano,
    'Rock_Organ':             InstrumentFamily.Piano,
    // Voice
    'Voice_Oohs':             InstrumentFamily.Voice,
    'Marimba':                InstrumentFamily.Voice,
};

/** API 入口处将乐器名称转换为 InstrumentFamily（仅此一处允许字符串查表） */
export function resolveInstrumentFamily(instrumentName: string): InstrumentFamily {
    const family = INSTRUMENT_FAMILY_TABLE[instrumentName];
    return family !== undefined ? family : InstrumentFamily.Unknown;
}

export class InstrumentIdiom {
    // 静态实例化策略类（单例模式节省内存）
    private static pianoEngine    = new PianoIdiom();
    private static guitarEngine   = new GuitarIdiom();
    private static stringEngine   = new StringIdiom();
    private static drumEngine     = new DrumIdiom();
    private static windEngine     = new WindIdiom();
    private static bassEngine     = new BassIdiom();
    private static synthVoiceEngine = new SynthVoiceIdiom();
    private static synthEngine    = new SynthIdiom();

    public static apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const family = resolveInstrumentFamily(instrumentName);

        // T-1 合规：枚举分发，无字符串子串匹配
        switch (family) {
            case InstrumentFamily.Drums:   return this.drumEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.String:  return this.stringEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Wind:    return this.windEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Guitar:  return this.guitarEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Bass:    return this.bassEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Synth:   return this.synthEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Piano:   return this.pianoEngine.apply(notes, instrumentName, chords, idiomPreferences);
            case InstrumentFamily.Voice:   return this.synthVoiceEngine.apply(notes, instrumentName, chords, idiomPreferences);
            default:                       return notes;
        }
    }

    public static humanize(notes: NoteData[], instrumentName: string, swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const family = resolveInstrumentFamily(instrumentName);

        switch (family) {
            case InstrumentFamily.Drums:   return this.drumEngine.humanize(notes, swingRatio, swingSubdivision, false, idiomPreferences);
            case InstrumentFamily.String:  return this.stringEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Wind:    return this.windEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Guitar:  return this.guitarEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Bass:    return this.bassEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Synth:   return this.synthEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Piano:   return this.pianoEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            case InstrumentFamily.Voice:   return this.synthVoiceEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
            default:                       return notes;
        }
    }
}
