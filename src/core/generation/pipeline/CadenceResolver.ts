// ============================================================
// CadenceResolver — Cadence Resolution(Definition 4)三层裁决
// ============================================================
//
// 出处:melodygenerative classifyCadenceTier / cadenceTargetPcs。给定 phrase
// 末尾位置的 chord context,决定最后音"该往哪里着陆":
//
//   Tier A — 剧终(global end + T 功能)
//     全曲最后 chord 是 T 功能 → 强制旋律落到 key root / key 3rd(major 用 M3,
//     minor 用 m3)。听感:"圆满归宿,绝对回家"。
//
//   Tier B — 句号(phrase-end + T 功能)
//     段落最后 chord 是 T 功能 → 强制落到 chord 1/3/5(no extensions)。
//     听感:"圆满,但比剧终柔和;不强行回 key root,只回 chord backbone"。
//
//   Tier C — 问号(phrase-end + D/S 功能)
//     段落最后 chord 是 D/S 功能 → preserve-tension(如果当前 pitch 已经在 chord
//     extended contract 内,保留;否则 soft snap 到 contract)。
//     听感:"半终止,问号挂着,期待下个 phrase 的回答"。
//
// auraflow 与 melodygenerative 差异:
//   - 字符串 chord type → ChordQuality enum
//   - 字符串 CadenceTier → 数值 enum
//   - keyRootPc 在 RELATIVE 空间恒为 0(K-2 铁律)— 调用方不需要传
//   - chord 的 HarmonicFunction 从 root pc 派生(0/3/4/9 = Tonic,5/2 = Subdom,7/11 = Dom)
//
// 设计哲学(melodygenerative 注释 line 3953-3958):
//   "Style flavor lives in passing tones and non-cadence color magnetism;
//    cadence is purely chord-driven."
//   风格色彩在非 cadence 位置体现,cadence 落点不该按 style 浮动 — 它是
//   "听觉上的回家信号",纯由 chord 功能决定。
//
// 消费方(Batch 6 接入):
//   - ToplineEngine.render 在 Pass 3 后(slots pitch 全确定 + sustain 已计算)
//     扫描最后一个有效 slot,按 tier 做 snap
//   - 未来 Batch 7 Sacred Boundary:motif 末尾音的 cadence 优先级最高(打破 sacred)
//
// PRNG:0(纯函数,无副作用)
// 依赖:types.ts(ChordQuality / CHORD_INTERVALS / Tonality)
//
// Cross-sync:依赖 ChordQuality + Tonality enum 数值(§1.4 涵盖)
// ============================================================

import { GeneratedChord, ChordQuality, CHORD_INTERVALS, Tonality } from '../types';

// ============================================================
// 数值枚举
// ============================================================

/** 4 个 cadence 等级 */
export enum CadenceTier {
    /** 非 cadence 位置 — 不做 snap */
    None                  = 0,
    /** 剧终(global end + T 功能)— 强制落 key root / 3rd */
    GlobalEndTonic        = 1,
    /** 句号(phrase end + T 功能)— 强制落 chord 1/3/5 */
    PhraseEndTonic        = 2,
    /** 问号(phrase end + D/S 功能)— preserve-tension */
    PhraseEndTension      = 3,
}

export const CadenceTierName: ReadonlyArray<string> = Object.freeze([
    'None', 'GlobalEndTonic', 'PhraseEndTonic', 'PhraseEndTension',
]);

/** snap 模式 */
export enum CadenceMode {
    /** 强制 snap 到 target PC(不论当前 pitch 是否合理) */
    Force            = 0,
    /** 已在 target PC 集合内 → 保留;否则 soft snap */
    PreserveTension  = 1,
}

/** chord 功能分类 — 数值与 HarmonicFunction / TsdFunc 同源(0=T, 1=S, 2=D) */
export enum ChordFunction {
    Tonic       = 0,
    Subdominant = 1,
    Dominant    = 2,
}

// ============================================================
// 输入 / 输出接口
// ============================================================

export interface CadenceClassifyInput {
    /** 是否全曲末尾(最后段最后 chord) */
    isGlobalEnd: boolean;
    /** 是否段落末尾(per-section 渲染时 section 最后 chord) */
    isPhraseEnd: boolean;
    /** 当前 chord 的功能 */
    chordFunc: ChordFunction;
}

export interface CadenceTargetInput {
    chord: GeneratedChord;
    /** Key tonality — Major-like 用 M3,Minor-like 用 m3(Tier A 决定 key third) */
    keyTonality: Tonality;
}

export interface CadenceTargetResult {
    /** target PC 集合(RELATIVE,[0, 11]) */
    pcs: ReadonlyArray<number>;
    /** snap 模式 */
    mode: CadenceMode;
}

// ============================================================
// chord function 派生
// ============================================================

/**
 * 按 chord root PC 反推 HarmonicFunction。
 *
 * 简化模型(与 MacroProgressionEngine.classifyFunctionByRoot 同源):
 *   root pc 5 / 2 → Subdominant(IV / ii)
 *   root pc 7 / 11 → Dominant(V / vii°)
 *   其他 → Tonic(I / vi / iii)
 *
 * Cross-sync:Batch 5.2 注入的 secondary dominant 让 chord.root 不再严格对应
 * 自然功能;但 cadence 处通常在段落末尾(很少触发 secondary dom),此简化能覆盖
 * 95%+ 场景。
 */
export function classifyChordFunction(rootPc: number): ChordFunction {
    const r = (((rootPc | 0) % 12) + 12) % 12;
    if (r === 5 || r === 2) return ChordFunction.Subdominant;
    if (r === 7 || r === 11) return ChordFunction.Dominant;
    return ChordFunction.Tonic;
}

// ============================================================
// Tier 分类
// ============================================================

/**
 * 派分 cadence tier。优先级:
 *   1. !isPhraseEnd → None(非 cadence 位置)
 *   2. isGlobalEnd + Tonic → GlobalEndTonic
 *   3. isGlobalEnd + 非 Tonic → None(开放结尾,如 ambient outro,保留原 pitch)
 *   4. Tonic → PhraseEndTonic
 *   5. Dominant / Subdominant → PhraseEndTension
 */
export function classifyCadenceTier(input: CadenceClassifyInput): CadenceTier {
    if (!input.isPhraseEnd) return CadenceTier.None;
    if (input.isGlobalEnd) {
        return input.chordFunc === ChordFunction.Tonic
            ? CadenceTier.GlobalEndTonic
            : CadenceTier.None;
    }
    if (input.chordFunc === ChordFunction.Tonic) return CadenceTier.PhraseEndTonic;
    return CadenceTier.PhraseEndTension;
}

// ============================================================
// Target PCs 计算
// ============================================================

const TONALITY_MAJOR_LIKE_MASK =
    (1 << Tonality.Major) |
    (1 << Tonality.Major_Pentatonic) |
    (1 << Tonality.Lydian) |
    (1 << Tonality.Mixolydian) |
    (1 << Tonality.LydianDominant) |
    (1 << Tonality.BebopDominant) |
    (1 << Tonality.BebopMajor);

function isMajorLikeKey(tonality: Tonality): boolean {
    return (TONALITY_MAJOR_LIKE_MASK & (1 << tonality)) !== 0;
}

/**
 * 取 chord backbone intervals(1/3/5 + 7 if chord has 7th)— 用于 Tier B "句号"。
 * 不含 extensions(9/11/13)— 句号位置的 melody 要落到 chord backbone,不漂浮在
 * 扩展色彩上。
 */
function getChordBackboneIntervals(quality: ChordQuality): ReadonlyArray<number> {
    const ivs = CHORD_INTERVALS[quality];
    if (ivs === undefined) return [0, 4, 7];  // 兜底 maj triad
    const backbone: number[] = [];
    for (let i = 0; i < ivs.length; i++) {
        const iv = ivs[i] % 12;
        if (iv === 0 || iv === 3 || iv === 4 || iv === 6 || iv === 7 || iv === 8 || iv === 10 || iv === 11) {
            // root / 3 / 5 / 7 — 不含 9 (2) / 11 (5,sus) / 13 (9 mod 12)
            if (backbone.indexOf(iv) === -1) backbone.push(iv);
        }
    }
    return backbone;
}

/**
 * 取 chord 扩展 contract PCs(literal + admissible extensions)— 用于 Tier C "问号"。
 * 与 HarmonicEvaluator.getAdmissibleColorIntervals 同模型(jazz convention):
 *   maj 家族 + 9 / 13 / #11
 *   min 家族 + 9 / 11 / 13 / b7
 *   dom 家族 + 9 / 13 / b9 / #9 / #11 / b13
 */
function getChordExtendedContractPcs(chord: GeneratedChord): number[] {
    const rootPc = (((chord.root | 0) % 12) + 12) % 12;
    const literalIvs = CHORD_INTERVALS[chord.quality] ?? [0, 4, 7];
    const pcs: number[] = [];

    // chord literal
    for (let i = 0; i < literalIvs.length; i++) {
        const pc = (rootPc + literalIvs[i]) % 12;
        if (pcs.indexOf(pc) === -1) pcs.push(pc);
    }

    // Admissible extensions(简化版,跟 HarmonicEvaluator ADMISSIBLE_* 一致)
    const q = chord.quality;
    if (q === ChordQuality.Major || q === ChordQuality.Major7 || q === ChordQuality.Major9
        || q === ChordQuality.Add9 || q === ChordQuality.Major13 || q === ChordQuality.Major7Sharp11) {
        addPc(pcs, (rootPc + 2) % 12);   // 9
        addPc(pcs, (rootPc + 9) % 12);   // 13
        addPc(pcs, (rootPc + 6) % 12);   // #11
    } else if (q === ChordQuality.Minor || q === ChordQuality.Minor7 || q === ChordQuality.Minor9
               || q === ChordQuality.Minor11) {
        addPc(pcs, (rootPc + 2) % 12);   // 9
        addPc(pcs, (rootPc + 5) % 12);   // 11
        addPc(pcs, (rootPc + 9) % 12);   // 13
        addPc(pcs, (rootPc + 10) % 12);  // b7
    } else if (q === ChordQuality.Dominant7 || q === ChordQuality.Dominant9 || q === ChordQuality.Dominant13
               || q === ChordQuality.Dominant7Sus4 || q === ChordQuality.Dom7Flat9 || q === ChordQuality.Dom7Sharp9
               || q === ChordQuality.Dom7Sharp11 || q === ChordQuality.Dom7Flat13 || q === ChordQuality.Dom7Alt
               || q === ChordQuality.Dominant11) {
        addPc(pcs, (rootPc + 2) % 12);   // 9
        addPc(pcs, (rootPc + 9) % 12);   // 13
        addPc(pcs, (rootPc + 1) % 12);   // b9
        addPc(pcs, (rootPc + 3) % 12);   // #9
        addPc(pcs, (rootPc + 6) % 12);   // #11
        addPc(pcs, (rootPc + 8) % 12);   // b13
    } else if (q === ChordQuality.HalfDiminished) {
        addPc(pcs, (rootPc + 5) % 12);   // 11
        addPc(pcs, (rootPc + 8) % 12);   // b13
    }
    // Diminished / Diminished7 / Augmented / Sus4 保留窄

    return pcs;
}

function addPc(arr: number[], pc: number): void {
    if (arr.indexOf(pc) === -1) arr.push(pc);
}

/**
 * 按 tier 计算 target PCs + mode。
 *
 * Tier A — GlobalEndTonic:
 *   key root + key third(major key M3,minor key m3)— 在 RELATIVE 空间 keyRoot=0
 *   返回 pcs = [0, 3 or 4],mode = Force
 *
 * Tier B — PhraseEndTonic:
 *   chord backbone(1 / 3 / 5,7 if chord has 7th)— mode = Force
 *
 * Tier C — PhraseEndTension:
 *   chord extended contract(literal + admissible extensions)— mode = PreserveTension
 *
 * Tier None:
 *   返回空数组 + Force(调用方应跳过)
 */
export function getCadenceTargetPcs(
    tier: CadenceTier,
    input: CadenceTargetInput,
): CadenceTargetResult {
    if (tier === CadenceTier.GlobalEndTonic) {
        // RELATIVE 空间 key root 恒为 0(K-2 铁律)
        const keyThird = isMajorLikeKey(input.keyTonality) ? 4 : 3;
        return Object.freeze({
            pcs: Object.freeze([0, keyThird]),
            mode: CadenceMode.Force,
        });
    }
    if (tier === CadenceTier.PhraseEndTonic) {
        const backbone = getChordBackboneIntervals(input.chord.quality);
        const rootPc = (((input.chord.root | 0) % 12) + 12) % 12;
        const pcs: number[] = [];
        for (let i = 0; i < backbone.length; i++) {
            pcs.push((rootPc + backbone[i]) % 12);
        }
        return Object.freeze({
            pcs: Object.freeze(pcs),
            mode: CadenceMode.Force,
        });
    }
    if (tier === CadenceTier.PhraseEndTension) {
        return Object.freeze({
            pcs: Object.freeze(getChordExtendedContractPcs(input.chord)),
            mode: CadenceMode.PreserveTension,
        });
    }
    return Object.freeze({
        pcs: Object.freeze([]),
        mode: CadenceMode.Force,
    });
}

// ============================================================
// Snap helper
// ============================================================

/**
 * 把 pitch 移到 target PC 集合内最近的合法位置。
 *
 * 算法:
 *   1. scalePcs(当前 chord/bar 的合法 PC 池)为空 → 兜底用 target PCs 自身
 *   2. 候选 = scalePcs ∩ targetPcs(交集)→ 跨 ±octave 展开到 MIDI 候选池
 *   3. 取距离 currentPitch 最近的候选
 *
 * PreserveTension 模式:调用方应先判定 "当前 PC 已在 target 内" → 直接返回原 pitch,
 * 不调本函数。
 *
 * 零 PRNG / 零分配除候选池外。
 */
export function snapPitchToCadence(
    currentPitch: number,
    targetPcs: ReadonlyArray<number>,
    scalePcs: ReadonlyArray<number>,
): number {
    if (targetPcs.length === 0) return currentPitch;

    // 先取交集 PC 集
    let candidatePcs: ReadonlyArray<number>;
    if (scalePcs.length === 0) {
        candidatePcs = targetPcs;
    } else {
        const intersect: number[] = [];
        for (let i = 0; i < targetPcs.length; i++) {
            for (let j = 0; j < scalePcs.length; j++) {
                if (targetPcs[i] === scalePcs[j]) {
                    if (intersect.indexOf(targetPcs[i]) === -1) intersect.push(targetPcs[i]);
                    break;
                }
            }
        }
        // 交集空 → 兜底用 target(不强求 in-scale)
        candidatePcs = intersect.length > 0 ? intersect : targetPcs;
    }

    // 在 ±12 半音内找最近的 PC 候选
    const lo = currentPitch - 12;
    const hi = currentPitch + 12;
    let best = currentPitch;
    let bestDist = Infinity;
    for (let p = lo; p <= hi; p++) {
        const pc = (((p % 12) + 12) % 12);
        for (let i = 0; i < candidatePcs.length; i++) {
            if (candidatePcs[i] === pc) {
                const dist = Math.abs(p - currentPitch);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = p;
                }
                break;
            }
        }
    }
    return bestDist === Infinity ? currentPitch : best;
}

/**
 * 检查 currentPitch 的 PC 是否已在 target PC 集合内。
 * 用于 PreserveTension 模式的早返。
 */
export function isPitchInTargetPcs(
    currentPitch: number,
    targetPcs: ReadonlyArray<number>,
): boolean {
    const pc = (((currentPitch % 12) + 12) % 12);
    for (let i = 0; i < targetPcs.length; i++) {
        if (targetPcs[i] === pc) return true;
    }
    return false;
}
