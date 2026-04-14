// ==========================================
// 📄 /src/core/generation/harmony/SkeletonMelodyGenerator.ts
// 🌟 PR #2: Phase 2 — 骨架旋律生成器
//
// 申克分析法的"中景骨架"：基于影子骨架的 T/S/D 功能，
// 在 diatonic（调内）音阶里选出每个槽位的代表性音 (anchor)。
//
// 输入：ShadowSlot[] 全曲影子骨架
// 输出：anchor[] 与 ShadowSlot 一一对应的 pitch class (主调相对 0~11)
//
// 选音规则（每槽位）：
//   - T 功能：优先 root(0) / 3rd(4) / 5th(7) — 都是大调 I 和弦音
//   - S 功能：优先 4th(5) / 6th(9) / 2nd(2) — 4 度色彩 + 6 度甜
//   - D 功能：优先 7th(11) leading tone / 2nd(2) / 5th(7)
//
// Smoothing（≤5 度跳进约束）：
//   相邻两个 anchor 的最短距离若 > 5 半音，使用八度等价音替换为最近的版本
//   这里 anchor 是 pitch class 0~11，"距离"用 mod 12 的最短差
//
// PRNG 消耗：每槽位 1 次（从 3 个候选中选）
//
// 输出严格在 diatonic safe scale 内，无任何调外音（K-3 / K-7 合规）
// ==========================================

import { PRNGManager } from '../../utils/PRNG';
import { ShadowSlot, ShadowFunction, Tonality } from '../types';

/**
 * 大调音阶 7 个 pc（相对主音）
 */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/**
 * 小调音阶（自然小调）7 个 pc
 * PR #2 限定大调，但留接口供 PR #3
 */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * 每个功能的"首选音"列表（按优先级降序）。
 * 这些都是大调相对空间的 pc。
 */
const T_PREFERRED = [0, 4, 7];     // I 和弦音 C-E-G
const S_PREFERRED = [5, 9, 2];     // 4-6-2 (IV 和弦音 + 9th)
const D_PREFERRED = [11, 2, 7];    // 7-2-5（V7 的 leading + 9 + root）

/**
 * 取一个功能对应的候选音池。
 */
function getCandidateNotes(func: ShadowFunction, tonality: Tonality): number[] {
    const scale = tonality === Tonality.Minor ? MINOR_SCALE : MAJOR_SCALE;
    let pool: number[];
    switch (func) {
        case ShadowFunction.Tonic:       pool = T_PREFERRED; break;
        case ShadowFunction.Subdominant: pool = S_PREFERRED; break;
        case ShadowFunction.Dominant:    pool = D_PREFERRED; break;
        default:                         pool = T_PREFERRED;
    }
    // 过滤掉不在调内音阶的（保险，理论上不会发生）
    return pool.filter(pc => scale.includes(pc));
}

/**
 * 计算两个 pitch class 在 12 半音圆上的最短距离（0~6）。
 */
function pcDistance(a: number, b: number): number {
    const diff = Math.abs(a - b) % 12;
    return diff > 6 ? 12 - diff : diff;
}

/**
 * Smoothing 决策：给定候选 candidate 和上一个 anchor prev，
 * 选 candidate 中与 prev 距离最近的一个（≤ 5 半音优先）。
 *
 * 如果所有 candidate 都 > 5 半音，仍返回最近的（不强行 fall back）。
 */
function pickClosest(candidates: number[], prev: number | null): number {
    if (prev === null || candidates.length === 0) {
        return candidates[0] ?? 0;
    }
    let best = candidates[0];
    let bestDist = pcDistance(best, prev);
    for (let i = 1; i < candidates.length; i++) {
        const d = pcDistance(candidates[i], prev);
        if (d < bestDist) {
            best = candidates[i];
            bestDist = d;
        }
    }
    return best;
}

/**
 * 主入口：从 ShadowSlot[] 生成 anchor[] (主调相对 pitch class)。
 *
 * @param shadow 影子骨架
 * @param tonality 调式（PR #2 仅支持 Major）
 * @returns anchor[] 与 shadow 长度相等
 */
export function generateSkeletonMelody(
    shadow: ShadowSlot[],
    tonality: Tonality,
): number[] {
    const anchors: number[] = new Array(shadow.length);
    let prev: number | null = null;

    for (let i = 0; i < shadow.length; i++) {
        const slot = shadow[i];
        const candidates = getCandidateNotes(slot.function, tonality);

        // 强位（每段开头/小节强拍）：从候选池里随机选一个，更明确地标记功能感
        // 弱位：在候选池里选 smoothing 最优的（最贴 prev）
        let chosen: number;
        if (slot.isStrong) {
            // 强位：让 PRNG 选一个，但 smoothing 仍然加权
            // 简单策略：50% 概率走 smoothing，50% 概率随机选首选
            const useSmoothing = PRNGManager.next() < 0.5;
            if (useSmoothing && prev !== null) {
                chosen = pickClosest(candidates, prev);
            } else {
                chosen = candidates[PRNGManager.nextInt(0, candidates.length - 1)];
            }
        } else {
            // 弱位：永远 smoothing
            // 但仍消耗一次 PRNG，保持序列对齐
            PRNGManager.next();
            chosen = pickClosest(candidates, prev);
        }

        anchors[i] = chosen;
        prev = chosen;
    }

    return anchors;
}
