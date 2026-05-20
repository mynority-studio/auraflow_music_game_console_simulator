// ============================================================
// RhythmMask — 节奏维度 bitmask 过滤(Phase 3 Texture Morphing)
// ============================================================
//
// 对仗 VoicingMask(和声维度)的概念:
//   - VoicingMask: bit 偏移 = VoiceRole(Root/Third/Fifth...),过滤 voice
//   - RhythmMask:  bit 偏移 = step idx(0-15 in 16-step bar),过滤击点
//
// 设计动机(PEAA "Genetic Masking"):
//   每个 recipe 的 baseGrid 是"最高密度 DNA"(假想 Level 7 表现形态),
//   实际渲染按 densityLevel 派出一张 mask,按位过滤掉低于当前密度等级的击点。
//
// 强拍永驻 / 弱拍逐级解锁:
//   stepTier[step]:每 step 的"音乐重要度"等级(1=强拍,7=最弱),
//   通过 metric 位置 + recipe baseGrid 派生。density >= tier 的 step 被保留。
//
// 复杂度 O(16),零 PRNG。
//
// 关联:
//   - cross_sync_rule.md §1.11:DensityLevel ↔ stepTier ↔ maskFromDensity ↔ Idiom 消费
//   - 当 PIANO_TEXTURE_GRID_LENGTH 改变(目前 16),deriveStepTier 公式需同步改
// ============================================================

import { DensityLevel } from '../types';

/** Bar 长度(与 PianoTextureRecipes 对齐) */
const BAR_STEPS = 16;

/**
 * 节奏 bitmask:32-bit number,bit i 对应 step i。
 *
 * MASK_FULL = (1 << 16) - 1 = 0xFFFF
 *
 * Phase 3 起 16 step 用 32-bit int 完全够用;若未来扩到 32-step,需升级到 BigInt 或 Uint32Array。
 */
export type RhythmMask = number;

/** 全开(Level 7 等价) */
export const MASK_RHYTHM_FULL: RhythmMask = (1 << BAR_STEPS) - 1;

/** 全闭(Level 1 Tacit) */
export const MASK_RHYTHM_EMPTY: RhythmMask = 0;

// ============================================================
// stepTier 派生 — 从 baseGrid 派生每 step 的音乐重要度
// ============================================================

/**
 * Metric tier(无视 baseGrid,纯按 4/4 拍位置)。
 *
 * 4/4 bar 16-step 网格 metric 重要度:
 *   tier 1: step 0, 8       — beat 1, 3 强拍(pulses)
 *   tier 2: step 4, 12      — beat 2, 4 次强拍
 *   tier 3: step 2, 6, 10, 14 — & beats(8 分音符正拍)
 *   tier 4: step 1, 9       — e of beat 1, 3
 *   tier 5: step 5, 13      — e of beat 2, 4
 *   tier 6: step 3, 11      — a of beat 1, 3
 *   tier 7: step 7, 15      — a of beat 2, 4(最弱)
 *
 * 改变本表会影响所有 recipe 的密度过滤行为。
 */
const METRIC_TIER: ReadonlyArray<number> = Object.freeze([
//  0  1  2  3   4  5  6  7   8  9 10 11  12 13 14 15
    1, 4, 3, 6,  2, 5, 3, 7,  1, 4, 3, 6,  2, 5, 3, 7,
]);

/**
 * 从 baseGrid 派生 stepTier 数组(自动派生路径,Phase 3 默认)。
 *
 * 规则:
 *   - baseGrid[step] === 0 → tier = 99(永远不会被 density 7 包含 → 永静默)
 *   - baseGrid[step] === 1 → tier = METRIC_TIER[step]
 *
 * 这样自然保留 baseGrid 的节奏轮廓,只在被允许的 step 上按 tier 排序。
 *
 * 未来若需手工调:每 recipe 加 `stepTier?: ReadonlyArray<number>` 字段,
 * 本函数检测到即直接返回手工值,跳过派生。
 */
export function deriveStepTier(baseGrid: ReadonlyArray<number>): ReadonlyArray<number> {
    const out: number[] = new Array(BAR_STEPS);
    for (let i = 0; i < BAR_STEPS; i++) {
        const hit = i < baseGrid.length ? baseGrid[i] : 0;
        out[i] = hit === 0 ? 99 : METRIC_TIER[i];
    }
    return out;
}

// ============================================================
// Mask 计算 — 按 density 决定保留哪些 step
// ============================================================

/**
 * 按 densityLevel 生成 RhythmMask。
 *
 * 规则:tier ≤ density 的 step 保留,其他过滤。
 *   Level 1 (Tacit):       无 step 保留 → mask = 0
 *   Level 2 (SparseSustain): 仅 tier 1(step 0, 8)
 *   Level 3 (BlockQuarter): tier 1-2(downbeats 0/4/8/12)
 *   Level 4 (BrokenEighth): tier 1-3(downbeats + & beats,8 hits)
 *   Level 5 (CompingStab):  tier 1-4(+ e of 强拍,10 hits)
 *   Level 6 (ActiveArp):    tier 1-5(+ e of 弱拍,12 hits)
 *   Level 7 (Saturated):    tier 1-7(全 16 hits 上限)
 *
 * 与 baseGrid 的 AND 关系:实际渲染 grid[i] = baseGrid[i] & ((mask >> i) & 1)。
 * 即:既要 baseGrid 允许,又要 density 允许,两个条件 AND。
 *
 * Tier 99 永远 > density,自动过滤(对应 baseGrid[step]=0 的位置)。
 */
export function maskFromDensity(
    stepTier: ReadonlyArray<number>,
    density: DensityLevel,
): RhythmMask {
    let mask = 0;
    const n = Math.min(stepTier.length, BAR_STEPS);
    for (let i = 0; i < n; i++) {
        if (stepTier[i] <= density) mask |= (1 << i);
    }
    return mask;
}

/**
 * 应用 mask 到 baseGrid(Int8Array 或 ReadonlyArray<number>),返回新 grid。
 *
 * 不可变 — 不修改 input grid,返回新 Int8Array。
 *
 * 性能:O(16),零分配除新数组。Idiom render 循环每和弦/每段调用一次。
 */
export function applyRhythmMask(
    baseGrid: ReadonlyArray<number>,
    mask: RhythmMask,
): Int8Array {
    const out = new Int8Array(BAR_STEPS);
    const n = Math.min(baseGrid.length, BAR_STEPS);
    for (let i = 0; i < n; i++) {
        if (baseGrid[i] !== 0 && ((mask >> i) & 1) === 1) {
            out[i] = baseGrid[i] as number;
        }
    }
    return out;
}

/**
 * 便利函数:一步从 baseGrid + density 派生过滤后的 grid。
 *
 * 等价于 applyRhythmMask(grid, maskFromDensity(deriveStepTier(grid), density))。
 *
 * Phase 3 Idiom 消费典型路径。
 */
export function filterGridByDensity(
    baseGrid: ReadonlyArray<number>,
    density: DensityLevel,
): Int8Array {
    const tier = deriveStepTier(baseGrid);
    const mask = maskFromDensity(tier, density);
    return applyRhythmMask(baseGrid, mask);
}
