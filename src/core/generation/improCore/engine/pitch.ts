// ============================================================
// ImproCore engine — 音高地基:PitchClass + NoteSymbol
// imp/data/PitchClass.java + imp/data/NoteSymbol.java 的忠实移植
// ============================================================
//
// PitchClass:不带八度的音级,用 "line of fifths" 索引(0-20,fb…b#)唯一表示。
//   - index            : 五度圈位置(决定拼写)
//   - semitonesAboveC  : 0-11 音级(决定 MIDI / enharmonic)
//   - sharpPreference  : 该音对应大调是否偏好升号(findRise 用)
//   移调走预算好的 up/down 表,保证升降号拼写一致(不混用)。
//
// NoteSymbol:PitchClass + 八度 + 时值。leadsheet 写法 "c8" / "e-8" / "f#8" / "c+8"。
//   MIDI = semitones + CMIDI + 12*octave,CMIDI=60(c8 = 中央 C 60)。
// ============================================================

import { CMIDI, OCTAVE } from './constants';
import { getDuration as parseDuration, durationToString } from './duration';

// ------------------------------------------------------------
// PitchClass — line-of-fifths 表(index 0..20)
// ------------------------------------------------------------

export interface PitchClassDef {
    readonly index: number;
    readonly name: string;
    readonly semitones: number;       // semitonesAboveC, 0-11
    readonly natural: boolean;
    readonly sharp: boolean;          // 非 natural 时:true=升,false=降
    readonly sharpPreference: boolean;
}

// 顺序即 index;数据逐字对应 PitchClass.java 的 pitchClass[]
export const PITCH_CLASSES: readonly PitchClassDef[] = [
    { index: 0,  name: 'fb', semitones: 4,  natural: false, sharp: false, sharpPreference: false },
    { index: 1,  name: 'cb', semitones: 11, natural: false, sharp: false, sharpPreference: false },
    { index: 2,  name: 'gb', semitones: 6,  natural: false, sharp: false, sharpPreference: false },
    { index: 3,  name: 'db', semitones: 1,  natural: false, sharp: false, sharpPreference: false },
    { index: 4,  name: 'ab', semitones: 8,  natural: false, sharp: false, sharpPreference: false },
    { index: 5,  name: 'eb', semitones: 3,  natural: false, sharp: false, sharpPreference: false },
    { index: 6,  name: 'bb', semitones: 10, natural: false, sharp: false, sharpPreference: false },
    { index: 7,  name: 'f',  semitones: 5,  natural: true,  sharp: false, sharpPreference: false },
    { index: 8,  name: 'c',  semitones: 0,  natural: true,  sharp: false, sharpPreference: false },
    { index: 9,  name: 'g',  semitones: 7,  natural: true,  sharp: false, sharpPreference: true  },
    { index: 10, name: 'd',  semitones: 2,  natural: true,  sharp: false, sharpPreference: true  },
    { index: 11, name: 'a',  semitones: 9,  natural: true,  sharp: false, sharpPreference: true  },
    { index: 12, name: 'e',  semitones: 4,  natural: true,  sharp: false, sharpPreference: true  },
    { index: 13, name: 'b',  semitones: 11, natural: true,  sharp: false, sharpPreference: true  },
    { index: 14, name: 'f#', semitones: 6,  natural: false, sharp: true,  sharpPreference: true  },
    { index: 15, name: 'c#', semitones: 1,  natural: false, sharp: true,  sharpPreference: true  },
    { index: 16, name: 'g#', semitones: 8,  natural: false, sharp: true,  sharpPreference: false },
    { index: 17, name: 'd#', semitones: 3,  natural: false, sharp: true,  sharpPreference: false },
    { index: 18, name: 'a#', semitones: 10, natural: false, sharp: true,  sharpPreference: false },
    { index: 19, name: 'e#', semitones: 5,  natural: false, sharp: true,  sharpPreference: false },
    { index: 20, name: 'b#', semitones: 0,  natural: false, sharp: true,  sharpPreference: false },
];

export const C_INDEX = 8;

// 渲染常量(PitchClass.java 143-164):移调表里的符号 → 简化后的 index
// (ds→eb=5, as→bb=6, es→f=7, bs→c=8, fb→e=12, cb→b=13)
const R: Record<string, number> = {
    fb: 12, cb: 13, gb: 2, db: 3, ab: 4, eb: 5, bb: 6, f: 7, c: 8, g: 9,
    d: 10, a: 11, e: 12, b: 13, fs: 14, cs: 15, gs: 16, ds: 5, as: 6, es: 7, bs: 8,
};

const resolve = (rows: string[]): number[][] => rows.map(r => r.trim().split(/\s+/).map(s => R[s]!));

// PitchClass.java upTranspositions[semitone 0-11][index 0-20] —— 逐行照抄
const UP = resolve([
    'fb cb gb db ab eb bb f c g d a e b fs cs gs ds as es bs',
    'f c g d a e b fs cs gs ds as es bs g d a e b fs cs',
    'fs cs gs ds as f c g d a e b fs cs gs ds as es bs g d',
    'g d a e b fs cs gs ds as f c g d a e b fs cs gs ds',
    'gs ds as f c g d a e b fs cs gs ds as es bs g d a e',
    'a e b fs cs gs ds as es c g d a e b fs cs gs ds as es',
    'as f c g d a e b fs cs gs ds as es bs g d a e b fs',
    'b fs cs gs ds as f c g d a e b fs cs gs ds as es bs g',
    'c g d a e b fs cs gs ds as es bs g d a e b fs cs gs',
    'cs gs ds as f c g d a e b fs cs gs ds as es bs g d a',
    'd a e b fs cs gs ds as f c g d a e b fs cs gs ds as',
    'ds as f c g d a e b fs cs gs ds as es bs g d a e b',
]);

// PitchClass.java downTranspositions
const DOWN = resolve([
    'fb cb gb db ab eb bb f c g d a e b fs cs gs ds as es bs',
    'eb bb f c g d a e b gb db ab eb bb f c g d a e b',
    'd a fb cb gb db ab eb bb f c g d a e b gb db ab eb bb',
    'db ab eb bb f c g d a e b gb db ab eb bb f c g d a',
    'c g d a fb cb gb db ab eb bb f c g d a e b gb db ab',
    'cb gb db ab eb bb f c g d a e b gb db ab eb bb f c g',
    'bb f c g d a e cb gb db ab eb bb f c g d a e b gb',
    'a fb cb gb db ab eb bb f c g d a e b gb db ab eb bb f',
    'ab eb bb f c g d a e b gb db ab eb bb f c g d a f',
    'g d a fb cb gb db ab eb bb f c g d a e b gb db ab eb',
    'gb db ab eb bb f c g d a e b gb db ab eb bb f c g d',
    'f c g d a fb cb gb db ab eb bb f c g d a e b gb db',
]);

/** 由音名取 PitchClass index(f=7,c=8,g=9,d=10,a=11,e=12,b=13;次字符 b→−7,#→+7) */
export function pitchClassIndexFromName(name: string): number | null {
    if (name.length === 0) return null;
    const lc = name.toLowerCase();
    let index = -1;
    switch (lc.charAt(0)) {
        case 'f': index = 7;  break;
        case 'c': index = 8;  break;
        case 'g': index = 9;  break;
        case 'd': index = 10; break;
        case 'a': index = 11; break;
        case 'e': index = 12; break;
        case 'b': index = 13; break;
    }
    if (index < 0) return null;
    if (lc.length > 1) {
        if (lc.charAt(1) === 'b') index -= 7;
        else if (lc.charAt(1) === '#') index += 7;
    }
    if (index < 0 || index > 20) return null;
    return index;
}

export const semitonesOf = (pcIndex: number): number => PITCH_CLASSES[pcIndex]!.semitones;

/** PitchClass.transpose(semitones):走 up/down 表,返回新 index(保持拼写一致) */
export function transposePitchClass(pcIndex: number, semitones: number): number {
    if (semitones >= 0) {
        const s = semitones % 12;
        if (s === 0) return pcIndex;
        return UP[s]![pcIndex]!;
    } else {
        const s = (-semitones) % 12;
        if (s === 0) return pcIndex;
        return DOWN[s]![pcIndex]!;
    }
}

/**
 * PitchClass.findRise(from,to):求把 from 移到 to 的 signed 半音数,
 * 用 sharpPreference 决定走升(正)还是降(负)以协调拼写。
 */
export function findRise(fromIndex: number, toIndex: number): number {
    const fromPc = PITCH_CLASSES[fromIndex]!;
    const toPc = PITCH_CLASSES[toIndex]!;
    let rise = toPc.semitones - fromPc.semitones;
    if (rise >= OCTAVE) rise = rise % OCTAVE;
    else if (rise < 0) rise = OCTAVE - ((-rise) % OCTAVE);

    if (rise > 0 && !toPc.sharpPreference) rise = -(OCTAVE - rise);
    else if (rise < 0 && toPc.sharpPreference) rise = -(OCTAVE + rise);
    return rise;
}

/** findRise(C → to):和弦按 root 移调时用 */
export const findRiseFromC = (toIndex: number): number => findRise(C_INDEX, toIndex);

// ------------------------------------------------------------
// NoteSymbol — PitchClass + 八度 + 时值
// ------------------------------------------------------------

export const REST_PITCH_INDEX = null;

export class NoteSymbol {
    /** null 表示休止 */
    readonly pcIndex: number | null;
    readonly octave: number;
    readonly duration: number;

    constructor(pcIndex: number | null, octave: number, duration: number) {
        this.pcIndex = pcIndex;
        this.octave = octave;
        this.duration = duration;
    }

    isRest(): boolean { return this.pcIndex === null; }

    /** semitonesAboveC,休止返回 -1 */
    getSemitones(): number {
        return this.pcIndex === null ? -1 : semitonesOf(this.pcIndex);
    }

    getMIDIoctave(): number { return CMIDI + 12 * this.octave; }

    /** MIDI pitch,休止返回 -1 */
    getMIDI(): number {
        if (this.pcIndex === null) return -1;
        return semitonesOf(this.pcIndex) + this.getMIDIoctave();
    }

    enharmonic(other: NoteSymbol): boolean {
        return this.getSemitones() === other.getSemitones();
    }

    /** NoteSymbol.transpose(rise):新音级 + 八度跟随调整,拼写走 transposePitchClass */
    transpose(rise: number): NoteSymbol {
        if (this.pcIndex === null || rise === 0) return this;
        let newOctave = this.octave;
        let newSemitones = semitonesOf(this.pcIndex) + rise;
        while (newSemitones >= 12) { newOctave++; newSemitones -= 12; }
        while (newSemitones < 0) { newOctave--; newSemitones += 12; }
        return new NoteSymbol(transposePitchClass(this.pcIndex, rise), newOctave, this.duration);
    }

    /** leadsheet 写法,如 "c+8" / "f#8" / "r4" */
    toString(): string {
        if (this.pcIndex === null) return 'r' + durationToString(this.duration);
        let s = PITCH_CLASSES[this.pcIndex]!.name;
        let o = this.octave;
        while (o >= 1) { s += '+'; o--; }
        while (o < 0) { s += '-'; o++; }
        return s + durationToString(this.duration);
    }
}

/** NoteSymbol.makeNoteSymbol(string, transposition):leadsheet 字符串 → NoteSymbol */
export function makeNoteSymbol(str: string, transposition = 0): NoteSymbol | null {
    const len = str.length;
    if (len === 0) return null;
    const s = str.toLowerCase();
    const c0 = s.charAt(0);

    // 休止
    if (c0 === 'r') {
        return new NoteSymbol(null, 0, parseDuration(s.substring(1)));
    }

    if ('cdefgab'.indexOf(c0) < 0) return null;

    let index = 1;
    const noteBase: string[] = [c0];
    if (index < len) {
        const second = s.charAt(1);
        if (second === '#' || second === 'b' || second === 's') {
            index++;
            noteBase.push(second === 's' ? '#' : second);
        }
    }

    let pcIndex = pitchClassIndexFromName(noteBase.join(''));
    if (pcIndex === null) return null;
    if (transposition !== 0) pcIndex = transposePitchClass(pcIndex, transposition);

    // 八度标记:+ / u 升,- 降
    let octave = 0;
    let more = true;
    while (index < len && more) {
        const ch = s.charAt(index);
        if (ch === '+' || ch === 'u') { octave++; index++; }
        else if (ch === '-') { octave--; index++; }
        else more = false;
    }

    const duration = parseDuration(s.substring(index));
    return new NoteSymbol(pcIndex, octave, duration);
}

/** 整列移调(ChordForm getSpell/getColor/getPriority 用) */
export const transposeNoteSymbolList = (list: NoteSymbol[], rise: number): NoteSymbol[] =>
    list.map(ns => ns.transpose(rise));

/** NoteSymbol 列 → MIDI 数组 */
export const noteSymbolListToMIDIarray = (list: NoteSymbol[]): number[] =>
    list.map(ns => ns.getMIDI());
