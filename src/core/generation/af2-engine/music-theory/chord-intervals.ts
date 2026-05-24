// ============================================================
// chord-intervals — Quality → 3rd / 5th / 7th interval(共享 helpers)
// ============================================================
//
// 2026-05-24 提取自 Af2MelodyGen / Af2AccompGen / BassIdiom 三处重复定义。
// 给定 ChordQuality enum,返回 chord-tone 半音间隔(从 root 起)。
// ============================================================

import { ChordQuality } from '../../types';

/** Minor 3rd(3 半音)还是 Major 3rd(4 半音)? */
export function thirdInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Minor:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.HalfDiminished:
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
            return 3;
        default:
            return 4;
    }
}

/** Diminished 5(6)/ Perfect 5(7)/ Augmented 5(8)? */
export function fifthInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
        case ChordQuality.HalfDiminished:
            return 6;
        case ChordQuality.Augmented:
            return 8;
        default:
            return 7;
    }
}

/** Major 7(11)/ Minor 7(10)/ Diminished bb7(9)? */
export function seventhInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Major7:
        case ChordQuality.Major9:
        case ChordQuality.Major13:
        case ChordQuality.Major7Sharp11:
            return 11;
        case ChordQuality.Diminished7:
            return 9;
        case ChordQuality.HalfDiminished:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.Dominant7:
        case ChordQuality.Dominant9:
        case ChordQuality.Dominant11:
        case ChordQuality.Dominant13:
            return 10;
        default:
            return 11;
    }
}
