// ============================================================
// DynamicTSDDictionary — TSD-aware 和弦质量池(带 look-ahead)
// ============================================================
//
// 出处:melodygenerative dynamicHarmony.ts 的 DYNAMIC_TSD_DICTIONARY。给
// MacroProgressionEngine 提供"按当前 TSD 功能 × 下一和弦质量类别 × colorLevel"
// 的 ChordQuality 池,让和弦修饰能根据 voice-lead 目标做更 idiomatic 选择。
//
// 例:JAZZ.D 在 MinorTarget 时(V→i)选 7b9 / 7alt(altered dominant);
//     在 MajorTarget 时(V→I)选 9 / 13 / 7#11(开放色彩)。
//
// 跟 melodygenerative 的区别:
//   - 字符串风格名(POP/JAZZ/BLUES/RNB) → StyleId 数值枚举索引
//   - 字符串 TSD_Func('T'/'S'/'D')   → TsdFunc 数值枚举索引
//   - 字符串 ResolutionTarget          → ResolutionTarget 数值枚举索引
//   - 字符串 chord type(7b9 等)       → ChordQuality 数值枚举(Batch 5 扩展后已覆盖)
//   - melodygenerative POP/JAZZ/RNB → auraflow ModernPop/ChillJazz/NeoSoul 一一映射
//     (BLUES 暂未单独 style,blues 元素分布在 NeoSoul / ChillJazz 的部分规则里)
//
// 关键设计:**tritoneProb**(Sub-V 减半音替代概率)。当 D 解决到 perfect-fifth-down
// 时,有概率把 V 的 root 替换为 +6 半音(C 大调:G7 → Db7#11)。配套 colorLevel 静态
// 映射到 Lydian-Dom 家族(7 / 9 / 13 / 7#11)避免 7#9#11 monster strings。
//
// 消费方(Batch 5.1 暂不接,Batch 5.2 接 MacroProgressionEngine):
//   - MacroProgressionEngine.decorateChord(等 Batch 5.2 注入)
//   - HarmonicEvaluator(可选,作为"该 chord 在该 style + 功能下是否 idiomatic"参考)
//
// 零 PRNG。依赖 ChordQuality(Batch 5 扩 enum)+ StyleId。
//
// Cross-sync:依赖 ChordQuality / StyleId enum 数值(§1.4 / §1.6 已涵盖)。
// ============================================================

import { ChordQuality } from '../types';
import { StyleId } from '../config/StyleFlags';

// ============================================================
// 数值枚举
// ============================================================

/** TSD 功能 — 与 HarmonicEvaluator.EffectiveFunc 数值一致 */
export enum TsdFunc {
    Tonic       = 0,  // T
    Subdominant = 1,  // S
    Dominant    = 2,  // D
}

export const TsdFuncCount = 3;

export const TsdFuncName: ReadonlyArray<string> = Object.freeze([
    'Tonic', 'Subdominant', 'Dominant',
]);

/**
 * 下一和弦的"目标类别"。
 *   MajorTarget — 下一和弦是 major-family 的 T(I / IV / VI 在 Major;III / VI 在 minor)
 *   MinorTarget — 下一和弦是 minor / diminished family
 *   Deceptive  — currFunc=D 但 nextFunc≠T(欺骗终止 / D→S / D→D 等)
 *   Default    — 兜底(无 next 信息或不在上述分类)
 */
export enum ResolutionTarget {
    MajorTarget = 0,
    MinorTarget = 1,
    Deceptive   = 2,
    Default     = 3,
}

export const ResolutionTargetCount = 4;

export const ResolutionTargetName: ReadonlyArray<string> = Object.freeze([
    'MajorTarget', 'MinorTarget', 'Deceptive', 'Default',
]);

// ============================================================
// 接口
// ============================================================

/**
 * colorLevel × ChordQuality 池(3 档:0=保守 / 1=中等 / 2=色彩浓重)。
 *
 * 索引:levels[colorLevel] = ChordQuality[]
 * 长度恒为 3。
 */
export type ColorLevelPools = ReadonlyArray<ReadonlyArray<ChordQuality>>;

export interface DynamicRule {
    /** 命中条件:下一和弦目标类别 */
    target: ResolutionTarget;
    /** 该条件下 3 档 colorLevel 各自的 ChordQuality 池 */
    levels: ColorLevelPools;
    /**
     * Sub-V tritone substitution 触发概率 [0, 1]。
     * 仅 D-function rule 才有意义;V→I (perfect 5th down) 时 MacroProgressionEngine
     * 可消费此字段做决定性 hash 抽取(零 PRNG)。
     */
    tritoneProb?: number;
}

// ============================================================
// 内联工具(简化数据表写法)
// ============================================================

const rule = (
    target: ResolutionTarget,
    l0: ReadonlyArray<ChordQuality>,
    l1: ReadonlyArray<ChordQuality>,
    l2: ReadonlyArray<ChordQuality>,
    tritoneProb?: number,
): DynamicRule => {
    const obj: DynamicRule = Object.freeze({
        target,
        levels: Object.freeze([Object.freeze(l0.slice()), Object.freeze(l1.slice()), Object.freeze(l2.slice())]),
        ...(tritoneProb !== undefined ? { tritoneProb } : {}),
    });
    return obj;
};

// ============================================================
// 主表:DYNAMIC_TSD_DICTIONARY[styleId][func] = rule[]
// ============================================================
//
// 数据来源 melodygenerative DYNAMIC_TSD_DICTIONARY,4 macro × 3 func × 4 rule。
// auraflow 当前 3 个 styleId:ModernPop / ChillJazz / NeoSoul,一一映射 POP / JAZZ / RNB。
// melodygenerative BLUES 暂未独立 style — 其特征已分布在 NeoSoul 部分(7#9 / 7b13)和
// ChillJazz 的 Default 规则里。

// ---- ModernPop(对应 melodygenerative POP) ----
const POP_T: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.Default,
        [ChordQuality.Major],
        [ChordQuality.Add9],
        [ChordQuality.Major7]),
]);

const POP_S: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Major],
        [ChordQuality.Add9],
        [ChordQuality.Major7, ChordQuality.Major9]),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.Minor],
        [ChordQuality.Minor7],
        [ChordQuality.Minor9]),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Major],
        [ChordQuality.Major7],
        [ChordQuality.Major]),
    rule(ResolutionTarget.Default,
        [ChordQuality.Major],
        [ChordQuality.Add9],
        [ChordQuality.Major9]),
]);

const POP_D: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Dominant7, ChordQuality.Sus4],
        [ChordQuality.Dominant9, ChordQuality.Dominant7Sus4],
        [ChordQuality.Dominant11, ChordQuality.Dominant13]),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.Dominant7],
        [ChordQuality.Dominant7Sus4],
        [ChordQuality.Dom7Flat13]),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Sus4],
        [ChordQuality.Dominant7Sus4],
        [ChordQuality.Dominant11]),
    rule(ResolutionTarget.Default,
        [ChordQuality.Dominant7],
        [ChordQuality.Dominant7],
        [ChordQuality.Dominant9]),
]);

// ---- ChillJazz(对应 melodygenerative JAZZ) ----
const JAZZ_T: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.Default,
        [ChordQuality.Major7],
        [ChordQuality.Major9],
        [ChordQuality.Major13]),
]);

const JAZZ_S: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Major7],
        [ChordQuality.Major9],
        [ChordQuality.Major13]),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.HalfDiminished],
        [ChordQuality.HalfDiminished],   // melodygenerative m9b5 — auraflow fallback HalfDim
        [ChordQuality.Minor11]),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Minor7, ChordQuality.Minor9],
        [ChordQuality.Minor11],
        [ChordQuality.Major7Sharp11]),
    rule(ResolutionTarget.Default,
        [ChordQuality.Major7],
        [ChordQuality.Minor9],
        [ChordQuality.HalfDiminished]),
]);

const JAZZ_D: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Dominant7, ChordQuality.Dominant9],
        [ChordQuality.Dominant9, ChordQuality.Dominant13],
        [ChordQuality.Dominant13, ChordQuality.Dom7Sharp11],
        0.35),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.Dom7Flat9],
        [ChordQuality.Dom7Flat13, ChordQuality.Dom7Sharp9],
        [ChordQuality.Dom7Alt, ChordQuality.Dom7Flat9],
        0.30),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Dom7Flat9],
        [ChordQuality.Dom7Sharp9],
        [ChordQuality.Dom7Alt],
        0.15),
    rule(ResolutionTarget.Default,
        [ChordQuality.Dominant7],
        [ChordQuality.Dominant9, ChordQuality.Dominant13],
        [ChordQuality.Dom7Alt, ChordQuality.Dominant13]),
]);

// ---- NeoSoul(对应 melodygenerative RNB,亦消化 BLUES 的 7#9 / 7b13 特征) ----
const RNB_T: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.Default,
        [ChordQuality.Major7],
        [ChordQuality.Major9],
        [ChordQuality.Major13]),
]);

const RNB_S: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Major9],
        [ChordQuality.Major13],
        [ChordQuality.Major7Sharp11]),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.Minor9],
        [ChordQuality.Minor11],
        [ChordQuality.HalfDiminished]),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Major9],
        [ChordQuality.Major13],
        [ChordQuality.Minor11]),
    rule(ResolutionTarget.Default,
        [ChordQuality.Major9],
        [ChordQuality.Minor9],
        [ChordQuality.Major13]),
]);

const RNB_D: ReadonlyArray<DynamicRule> = Object.freeze([
    rule(ResolutionTarget.MajorTarget,
        [ChordQuality.Dominant7Sus4],
        [ChordQuality.Dominant13, ChordQuality.Dominant7Sus4],
        [ChordQuality.Dominant13, ChordQuality.Dominant11],
        0.15),
    rule(ResolutionTarget.MinorTarget,
        [ChordQuality.Dom7Sharp9],   // Hendrix chord(BLUES 签名)
        [ChordQuality.Dom7Flat13],
        [ChordQuality.Dom7Alt],
        0.20),
    rule(ResolutionTarget.Deceptive,
        [ChordQuality.Dom7Sharp9],
        [ChordQuality.Dom7Flat9],
        [ChordQuality.Dom7Alt]),
    rule(ResolutionTarget.Default,
        [ChordQuality.Dominant9],
        [ChordQuality.Dominant13],
        [ChordQuality.Dom7Flat13]),
]);

// ============================================================
// 主表组装 — 按 StyleId 索引,每 style 一个 [T, S, D] 数组
// ============================================================

/** 索引:DYNAMIC_TSD_DICTIONARY[styleId][func] = DynamicRule[] */
export const DYNAMIC_TSD_DICTIONARY: ReadonlyArray<ReadonlyArray<ReadonlyArray<DynamicRule>>> = (() => {
    const arr: ReadonlyArray<ReadonlyArray<DynamicRule>>[] = [];
    arr[StyleId.POP] = Object.freeze([POP_T, POP_S, POP_D]);
    arr[StyleId.JAZZ] = Object.freeze([JAZZ_T, JAZZ_S, JAZZ_D]);
    arr[StyleId.RNB]   = Object.freeze([RNB_T, RNB_S, RNB_D]);
    return Object.freeze(arr);
})();

// ============================================================
// 查询 + 分析函数
// ============================================================

/**
 * 取 (styleId, func) 下的所有 DynamicRule。返回空数组表示无规则(调用方走 fallback)。
 */
export function getDynamicRules(
    styleId: StyleId,
    func: TsdFunc,
): ReadonlyArray<DynamicRule> {
    const byStyle = DYNAMIC_TSD_DICTIONARY[styleId];
    if (byStyle === undefined) return EMPTY_RULES;
    const byFunc = byStyle[func];
    return byFunc !== undefined ? byFunc : EMPTY_RULES;
}

const EMPTY_RULES: ReadonlyArray<DynamicRule> = Object.freeze([]);

/**
 * 在 (styleId, func) 规则集中找匹配 target 的 rule,若无则回落到 Default。
 *
 * @returns 命中 rule(永远非 null,因为 Default 兜底);若该 (style, func) 整个无规则
 *          则返回 null(极端情况,调用方走 ChordQuality 默认池)。
 */
export function findDynamicRule(
    styleId: StyleId,
    func: TsdFunc,
    target: ResolutionTarget,
): DynamicRule | null {
    const rules = getDynamicRules(styleId, func);
    if (rules.length === 0) return null;
    let defaultRule: DynamicRule | null = null;
    for (let i = 0; i < rules.length; i++) {
        if (rules[i].target === target) return rules[i];
        if (rules[i].target === ResolutionTarget.Default) defaultRule = rules[i];
    }
    return defaultRule;
}

/**
 * analyzeTargetQuality — 分析下一和弦的目标类别。
 *
 * 与 melodygenerative 同名函数的差异:auraflow 直接消费 ChordQuality enum(不像
 * melodygenerative 用字符串 chord type + roman 解析),逻辑更直接:
 *
 *   1. currFunc=D + nextFunc≠T → Deceptive(欺骗终止)
 *   2. nextChordQuality 是 minor-family / dim-family → MinorTarget
 *   3. 其他 → MajorTarget
 *
 * @param currFunc       当前 chord 的 TSD 功能
 * @param nextFunc       下一 chord 的 TSD 功能(null 表示无下一 chord)
 * @param nextQuality    下一 chord 的 ChordQuality(null 表示无下一 chord)
 */
export function analyzeTargetQuality(
    currFunc: TsdFunc,
    nextFunc: TsdFunc | null,
    nextQuality: ChordQuality | null,
): ResolutionTarget {
    if (nextFunc === null || nextQuality === null) return ResolutionTarget.Default;

    // Dominant 未解决到 Tonic → Deceptive
    if (currFunc === TsdFunc.Dominant && nextFunc !== TsdFunc.Tonic) {
        return ResolutionTarget.Deceptive;
    }

    // Minor/Dim family 判定(用 quality enum 直接判定,无字符串 substring 陷阱)
    const isMinorish =
        nextQuality === ChordQuality.Minor
        || nextQuality === ChordQuality.Minor7
        || nextQuality === ChordQuality.Minor9
        || nextQuality === ChordQuality.Minor11
        || nextQuality === ChordQuality.Diminished
        || nextQuality === ChordQuality.Diminished7
        || nextQuality === ChordQuality.HalfDiminished;

    return isMinorish ? ResolutionTarget.MinorTarget : ResolutionTarget.MajorTarget;
}
