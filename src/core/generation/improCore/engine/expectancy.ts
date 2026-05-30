// ============================================================
// ImproCore engine — Expectancy(Margulis 旋律期待评分 + 择优)
// imp/lickgen/Expectancy.java 的忠实移植
// ============================================================
//
// expectancy = stability × proximity × mobility + direction
//   stability  音在和弦里的角色(root 6 > chord 5 > color 4 > outside 1)
//   proximity  与前音的音程近似度(1 半音最高,渐降)
//   direction  方向期待(小音程期待同向,大音程期待反向)
//   mobility   重复音惩罚(0.67)
//
// 用法:生成 N 条 solo,scoreMelody 取平均期待,pickBest 选最高(更平滑连贯)。
// ============================================================

import type { Chord } from './chord';
import type { ChordPart } from './chordpart';
import type { SlotNote } from './lickgen';

const PROXIMITY = [24, 36, 32, 25, 20, 16, 12, 9, 6, 4, 2, 1, 0.25, 0.02]; // index=距离;≥14 → 0.01
const DIR_SMALL = [6, 20, 12, 6, 0];                                        // intervalSize ≤4
const DIR_LARGE: Record<number, number> = { 5: 6, 6: 12, 7: 25, 8: 36, 9: 52 }; // ≥10 → 75
const REPETITION = 0.67;

function stability(pitch: number, chord: Chord | null): number {
    if (!chord || chord.isNOCHORD()) return 1;
    const pc = ((pitch % 12) + 12) % 12;
    if (pc === chord.getRootSemitones()) return 6;
    if (chord.getSpell().some(ns => ns.getSemitones() === pc)) return 5;
    if (chord.getColor().some(ns => ns.getSemitones() === pc)) return 4;
    return 1;
}

function proximity(pitch: number, prevPitch: number): number {
    const d = Math.abs(pitch - prevPitch);
    return d <= 13 ? PROXIMITY[d]! : 0.01;
}

function direction(pitch: number, prevPitch: number, prevPrevPitch: number): number {
    const intervalSize = Math.abs(prevPitch - prevPrevPitch);
    const dir = prevPitch - prevPrevPitch;
    if (intervalSize <= 4) {
        if (dir < 0) return 0;
        return DIR_SMALL[intervalSize] ?? 0;
    }
    if (dir > 0) return 0;
    return DIR_LARGE[intervalSize] ?? 75;
}

const mobility = (pitch: number, prevPitch: number): number => (pitch === prevPitch ? REPETITION : 1);

/** Expectancy.getExpectancy */
export function getExpectancy(pitch: number, prevPitch: number, prevPrevPitch: number, chord: Chord | null): number {
    return stability(pitch, chord) * proximity(pitch, prevPitch) * mobility(pitch, prevPitch) + direction(pitch, prevPitch, prevPrevPitch);
}

/** 一条 solo 的平均期待值(越高越平滑连贯) */
export function scoreMelody(notes: SlotNote[], cp: ChordPart): number {
    let prev = -1, prevPrev = -1, total = 0, count = 0;
    for (const n of notes) {
        if (n.pitch < 0) continue; // 休止
        if (prev >= 0 && prevPrev >= 0) {
            total += getExpectancy(n.pitch, prev, prevPrev, cp.getCurrentChord(n.startSlot));
            count++;
        }
        prevPrev = prev;
        prev = n.pitch;
    }
    return count > 0 ? total / count : 0;
}

/** 从多条候选 solo 里选平均期待最高的 */
export function pickBest(candidates: SlotNote[][], cp: ChordPart): SlotNote[] {
    let best = candidates[0] ?? [];
    let bestScore = -Infinity;
    for (const c of candidates) {
        const s = scoreMelody(c, cp);
        if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
}
