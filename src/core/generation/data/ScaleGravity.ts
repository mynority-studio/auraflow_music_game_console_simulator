// ============================================================
// ScaleGravity — 调式内"音程引力"规则表(Lerdahl 2001 派生)
// ============================================================
//
// 出处:Fred Lerdahl 2001 "Tonal Pitch Space" Ch. 4。
// 公式:α(fromPc → toPc) = (s(toPc) / s(fromPc)) × (1 / n²)
//   - s = anchoring strength(scale 内稳定度层级)
//   - n = 半音距离(mod-12 短距)
//
// scale-intrinsic anchoring 层级:
//   tonic     → 5  (octave level)
//   fifth     → 4  (fifth level)
//   third     → 3  (triadic level)
//   diatonic  → 2  (其他 scale tone)
//   chromatic → 1  (scale 外,通常不入表)
//
// 与 IntervalAesthetics 的区别:
//   - IntervalAesthetics:K-K 概率实证(听感数据)
//   - ScaleGravity:Lerdahl 理论推导(scale 结构)
//   两者协同 — K-K 校准张力值,Lerdahl 推导引力目标。
//
// Major-family 调式(Ionian / Lydian / Mixolydian)由 computeLerdahlScaleGravity
// 在模块加载时自动派生。Minor-family + exotic 调式用手调表(Lerdahl 1/n² 模型
// 无法捕捉的 Aeolian b6→5 sigh / Phrygian b2→1 dark sub-tonic 等)。
//
// type 分三类:
//   ResolveDown — 半音/全音下行解决
//   ResolveUp   — 半音/全音上行解决
//   Hang        — 调式特征 hang tone(Dorian ♮6 不被强拉)
//
// score 范围 [0, 30] — 配合软评分权重使用,18 是 hard-filter 阈值(supratonic)。
//
// 消费方(Batch 1 暂不接):
//   - Batch 2 HarmonicEvaluator(scale-aware 评估)
//   - Batch 7 melody anchor scoring(scale gravity line filter)
//
// 零 PRNG。依赖 Tonality + SCALE_INTERVALS。
//
// Cross-sync:Tonality 扩枚举时需扩本表(Batch 5)。
// ============================================================

import { Tonality, SCALE_INTERVALS } from '../types';

export enum ScaleGravityType {
    ResolveDown = 0,
    ResolveUp   = 1,
    Hang        = 2,
}

export interface ScaleGravityRule {
    /** [0, 11] 起点 interval(相对 scale root) */
    fromInterval: number;
    /** [0, 11] 终点 interval */
    toInterval: number;
    /** 0..30 引力强度(Lerdahl α × 10 round) */
    score: number;
    /** 解决方向类别 */
    type: ScaleGravityType;
}

// ============================================================
// Lerdahl scale-anchoring strength
// ============================================================

const ANCHOR_STRENGTH_CHROMATIC = 1;
const ANCHOR_STRENGTH_DIATONIC  = 2;
const ANCHOR_STRENGTH_THIRD     = 3;
const ANCHOR_STRENGTH_FIFTH     = 4;
const ANCHOR_STRENGTH_TONIC     = 5;

/**
 * 给定 PC + scale,返回该 PC 在该 scale 中的 anchoring strength(1-5)。
 */
function lerdahlScaleStrength(pc: number, scaleRoot: number, tonality: Tonality): number {
    const scaleIntervals = SCALE_INTERVALS[tonality];
    if (scaleIntervals === undefined) return ANCHOR_STRENGTH_CHROMATIC;
    const ivFromRoot = (((pc - scaleRoot) % 12) + 12) % 12;
    let inScale = false;
    for (let i = 0; i < scaleIntervals.length; i++) {
        if (scaleIntervals[i] === ivFromRoot) { inScale = true; break; }
    }
    if (!inScale) return ANCHOR_STRENGTH_CHROMATIC;
    if (ivFromRoot === 0) return ANCHOR_STRENGTH_TONIC;
    if (ivFromRoot === 7) return ANCHOR_STRENGTH_FIFTH;
    // 3rd-of-scale 优先 major-3(4),fallback minor-3(3)
    let hasM3 = false, hasm3 = false;
    for (let i = 0; i < scaleIntervals.length; i++) {
        if (scaleIntervals[i] === 4) hasM3 = true;
        if (scaleIntervals[i] === 3) hasm3 = true;
    }
    if (hasM3 && ivFromRoot === 4) return ANCHOR_STRENGTH_THIRD;
    if (!hasM3 && hasm3 && ivFromRoot === 3) return ANCHOR_STRENGTH_THIRD;
    return ANCHOR_STRENGTH_DIATONIC;
}

/**
 * 派生函数:为某 tonality 计算 SCALE_GRAVITY 条目。
 *
 * 算法:对每个 scale tone fromIv,在 scale 内寻找 ±2 半音距、anchor 更高的 toIv,
 * 取 α 最高者。score = round(α × 10),type 按方向 + α 阈值分类。
 *
 * Tonic 无 pull target(自身就是最稳定),跳过。
 */
export function computeLerdahlScaleGravity(tonality: Tonality): ReadonlyArray<ScaleGravityRule> {
    const scaleIntervals = SCALE_INTERVALS[tonality];
    if (scaleIntervals === undefined) return [];
    const rules: ScaleGravityRule[] = [];

    for (let fromIdx = 0; fromIdx < scaleIntervals.length; fromIdx++) {
        const fromIv = scaleIntervals[fromIdx];
        if (fromIv === 0) continue;  // tonic 无解决方向
        const sFrom = lerdahlScaleStrength(fromIv, 0, tonality);

        let bestToIv = -1;
        let bestAlpha = 0;
        for (let toIdx = 0; toIdx < scaleIntervals.length; toIdx++) {
            const toIv = scaleIntervals[toIdx];
            if (toIv === fromIv) continue;
            const rawDist = (((toIv - fromIv) % 12) + 12) % 12;
            const n = Math.min(rawDist, 12 - rawDist);
            if (n > 2) continue;  // 仅 ±2 半音内 gravity pull
            const sTo = lerdahlScaleStrength(toIv, 0, tonality);
            if (sTo <= sFrom) continue;  // 只往更稳定方向解决
            const alpha = (sTo / sFrom) * (1 / (n * n));
            if (alpha > bestAlpha) { bestAlpha = alpha; bestToIv = toIv; }
        }
        if (bestToIv < 0) continue;

        const upDist = (((bestToIv - fromIv) % 12) + 12) % 12;
        const downDist = 12 - upDist;
        const isUp = upDist <= downDist;
        const score = Math.round(bestAlpha * 10);
        const type: ScaleGravityType = bestAlpha < 0.5
            ? ScaleGravityType.Hang
            : (isUp ? ScaleGravityType.ResolveUp : ScaleGravityType.ResolveDown);
        rules.push({ fromInterval: fromIv, toInterval: bestToIv, score, type });
    }
    return rules;
}

// ============================================================
// 主表 — Major-family 派生 + Minor-family / exotic 手调
// ============================================================

/**
 * 索引 = Tonality enum。
 * undefined 表示该 tonality 无引力规则(纯五声 / chromatic 等)。
 */
export const SCALE_GRAVITY: ReadonlyArray<ReadonlyArray<ScaleGravityRule>> = (() => {
    const arr: ReadonlyArray<ScaleGravityRule>[] = [];

    // ---- Major-family — Lerdahl 公式派生 ----
    arr[Tonality.Major]      = Object.freeze(computeLerdahlScaleGravity(Tonality.Major));
    arr[Tonality.Lydian]     = Object.freeze(computeLerdahlScaleGravity(Tonality.Lydian));
    arr[Tonality.Mixolydian] = Object.freeze(computeLerdahlScaleGravity(Tonality.Mixolydian));

    // ---- Pentatonic — 无强引力(已是骨架) ----
    arr[Tonality.Major_Pentatonic] = Object.freeze([]);
    arr[Tonality.Minor_Pentatonic] = Object.freeze([]);

    // ---- Minor-family — 手调(Aeolian sigh / 模态 sub-leading 等 Lerdahl 公式不覆盖) ----
    arr[Tonality.Minor] = Object.freeze([
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 25, type: ScaleGravityType.ResolveDown }),  // b6→5 minor sigh
        Object.freeze({ fromInterval: 10, toInterval: 0,  score: 18, type: ScaleGravityType.ResolveUp   }),  // b7→1 modal sub
        Object.freeze({ fromInterval: 2,  toInterval: 3,  score: 10, type: ScaleGravityType.ResolveUp   }),  // 2→b3 dark up
        Object.freeze({ fromInterval: 5,  toInterval: 3,  score: 12, type: ScaleGravityType.ResolveDown }),  // 4→b3 sub-down
    ]);

    arr[Tonality.Dorian] = Object.freeze([
        Object.freeze({ fromInterval: 9,  toInterval: 7,  score: 5,  type: ScaleGravityType.Hang        }),  // ♮6 hang(不被强拉)
        Object.freeze({ fromInterval: 9,  toInterval: 10, score: 6,  type: ScaleGravityType.ResolveUp   }),  // 6→b7 cool
        Object.freeze({ fromInterval: 2,  toInterval: 3,  score: 9,  type: ScaleGravityType.ResolveUp   }),
        Object.freeze({ fromInterval: 5,  toInterval: 3,  score: 6,  type: ScaleGravityType.ResolveDown }),
        Object.freeze({ fromInterval: 10, toInterval: 0,  score: 10, type: ScaleGravityType.ResolveUp   }),
    ]);

    arr[Tonality.Phrygian] = Object.freeze([
        Object.freeze({ fromInterval: 1,  toInterval: 0,  score: 22, type: ScaleGravityType.ResolveDown }),  // b2→1 dark Phrygian signature
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 20, type: ScaleGravityType.ResolveDown }),
    ]);

    arr[Tonality.Harmonic_Minor] = Object.freeze([
        Object.freeze({ fromInterval: 11, toInterval: 0,  score: 25, type: ScaleGravityType.ResolveUp   }),  // 7→1 raised leading
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 20, type: ScaleGravityType.ResolveDown }),
        Object.freeze({ fromInterval: 2,  toInterval: 3,  score: 10, type: ScaleGravityType.ResolveUp   }),
    ]);

    arr[Tonality.Melodic_Minor] = Object.freeze([
        Object.freeze({ fromInterval: 11, toInterval: 0,  score: 22, type: ScaleGravityType.ResolveUp   }),
        Object.freeze({ fromInterval: 9,  toInterval: 11, score: 8,  type: ScaleGravityType.ResolveUp   }),
        Object.freeze({ fromInterval: 2,  toInterval: 3,  score: 9,  type: ScaleGravityType.ResolveUp   }),
    ]);

    arr[Tonality.Blues] = Object.freeze([
        // Blues 的"引力"主要是 b3↔3、b5↔5 之间的弯音色,score 偏弱(blues 哲学就是 hang 不强解决)
        Object.freeze({ fromInterval: 3,  toInterval: 0,  score: 8,  type: ScaleGravityType.ResolveDown }),
        Object.freeze({ fromInterval: 6,  toInterval: 7,  score: 10, type: ScaleGravityType.ResolveUp   }),  // b5→5 blue note
        Object.freeze({ fromInterval: 10, toInterval: 0,  score: 6,  type: ScaleGravityType.ResolveUp   }),
    ]);

    // ---- Batch 5 新增 ----
    arr[Tonality.Locrian] = Object.freeze([
        Object.freeze({ fromInterval: 1,  toInterval: 0,  score: 18, type: ScaleGravityType.ResolveDown }),  // b2→1
        Object.freeze({ fromInterval: 6,  toInterval: 7,  score: 5,  type: ScaleGravityType.ResolveUp   }),  // b5→? weak
    ]);

    arr[Tonality.LydianDominant] = Object.freeze([
        Object.freeze({ fromInterval: 6,  toInterval: 7,  score: 16, type: ScaleGravityType.ResolveUp   }),  // #4→5
        Object.freeze({ fromInterval: 10, toInterval: 9,  score: 10, type: ScaleGravityType.ResolveDown }),  // b7→6
    ]);

    arr[Tonality.PhrygianDominant] = Object.freeze([
        Object.freeze({ fromInterval: 1,  toInterval: 0,  score: 25, type: ScaleGravityType.ResolveDown }),  // b9→1 dark sub-tonic
        Object.freeze({ fromInterval: 11, toInterval: 0,  score: 22, type: ScaleGravityType.ResolveUp   }),  // 7→1 strong leading
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 20, type: ScaleGravityType.ResolveDown }),  // b13→5
        Object.freeze({ fromInterval: 5,  toInterval: 4,  score: 12, type: ScaleGravityType.ResolveDown }),  // 4→3
    ]);

    arr[Tonality.Altered] = Object.freeze([
        // Altered scale 的引力主要是 cross-chord(解决到下个 chord 的 tones),
        // within-scale tendencies 弱;占位规则供 evaluator 在 phrase-end 使用。
        Object.freeze({ fromInterval: 1,  toInterval: 0,  score: 18, type: ScaleGravityType.ResolveDown }),  // b9→1
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 15, type: ScaleGravityType.ResolveDown }),  // b13→5
    ]);

    arr[Tonality.BebopDominant] = Object.freeze([
        Object.freeze({ fromInterval: 11, toInterval: 0,  score: 16, type: ScaleGravityType.ResolveUp   }),  // nat 7→1 (added passing)
        Object.freeze({ fromInterval: 10, toInterval: 9,  score: 10, type: ScaleGravityType.ResolveDown }),  // b7→6
        Object.freeze({ fromInterval: 5,  toInterval: 4,  score: 14, type: ScaleGravityType.ResolveDown }),  // 4→3
    ]);

    arr[Tonality.BebopMajor] = Object.freeze([
        Object.freeze({ fromInterval: 5,  toInterval: 4,  score: 15, type: ScaleGravityType.ResolveDown }),  // 4→3
        Object.freeze({ fromInterval: 11, toInterval: 0,  score: 22, type: ScaleGravityType.ResolveUp   }),  // 7→1
        Object.freeze({ fromInterval: 8,  toInterval: 7,  score: 12, type: ScaleGravityType.ResolveDown }),  // added b6→5
    ]);

    return Object.freeze(arr);
})();

// ============================================================
// 查询函数
// ============================================================

/**
 * 取某 tonality 的全部 gravity rules(只读)。
 * 未定义返回空数组。
 */
export function getScaleGravityRules(tonality: Tonality): ReadonlyArray<ScaleGravityRule> {
    const rules = SCALE_GRAVITY[tonality];
    return rules !== undefined ? rules : [];
}

/**
 * 按 fromInterval 索引(每 from 取 score 最高的 rule)。
 *
 * 返回长度 12 的稀疏数组(对应 interval 0-11),元素 undefined 表示该 interval
 * 在该 tonality 上无 gravity rule。
 *
 * 设计原因:消费方(HarmonicEvaluator)需要 O(1) lookup "我现在这个 PC 想去哪",
 * 而不是每次扫线性表。
 */
export function getScaleGravityByFromInterval(
    tonality: Tonality,
): ReadonlyArray<ScaleGravityRule | undefined> {
    const out: (ScaleGravityRule | undefined)[] = new Array(12);
    const rules = SCALE_GRAVITY[tonality];
    if (rules === undefined) return out;
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const existing = out[r.fromInterval];
        if (existing === undefined || r.score > existing.score) {
            out[r.fromInterval] = r;
        }
    }
    return out;
}
