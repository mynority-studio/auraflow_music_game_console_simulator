// ==========================================
// DynamicHarmony — Dynamic TSD-aware chord-type decoration
// ==========================================
//
// M 阶段移植(2026-05-24,from mg/src/lib/dynamicHarmony.ts May 22)。
//
// 用途:Composer 选 chord type 时不"盲选",而是 Look-ahead 看 next chord 的
// 功能 + quality(MajorTarget / MinorTarget / Deceptive / Default)→ 从
// DYNAMIC_TSD_DICTIONARY[mgStyle][T/S/D] 找对应规则 → 按 colorLevel(0/1/2)
// 选 chord type variant。
//
// 加 Sub-V tritone substitution:D-function chord 解决到 next 是 perfect-fifth
// down 时,概率触发 V → bII7 替换(Stage 3 Divisi 已 lockType-aware,不影响)。
//
// Per-mgStyle colorLevelProbabilities 决定 colorLevel roll 分布:
//   POP   多 level 0/1(平直)
//   JAZZ  多 level 1/2(色彩)
//   RNB   多 level 1/2(色彩)
//   BLUES 多 level 0(简单 dominant)
// ==========================================

import type { MgStyle } from '../../../state/EngineSelectionStore';

export type ResolutionTarget = 'MajorTarget' | 'MinorTarget' | 'Deceptive' | 'Default';
export type TSD_Func = 'T' | 'S' | 'D';

export interface DynamicRule {
    /** Which next-chord context this rule fires on */
    target: ResolutionTarget;
    /** colorLevel (0/1/2) → array of chord-type 字符串 pool */
    levels: Record<number, string[]>;
    /**
     * Sub-V tritone substitution 概率(仅 D-function rule 有意义)。
     * 当 curr→next 是 perfect-fifth-down(rootDelta=5)AND non-deceptive AND
     * 该 rule 有定义时触发。Engine 静态 map sub-V chord type 给 Lydian Dominant
     * family('7' / '9' / '13' / '7#11')— 避免 '7#9#11' monster string,
     * 保 random-stream 决定性(sub override 不消耗 random)。
     */
    tritoneProb?: number;
}

/**
 * Per-mgStyle colorLevel roll 分布。Engine 用 random.next() roll 一次,
 * 按 cumulative threshold 决定 level 0/1/2。
 */
export const COLOR_LEVEL_PROBABILITIES: Record<MgStyle, { level0: number; level1: number; level2: number }> = {
    POP:   { level0: 0.40, level1: 0.40, level2: 0.20 },
    JAZZ:  { level0: 0.20, level1: 0.40, level2: 0.40 },
    RNB:   { level0: 0.20, level1: 0.40, level2: 0.40 },
    BLUES: { level0: 0.50, level1: 0.40, level2: 0.10 },
};

/**
 * Per-macro × per-function rule sets。Keys 必须匹配 MgStyle union
 * (POP / JAZZ / BLUES / RNB)— 直接查表,无 routing。
 */
export const DYNAMIC_TSD_DICTIONARY: Record<MgStyle, Record<TSD_Func, DynamicRule[]>> = {
    POP: {
        D: [
            // sus4 / 7sus4 / 9sus4 偏好 — Pop V chord 喜欢 4 over b7
            // (Coldplay / 80s synth-pop / Max Martin lift-into-chorus)
            { target: 'MajorTarget', levels: { 0: ['7', 'sus4', '7sus4'], 1: ['9sus4', '7sus4', '9'], 2: ['9sus4', '13'] } },
            { target: 'MinorTarget', levels: { 0: ['7', '7sus4'], 1: ['7sus4', '7'], 2: ['7sus4', '7b13'] } },
            { target: 'Deceptive',   levels: { 0: ['sus4', '7sus4'], 1: ['9sus4'], 2: ['11'] } },
            { target: 'Default',     levels: { 0: ['7', '7sus4'], 1: ['7sus4', '9sus4'], 2: ['9'] } },
        ],
        S: [
            { target: 'MajorTarget', levels: { 0: ['maj'], 1: ['add9'], 2: ['maj7', 'maj9'] } },
            { target: 'MinorTarget', levels: { 0: ['min'], 1: ['m7'], 2: ['m9'] } },
            { target: 'Deceptive',   levels: { 0: ['maj'], 1: ['maj7'], 2: ['6'] } },
            { target: 'Default',     levels: { 0: ['maj'], 1: ['add9'], 2: ['maj9'] } },
        ],
        T: [
            { target: 'Default',     levels: { 0: ['maj'], 1: ['add9'], 2: ['maj7'] } },
        ],
    },

    RNB: {
        D: [
            { target: 'MajorTarget', levels: { 0: ['9sus4'], 1: ['13', '9sus4'], 2: ['13', '11'] }, tritoneProb: 0.15 },
            { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7alt'] }, tritoneProb: 0.20 },
            { target: 'Deceptive',   levels: { 0: ['7#9'], 1: ['13b9'], 2: ['7alt'] } },
            { target: 'Default',     levels: { 0: ['9'], 1: ['13'], 2: ['7b13'] } },
        ],
        S: [
            { target: 'MajorTarget', levels: { 0: ['maj9'], 1: ['maj13'], 2: ['maj9#11'] } },
            { target: 'MinorTarget', levels: { 0: ['m9'], 1: ['m11'], 2: ['m9b5'] } },
            { target: 'Deceptive',   levels: { 0: ['maj9'], 1: ['maj13'], 2: ['m11'] } },
            { target: 'Default',     levels: { 0: ['maj9'], 1: ['m9'], 2: ['maj13'] } },
        ],
        T: [
            { target: 'Default',     levels: { 0: ['maj7'], 1: ['maj9'], 2: ['maj13', '6/9'] } },
        ],
    },

    JAZZ: {
        D: [
            // Major target — light + airy on low levels;light alteration at 2
            // 避免 "everything is 7alt" hard-bop overload
            { target: 'MajorTarget', levels: { 0: ['7', '9'], 1: ['9', '13'], 2: ['13', '7#11'] }, tritoneProb: 0.35 },
            // Minor target — dark altered tensions earn keep:b9/b13/7alt
            // 自然落在 minor resolution
            { target: 'MinorTarget', levels: { 0: ['7b9'], 1: ['7b13', '7#9'], 2: ['7alt', '13b9'] }, tritoneProb: 0.30 },
            { target: 'Deceptive',   levels: { 0: ['7b9'], 1: ['7#9'], 2: ['7alt'] }, tritoneProb: 0.15 },
            { target: 'Default',     levels: { 0: ['7'], 1: ['9', '13'], 2: ['7alt', '13'] } },
        ],
        S: [
            { target: 'MajorTarget', levels: { 0: ['maj7'], 1: ['maj9', '6/9'], 2: ['maj13'] } },
            { target: 'MinorTarget', levels: { 0: ['m7b5'], 1: ['m9b5'], 2: ['m11'] } },
            { target: 'Deceptive',   levels: { 0: ['m7', 'm9'], 1: ['m11'], 2: ['maj9#11'] } },
            { target: 'Default',     levels: { 0: ['maj7'], 1: ['m9'], 2: ['m7b5'] } },
        ],
        T: [
            { target: 'Default',     levels: { 0: ['maj7'], 1: ['maj9'], 2: ['6/9'] } },
        ],
    },

    BLUES: {
        D: [
            { target: 'MajorTarget', levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
            { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7#9'] } },
            { target: 'Deceptive',   levels: { 0: ['7#9'], 1: ['7#9'], 2: ['7alt'] } },
            { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
        ],
        S: [
            { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['9'] } },
        ],
        T: [
            { target: 'Default',     levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
        ],
    },
};

/**
 * 分类 next chord 的角色,Stage 2 用于在 rule list 内 find rule。
 *
 *   MajorTarget  — next 落在 major-quality T(I/IV/VI in major,or III/VI in minor relative)
 *   MinorTarget  — next 落在 minor / diminished
 *   Deceptive    — curr 是 D 但 next 不是 T-family(D→S / D→D = deceptive)
 *   Default      — fallback
 *
 * Minor 检测避免 'maj7'.includes('m') 陷阱:
 *   • roman 小写 OR
 *   • chord type 以 'm' 开头但不是 'maj' OR
 *   • dim 家族
 */
export function analyzeTargetQuality(
    currFunc: TSD_Func,
    nextFunc: TSD_Func,
    nextRoman: string,
    nextType: string,
): ResolutionTarget {
    if (!nextRoman) return 'Default';

    if (currFunc === 'D' && nextFunc !== 'T') return 'Deceptive';

    const nextBaseRoman = nextRoman.split('/')[0].replace(/[^a-zA-Z]/g, '');

    const typeIsMinor = (
        nextType === 'min'
        || nextType === 'dim'
        || nextType === 'dim7'
        || nextType === 'm7b5'
        || (nextType.startsWith('m') && !nextType.startsWith('maj'))
    );
    const romanIsMinor = nextBaseRoman.length > 0
        && nextBaseRoman === nextBaseRoman.toLowerCase();

    return (typeIsMinor || romanIsMinor) ? 'MinorTarget' : 'MajorTarget';
}
