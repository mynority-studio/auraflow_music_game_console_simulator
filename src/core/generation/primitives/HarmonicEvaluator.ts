// ============================================================
// HarmonicEvaluator — Chord-context + Key-context 双层和声评估器
// ============================================================
//
// 出处:melodygenerative evaluateNoteInChordContext — 整个旋律选音哲学的
// "统一裁决器"。给定 (notePc, chord, nextChord, key, scale) 上下文,返回
// 该音的:
//   - 协和度等级(Consonant / Colortone / Tension / Avoid)
//   - 解决迫切度(urgency, [0, 1])
//   - 解决目标 pcs(钱想去的几个具体音)
//   - 三个 flag:in chord contract / in chord extension / in next chord anchor
//
// 设计核心:**Layer A + Layer B 双层裁决**,取严不取宽:
//   Layer A:chord-context(TENDENCY_TABLE)— 当前和弦上的角色
//   Layer B:key-context(IntervalAesthetics)— 调内的牵引
//   → finalGravity = max(A, B)
//   → finalState   = harshest(A, B)
//   → finalTargets = union(A, B) 在绝对 pcs
//
// 关键案例:G7 上的 B
//   Layer A (Dom)[4] = ChordTone gravity=0   chord 3rd,harmless
//   Layer B (Major)[11] = Leading 0.95       key 7th,must go to 1
//   → 取 Layer B,B-on-G7 升级为 tension/urgency=0.95
//
// 模块定位:**primitives/**(与 VoicingProcessor 同层)
//   - 纯函数评估器,零 PRNG,零副作用
//   - 消费 data/* 的 6 张表:TendencyTable / IntervalAesthetics /
//     ModalCharacteristics(本批 3 张),CHORD_INTERVALS / SCALE_INTERVALS
//     (types.ts 已有)
//   - 后续 Batch 3 被 VoicingProcessor 接;Batch 7 被 ToplineEngine /
//     Reconciler 接做主旋律选音
//
// 与 melodygenerative 原版的差异:
//   1. 字符串 chord type → ChordQuality enum(P-1)
//   2. 复杂 fallback 路径(CHORD_VOICING_AESTHETICS / computeGlobalContract /
//      isAvoidNote 物理三法则)— Batch 2 用简化版(TENDENCY_TABLE 主路径覆盖
//      绝大多数 case;dim/aug/HalfDim 用简单 CHORD_INTERVALS 兜底)。完整
//      物理法则待 Batch 7 sacred boundary 时再补
//   3. localScalePcs 用 ReadonlyArray<number> 而非 Set(P-1 无 Set)
//
// PRNG:0(纯函数)
// 依赖:types.ts + data/TendencyTable + data/IntervalAesthetics +
//      data/ModalCharacteristics
// Cross-sync:依赖 ChordQuality + Tonality enum 数值(§1.4 已涵盖)
// ============================================================

import {
    ChordQuality,
    CHORD_INTERVALS,
    CQ_IS_DOM,
    CQ_IS_MAJOR,
    CQ_IS_MINOR,
    CQ_IS_DIM,
    Tonality,
} from '../types';
import {
    TENDENCY_TABLE,
    TendencyState,
    ChordScenario,
    resolveChordScenario,
    EffectiveFunc,
    FUNC_T,
    FUNC_S,
    FUNC_D,
} from '../data/TendencyTable';
import {
    INTERVAL_AESTHETICS_MAJOR,
    INTERVAL_AESTHETICS_MINOR,
    IntervalFunction,
    isMajorLikeTonality,
} from '../data/IntervalAesthetics';
import { isModalCharacteristicInterval } from '../data/ModalCharacteristics';

// Re-export for consumers(避免他们直接 import data/*,减少跨层耦合)
// 注:EffectiveFunc 是 type alias,isolatedModules 下需走 `export type`
export type { EffectiveFunc };
export { FUNC_T, FUNC_S, FUNC_D };

// ============================================================
// Enum + 接口
// ============================================================

/**
 * 协和度等级 — 主输出的"主要分类":
 *   Consonant — chord tone,无需解决
 *   Colortone — 可悬挂的色彩音(9 / 11 / 13 mild tension)
 *   Tension  — 张力音,gravity ≥ 0.5,通常需解决
 *   Avoid    — 必须解决(破坏 chord identity / m9 clash 等)
 */
export enum ConsonanceLevel {
    Consonant = 0,
    Colortone = 1,
    Tension   = 2,
    Avoid     = 3,
}

export const ConsonanceLevelName: ReadonlyArray<string> = Object.freeze([
    'Consonant', 'Colortone', 'Tension', 'Avoid',
]);

/** 全曲 tonal character — 决定 evaluator 是否放宽解决要求 */
export enum TonalCharacter {
    /** 功能和声 — tensions 必须解决,V→I cadence 是 load-bearing */
    Tonal = 0,
    /** Scale-color music — tensions 是长 form 色彩,blues b3/b7 等可悬挂 */
    Modal = 1,
}

/** 单点评估的输入参数包 */
export interface NoteEvaluationInput {
    /** 待评估的旋律 / voice PC ∈ [0, 11] */
    notePc: number;
    /** 当前和弦根音 PC */
    chordRootPc: number;
    /** 当前和弦质量 */
    chordQuality: ChordQuality;
    /** 当前和弦的 TSD 功能:0=T / 1=S / 2=D */
    effectiveFunc: EffectiveFunc;

    /** 下一和弦根音 PC(用于 anticipatory resolution,可选) */
    nextChordRootPc?: number;
    /** 下一和弦质量 */
    nextChordQuality?: ChordQuality;

    /** 全曲主调根音 PC */
    keyRootPc: number;
    /** 全曲主调 tonality(决定 IntervalAesthetics 走 major / minor profile) */
    keyTonality: Tonality;
    /**
     * 局部调中心 PC(secondary dominant / borrowed chord 借用时不为 undefined)。
     * 缺省时 evaluator 用 keyRootPc 做 Layer B 锚定。
     */
    localTonalCenterPc?: number;

    /** Modal/Tonal 切换(默认 Tonal) */
    tonalCharacter?: TonalCharacter;
    /**
     * 当前 bar 的 runScale PC 集(可选,scale-aware 评估)。
     *
     * 提供时:
     *   - in-scale 音不能降到 Avoid(scale 内色彩天然合法)
     *   - out-of-scale 音不能高于 Consonant/Colortone(强制升 Tension)
     *   - modal 模式下 in-scale Tension 升级为 Colortone
     */
    barScalePcs?: ReadonlyArray<number>;
    /**
     * 当前 bar runScale 的 tonality(可选,启用 modal characteristic 豁免)。
     *
     * 提供时:if (isModalContext && barScaleTonality 的特征音含 noteInterval) → 不判 Avoid
     * 主要用于 Dorian ♮6 / Lydian #11 / Phrygian b2 等模态色彩.
     */
    barScaleTonality?: Tonality;
}

/** 评估输出 */
export interface NoteHarmonicAssessment {
    /** 主分类 — chord-context first,key-context 严化 */
    consonance: ConsonanceLevel;
    /** 解决迫切度 [0, 1] */
    urgency: number;
    /**
     * 想去的解决目标 PC 集(绝对 pc,已展开到 [0, 11])。
     * 已剔除自身 PC。优先级 union:
     *   1. TENDENCY_TABLE.targets(chord-relative offset 已加 chordRoot)
     *   2. Chord literal 1/3/5/7(近邻 anchor)
     *   3. Next-chord 1/3/5(anticipatory)
     *   4. IntervalAesthetics.expectedResolutions(key-relative,已加 keyRoot/localCenter)
     */
    resolutionTargetsPc: ReadonlyArray<number>;
    /** PC 是否是当前和弦 literal interval(root/3/5/7/9/11/13 of CHORD_INTERVALS) */
    isInChordContract: boolean;
    /** PC 是否是 admissible 色彩扩展(本批简化版:chord scale 内但非 contract) */
    isInChordExtension: boolean;
    /** PC 是否是 next 和弦的 1/3/5(anticipatory resolution candidate) */
    isInNextChordAnchor: boolean;
}

// ============================================================
// 内部 helper
// ============================================================

/** [0, 11] mod 归一化(正确处理负数) */
function normalizePc(pc: number): number {
    return (((pc | 0) % 12) + 12) % 12;
}

/** 取 interval 在 [0, 11] 区间(相对 chord/key root) */
function intervalFromRoot(notePc: number, rootPc: number): number {
    return normalizePc(notePc - rootPc);
}

/** 用 bitmask 检测 ChordQuality 是否 dom 家族 */
function isDomFamily(quality: ChordQuality): boolean {
    return ((1 << quality) & CQ_IS_DOM) !== 0;
}

/** 是否 maj 家族(Major / Major7 / Major9 / Add9) */
function isMajorFamily(quality: ChordQuality): boolean {
    return ((1 << quality) & CQ_IS_MAJOR) !== 0 || quality === ChordQuality.Add9;
}

/** 是否 min 家族(纯小三 base,不含 dim) */
function isMinorFamily(quality: ChordQuality): boolean {
    return ((1 << quality) & CQ_IS_MINOR) !== 0;
}

/** 是否 dim 家族(Diminished / Diminished7 / HalfDiminished) */
function isDimFamily(quality: ChordQuality): boolean {
    return ((1 << quality) & CQ_IS_DIM) !== 0;
}

/**
 * 计算和弦的 "admissible 色彩扩展" PC 集(本批简化版)。
 *
 * 完整版(melodygenerative computeGlobalContract):
 *   maj   家族 + 9 + 13 + #11
 *   min   家族 + 9 + 11 + 13 + b7
 *   dom   家族 + 9 + 13 + b9 + #9 + #11 + b13(altered tensions)
 *   halfDim + 11 + b13
 *   dim / aug 保留窄
 *
 * 本批简化:仅给出主要 admissible 扩展,符合 auraflow 现有 ChordQuality 覆盖。
 * 待 Batch 5 扩 ChordQuality 后,可与 CHORD_SCALE_INTERVALS 对齐扩展。
 *
 * 返回相对 chord root 的 interval 集(不含 root literal,只列 admissible 扩展)。
 */
function getAdmissibleColorIntervals(quality: ChordQuality): ReadonlyArray<number> {
    if (isMajorFamily(quality)) {
        return ADMISSIBLE_MAJ;
    }
    if (isMinorFamily(quality)) {
        return ADMISSIBLE_MIN;
    }
    if (isDomFamily(quality)) {
        return ADMISSIBLE_DOM;
    }
    if (quality === ChordQuality.HalfDiminished) {
        return ADMISSIBLE_HALFDIM;
    }
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) {
        return ADMISSIBLE_SUS;
    }
    // Diminished / Diminished7 / Augmented 保留窄(无扩展)
    return EMPTY_INTERVALS;
}

const EMPTY_INTERVALS: ReadonlyArray<number> = Object.freeze([]);
const ADMISSIBLE_MAJ:    ReadonlyArray<number> = Object.freeze([2, 9, 6]);             // 9 / 13 / #11
const ADMISSIBLE_MIN:    ReadonlyArray<number> = Object.freeze([2, 5, 9, 10]);          // 9 / 11 / 13 / b7
const ADMISSIBLE_DOM:    ReadonlyArray<number> = Object.freeze([2, 9, 1, 3, 6, 8]);    // 9 / 13 / b9 / #9 / #11 / b13
const ADMISSIBLE_HALFDIM:ReadonlyArray<number> = Object.freeze([5, 8]);                // 11 / b13(Locrian)
const ADMISSIBLE_SUS:    ReadonlyArray<number> = Object.freeze([2, 9]);                // 9 / 13

/** 取下一和弦的 anchor PCs(root + 3 + 5,quality-aware) */
function getNextChordAnchorPcs(
    nextChordRootPc: number,
    nextChordQuality: ChordQuality,
): ReadonlyArray<number> {
    const nrpc = normalizePc(nextChordRootPc);
    const intervals = CHORD_INTERVALS[nextChordQuality];
    if (intervals === undefined) return EMPTY_INTERVALS;
    const anchors: number[] = [nrpc];
    for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i];
        // 仅纳入 3 / 4 / 7 半音(minor third / major third / fifth)
        if (iv === 3 || iv === 4 || iv === 7) {
            anchors.push((nrpc + iv) % 12);
        }
    }
    return anchors;
}

// ============================================================
// Main: evaluateNoteInChordContext
// ============================================================

/**
 * 评估某 PC 在当前 (chord, key, scale) 上下文中的和声角色。
 *
 * 算法步骤:
 *   1. 归一化输入 PC,计算 pcFromChord / pcFromLocalKey
 *   2. 计算 contract / extension / next-anchor 三 flag
 *   3. Layer A:TENDENCY_TABLE 主裁决
 *      - resolveChordScenario(quality, func) 返回 6 个 scenario 之一或 null
 *      - 命中:state → consonance,gravity 直接用,targets 转绝对 pc
 *      - null:走 CHORD_INTERVALS 简单 fallback(chord tone / outside)
 *   4. Layer B:IntervalAesthetics(major/minor profile by keyTonality)
 *      - localTonalCenterPc 优先(secondary dominant 时)
 *      - 取 max(gravityA, gravityB);Layer B 严化时升级 consonance
 *   5. Modal characteristic exemption(barScaleTonality 在 modal 列表内时,
 *      特征 interval 不判 Avoid)
 *   6. Scale-aware 校正(barScalePcs 提供时,in-scale / out-of-scale 升降)
 *   7. urgency 从 gravity 派生;modal tonalCharacter 时 halve
 *   8. resolutionTargetsPc 集合(union 多源 + 剔除自身 PC)
 */
export function evaluateNoteInChordContext(input: NoteEvaluationInput): NoteHarmonicAssessment {
    const notePc       = normalizePc(input.notePc);
    const chordRootPc  = normalizePc(input.chordRootPc);
    const keyRootPc    = normalizePc(input.keyRootPc);
    const localCenter  = input.localTonalCenterPc !== undefined
        ? normalizePc(input.localTonalCenterPc) : keyRootPc;
    const tonalChar    = input.tonalCharacter ?? TonalCharacter.Tonal;

    const pcFromChord    = intervalFromRoot(notePc, chordRootPc);
    const pcFromLocalKey = intervalFromRoot(notePc, localCenter);

    // ------------------------------------------------------------
    // (1) Chord contract / extension / next-anchor flags
    // ------------------------------------------------------------
    const literalIntervals = CHORD_INTERVALS[input.chordQuality];
    let isInChordContract = false;
    if (literalIntervals !== undefined) {
        for (let i = 0; i < literalIntervals.length; i++) {
            if (((chordRootPc + literalIntervals[i]) % 12) === notePc) {
                isInChordContract = true;
                break;
            }
        }
    }

    let isInChordExtension = false;
    if (!isInChordContract) {
        const ext = getAdmissibleColorIntervals(input.chordQuality);
        for (let i = 0; i < ext.length; i++) {
            if (((chordRootPc + ext[i]) % 12) === notePc) {
                isInChordExtension = true;
                break;
            }
        }
    }

    let isInNextChordAnchor = false;
    let nextAnchorPcs: ReadonlyArray<number> = EMPTY_INTERVALS;
    if (input.nextChordRootPc !== undefined && input.nextChordQuality !== undefined) {
        nextAnchorPcs = getNextChordAnchorPcs(input.nextChordRootPc, input.nextChordQuality);
        for (let i = 0; i < nextAnchorPcs.length; i++) {
            if (nextAnchorPcs[i] === notePc) {
                isInNextChordAnchor = true;
                break;
            }
        }
    }

    // ------------------------------------------------------------
    // (2) Layer A:TENDENCY_TABLE 主裁决
    // ------------------------------------------------------------
    let consonance: ConsonanceLevel;
    let layerATargetsAbs: number[] = [];
    let layerAGravity: number;
    const scenario = resolveChordScenario(input.chordQuality, input.effectiveFunc);

    if (scenario !== null) {
        const tendency = TENDENCY_TABLE[scenario][pcFromChord];
        layerAGravity = tendency.gravity;
        // chord-relative offsets → absolute pcs
        for (let i = 0; i < tendency.targets.length; i++) {
            layerATargetsAbs.push((chordRootPc + tendency.targets[i]) % 12);
        }
        // state → consonance
        if (tendency.state === TendencyState.ChordTone) {
            consonance = ConsonanceLevel.Consonant;
        } else if (tendency.state === TendencyState.Tension) {
            consonance = tendency.gravity >= 0.5 ? ConsonanceLevel.Tension : ConsonanceLevel.Colortone;
        } else {
            consonance = ConsonanceLevel.Avoid;
        }
    } else {
        // Fallback:dim / aug / m7b5 等 — TENDENCY_TABLE 不覆盖
        // 简单判定:chord literal → Consonant;admissible ext → Colortone;其他 → Tension
        if (isInChordContract) {
            // dom 家族的 b7 / maj 家族的 maj7 在 melodygenerative 还会升级到 tension,
            // 但 dim / aug / m7b5 fallback 路径里这种细分意义不大,保持 Consonant
            consonance = ConsonanceLevel.Consonant;
            layerAGravity = 0;
        } else if (isInChordExtension) {
            consonance = ConsonanceLevel.Colortone;
            layerAGravity = 0.2;
        } else {
            consonance = ConsonanceLevel.Tension;
            layerAGravity = 0.6 + (input.effectiveFunc === FUNC_D ? 0.2 : 0);
        }
    }

    // ------------------------------------------------------------
    // (3) Layer B:IntervalAesthetics(key-relative)
    // ------------------------------------------------------------
    const layerBProfile = isMajorLikeTonality(input.keyTonality)
        ? INTERVAL_AESTHETICS_MAJOR
        : INTERVAL_AESTHETICS_MINOR;
    const layerBRule = layerBProfile[pcFromLocalKey];
    const layerBGravity = layerBRule.tensionAmount;
    // Layer B targets 转绝对 pc(用 localCenter 锚定 — 借用时跟着借)
    const layerBTargetsAbs: number[] = [];
    for (let i = 0; i < layerBRule.expectedResolutions.length; i++) {
        layerBTargetsAbs.push((localCenter + layerBRule.expectedResolutions[i]) % 12);
    }

    // Max-merge:Layer B 严化时升级 consonance(永不降级)
    let finalGravity = layerAGravity;
    if (layerBGravity > layerAGravity) {
        finalGravity = layerBGravity;
        if (layerBGravity >= 0.85) {
            // 极高紧张 — Tension function 升级到 Avoid;其他升级到 Tension
            if (layerBRule.function === IntervalFunction.Tension) {
                if (consonance < ConsonanceLevel.Avoid) {
                    consonance = ConsonanceLevel.Avoid;
                }
            } else {
                if (consonance < ConsonanceLevel.Tension) {
                    consonance = ConsonanceLevel.Tension;
                }
            }
        } else if (layerBGravity >= 0.5) {
            if (consonance < ConsonanceLevel.Tension) {
                consonance = ConsonanceLevel.Tension;
            }
        }
    }

    // ------------------------------------------------------------
    // (4) Modal characteristic exemption
    // ------------------------------------------------------------
    // barScaleTonality 在 modal 列表中(Dorian / Lydian / Phrygian / ...)且当前
    // interval 是该 mode 的特征音 → 不判 Avoid。
    if (input.barScaleTonality !== undefined && consonance === ConsonanceLevel.Avoid) {
        const intervalFromBarScale = pcFromLocalKey;  // barScale 默认锚 localCenter
        if (isModalCharacteristicInterval(input.barScaleTonality, intervalFromBarScale)) {
            consonance = ConsonanceLevel.Colortone;
        }
    }

    // ------------------------------------------------------------
    // (5) Scale-aware 校正(barScalePcs 提供时)
    // ------------------------------------------------------------
    if (input.barScalePcs !== undefined && input.barScalePcs.length > 0) {
        let inScale = false;
        for (let i = 0; i < input.barScalePcs.length; i++) {
            if (normalizePc(input.barScalePcs[i]) === notePc) { inScale = true; break; }
        }
        if (inScale) {
            // in-scale 不能降到 Avoid;modal 时 Tension 升级为 Colortone
            if (consonance === ConsonanceLevel.Avoid) {
                consonance = ConsonanceLevel.Colortone;
            }
            if (tonalChar === TonalCharacter.Modal && consonance === ConsonanceLevel.Tension) {
                consonance = ConsonanceLevel.Colortone;
            }
        } else {
            // out-of-scale 不能 ≤ Colortone(强制升 Tension)
            if (consonance < ConsonanceLevel.Tension) {
                consonance = ConsonanceLevel.Tension;
            }
        }
    }

    // ------------------------------------------------------------
    // (6) urgency 派生 + modal halve
    // ------------------------------------------------------------
    let urgency = finalGravity;
    if (tonalChar === TonalCharacter.Modal && urgency > 0) {
        urgency = urgency * 0.5;
        if (urgency > 1) urgency = 1;
    }

    // ------------------------------------------------------------
    // (7) resolutionTargetsPc 集合 — union 多源后去重、剔除自身
    // ------------------------------------------------------------
    const targetsSet: number[] = [];
    const pushUnique = (pc: number): void => {
        const p = normalizePc(pc);
        if (p === notePc) return;
        for (let i = 0; i < targetsSet.length; i++) {
            if (targetsSet[i] === p) return;
        }
        targetsSet.push(p);
    };

    // a. Layer A targets
    for (let i = 0; i < layerATargetsAbs.length; i++) pushUnique(layerATargetsAbs[i]);
    // b. Chord literal anchors(1/3/5/7)
    if (literalIntervals !== undefined) {
        for (let i = 0; i < literalIntervals.length; i++) {
            pushUnique((chordRootPc + literalIntervals[i]) % 12);
        }
    }
    // c. Next chord anchor pcs
    for (let i = 0; i < nextAnchorPcs.length; i++) pushUnique(nextAnchorPcs[i]);
    // d. Layer B targets
    for (let i = 0; i < layerBTargetsAbs.length; i++) pushUnique(layerBTargetsAbs[i]);

    return {
        consonance,
        urgency,
        resolutionTargetsPc: targetsSet,
        isInChordContract,
        isInChordExtension,
        isInNextChordAnchor,
    };
}
