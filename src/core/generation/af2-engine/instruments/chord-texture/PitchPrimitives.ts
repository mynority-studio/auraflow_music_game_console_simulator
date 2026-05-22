// ============================================================
// PitchPrimitives — 9 个音高 grammar primitive(纯函数)
// ============================================================
//
// 从 mg.applyTexture 提取,作为 AF2 自有 chord-aware / quality-aware /
// next-chord-aware 计算库。
//
// 设计原则:
//   1. **纯函数** — 不依赖 class state
//   2. **Random 显式注入** — 不用 this.random
//   3. **Smart Omit 内置** — chordVoicing 自动处理 FirstInversion(对齐 mg 行为)
//
// 参考:af2-engine/CHORD_TEXTURE_ENGINE.md §2。
// ============================================================

import type { ChordDef, Random } from '../../../mg-engine/musicEngine';
import { BASS_RANGE } from '../../music-theory';

/** 基础 bass — chord.bassMidi 直接读 */
export function bassMidi(chord: ChordDef): number {
    return chord.bassMidi;
}

/** 八度低 bass,带 BASS_RANGE.LOW 保护(避免越界为不相关 pc) */
export function bassMidiLow(chord: ChordDef): number {
    const bM = chord.bassMidi;
    return (bM - 12 >= BASS_RANGE.LOW) ? bM - 12 : bM;
}

/** 根音锚点(处理转位 — bass 可能是 3rd 或 5th,但 root 永远是 root pc) */
export function rootAnchor(chord: ChordDef): number {
    const rootPc = (((chord.rootMidi % 12) + 12) % 12);
    const bMOct = Math.floor(chord.bassMidi / 12);
    const sameOct = bMOct * 12 + rootPc;
    return sameOct >= chord.bassMidi ? sameOct : sameOct + 12;
}

/** 根音锚点低八度 */
export function rootAnchorLow(chord: ChordDef): number {
    const bRoot = rootAnchor(chord);
    return (bRoot - 12 >= BASS_RANGE.LOW) ? bRoot - 12 : bRoot;
}

/**
 * chord 全音(含 Smart Omit 处理 — FirstInversion 时去掉 3rd 避撞 bass)。
 * 对齐 mg.applyTexture L3492-L3500 行为。
 */
export function chordVoicing(chord: ChordDef): number[] {
    let cM = chord.notesMidi.slice();

    if (chord.tensionState === 'FirstInversion') {
        const rootPc = (((chord.rootMidi % 12) + 12) % 12);
        const bassPc = (((chord.bassMidi % 12) + 12) % 12);
        const bassIvToRoot = ((bassPc - rootPc + 12) % 12);
        if (bassIvToRoot === 3 || bassIvToRoot === 4) {
            cM = cM.filter(m => {
                const pc = (((m % 12) + 12) % 12);
                const ivToRoot = ((pc - rootPc + 12) % 12);
                return ivToRoot !== 3 && ivToRoot !== 4;
            });
        }
    }
    return cM;
}

// ============================================================
// Quality-aware 音程
// ============================================================

/** quality-aware 第三度(min/dim → 3,maj → 4) */
export function thirdInterval(chord: ChordDef): 3 | 4 {
    const t = chord.type;
    const isMinor = t === 'min' || t === 'm'
        || (t.startsWith('m') && !t.startsWith('maj'))
        || t === 'm7b5' || t === 'dim' || t === 'dim7';
    return isMinor ? 3 : 4;
}

/** quality-aware 第五度(dim 系 → 6,其余 → 7) */
export function fifthInterval(chord: ChordDef): 6 | 7 {
    const t = chord.type;
    return (t === 'dim' || t === 'dim7' || t === 'm7b5') ? 6 : 7;
}

/** quality-aware 七度音程数(maj 系 → 11,其余 → 10) */
export function seventhInterval(chord: ChordDef): 10 | 11 {
    const t = chord.type;
    const isMaj = t.startsWith('maj') || t === 'add9' || t === '6' || t === '6/9';
    return isMaj ? 11 : 10;
}

/** quality-aware chord tones [root, 3rd, 5th, 7th](MIDI 绝对值,以 bM 为根) */
export function chordTones(chord: ChordDef): number[] {
    const bM = chord.bassMidi;
    return [
        bM,
        bM + thirdInterval(chord),
        bM + fifthInterval(chord),
        bM + seventhInterval(chord),
    ];
}

// ============================================================
// Next-chord / pattern
// ============================================================

/**
 * next-chord chromatic approach(±1 或 ±2,random 决定)。
 * 对齐 mg.applyTexture L3756 逻辑。
 */
export function approachTone(
    currentChord: ChordDef,
    nextChord: ChordDef | null,
    rng: Random,
    halfStepRatio: number = 0.6,
): number {
    if (!nextChord) return currentChord.bassMidi;
    const nextRoot = nextChord.bassMidi;
    const halfStep = rng.next() < halfStepRatio;
    const direction = rng.next() < 0.5 ? -1 : 1;
    return nextRoot + direction * (halfStep ? 1 : 2);
}

/**
 * Boogie 1-3-5-6-b7-6-5-3 quality-aware pattern(8 个 octave 内偏移)。
 * 对齐 mg.applyTexture L4126+ Blues_Boogie_Woogie。
 */
export function boogiePattern(chord: ChordDef): number[] {
    const third = thirdInterval(chord);
    const fifth = fifthInterval(chord);
    return [0, third, fifth, 9, 10, 9, fifth, third];
}
