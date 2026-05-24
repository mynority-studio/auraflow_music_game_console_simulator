// ============================================================
// spell — Note 拼写 helpers(原 mg-engine/musicEngine.ts copy)
// ============================================================
//
// 2026-05-24:从 mg-engine 内化到 af2-engine。
//
// 函数集:
//   KEYS                    — flat-default 12-key 表(legacy 兼容)
//   spellPcInKey            — pc → 调内音符名(key-context-aware)
//   midiToNoteInKey         — MIDI → 调内音符名(带八度)
//   spellPcInChord          — pc → chord-root-relative 音符名
//   midiToNoteInChord       — MIDI → chord-relative 音符名(带八度)
//   harmonicFunctionFromRoman — Roman → T/S/D 函数分类
// ============================================================

export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const SHARP_SPELLING = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELLING  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const CIRCLE_OF_FIFTHS_POS: Record<number, number> = {
    0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
    1: -5, 8: -4, 3: -3, 10: -2, 5: -1,
};

/**
 * Spell a pitch class with the accidental matching the song's key signature.
 * D major → pc 6 = F# (not Gb). Bb major → pc 3 = Eb (not D#).
 * Minor mode maps to relative major. C major / A minor → neutral flat default.
 */
export function spellPcInKey(pc: number, keyRootPc: number, isMinor: boolean): string {
    const npc = (((pc % 12) + 12) % 12);
    const adjRoot = isMinor ? (((keyRootPc + 3) % 12) + 12) % 12 : (((keyRootPc % 12) + 12) % 12);
    const pos = CIRCLE_OF_FIFTHS_POS[adjRoot] ?? 0;
    const useSharp = pos > 0;
    return useSharp ? SHARP_SPELLING[npc] : FLAT_SPELLING[npc];
}

export function midiToNoteInKey(midi: number, keyRootPc: number, isMinor: boolean): string {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return `${spellPcInKey(pc, keyRootPc, isMinor)}${oct}`;
}

const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_NATURAL_PC: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const INTERVAL_TO_LETTER_OFFSET: Record<number, number> = {
    0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6,
};

/**
 * Spell a pc relative to chord root. b9 of A → "Bb", #11 of F → "B", b13 of G → "Eb".
 * Chord-type overrides ambiguous intervals(dim → b5, aug → #5)。
 */
export function spellPcInChord(
    pc: number,
    chordRootPc: number,
    keyRootPc: number,
    isMinor: boolean,
    chordType?: string,
): string {
    const npc = (((pc % 12) + 12) % 12);
    const rpc = (((chordRootPc % 12) + 12) % 12);
    const interval = (((npc - rpc) % 12) + 12) % 12;
    const rootName = spellPcInKey(rpc, keyRootPc, isMinor);
    const rootLetter = rootName[0];
    const rootLetterIdx = NOTE_LETTERS.indexOf(rootLetter);
    if (rootLetterIdx === -1) {
        return spellPcInKey(npc, keyRootPc, isMinor);
    }
    let letterOffset = INTERVAL_TO_LETTER_OFFSET[interval] ?? 0;
    if (chordType) {
        const isDimFamily = chordType.includes('m7b5') || chordType.includes('m9b5')
            || chordType.includes('dim');
        const isAugFamily = chordType.includes('aug') || chordType.includes('+5')
            || chordType.includes('7#5');
        if (interval === 6 && isDimFamily) letterOffset = 4;
        if (interval === 8 && isAugFamily) letterOffset = 4;
    }
    const targetLetterIdx = (rootLetterIdx + letterOffset) % 7;
    const targetLetter = NOTE_LETTERS[targetLetterIdx];
    let adj = (npc - LETTER_NATURAL_PC[targetLetter] + 12) % 12;
    if (adj > 6) adj -= 12;
    let suffix = '';
    if (adj === 2) suffix = '##';
    else if (adj === 1) suffix = '#';
    else if (adj === -1) suffix = 'b';
    else if (adj === -2) suffix = 'bb';
    return targetLetter + suffix;
}

export function midiToNoteInChord(
    midi: number,
    chordRootPc: number,
    keyRootPc: number,
    isMinor: boolean,
    chordType?: string,
): string {
    const pc = ((midi % 12) + 12) % 12;
    const stdOct = Math.floor(midi / 12) - 1;
    const name = spellPcInChord(pc, chordRootPc, keyRootPc, isMinor, chordType);
    const letter = name[0];
    const naturalPc = LETTER_NATURAL_PC[letter];
    if (naturalPc === undefined) return `${name}${stdOct}`;
    let adj = pc - naturalPc;
    if (adj > 6) adj -= 12;
    else if (adj < -6) adj += 12;
    let oct = stdOct;
    if (naturalPc + adj >= 12) oct -= 1;
    else if (naturalPc + adj < 0) oct += 1;
    return `${name}${oct}`;
}

/**
 * Roman → TSD function classifier。
 * V / vii / 任何 /X 二级属 → D
 * IV / ii / bVI / bVII → S
 * 其他 → T
 */
export function harmonicFunctionFromRoman(romanOriginal: string): 'T' | 'S' | 'D' {
    const base = romanOriginal.split('/')[0].replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
    if (['V', 'v', 'vii', 'VII'].includes(base) || romanOriginal.includes('/')) return 'D';
    if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
    return 'T';
}
