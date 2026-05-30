// ============================================================
// ImproCore engine — Swing(摇摆节奏 warp)
// ============================================================
//
// 把直的八分网格 warp 成摇摆:每拍(120 slot)内,前八分占 ratio,后八分占 1-ratio。
//   ratio 0.5 = 直;0.67 ≈ 三连音感(长短 2:1)。
// 对 slot 位置做线性重映射(拍边界不动,只挪拍内"and"),整轨施加即可。
// Style.swing(旋律)/ comp-swing(伴奏)提供比值。
// ============================================================

import { BEAT } from './constants';
import type { SlotNote } from './lickgen';

/** 把直 slot 映射到摇摆 slot */
function warpSlot(slot: number, ratio: number, beatSlots: number): number {
    const beat = Math.floor(slot / beatSlots);
    const off = slot - beat * beatSlots;
    const half = beatSlots / 2;
    const split = beatSlots * ratio;   // 前八分时长
    const w = off <= half
        ? (off / half) * split
        : split + ((off - half) / half) * (beatSlots - split);
    return beat * beatSlots + w;
}

/** 给一轨音符施加摇摆(ratio≈0.5 时原样返回) */
export function applySwing(notes: SlotNote[], ratio: number, beatSlots: number = BEAT): SlotNote[] {
    if (!Number.isFinite(ratio) || Math.abs(ratio - 0.5) < 0.02) return notes;
    return notes.map(n => {
        const start = warpSlot(n.startSlot, ratio, beatSlots);
        const end = warpSlot(n.startSlot + n.durationSlots, ratio, beatSlots);
        return { ...n, startSlot: Math.round(start), durationSlots: Math.max(1, Math.round(end - start)) };
    });
}
