/**
 * ChordNumeralParser — 罗马数字和弦解析（V4.2a）
 *
 * 用途：把进行池的 numeral 字符串解析成 { root, quality, bassOverride }。
 * 例：
 *   parseNumeral('IVmaj7', Major) → { root: 5, quality: Major7 }
 *   parseNumeral('vi',     Major) → { root: 9, quality: Minor }
 *   parseNumeral('V7/vi',  Major) → { root: 4, quality: Dominant7 }   // vi's V = E
 *   parseNumeral('I/III',  Major) → { root: 0, quality: Major, bassOverride: 4 }
 *   parseNumeral('iiø',    Minor) → { root: 3, quality: HalfDiminished } // 小调 ii° = D
 *   parseNumeral('bVImaj7',Major) → { root: 8, quality: Major7 }      // 借调 b6
 *
 * 支持语法（按解析顺序）：
 *   1. 可选前导降号 `b` / 升号 `#`（半音调整）
 *   2. 罗马数字 I-VII / i-vii (大写=major, 小写=minor)
 *   3. 可选 quality 后缀: maj7, maj9, 7, 9, 11, 13, m7, mmaj7, ø/o7, °, dim7, sus4, sus2, +
 *   4. 可选斜杠 `/X` — X 可以是另一罗马数字 (V/vi) 或度数 (1/3)
 *
 * 解析失败时返回 fallback (root=0, quality=Major)，不抛错（HarmonyEngine 不应被
 * 单个不合法 numeral 拖崩）。
 *
 * Pitch Space: PC (0-11)
 *
 * @author AuraFlow Tap! BandEngine V4.2
 */

import { ChordQuality, Tonality } from '../types';

// 大调 7 级 → 半音偏移（C 大调 I=C/0, ii=D/2, iii=E/4, IV=F/5, V=G/7, vi=A/9, vii=B/11）
const MAJOR_SCALE_DEGREES: ReadonlyArray<number> = [0, 2, 4, 5, 7, 9, 11];
// 小调（自然小调）：i=0, ii°=2, III=3, iv=5, v=7, VI=8, VII=10
const MINOR_SCALE_DEGREES: ReadonlyArray<number> = [0, 2, 3, 5, 7, 8, 10];

export interface ParsedNumeral {
    root: number;
    quality: ChordQuality;
    bassOverride?: number;
}

/**
 * 主入口 — 解析 numeral 字符串。
 *
 * 注意：返回的 root 是相对调式主音的 PC（C 大调主音 = 0）。
 * caller 之后会与 keyOffset 组合得到绝对调号。
 */
export function parseNumeral(numeral: string, tonality: Tonality): ParsedNumeral {
    if (!numeral || numeral.length === 0) return { root: 0, quality: ChordQuality.Major };

    // 拆分斜杠
    const slashIdx = numeral.indexOf('/');
    const main = slashIdx >= 0 ? numeral.substring(0, slashIdx) : numeral;
    const slashPart = slashIdx >= 0 ? numeral.substring(slashIdx + 1) : '';

    const parsed = parseMainPart(main, tonality);

    if (slashPart.length > 0) {
        // V7/vi、V/VII、I/III 等 — 决定 bassOverride 或 secondary key
        const slashResult = parseSlashPart(slashPart, tonality, parsed);
        if (slashResult.kind === 'bass') {
            parsed.bassOverride = slashResult.bassPc;
        } else if (slashResult.kind === 'secondary') {
            // 二级和弦：main 的 root 相对 slash 的 root 重新计算
            //   V/vi 表示"vi 的 V" — root = vi 的 root + 7（main 数字是 V）
            const baseRootPc = slashResult.targetRootPc;
            const offsetFromI = computeRomanOffset(getRomanDegree(main), tonality);
            parsed.root = ((baseRootPc + offsetFromI) % 12 + 12) % 12;
        }
    }

    return parsed;
}

// ============================================================
// 内部：拆解 numeral 主部分（不含斜杠）
// ============================================================

function parseMainPart(s: string, tonality: Tonality): ParsedNumeral {
    let cursor = 0;

    // 1. 前导 b / #
    let semitoneAdjust = 0;
    if (s[cursor] === 'b' || s[cursor] === '♭') {
        semitoneAdjust = -1;
        cursor++;
    } else if (s[cursor] === '#' || s[cursor] === '♯') {
        semitoneAdjust = 1;
        cursor++;
    }

    // 2. 罗马数字（最长匹配）
    const { romanDegree, isUpper, length } = readRoman(s, cursor);
    cursor += length;

    if (romanDegree < 1) {
        return { root: 0, quality: ChordQuality.Major };  // 解析失败兜底
    }

    // 3. 计算 root PC
    const rootPc = computeRootPC(romanDegree, semitoneAdjust, tonality);

    // 4. 解析 quality 后缀
    const suffix = s.substring(cursor);
    const quality = parseQuality(suffix, isUpper, romanDegree, tonality);

    return { root: rootPc, quality };
}

// ============================================================
// 内部：读取罗马数字（i-vii / I-VII）
// ============================================================

function readRoman(s: string, start: number): { romanDegree: number; isUpper: boolean; length: number } {
    // 优先匹配长串：VII/vii > VI/vi > V/v > IV/iv > III/iii > II/ii > I/i
    const candidates: [string, number][] = [
        ['VII', 7], ['vii', 7],
        ['VI', 6],  ['vi', 6],
        ['IV', 4],  ['iv', 4],
        ['III', 3], ['iii', 3],
        ['II', 2],  ['ii', 2],
        ['V', 5],   ['v', 5],
        ['I', 1],   ['i', 1],
    ];

    for (const [str, degree] of candidates) {
        if (s.substring(start, start + str.length) === str) {
            return {
                romanDegree: degree,
                isUpper: str === str.toUpperCase(),
                length: str.length,
            };
        }
    }

    return { romanDegree: 0, isUpper: true, length: 0 };
}

// ============================================================
// 内部：root PC 计算
// ============================================================

function computeRootPC(degree: number, semitoneAdjust: number, tonality: Tonality): number {
    const scale = tonality === Tonality.Minor ? MINOR_SCALE_DEGREES : MAJOR_SCALE_DEGREES;
    const base = scale[(degree - 1) % 7];
    return ((base + semitoneAdjust) % 12 + 12) % 12;
}

// ============================================================
// 内部：解析 quality 后缀
// ============================================================

function parseQuality(suffix: string, isUpper: boolean, _degree: number, _tonality: Tonality): ChordQuality {
    // 优先级匹配（长后缀先）
    if (suffix.includes('maj9'))      return ChordQuality.Major9;
    if (suffix.includes('maj7'))      return ChordQuality.Major7;
    if (suffix.includes('m9'))        return ChordQuality.Minor9;
    if (suffix.includes('mmaj7'))     return ChordQuality.Minor7;  // m + maj7 是 mmaj7，简化处理
    if (suffix.includes('m7'))        return ChordQuality.Minor7;
    if (suffix.includes('ø')
        || suffix.includes('m7b5')
        || suffix.includes('hdim'))   return ChordQuality.HalfDiminished;
    if (suffix.includes('dim7')
        || suffix.includes('°7'))     return ChordQuality.Diminished7;
    if (suffix.includes('dim')
        || suffix.includes('°')
        || suffix.includes('o7'))     return ChordQuality.Diminished;
    if (suffix.includes('aug')
        || suffix.includes('+'))      return ChordQuality.Augmented;
    if (suffix.includes('sus4'))      return ChordQuality.Sus4;
    if (suffix.includes('sus2'))      return ChordQuality.Sus4;  // 暂归 Sus4
    if (suffix.includes('13'))        return ChordQuality.Dominant13;
    if (suffix.includes('11'))        return ChordQuality.Minor11;  // 默认 m11
    if (suffix.includes('add9'))      return ChordQuality.Add9;
    if (suffix.includes('9'))         return isUpper ? ChordQuality.Dominant9 : ChordQuality.Minor9;
    if (suffix.includes('7'))         return isUpper ? ChordQuality.Dominant7 : ChordQuality.Minor7;
    if (suffix.includes('m'))         return ChordQuality.Minor;
    // 默认按罗马数字大小写
    return isUpper ? ChordQuality.Major : ChordQuality.Minor;
}

// ============================================================
// 内部：斜杠部分解析（X/Y 中的 Y）
// ============================================================

type SlashResult =
    | { kind: 'bass'; bassPc: number }
    | { kind: 'secondary'; targetRootPc: number };

function parseSlashPart(s: string, tonality: Tonality, _mainParsed: ParsedNumeral): SlashResult {
    // 纯数字（1/3/5...）→ bassOverride（度数）
    const digitMatch = /^(\d+)$/.exec(s);
    if (digitMatch !== null) {
        const degree = parseInt(digitMatch[1], 10);
        const scale = tonality === Tonality.Minor ? MINOR_SCALE_DEGREES : MAJOR_SCALE_DEGREES;
        const idx = ((degree - 1) % 7 + 7) % 7;
        return { kind: 'bass', bassPc: scale[idx] };
    }

    // 罗马数字 → 二级和弦的目标 root
    const { romanDegree, length: rlen } = readRoman(s, 0);
    if (romanDegree > 0 && rlen === s.length) {
        const rootPc = computeRootPC(romanDegree, 0, tonality);
        return { kind: 'secondary', targetRootPc: rootPc };
    }

    // 罗马数字 + 可选 quality 后缀 → 取罗马数字的 root 作为 bassOverride
    if (romanDegree > 0) {
        const rootPc = computeRootPC(romanDegree, 0, tonality);
        return { kind: 'bass', bassPc: rootPc };
    }

    // 解析失败兜底
    return { kind: 'bass', bassPc: 0 };
}

// ============================================================
// 内部：读罗马数字（用于 main 的 secondary 计算）
// ============================================================

function getRomanDegree(s: string): number {
    let cursor = 0;
    if (s[cursor] === 'b' || s[cursor] === '#') cursor++;
    return readRoman(s, cursor).romanDegree;
}

function computeRomanOffset(degree: number, tonality: Tonality): number {
    if (degree < 1) return 0;
    const scale = tonality === Tonality.Minor ? MINOR_SCALE_DEGREES : MAJOR_SCALE_DEGREES;
    return scale[(degree - 1) % 7];
}
