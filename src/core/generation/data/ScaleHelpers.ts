/**
 * ScaleHelpers — 音阶/音程工具集
 *
 * 借鉴自 SampleDEMO 的 MusicTheory utility，但适配我们的 RELATIVE pitch space + Tonality enum。
 *
 * 提供功能：
 *   - getScalePitches(tonality)         — 返回调内 PC 数组（基于 SCALE_INTERVALS）
 *   - snapToPool(pitch, validPcs)       — 把任意 pitch 吸附到合法 PC 池里"最近"的音（绝对距离）
 *   - getDrop2Voicing(voicing)          — 爵士 Drop-2 开放排列：把次高音降一个八度
 *   - getChordPitches(chord, octave?)   — 按 chord.quality 展开 chord tone 的实际 pitch（root + intervals）
 *
 * 约束遵从：
 *   D-1: 零 PRNG
 *   D-4: 无浮点等于比较（本模块全整数 PC）
 *   P-1: 输出 number[] 扁平数组
 *   S-3: 全同步纯函数
 *   T-3: 无 any
 *
 * Pitch Space: PC (Pitch Class, 0-11) — 与 GeneratedChord.root 对齐
 *
 * @author AuraFlow Tap! BandEngine V3
 */

import {
    Tonality, SCALE_INTERVALS,
    GeneratedChord, CHORD_INTERVALS,
} from '../types';

// ============================================================
// 公开 API
// ============================================================

/**
 * 返回 tonality 对应的调内 PC 数组（去 root 偏移版 —— 始终以 PC 0 为主音参照）。
 *
 * 注意：这是"调式相对"PC 集合（C 大调 = [0,2,4,5,7,9,11]）。
 * 实际调号偏移由 Orchestrator.applyOffset 统一处理。
 */
export function getScalePitches(tonality: Tonality): number[] {
    const intervals = SCALE_INTERVALS[tonality];
    if (intervals === undefined) return SCALE_INTERVALS[Tonality.Major];  // 兜底
    return intervals.slice();  // copy 防外部 mutate
}

/**
 * 把任意 pitch 吸附到 validPcs 池里"最近"的音（按 PC 模 12 距离，含同 PC 跨八度）。
 *
 * 算法：
 *   1. 取 pitch 的 PC = pitch mod 12
 *   2. 在 validPcs 里找距 PC 最近的 PC'（环形距离，min(|d|, 12-|d|)）
 *   3. 返回 pitch + (PC' - PC) 修正（保持原八度）
 *
 * 应用：
 *   - PassingChord 顺阶吸附（防大小三度撞音）
 *   - Lick injection 时把签名 lick 的 pitchOffset 吸附到当前 chord scale
 *   - Linear solo 跑单音时吸附到 chord-tone pool
 *
 * @param pitch    输入 pitch（任意 MIDI 值）
 * @param validPcs 合法 PC 数组（0-11，可有重复，函数会自动去重）
 * @returns 修正后的 pitch（与输入同八度，PC ∈ validPcs）。validPcs 为空时返回原 pitch。
 */
export function snapToPool(pitch: number, validPcs: number[]): number {
    if (validPcs.length === 0) return pitch;

    const pInt = pitch | 0;
    const pc = ((pInt % 12) + 12) % 12;

    // 找最近的 PC（环形距离）
    let bestPc = validPcs[0];
    let bestDist = ringDistance(pc, ((bestPc % 12) + 12) % 12);

    for (let i = 1; i < validPcs.length; i++) {
        const vp = ((validPcs[i] % 12) + 12) % 12;
        const d = ringDistance(pc, vp);
        if (d < bestDist) {
            bestDist = d;
            bestPc = vp;
        }
    }

    const bestPcNorm = ((bestPc % 12) + 12) % 12;
    // 取最小绝对修正量（向上 vs 向下）
    let delta = bestPcNorm - pc;
    if (delta > 6) delta -= 12;
    else if (delta < -6) delta += 12;

    return pInt + delta;
}

/**
 * 爵士 Drop-2 开放排列 — 把"次高音"降低一个八度。
 *
 * 输入 voicing 应是升序排列的 close-position 和弦（如 [60, 64, 67, 71]）。
 * 输出 [60, 64-12, 67, 71] = [48, 60, 67, 71]（次高音 64 → 52，重新排序）。
 *
 * 用途：当 sectionVoicingSpan > 0.6（高能量 / 高 colorBias）时自动套，
 * 制造"开放"听感（标准爵士钢琴 voice leading 技巧）。
 *
 * @param voicing 升序 close-position voicing（≥ 2 voice）
 * @returns Drop-2 重排后的 voicing（仍升序）。少于 2 voice 时直接返回 copy。
 */
export function getDrop2Voicing(voicing: number[]): number[] {
    if (voicing.length < 2) return voicing.slice();

    // 升序排列后的索引：top = length-1, second-top = length-2
    const sorted = voicing.slice().sort((a, b) => a - b);
    const secondIdx = sorted.length - 2;
    sorted[secondIdx] = sorted[secondIdx] - 12;
    sorted.sort((a, b) => a - b);
    return sorted;
}

/**
 * 按 chord.quality 展开 chord tone 到 PC 集合（不含八度，仅 PC 0-11）。
 *
 * 用途：
 *   - LickDictionary 注入时构造 chord-tone pool 给 snapToPool 用
 *   - Linear solo 单音线条吸附
 *   - PassingChord 第一转位（slash chord）的 bass voice 选择
 *
 * @returns 升序 PC 数组（去重）。
 */
export function getChordTonePCs(chord: GeneratedChord): number[] {
    const intervals = CHORD_INTERVALS[chord.quality];
    if (intervals === undefined) return [chord.root];

    const rootPc = ((chord.root % 12) + 12) % 12;
    const pcsSet: { [k: number]: boolean } = {};
    for (let i = 0; i < intervals.length; i++) {
        const pc = ((rootPc + intervals[i]) % 12 + 12) % 12;
        pcsSet[pc] = true;
    }

    const out: number[] = [];
    for (let pc = 0; pc < 12; pc++) {
        if (pcsSet[pc]) out.push(pc);
    }
    return out;
}

/**
 * 给定 root PC + tonality，返回 7 个 scale degree 的 PC（实际值）。
 *
 * 用途：PassingChord 顺阶 7th 等需要"调内某级 PC"。
 *
 * @param rootPc  主音 PC（C 大调主音 = 0）
 * @param tonality 调式
 * @returns 长度 = scale degrees 数，按 scale step 升序。
 */
export function getScalePCsFromRoot(rootPc: number, tonality: Tonality): number[] {
    const intervals = getScalePitches(tonality);
    const root = ((rootPc % 12) + 12) % 12;
    const out: number[] = new Array(intervals.length);
    for (let i = 0; i < intervals.length; i++) {
        out[i] = ((root + intervals[i]) % 12 + 12) % 12;
    }
    return out;
}

// ============================================================
// 内部
// ============================================================

/** 环形距离：min(|a-b|, 12-|a-b|)，a/b ∈ [0,11] */
function ringDistance(a: number, b: number): number {
    const d = Math.abs(a - b);
    return d > 6 ? 12 - d : d;
}
