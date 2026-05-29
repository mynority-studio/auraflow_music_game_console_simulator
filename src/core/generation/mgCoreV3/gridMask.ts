// ============================================================
// gridMask.ts — 16-slot grid + per-slot 能量权重(Layer 2)
// ============================================================
//
// 一 bar(4/4)切成 16 个 16 分音符 slot,每 slot 携带:
//   - beat:绝对节拍位置(0.0 ~ 3.75)
//   - weight:基础能量权重(0-1)
//   - tag:slot 类型(strong / weak / and-of-beat / 16分插点)
//
// 权重设计基于 MMA stdlib 122 文件 1509 事件的 beat 位分布审计:
//   beat 1.0:33% / 3.0:20% / 2.0:10% / 2.5:7% / 1.5/4.5:4% / 3.5:5% ...
//
// 后续 layer(L4 概率填 / L5 剪枝)读这个权重做 emit 决策:
//   P(emit at slot) = slot.weight × style.fillProb × sectionMutation.density
//
// 当前 P1 阶段只建数据,patterns 暂不消费这个 grid。
// ============================================================

/** 一 bar 的 slot 数(16 分音符精度) */
export const SLOTS_PER_BAR = 16;

/** Slot 长度 = 0.25 beat */
export const SLOT_DUR = 0.25;

/** Slot 类型标签 */
export type SlotTag = 'strong' | 'weak' | 'and' | 'sixteenth';

export interface GridSlot {
    /** 0-15 within bar */
    index: number;
    /** Beat position(0-3.75 for 4-beat bar)*/
    beat: number;
    /** Energy weight 0-1(基础值,后续 layer 会再乘 multiplier)*/
    weight: number;
    /** Slot 分类 */
    tag: SlotTag;
}

/**
 * 默认 4/4 grid:16 个 slot 的权重表(基于 MMA 数据审计):
 *   beat 1.0 / 3.0 / 2.0 / 4.0   = strong / weak 拍正面(highest weight)
 *   beat 1.5 / 2.5 / 3.5 / 4.5   = and-of-beat(syncopation 关键位)
 *   其余 16 分 odd 位              = sixteenth(填充位,低权重)
 *
 * 注意:beat 1 比 beat 3 高一档(1.0 vs 0.9),因为 1 是 phrase 起点的主导拍
 */
export const DEFAULT_GRID_4_4: ReadonlyArray<GridSlot> = [
    { index:  0, beat: 0.0,  weight: 1.0, tag: 'strong'    },  // beat 1
    { index:  1, beat: 0.25, weight: 0.2, tag: 'sixteenth' },
    { index:  2, beat: 0.5,  weight: 0.4, tag: 'and'       },  // and of 1
    { index:  3, beat: 0.75, weight: 0.2, tag: 'sixteenth' },
    { index:  4, beat: 1.0,  weight: 0.6, tag: 'weak'      },  // beat 2 (backbeat)
    { index:  5, beat: 1.25, weight: 0.2, tag: 'sixteenth' },
    { index:  6, beat: 1.5,  weight: 0.4, tag: 'and'       },  // and of 2
    { index:  7, beat: 1.75, weight: 0.2, tag: 'sixteenth' },
    { index:  8, beat: 2.0,  weight: 0.9, tag: 'strong'    },  // beat 3
    { index:  9, beat: 2.25, weight: 0.2, tag: 'sixteenth' },
    { index: 10, beat: 2.5,  weight: 0.4, tag: 'and'       },  // and of 3
    { index: 11, beat: 2.75, weight: 0.2, tag: 'sixteenth' },
    { index: 12, beat: 3.0,  weight: 0.6, tag: 'weak'      },  // beat 4 (backbeat)
    { index: 13, beat: 3.25, weight: 0.2, tag: 'sixteenth' },
    { index: 14, beat: 3.5,  weight: 0.4, tag: 'and'       },  // and of 4 (anticipation 招牌位)
    { index: 15, beat: 3.75, weight: 0.2, tag: 'sixteenth' },
];

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Slot index → beat position(in 4-beat bar) */
export function slotToBeat(index: number): number {
    return (index % SLOTS_PER_BAR) * SLOT_DUR;
}

/** Beat position → 最近 slot index(quantize to 16th grid) */
export function beatToSlot(beat: number): number {
    return Math.round(beat / SLOT_DUR) % SLOTS_PER_BAR;
}

/**
 * 找 grid 上所有 weight >= threshold 的 slot(用于"强 slot"挑选)。
 * 例:threshold=0.7 → 强拍位 [0, 8] = beat 1, 3
 */
export function strongSlots(threshold: number = 0.7, grid: ReadonlyArray<GridSlot> = DEFAULT_GRID_4_4): GridSlot[] {
    return grid.filter(s => s.weight >= threshold);
}
