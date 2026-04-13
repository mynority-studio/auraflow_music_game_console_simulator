/**
 * InstrumentIdiom — 演奏表情路由分发器
 * 根据 instrumentName 分派到具体的 idiom 引擎
 * Pitch Space: ABSOLUTE（在 applyOffset 之后调用）
 */
import { NoteData, GeneratedChord } from '../types';
import { PianoIdiom } from './idioms/PianoIdiom';
import { BassIdiom } from './idioms/BassIdiom';
import { DrumIdiom } from './idioms/DrumIdiom';
import { WindIdiom } from './idioms/WindIdiom';
import { StringIdiom } from './idioms/StringIdiom';
import { SynthIdiom } from './idioms/SynthIdiom';

// 单例实例（节省内存，C 可移植时改为 static struct）
const pianoEngine = new PianoIdiom();
const bassEngine = new BassIdiom();
const drumEngine = new DrumIdiom();
const windEngine = new WindIdiom();
const stringEngine = new StringIdiom();
const synthEngine = new SynthIdiom();

function resolveEngine(instrumentName: string) {
    if (instrumentName.includes('Drum') || instrumentName === 'Drums') return drumEngine;
    if (instrumentName.includes('Bass')) return bassEngine;
    if (instrumentName.includes('String') || instrumentName.includes('Violin') || instrumentName.includes('Cello') || instrumentName.includes('Viola')) return stringEngine;
    if (instrumentName.includes('Sax') || instrumentName.includes('Flute') || instrumentName.includes('Clarinet') || instrumentName.includes('Trumpet') || instrumentName.includes('Oboe') || instrumentName.includes('Horn')) return windEngine;
    if (instrumentName.includes('Synth') || instrumentName.includes('Pad') || instrumentName.includes('Lead')) return synthEngine;
    if (instrumentName.includes('Piano') || instrumentName.includes('EP') || instrumentName.includes('Clavinet') || instrumentName.includes('Harpsichord') || instrumentName.includes('Electric_Piano')) return pianoEngine;
    if (instrumentName.includes('Guitar')) return pianoEngine; // 吉他走钢琴引擎（踏板+力度逻辑类似）
    if (instrumentName.includes('Voice') || instrumentName.includes('Choir') || instrumentName.includes('Vocal')) return synthEngine; // 人声走 synth pad 模式
    if (instrumentName.includes('Vibraphone') || instrumentName.includes('Music_Box') || instrumentName.includes('Marimba')) return pianoEngine;
    return pianoEngine; // 默认回退
}

export class InstrumentIdiom {
    public static apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        if (!notes || notes.length === 0) return notes;
        return resolveEngine(instrumentName).apply(notes, instrumentName, chords, idiomPreferences);
    }

    public static humanize(notes: NoteData[], instrumentName: string, swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        if (!notes || notes.length === 0) return notes;
        return resolveEngine(instrumentName).humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
    }
}
