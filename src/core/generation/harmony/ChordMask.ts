// ==========================================
// 📄 /src/core/generation/harmony/ChordMask.ts
// 🌟 PR #1: 12-bit Pitch Class Mask — 和声位运算基础设施
//
// Pitch Space: RELATIVE（主调相对空间，不含 keyOffset）
// 对应 music_generation_pipeline_rule.md §4.7 K-1~K-3
//
// 设计原则：
//   - 一个和弦压缩到 12 位（uint16 足够），bit i 对应 pitch class i
//     bit 0 = C, bit 1 = C#, ..., bit 11 = B（主调相对）
//   - 跨八度的扩展音（9/11/13）统一 % 12 折叠到同一个 pitch class
//   - 共同音运算 = popcount(A & B)，Viterbi 热路径上单次 2 ops
//   - ESP32 移植目标：__builtin_popcount 或位宽 12 的 SWAR
// ==========================================

import { ChordQuality, CHORD_INTERVALS } from '../types';

/**
 * 12-bit Pitch Class Mask。
 * 高 20 位始终为 0，仅低 12 位参与运算。
 * JS 中存为普通 number（双精度，低 32 位位运算安全），C 层为 uint16_t。
 */
export type ChordMask = number;

export const MASK_BITS = 12;
export const MASK_ALL_12 = 0xFFF;

/**
 * 把 (rootPc, quality) 转成 12-bit mask。
 *
 * rootPc 为主调相对空间的根音 pitch class（I=0, ii=2, V=7 ...）。
 * CHORD_INTERVALS 中的跨八度音程（14=9th, 17=11th, 21=13th）会被 % 12
 * 折叠，所以 Minor11 的 mask 在 pitch class 层是 {R, b3, 5, b7, 9, 11}。
 */
export function chordToMask(rootPc: number, quality: ChordQuality): ChordMask {
    const intervals = CHORD_INTERVALS[quality];
    const base = ((rootPc % 12) + 12) % 12;
    let mask = 0;
    for (let i = 0; i < intervals.length; i++) {
        const pc = (base + intervals[i]) % 12;
        mask |= (1 << pc);
    }
    return mask & MASK_ALL_12;
}

/**
 * 12-bit SWAR popcount。
 *
 * JS 无 __builtin_popcount，但 12 位足够小，直接展开比查表还快。
 * ESP32 翻译时替换为 __builtin_popcount(x) 即可。
 */
export function popcount12(x: number): number {
    x = x & MASK_ALL_12;
    x = x - ((x >> 1) & 0x555);
    x = (x & 0x333) + ((x >> 2) & 0x333);
    x = (x + (x >> 4)) & 0xF0F;
    return (x + (x >> 8)) & 0x1F;
}

/**
 * 两个和弦的共同音个数（法则 3：共同音连接）。
 *
 * 返回值范围 0~4（大部分三/四和弦）或 0~6（九/十一和弦）。
 * 共同音越多，voice leading 越平滑。
 */
export function commonTones(a: ChordMask, b: ChordMask): number {
    return popcount12(a & b);
}
