import { NoteData, GeneratedChord } from '../types';
import { PianoIdiom } from './idioms/PianoIdiom';
import { GuitarIdiom } from './idioms/GuitarIdiom';
import { StringIdiom } from './idioms/StringIdiom';
import { DrumIdiom } from './idioms/DrumIdiom';
import { WindIdiom } from './idioms/WindIdiom';
import { BassIdiom } from './idioms/BassIdiom';
import { SynthVoiceIdiom } from './idioms/SynthVoiceIdiom';
import { SynthIdiom } from './idioms/SynthIdiom';

export class InstrumentIdiom {
    // 静态实例化策略类（单例模式节省内存）
    private static pianoEngine = new PianoIdiom();
    private static guitarEngine = new GuitarIdiom();
    private static stringEngine = new StringIdiom();
    private static drumEngine = new DrumIdiom();
    private static windEngine = new WindIdiom();
    private static bassEngine = new BassIdiom();
    private static synthVoiceEngine = new SynthVoiceIdiom();
    private static synthEngine = new SynthIdiom();

    public static apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        
        // 智能路由分发 (Router)
        if (instrumentName.includes('Drum') || instrumentName === 'Drums') {
            return this.drumEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('String') || instrumentName.includes('Violin')) {
            return this.stringEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Sax') || instrumentName.includes('Flute') || instrumentName.includes('Clarinet') || instrumentName.includes('Trumpet')) {
            return this.windEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Guitar')) {
            return this.guitarEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Bass')) {
            return this.bassEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Synth') || instrumentName.includes('Pad') || instrumentName.includes('Lead') || instrumentName.includes('Arp')) {
            return this.synthEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Piano') || instrumentName.includes('EP') || instrumentName.includes('Clavinet') || instrumentName.includes('Harpsichord')) {
            return this.pianoEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        else if (instrumentName.includes('Voice') || instrumentName.includes('Choir') || instrumentName.includes('Vocal')) {
            return this.synthVoiceEngine.apply(notes, instrumentName, chords, idiomPreferences);
        }
        
        // 如果找不到匹配的乐器类别，原样返回（Fallback）
        return notes; 
    }

    public static humanize(notes: NoteData[], instrumentName: string, swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        if (instrumentName.includes('Drum') || instrumentName === 'Drums') {
            return this.drumEngine.humanize(notes, swingRatio, swingSubdivision, false, idiomPreferences);
        }
        else if (instrumentName.includes('String') || instrumentName.includes('Violin')) {
            return this.stringEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Sax') || instrumentName.includes('Flute') || instrumentName.includes('Clarinet') || instrumentName.includes('Trumpet')) {
            return this.windEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Guitar')) {
            return this.guitarEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Bass')) {
            return this.bassEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Synth') || instrumentName.includes('Pad') || instrumentName.includes('Lead') || instrumentName.includes('Arp')) {
            return this.synthEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Piano') || instrumentName.includes('EP') || instrumentName.includes('Clavinet') || instrumentName.includes('Harpsichord')) {
            return this.pianoEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        else if (instrumentName.includes('Voice') || instrumentName.includes('Choir') || instrumentName.includes('Vocal')) {
            return this.synthVoiceEngine.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
        }
        
        // 默认回退到不处理
        return notes;
    }
}