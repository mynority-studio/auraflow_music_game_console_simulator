// ============================================================
// motifCore — 级数标签(纯展示推导,不碰生成逻辑)
// ============================================================
//
// 把每个和弦的 root(相对主调)推成罗马级数标签:I / vi / V / bVII° 等。
// 仅消费现有 Chord 的公开访问器(getRootSemitones / getFamily),纯函数。
// ============================================================

import type { Chord } from '../improCore/engine';

// 相对主调的半音 → 级数名(含变化音);大写,后续按和弦性质转小写
const DEGREE: readonly string[] = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

// 大调自然音级的相对半音(I ii iii IV V vi vii°)
const DIATONIC_DEGREES = new Set([0, 2, 4, 5, 7, 9, 11]);

/** 和弦相对主调的「排列信息」分类 */
export type ChordKind = 'diatonic' | 'borrowed' | 'secondary' | 'chromatic';

export interface RomanInfo {
    /** 级数标签,如 'vi' / 'bVII' / 'V' / 'NC' */
    label: string;
    kind: ChordKind;
    /** 是否离调(非自然音级根音) */
    outOfKey: boolean;
    /** 简短中文说明(hover/标注用) */
    note: string;
}

/** 和弦 → 级数标签(纯字符串,兼容旧调用) */
export function romanLabel(chord: Chord, keyRoot: number): string {
    return analyzeChord(chord, keyRoot).label;
}

/** 和弦 → 完整级数 + 离调分析(纯展示推导,不碰生成) */
export function analyzeChord(chord: Chord, keyRoot: number): RomanInfo {
    if (chord.isNOCHORD()) return { label: 'NC', kind: 'diatonic', outOfKey: false, note: '无和弦' };

    const rootPc = ((chord.getRootSemitones() % 12) + 12) % 12;
    const deg = ((rootPc - keyRoot) % 12 + 12) % 12;
    let base = DEGREE[deg]!;

    const fam = chord.getFamily();
    const isMinorish = fam === 'minor' || fam === 'minor7' || fam === 'half-diminished';
    const isDim = fam === 'diminished';
    if (isMinorish || isDim) base = base.replace(/[IV]+/, m => m.toLowerCase());

    let suffix = '';
    if (fam === 'diminished') suffix = '°';
    else if (fam === 'half-diminished') suffix = 'ø';
    else if (fam === 'augmented') suffix = '+';
    else if (fam === 'sus4') suffix = 'sus';
    const label = base + suffix;

    // 排列信息分类:
    //   - 根音在自然音级内 → diatonic;但若是「自然音级上的属七」且非 V → secondary(副属感)
    //   - 根音离调 → 属/属七功能 = secondary(副属/副属链);否则 = borrowed(调式借用)
    const isDom = fam === 'dominant';
    const inKey = DIATONIC_DEGREES.has(deg);
    let kind: ChordKind;
    let note: string;
    if (inKey) {
        if (isDom && deg !== 7) { kind = 'secondary'; note = '副属和弦(离调倾向)'; }
        else { kind = 'diatonic'; note = '自然音级'; }
    } else if (isDom) {
        kind = 'secondary'; note = '副属/副属链(离调解决)';
    } else {
        kind = 'borrowed'; note = '调式借用(离调)';
    }
    const outOfKey = kind !== 'diatonic';

    return { label, kind, outOfKey, note };
}

// 排列信息 → 配色(UI 标注用,呼应 mg 监控器:离调橙/借用紫)
export const KIND_COLOR: Record<ChordKind, string> = {
    diatonic: '#7c89ff',   // 自然音级 — 蓝
    secondary: '#f2994a',  // 副属 — 橙
    borrowed: '#b580e0',   // 借用 — 紫
    chromatic: '#e06666',  // 半音 — 红
};

// ---- mg 权威分析的展示映射(BorrowedSource 5-way 分类 → 颜色 + 中文)----

import type { BorrowedSource } from '../mgEngine/styleDictionary';
import type { ChordAnalysis } from './songSource';

/** mg borrowedSource → ChordKind(对齐配色) */
export function kindFromMg(a: ChordAnalysis): ChordKind {
    switch (a.borrowedSource) {
        case 'secondary_dominant':
        case 'secondary_ii_v':
            return 'secondary';
        case 'backdoor_dominant':
        case 'modal_interchange':
            return 'borrowed';
        case 'chromatic_color':
            return 'chromatic';
        default:
            return 'diatonic';
    }
}

const BORROWED_CN: Record<BorrowedSource, string> = {
    secondary_dominant: '副属和弦 V/X',
    secondary_ii_v: '副 ii–V 链',
    backdoor_dominant: '后门属 bVII7',
    modal_interchange: '调式借用',
    chromatic_color: '半音经过',
};

// TSD 功能配色(呼应 mg:T 蓝 / S 琥珀 / D 红)
export const FUNC_COLOR: Record<'T' | 'S' | 'D', string> = {
    T: '#6ba8e0', S: '#d4af37', D: '#e06b6b',
};

/** mg 权威分析 → bar 卡展示模型(优先级最高,有则盖过启发式) */
export interface MgChordView {
    roman: string;
    kind: ChordKind;
    func: 'T' | 'S' | 'D';
    funcOverridden: boolean;
    outOfKey: boolean;
    /** hover 详情 */
    note: string;
    localRoman?: string;
    showLocal: boolean;
    mustResolve: boolean;
}

export function viewFromMg(a: ChordAnalysis, keyRootPc: number): MgChordView {
    const kind = kindFromMg(a);
    const parts: string[] = [];
    if (a.borrowedSource) parts.push(BORROWED_CN[a.borrowedSource]);
    if (a.borrowedFrom) parts.push(`借自 ${a.borrowedFrom}`);
    if (a.mustResolve) parts.push('须解决');
    parts.push(`功能 ${a.func}${a.funcOverridden ? '(覆盖)' : ''}`);
    return {
        roman: a.roman,
        kind,
        func: a.func,
        funcOverridden: a.funcOverridden,
        outOfKey: kind !== 'diatonic' || a.roman.includes('/'),
        note: parts.join(' · '),
        localRoman: a.localRoman,
        showLocal: a.localRoman !== undefined && a.analysisKeyPc !== undefined && a.analysisKeyPc !== keyRootPc,
        mustResolve: a.mustResolve ?? false,
    };
}
