// ============================================================
// styleVector.ts — V2 dimensional 风格切片(2026-05-28 Phase 3)
// ============================================================
//
// 基于 122 MMA stdlib 文件维度分布分析(commit c5160b4)得到的 4 axis 高方差
// 维度。低方差维度(VoicingMode 70% Optimal / Harmony 80% 无声明 / SeqRnd
// 100% on / Strum 90% 无)固化到 kernel 内部不暴露。
//
// 5 个 mg style 在 4 axis 上的 anchor 坐标 — 数值是从 MMA 同名/同风格 stdlib
// 文件人工标定的中位值,后续可用 corpus PCA 自动校准。
// ============================================================

import type { StyleName } from '../mgEngine/styleDictionary';

export interface StyleVector {
    /** 击点密度 [0,1]:0=每 bar 1 击 / 0.5=2-4 击 / 1=连续 16 分音符 */
    density: number;
    /** 音长比 [0,1]:0=staccato 短音 / 0.5=normal / 1=legato 全 bar */
    articulation: number;
    /** 音量分级 [0,1]:0=pp / 0.5=mp / 1=ff(velocity ≈ 30 ~ 120) */
    volume: number;
    /** LH/RH 八度间距 [0,1]:0=close(都 oct4) / 0.5=标准(LH3 RH5) / 1=wide(LH2 RH6) */
    registerSpread: number;
}

/**
 * 5 个 mg style 的 anchor StyleVector。
 * 数值参考 MMA stdlib 同风格文件 + mg STYLE_DICTIONARY tempoRange。
 */
export const STYLE_VECTORS: Record<StyleName, StyleVector> = {
    POP:   { density: 0.50, articulation: 0.60, volume: 0.60, registerSpread: 0.50 },
    LOFI:  { density: 0.30, articulation: 0.90, volume: 0.40, registerSpread: 0.60 },
    JAZZ:  { density: 0.65, articulation: 0.50, volume: 0.60, registerSpread: 0.45 },
    BLUES: { density: 0.55, articulation: 0.65, volume: 0.65, registerSpread: 0.40 },
    RNB:   { density: 0.45, articulation: 0.80, volume: 0.55, registerSpread: 0.55 },
};

// ─────────────────────────────────────────────────────────────────
// Helpers:vector axis → 渲染参数
// ─────────────────────────────────────────────────────────────────

/** articulation [0,1] → noteOn 持续时间占 beat 比例 [0.15, 1.0] */
export function articulationToDurRatio(articulation: number): number {
    // staccato 0.15 beat → legato 1.0 beat-per-beat
    return 0.15 + articulation * 0.85;
}

/** volume [0,1] → MIDI velocity [30, 120] */
export function volumeToVelocity(volume: number): number {
    return Math.round(30 + volume * 90);
}

/** registerSpread [0,1] → 推荐 LH/RH 八度差(0=0 / 1=4 octaves) */
export function registerSpreadToOctaveGap(spread: number): number {
    return Math.round(spread * 4);
}
