// ============================================================
// ImproCore engine — Rectify(把旋律吸附到当前和弦音阶)
// imp/lickgen RECTIFY(默认 true)+ Notate.rectifySelection 的精神
// ============================================================
//
// IV 生成旋律后默认 rectify=true:逐音检查,若不在当前和弦的音阶内,
// 就吸附到最近的音阶音(就近升/降)。消掉真·调外音,让 solo 与和弦/伴奏
// 始终在同一音阶上(调式色彩音如 dorian 6 在和弦音阶内,会保留)。
//
// onlyChordTones=true 时吸附到和弦音(更"内");否则吸附到和弦首音阶。
// ============================================================

import type { ChordPart } from './chordpart';
import type { SlotNote } from './lickgen';

/** 取当前和弦的吸附目标 pitch-class 集 */
function targetPCs(cp: ChordPart, slot: number, onlyChordTones: boolean): number[] | null {
    const ch = cp.getCurrentChord(slot);
    if (!ch || ch.isNOCHORD()) return null;
    const chordPCs = ch.getSpellMIDIarray().map(m => ((m % 12) + 12) % 12);
    if (onlyChordTones) return chordPCs;
    const scale = ch.getFirstScalePCs();
    return scale && scale.length > 0 ? scale : chordPCs; // 无音阶 → 退化到和弦音
}

/**
 * 把旋律吸附进当前和弦音阶(就近)。已在音阶内的音不动。
 * @param onlyChordTones true=吸附到和弦音(最"内"),false=和弦首音阶(默认,保留调式色彩)
 */
export function rectify(notes: SlotNote[], cp: ChordPart, onlyChordTones = false): SlotNote[] {
    return notes.map(n => {
        if (n.pitch < 0) return n; // 休止
        const pcs = targetPCs(cp, n.startSlot, onlyChordTones);
        if (!pcs) return n;
        const pc = ((n.pitch % 12) + 12) % 12;
        if (pcs.includes(pc)) return n; // 已在音阶内
        // 就近吸附:先看 ±1、±2 … 谁先命中音阶
        for (let d = 1; d <= 6; d++) {
            if (pcs.includes(((pc + d) % 12 + 12) % 12)) return { ...n, pitch: n.pitch + d };
            if (pcs.includes(((pc - d) % 12 + 12) % 12)) return { ...n, pitch: n.pitch - d };
        }
        return n;
    });
}

// ------------------------------------------------------------
// 锁定全曲调性:推断主调 + 吸附到该大调音阶(全程一个调,最"统一")
// ------------------------------------------------------------

const majorScale = (root: number): number[] => [0, 2, 4, 5, 7, 9, 11].map(x => (x + root) % 12);

/** 从和弦进行推断主调(大调根音 pc):用所有和弦音投票,选覆盖最多的大调音阶 */
export function inferKey(cp: ChordPart): number {
    const pcs: number[] = [];
    for (const span of cp.getSpans()) for (const m of span.chord.getSpellMIDIarray()) pcs.push(((m % 12) + 12) % 12);
    let bestRoot = 0, bestScore = -1;
    for (let r = 0; r < 12; r++) {
        const scale = new Set(majorScale(r));
        const score = pcs.filter(pc => scale.has(pc)).length;
        if (score > bestScore) { bestScore = score; bestRoot = r; }
    }
    return bestRoot;
}

/** 把旋律吸附到指定大调音阶(就近)——全曲锁定一个调 */
export function rectifyToKey(notes: SlotNote[], keyRoot: number): SlotNote[] {
    const scale = new Set(majorScale(keyRoot));
    return notes.map(n => {
        if (n.pitch < 0) return n;
        const pc = ((n.pitch % 12) + 12) % 12;
        if (scale.has(pc)) return n;
        for (let d = 1; d <= 6; d++) {
            if (scale.has(((pc + d) % 12 + 12) % 12)) return { ...n, pitch: n.pitch + d };
            if (scale.has(((pc - d) % 12 + 12) % 12)) return { ...n, pitch: n.pitch - d };
        }
        return n;
    });
}
