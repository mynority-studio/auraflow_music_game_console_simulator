// ============================================================
// engine-utils — mg.Engine class 的纯函数抽取(Phase 1 / #6.0)
// ============================================================
//
// audit 报告(2026-05-22)将 mg.Engine class 的 24 个 method 分组,这里收集
// 「组 A 纯函数候选」(0 state 依赖,可直接抽离 class scope)。
//
// 渐进式抽取:每抽出一个 method,Engine class 内调用点改为 free function 调用
// (`this.xxx()` → `xxx()`)。Phase 6 完成后 Engine class 可全部消失。
//
// 本文件位置(mg-engine/)暂时,#6.6 整体迁移到 af2-engine/ 时一起搬。
// ============================================================

import { StyleName } from './styleDictionary';
import { harmonicFunctionFromRoman } from './musicEngine';

/**
 * 抽自 mg.Engine.resolveTonalCharacter (原 L684-689)。
 * 决定 song-level 是 tonal(功能性和声)还是 modal(scale-color)。
 *
 * BLUES style → modal(blues note 是 scale color,非 tension resolution)
 * Major/Minor/Ionian/Aeolian mode → tonal
 * 其他 mode(Dorian/Phrygian/Lydian/Mixolydian/Locrian)→ modal
 */
export function resolveTonalCharacter(style: StyleName, mode: string): 'tonal' | 'modal' {
    if (style === 'BLUES') return 'modal';
    const tonalModes = new Set(['Major', 'Minor', 'Ionian', 'Aeolian']);
    if (!tonalModes.has(mode)) return 'modal';
    return 'tonal';
}

/**
 * 抽自 mg.Engine.getHarmonicFunction (原 L1634-1636)。
 * 一行 wrapper:roman numeral → T/S/D 功能。
 *
 * 设计原因:原 class method 仅为 wrap harmonicFunctionFromRoman(后者已在
 * musicTheory.ts 是 free function)。抽出后调用方可直接调本函数或下层。
 */
export function getHarmonicFunction(romanOriginal: string): 'T' | 'S' | 'D' {
    return harmonicFunctionFromRoman(romanOriginal);
}

/**
 * 抽自 mg.Engine.applySwing (原 L3418-3428)。
 * Swing/shuffle groove 时值调整 — 把直拍的 8th note 偏移到 2:1 triplet feel。
 *
 *   straight 0.5 → swing 0.66
 *   straight 0.25 → swing 0.33(triplet 1)
 *   straight 0.75 → swing 0.83(triplet 3)
 *   其他 fraction:不变
 */
export function applySwing(t: number, isShuffle: boolean): number {
    if (!isShuffle) return t;
    const beat = Math.floor(t);
    const fraction = t - beat;
    if (fraction === 0) return t;
    if (Math.abs(fraction - 0.5) < 0.01) return beat + 0.66;
    if (Math.abs(fraction - 0.25) < 0.01) return beat + 0.33;
    if (Math.abs(fraction - 0.75) < 0.01) return beat + 0.83;
    return t;
}
