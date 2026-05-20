// ============================================================
// ChordColors — 调式的和弦色彩字典
// ============================================================
//
// 出处:melodygenerative CHORD_COLOR_DICTIONARY。每个调式定义其 7 级
// 罗马级数对应的"典型 chord type"+ 推荐替代 + 推荐进行片段。
// 用于:
//   1. MacroProgressionEngine 在 modal 段(exotic tonality)用作 chord 池
//   2. HarmonicEvaluator 判定"该和弦在该调上是否典型"
//   3. UI / 调试 — 显示当前调式的"色彩简介"
//
// 关键设计:级数串(I / II / III / ...)是字符串而非 enum,因为:
//   - 7 级数本身就是音乐理论的标准记号(不存在歧义)
//   - 实际值用 roman 字符串(如 'Imaj7' / 'V-7')需要支持降记号(b)、
//     加减(+/-)等组合,设计成 enum 反而僵硬
//   - 消费方 MacroProgressionEngine 已有 ChordNumeralParser,本字段直接对接
//
// 消费方(Batch 1 暂不接):
//   - Batch 5:MacroProgressionEngine 在 modal/exotic tonality 段引用
//   - Batch 2:HarmonicEvaluator 作为"典型 chord 类型"参考(非裁决主源)
//
// 零 PRNG。仅依赖 Tonality。
//
// Cross-sync:暂无独立条目(数据稳定)。Batch 5 扩 Tonality 时需扩本表。
// ============================================================

import { Tonality } from '../types';

/** 单条 chord color 条目 */
export interface ChordColorEntry {
    /**
     * 索引 0..6 对应 I, II, III, IV, V, VI, VII。
     * 值为 roman 字符串(供 ChordNumeralParser 解析)。
     */
    chords: ReadonlyArray<string>;
    /** 推荐替代级数(roman 字符串数组) */
    substitutes: ReadonlyArray<string>;
    /** 推荐进行片段(每条是 hyphen-joined roman 序列) */
    progressions: ReadonlyArray<string>;
}

/**
 * 索引 = Tonality enum。
 * undefined 表示该 tonality 无 color 字典(MacroProgressionEngine 走通用 fallback)。
 *
 * Tonality 当前 11 个值,本表对应填写主流调式。Batch 5 扩枚举时同步扩本表。
 */
export const CHORD_COLORS: ReadonlyArray<ChordColorEntry | undefined> = (() => {
    const arr: (ChordColorEntry | undefined)[] = [];

    arr[Tonality.Major] = Object.freeze({
        chords: Object.freeze(['Imaj7', 'II-7', 'III-7', 'IVmaj7', 'V7', 'VI-7', 'VII-7b5']),
        substitutes: Object.freeze([]),
        progressions: Object.freeze(['I-IV-V', 'I-V-VI-IV']),
    });

    arr[Tonality.Minor] = Object.freeze({
        chords: Object.freeze(['I-7', 'II-7b5', 'bIIImaj7', 'IV-7', 'V-7', 'bVImaj7', 'bVII7']),
        substitutes: Object.freeze(['2', '6', '7']),
        progressions: Object.freeze(['i-bVI', 'i-iv-v', 'i-bVII-bVI-V']),
    });

    arr[Tonality.Major_Pentatonic] = undefined;  // pentatonic 不构成完整 7 级和声体系
    arr[Tonality.Minor_Pentatonic] = undefined;

    arr[Tonality.Blues] = Object.freeze({
        chords: Object.freeze(['I7', 'II7', 'III7', 'IV7', 'V7', 'VI7', 'VII7']),
        substitutes: Object.freeze(['5']),
        progressions: Object.freeze(['I7-IV7-I7-V7-IV7-I7']),  // 12-bar blues
    });

    arr[Tonality.Dorian] = Object.freeze({
        chords: Object.freeze(['I-7', 'II-7', 'bIIImaj7', 'IV7', 'V-7', 'VI-7b5', 'bVIImaj7']),
        substitutes: Object.freeze(['3', '4']),
        progressions: Object.freeze(['i-IV-i', 'i-bVII-IV']),
    });

    arr[Tonality.Mixolydian] = Object.freeze({
        chords: Object.freeze(['I7', 'II-7', 'III-7b5', 'IVmaj7', 'V-7', 'VI-7', 'bVIImaj7']),
        substitutes: Object.freeze(['5', '7']),
        progressions: Object.freeze(['I-bVII', 'I-bVII-IV']),
    });

    arr[Tonality.Melodic_Minor] = Object.freeze({
        chords: Object.freeze(['Imaj7', 'II-7', 'bIII+maj7', 'IV7', 'V7', 'VI-7b5', 'VII-7b5']),
        substitutes: Object.freeze(['1']),
        progressions: Object.freeze(['i-IV7']),
    });

    arr[Tonality.Lydian] = Object.freeze({
        chords: Object.freeze(['Imaj7', 'II7', 'III-7', '#IV-7b5', 'Vmaj7', 'VI-7', 'VII-7']),
        substitutes: Object.freeze(['2', '4']),
        progressions: Object.freeze(['I-II', 'I-II-V']),
    });

    arr[Tonality.Harmonic_Minor] = Object.freeze({
        chords: Object.freeze(['Imaj7', 'II-7b5', 'bIII+maj7', 'IV-7', 'V7', 'bVImaj7', 'VII°7']),
        substitutes: Object.freeze(['7']),
        progressions: Object.freeze(['i-V7-i', 'i-VII°7-i']),
    });

    arr[Tonality.Phrygian] = Object.freeze({
        chords: Object.freeze(['I-7', 'bIImaj7', 'bIII7', 'IV-7', 'V-7b5', 'bVImaj7', 'bVII-7']),
        substitutes: Object.freeze(['2', '7']),
        progressions: Object.freeze(['i-bII-i', 'i-bII-bIII']),
    });

    // ---- Batch 5 新增 ----
    arr[Tonality.Locrian] = Object.freeze({
        // Locrian 的 I 是 m7b5 — 严格不稳定,但 b2 + bV 是它的体裁签名
        chords: Object.freeze(['I-7b5', 'bIImaj7', 'bIII-7', 'IV-7', 'bVmaj7', 'bVI7', 'bVII-7']),
        substitutes: Object.freeze(['5']),
        progressions: Object.freeze(['i-bV', 'i-bII-bIII']),
    });

    // LydianDominant / PhrygianDominant / Altered 是 dominant-family scales(borrowed scales
    // 用于 V/X 借用场景)— 它们的"chord 色彩"是单一 dom 类型 + 其 idiomatic 替代,而不是
    // 完整 7 级和声体系。下面以 dom7 family 的常用 voicing 作为 I 级条目,其余级数借自相邻调式。

    arr[Tonality.LydianDominant] = Object.freeze({
        chords: Object.freeze(['I7#11', 'II7', 'III-7b5', 'IV#-7b5', 'V-7', 'VI-7', 'bVIImaj7']),
        substitutes: Object.freeze(['4']),
        progressions: Object.freeze(['I7#11-IV', 'I7#11-V']),
    });

    arr[Tonality.PhrygianDominant] = Object.freeze({
        // V/i 借用(harmonic minor 5th mode)— flamenco / klezmer / metal 风
        chords: Object.freeze(['I7b9', 'bIImaj7', 'bIII°7', 'IV-7', 'V-7b5', 'bVImaj7', 'bVII-7']),
        substitutes: Object.freeze(['2']),
        progressions: Object.freeze(['I7b9-bII', 'I7b9-iv']),
    });

    arr[Tonality.Altered] = Object.freeze({
        // 7alt 主导 — V/X 在 modal interchange 中的极端 dominant 着色
        chords: Object.freeze(['I7alt', 'bII7', 'bIIImaj7', 'III-7b5', 'IV-7', 'bVI7', 'bVII-7']),
        substitutes: Object.freeze([]),
        progressions: Object.freeze(['I7alt-bII-I', 'I7alt-resolve']),
    });

    arr[Tonality.BebopDominant] = Object.freeze({
        // Bebop dominant scale 主要用于 bebop solo 经过线,chord 体系借 Mixolydian
        chords: Object.freeze(['I7', 'II-7', 'III-7b5', 'IVmaj7', 'V-7', 'VI-7', 'bVIImaj7']),
        substitutes: Object.freeze(['5', '7']),
        progressions: Object.freeze(['I-bVII', 'ii-V-I']),
    });

    arr[Tonality.BebopMajor] = Object.freeze({
        // Bebop major scale 用于 bebop solo,chord 体系借 Ionian + b6 色彩
        chords: Object.freeze(['Imaj7', 'II-7', 'III-7', 'IVmaj7', 'V7', 'bVImaj7', 'VII-7b5']),
        substitutes: Object.freeze(['6']),
        progressions: Object.freeze(['I-vi-ii-V', 'I-bVI-IV']),
    });

    return Object.freeze(arr);
})();

// ============================================================
// 查询函数
// ============================================================

/**
 * 取该 tonality 的 color 字典。
 * 未定义返回 undefined,调用方应 fallback 到通用 chord 池。
 */
export function getChordColors(tonality: Tonality): ChordColorEntry | undefined {
    return CHORD_COLORS[tonality];
}

/**
 * 取该 tonality 在某级数(1-7)的典型 chord roman 字符串。
 *
 * @param tonality 调式
 * @param degree 级数 1-7(自动 clamp 到合法范围,越界返回空字符串)
 */
export function getChordRomanByDegree(tonality: Tonality, degree: number): string {
    const entry = CHORD_COLORS[tonality];
    if (entry === undefined) return '';
    const idx = (degree | 0) - 1;
    if (idx < 0 || idx >= entry.chords.length) return '';
    return entry.chords[idx];
}
