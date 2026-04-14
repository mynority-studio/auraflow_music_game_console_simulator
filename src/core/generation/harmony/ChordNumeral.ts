// ==========================================
// 📄 /src/core/generation/harmony/ChordNumeral.ts
// 🌟 PR #2: pitchClass + quality → 罗马数字 numeral 字符串反查
//
// 目的：
//   ViterbiChordSelector 输出 (rootPc: number, quality: ChordQuality)，
//   但 GeneratedChord 契约要求 numeral 必填（HarmonyEngine.reharmonize 会 parseRomanNumeral）。
//   本模块把 (rootPc, quality, tonality) 反查成符合 parseRomanNumeral 输入语法的字符串。
//
// 输出字符串必须能被 HarmonyCore.parseRomanNumeral() 正确解析回 (root, quality)。
// 对应 parseRomanNumeral 的输入语法：
//   - 大写 = Major 系（'I'/'IV'/'V'）；小写 = Minor 系（'i'/'ii'/'vi'）
//   - 'b' 前缀 = root - 1（如 'bVI' 在大调中 = pc 8）
//   - 后缀映射：maj7 / maj9 / m7 / m9 / m7b5 / dim7 / dim / aug / sus4 / 7 / 9 / add9
//
// PR #2 限定大调（Tonality.Major）。小调留给 PR #3。
// ==========================================

import { ChordQuality } from '../types';
import { Tonality } from '../types';

/**
 * 大调 7 个自然音级的 pitch class。索引即音级序数（0=I, 1=ii, ..., 6=vii°）。
 */
const MAJOR_DEGREE_PCS = [0, 2, 4, 5, 7, 9, 11];

/**
 * 大调每个音级的"自然音质"（根据传统功能和声）。
 * I=Major, ii=Minor, iii=Minor, IV=Major, V=Major(or Dom7), vi=Minor, vii=Dim
 */
const MAJOR_DEGREE_NATURAL_IS_MAJOR = [true, false, false, true, true, false, false];

/**
 * 罗马数字基础字符串（大写形式）。
 */
const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * 把 quality 转成 parseRomanNumeral 能识别的后缀字符串。
 * 注意：根据是否为 minor 系，根字母大小写也会变化（在 toNumeral 里处理）。
 *
 * 返回值是"附加在根字母后面"的部分，不含大小写。
 */
function qualityToSuffix(quality: ChordQuality): string {
    // 注意：HarmonyCore.parseRomanNumeral 是 else-if 链，每次只匹配第一个后缀。
    // 这意味着复合后缀（如 7sus4）会被先匹配到 sus4，base 残留 "V7" 在 rootMap 找不到。
    // 因此对复合后缀我们要选择"能让 root 正确解析"的简化形式，
    // quality 信息通过 GeneratedChord.quality 字段直接保留（ToplineEngine 读这个字段）。
    switch (quality) {
        case ChordQuality.Major:         return '';
        case ChordQuality.Minor:         return '';     // 大小写在外层处理
        case ChordQuality.Diminished:    return 'dim';
        case ChordQuality.Diminished7:   return 'dim7';
        case ChordQuality.Augmented:     return 'aug';
        case ChordQuality.Dominant7:     return '7';
        case ChordQuality.Minor7:        return 'm7';   // 'm' + '7'
        case ChordQuality.Major7:        return 'maj7';
        case ChordQuality.HalfDiminished: return 'm7b5';
        case ChordQuality.Sus4:          return 'sus4';
        case ChordQuality.Dominant7Sus4: return 'sus4'; // 退化为 sus4（else-if 链兼容），quality 字段保 Dominant7Sus4
        case ChordQuality.Add9:          return 'add9';
        case ChordQuality.Minor9:        return 'm9';
        case ChordQuality.Major9:        return 'maj9';
        case ChordQuality.Dominant9:     return '9';
        case ChordQuality.Minor11:       return 'm9';   // 退化为 m9（parseRomanNumeral 不识别 m11）
        case ChordQuality.Dominant13:    return '9';    // 退化为 9
        default:                         return '';
    }
}

/**
 * 判断 quality 是否属于"小调系"（用于决定根字母的大小写）。
 * Minor / Minor7 / Minor9 / Minor11 / HalfDiminished 都用小写。
 */
function isMinorFamily(quality: ChordQuality): boolean {
    return quality === ChordQuality.Minor ||
           quality === ChordQuality.Minor7 ||
           quality === ChordQuality.Minor9 ||
           quality === ChordQuality.Minor11 ||
           quality === ChordQuality.HalfDiminished;
}

/**
 * 主入口：把相对空间 (rootPc, quality) 转成符合 parseRomanNumeral 语法的字符串。
 *
 * @param rootPc 0~11，主调相对的 pitch class
 * @param quality ChordQuality 数值枚举
 * @param tonality 大调/小调（PR #2 仅支持大调，其他暂时按大调处理）
 * @returns 罗马数字字符串，例如 "I" / "vi7" / "bVI" / "V7" / "Imaj7"
 */
export function pitchClassToNumeral(
    rootPc: number,
    quality: ChordQuality,
    tonality: Tonality = Tonality.Major,
): string {
    const pc = ((rootPc % 12) + 12) % 12;

    // 1. 找到 pc 在大调音阶中的位置
    let degreeIdx = MAJOR_DEGREE_PCS.indexOf(pc);
    let accidental = '';

    if (degreeIdx === -1) {
        // 不是自然音 → 借调和弦，需要 b 或 # 前缀
        // 优先尝试 bVI / bIII / bVII（最常见的借调），其次 #IV
        const flatTry = MAJOR_DEGREE_PCS.indexOf((pc + 1) % 12);
        const sharpTry = MAJOR_DEGREE_PCS.indexOf((pc - 1 + 12) % 12);

        if (flatTry !== -1 && (flatTry === 5 || flatTry === 2 || flatTry === 6 || flatTry === 1)) {
            // bVI (idx 5), bIII (idx 2), bVII (idx 6), bII (idx 1)
            degreeIdx = flatTry;
            accidental = 'b';
        } else if (sharpTry !== -1 && (sharpTry === 3 || sharpTry === 4)) {
            // #IV (idx 3), #V (idx 4)
            degreeIdx = sharpTry;
            accidental = '#';
        } else if (flatTry !== -1) {
            degreeIdx = flatTry;
            accidental = 'b';
        } else if (sharpTry !== -1) {
            degreeIdx = sharpTry;
            accidental = '#';
        } else {
            // 兜底：理论上不应该到这里
            degreeIdx = 0;
        }
    }

    // 2. 决定根字母的大小写
    //    parseRomanNumeral 用大小写区分 Major/Minor 系，
    //    所以 quality 是 minor 家族时一律小写，其他大写。
    const baseUpper = ROMAN_UPPER[degreeIdx];
    const isLower = isMinorFamily(quality);
    const base = isLower ? baseUpper.toLowerCase() : baseUpper;

    // 3. 拼后缀
    const suffix = qualityToSuffix(quality);

    // 4. 小调家族的 'm' 前缀已经由小写字母表达，suffix 里去掉它
    //    例如 vi + Minor7 → "vi7"（不是 "vim7"）
    //    parseRomanNumeral 看到小写 i + 后缀 7，会识别为 Minor7
    let cleanSuffix = suffix;
    if (isLower && cleanSuffix.startsWith('m')) {
        cleanSuffix = cleanSuffix.substring(1);
    }

    void tonality; // PR #2 仅支持大调，参数预留给 PR #3

    return accidental + base + cleanSuffix;
}

/**
 * 自检函数：在 dev 模式下手工调一组验证用例。
 * 不在生产代码路径调用。
 */
export function _selfTest(): { passed: number; failed: number; cases: string[] } {
    const cases: Array<[number, ChordQuality, string]> = [
        [0,  ChordQuality.Major,        'I'],
        [0,  ChordQuality.Major7,       'Imaj7'],
        [2,  ChordQuality.Minor,        'ii'],
        [2,  ChordQuality.Minor7,       'ii7'],     // 小写 ii + 7 → parseRomanNumeral 识别为 Minor7
        [4,  ChordQuality.Minor7,       'iii7'],
        [5,  ChordQuality.Major,        'IV'],
        [5,  ChordQuality.Major7,       'IVmaj7'],
        [7,  ChordQuality.Major,        'V'],
        [7,  ChordQuality.Dominant7,    'V7'],
        [9,  ChordQuality.Minor,        'vi'],
        [9,  ChordQuality.Minor7,       'vi7'],
        // 借调
        [3,  ChordQuality.Major,        'bIII'],
        [8,  ChordQuality.Major,        'bVI'],
        [10, ChordQuality.Major,        'bVII'],
        // 副属
        [4,  ChordQuality.Dominant7,    'III7'],    // V/vi（不是借调，是大三+dom7）
        [2,  ChordQuality.Dominant7,    'II7'],     // V/V
    ];
    const results: string[] = [];
    let passed = 0, failed = 0;
    for (const [pc, q, expected] of cases) {
        const got = pitchClassToNumeral(pc, q);
        const ok = got === expected;
        if (ok) passed++; else failed++;
        results.push(`${ok ? 'OK ' : 'FAIL'} pc=${pc} q=${ChordQuality[q]} → "${got}" (expected "${expected}")`);
    }
    return { passed, failed, cases: results };
}
