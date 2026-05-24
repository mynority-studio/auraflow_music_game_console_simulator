// ============================================================
// PitchPrimitives — 音高 grammar primitive(纯函数,N 阶段移植)
// ============================================================
//
// 从 mg/src/lib/chord-texture/PitchPrimitives.ts 移植。
//
// 与 mg 版本区别:AF2 ChordDef 无 tensionState 字段(Composer 不做转位),
// 所以 chordVoicing() 去掉 FirstInversion 处理直接返 notesMidi。
// ============================================================

import type { ChordDef } from '../types/ChordDef';
import type { Random } from '../utils/Random';
import { BASS_RANGE } from '../music-theory';

/** 基础 bass — chord.bassMidi 直接读 */
export function bassMidi(chord: ChordDef): number {
    return chord.bassMidi;
}

/** 八度低 bass,带 BASS_RANGE.LOW 保护(避免越界为不相关 pc) */
export function bassMidiLow(chord: ChordDef): number {
    const bM = chord.bassMidi;
    return (bM - 12 >= BASS_RANGE.LOW) ? bM - 12 : bM;
}

/** 根音锚点(AF2 Composer 不做转位,root 永远是 bass;保留 helper 给 family 一致 API) */
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
 * chord 全音 voicing。
 * AF2 简化:Composer 不做转位 → 不需要 FirstInversion 去 3rd 处理。
 * 直接返 notesMidi。
 */
export function chordVoicing(chord: ChordDef): number[] {
    return chord.notesMidi.slice();
}

// ============================================================
// Quality-aware 音程(直接读 type 字符串,与 music-theory/chord-intervals 镜像)
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

/**
 * Boogie 1-3-5-6-b7-6-5-3 quality-aware pattern(8 个 octave 内偏移)。
 * 对齐 mg.applyTexture Blues_Boogie_Woogie。
 */
export function boogiePattern(chord: ChordDef): number[] {
    const third = thirdInterval(chord);
    const fifth = fifthInterval(chord);
    return [0, third, fifth, 9, 10, 9, fifth, third];
}

/**
 * next-chord chromatic approach(±1 或 ±2,random 决定)。
 * 当前 N 阶段 family 暂未用,保留给 N5 WalkingBass 移植。
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
