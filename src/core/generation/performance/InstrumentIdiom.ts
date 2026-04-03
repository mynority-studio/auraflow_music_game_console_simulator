import { NoteData, GeneratedChord, RuntimeIdiomPreferences } from '../types';
import { PianoIdiom } from './idioms/PianoIdiom';
import { GuitarIdiom } from './idioms/GuitarIdiom';
import { StringIdiom } from './idioms/StringIdiom';
import { DrumIdiom } from './idioms/DrumIdiom';
import { WindIdiom } from './idioms/WindIdiom';
import { BassIdiom } from './idioms/BassIdiom';
import { SynthVoiceIdiom } from './idioms/SynthVoiceIdiom';
import { SynthIdiom } from './idioms/SynthIdiom';
import { InstrumentId, InstrumentIdFamily } from '../config/InstrumentFlags';

// T-1 合规：禁止字符串子串匹配做乐器路由，改用枚举查表
// InstrumentIndex[name] -> InstrumentFamily 仅在 API 入口处使用一次
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

    public static apply(notes: NoteData[], instrumentId: InstrumentId, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const family = resolveInstrumentFamily(instrumentId);

        // T-1 合规：枚举分发，无字符串子串匹配
        switch (family) {
            case InstrumentFamily.Drums:   return this.drumEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.String:  return this.stringEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Wind:    return this.windEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Guitar:  return this.guitarEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Bass:    return this.bassEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Synth:   return this.synthEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Piano:   return this.pianoEngine.apply(notes, instrumentId, chords, idiomPreferences);
            case InstrumentFamily.Voice:   return this.synthVoiceEngine.apply(notes, instrumentId, chords, idiomPreferences);
            default:                       return notes;
        }
    }

    public static humanize(notes: NoteData[], instrumentId: InstrumentId, swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const family = resolveInstrumentFamily(instrumentId);

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
