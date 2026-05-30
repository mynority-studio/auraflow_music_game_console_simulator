// ============================================================
// ImproCore engine — ChordSymbol + Chord
// imp/data/ChordSymbol.java + imp/data/Chord.java(生成路径子集)
// ============================================================
//
// 和弦名 → root + type 解析,再以 "C"+type 查词汇拿 ChordForm,按 root 移调出音集。
//   "Amaj7" → root "A", type "maj7" → 查 "Cmaj7" → getSpell("A")
//   支持:NOCHORD(NC)、普通和弦、slash 和弦(/bass)。
//   polychord(反斜杠)Phase 1 仅解析、实现回退主和弦(TODO)。
// ============================================================

import { ChordForm, getChordForm } from './vocab';
import { NoteSymbol, pitchClassIndexFromName, semitonesOf } from './pitch';
import { QUARTER } from './constants';

export const NOCHORD = 'NC';
const CROOT = 'C';
const SLASH = '/';
const BACKSLASH = '\\';

const isValidStem = (c: string): boolean => 'abcdefg'.indexOf(c.toLowerCase()) >= 0;

export interface ChordSymbol {
    name: string;
    type: string;
    rootString: string;     // 原始大小写,如 "A" / "Bb" / "F#"
    rootIndex: number;      // PitchClass line-of-fifths index
    bassString: string;
    isNoChord: boolean;
    polybaseName: string | null;
}

/** ChordSymbol.makeChordSymbol(name):解析和弦名 */
export function makeChordSymbol(name: string): ChordSymbol | null {
    if (name === '') return null;

    if (name === NOCHORD) {
        return {
            name, type: NOCHORD, rootString: CROOT, rootIndex: pitchClassIndexFromName('c')!,
            bassString: CROOT, isNoChord: true, polybaseName: null,
        };
    }

    const len = name.length;
    if (!isValidStem(name.charAt(0))) return null;

    let rootString = name.charAt(0);
    let index = 1;
    if (index < len) {
        const c = name.charAt(1);
        if (c === '#' || c === 'b') { rootString += c; index++; }
    }

    const rootIndex = pitchClassIndexFromName(rootString.toLowerCase());
    if (rootIndex === null) return null;

    // type = 到 / 或 \ 为止
    let type = '';
    while (index < len && name.charAt(index) !== SLASH && name.charAt(index) !== BACKSLASH) {
        type += name.charAt(index);
        index++;
    }

    let bassString = rootString;
    let polybaseName: string | null = null;
    if (index < len) {
        if (name.charAt(index) === SLASH) {
            bassString = name.substring(index + 1);
            if (pitchClassIndexFromName(bassString.toLowerCase()) === null) return null;
        } else {
            // polychord(反斜杠)— Phase 1 仅记录
            polybaseName = name.substring(index + 1);
        }
    }

    // 校验:词汇里要有 "C"+type
    if (getChordForm(CROOT + type) === null) return null;

    return { name, type, rootString, rootIndex, bassString, isNoChord: false, polybaseName };
}

// ------------------------------------------------------------
// Chord
// ------------------------------------------------------------

export class Chord {
    readonly symbol: ChordSymbol;
    rhythmValue: number;

    private constructor(symbol: ChordSymbol, rhythmValue: number) {
        this.symbol = symbol;
        this.rhythmValue = rhythmValue;
    }

    /** Chord.makeChord(name, rhythmValue);名字非法返回 null */
    static makeChord(name: string, rhythmValue: number = QUARTER): Chord | null {
        const symbol = makeChordSymbol(name);
        if (symbol === null) return null;
        return new Chord(symbol, rhythmValue);
    }

    getName(): string { return this.symbol.name; }
    getRoot(): string { return this.symbol.rootString; }
    /** root 的 semitonesAboveC(0-11) */
    getRootSemitones(): number { return semitonesOf(this.symbol.rootIndex); }
    getType(): string { return this.symbol.type; }
    getBass(): string { return this.symbol.bassString; }
    isNOCHORD(): boolean { return this.symbol.isNoChord; }

    getChordForm(): ChordForm | null {
        if (this.symbol.isNoChord) return null;
        return getChordForm(CROOT + this.symbol.type);
    }

    getFamily(): string {
        const form = this.getChordForm();
        return form ? form.family : 'other';
    }

    // --- 音集(按 root 移调) ---

    getSpell(): NoteSymbol[] {
        const f = this.getChordForm();
        return f ? f.getSpell(this.symbol.rootString) : [];
    }

    getColor(): NoteSymbol[] {
        const f = this.getChordForm();
        return f ? f.getColor(this.symbol.rootString) : [];
    }

    getPriority(): NoteSymbol[] {
        const f = this.getChordForm();
        return f ? f.getPriority(this.symbol.rootString) : [];
    }

    getSpellMIDIarray(): number[] { return this.getSpell().map(ns => ns.getMIDI()); }
    getColorMIDIarray(): number[] { return this.getColor().map(ns => ns.getMIDI()); }
    getPriorityMIDIarray(): number[] { return this.getPriority().map(ns => ns.getMIDI()); }

    /** 第一个音阶的 pitch classes(移到本和弦 root);无音阶/未注入返 null */
    getFirstScalePCs(): number[] | null {
        const f = this.getChordForm();
        return f ? f.getFirstScalePCs(this.symbol.rootString) : null;
    }
}
