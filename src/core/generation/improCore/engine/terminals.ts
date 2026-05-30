// ============================================================
// ImproCore engine — 值模型 + Terminals
// imp/lickgen/Terminals.java 的忠实移植
// ============================================================
//
// 值模型(关键):Impro-Visor 的 Tokenizer 把数字 token 解析成 Long/Double,
// 其余成 symbol(String)。我们的 sexpr-reader 把一切存成 string,所以
// numberize() 把"看起来是数字"的 atom 转成 JS number,使后续逻辑能用
// `typeof x === 'number'` 对应 Java 的 `instanceof Number`。
//
// 终结符类型(grammar 抽象旋律的叶子):
//   abstractNote  字符串 {A,C,H,L,R,S,X,Y}+时值,如 "C8" "R4" "X2+4"
//   wrappedTerminal  单元素 list,首项是 abstractNote,如 ("C8")
//   scaleDegree   (X 度 时值),如 (X 1 8) (X #7 16)
//   slope         (slope a b T...),长度≥4
//   triadic       (triadic 时值 ...),长度 3
// ============================================================

import { getDuration as durationOf, isDuration } from './duration';

// ------------------------------------------------------------
// 值模型
// ------------------------------------------------------------

export type GVal = number | string | GList;
export interface GList extends ReadonlyArray<GVal> {}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** "看起来是数字"的 atom → JS number;其余原样(slope 的 -2 → -2,"C8"/"#7"/"16/3" 留 string) */
export function numberize(node: string | readonly (string | unknown)[]): GVal {
    if (typeof node === 'string') {
        return NUMERIC.test(node) ? Number(node) : node;
    }
    return (node as readonly unknown[]).map(n => numberize(n as string | readonly unknown[]));
}

// ------------------------------------------------------------
// Lisp helpers(GList 上的 first/rest/second… + assoc/member)
// ------------------------------------------------------------

export const isGList = (x: GVal): x is GList => Array.isArray(x);
export const gFirst = (p: GList): GVal | undefined => p[0];
export const gRest = (p: GList): GList => p.slice(1);
export const gSecond = (p: GList): GVal | undefined => p[1];
export const gThird = (p: GList): GVal | undefined => p[2];
export const gFourth = (p: GList): GVal | undefined => p[3];

/** Polylist.assoc:在 list-of-lists 里找首项等于 key 的子 list */
export function gAssoc(list: GList, key: GVal): GList | null {
    for (const el of list) {
        if (isGList(el) && el.length > 0 && el[0] === key) return el;
    }
    return null;
}

/** Polylist.member:list 含某值 */
export const gMember = (list: GList, x: GVal): boolean => list.some(e => e === x);

/** GVal → 字符串(getDuration 取 scaleDegree/triadic 的时值项用) */
export const gValToString = (v: GVal | undefined): string => (v === undefined ? '' : String(v));

// ------------------------------------------------------------
// Terminals 谓词
// ------------------------------------------------------------

const ABSTRACT_LETTERS = new Set(['A', 'C', 'H', 'L', 'R', 'S', 'X', 'Y']);

/** abstractNote:字符串,首字母 ∈ {A,C,H,L,R,S,X,Y} 且其后是合法时值 */
export function isAbstractNote(ob: GVal): boolean {
    if (typeof ob !== 'string' || ob.length === 0) return false;
    if (!ABSTRACT_LETTERS.has(ob.charAt(0))) return false;
    return isDuration(ob.substring(1));
}

export function isScaleDegree(ob: GVal): boolean {
    if (!isGList(ob) || ob.length !== 3) return false;
    if (ob[0] !== 'X') return false;
    const second = ob[1], third = ob[2];
    const okSecond = typeof second === 'number' || typeof second === 'string';
    const okThird = typeof third === 'number' || typeof third === 'string';
    return okSecond && okThird;
}

export function isSlope(ob: GVal): boolean {
    return isGList(ob) && ob.length >= 4 && ob[0] === 'slope';
}

export function isTriadic(ob: GVal): boolean {
    return isGList(ob) && ob.length === 3 && ob[0] === 'triadic';
}

/** wrappedTerminal:单/多元素 list,首项是 abstractNote,且非 scaleDegree/slope/triadic */
export function isWrappedTerminal(ob: GVal): boolean {
    if (!isGList(ob)) return false;
    if (isScaleDegree(ob) || isSlope(ob) || isTriadic(ob)) return false;
    if (ob.length === 0) return false;
    return isAbstractNote(ob[0]!);
}

export function isTerminal(ob: GVal): boolean {
    return isAbstractNote(ob) || isScaleDegree(ob) || isSlope(ob) || isTriadic(ob) || isWrappedTerminal(ob);
}

// ------------------------------------------------------------
// 时值
// ------------------------------------------------------------

/** Terminals.getDuration:各终结符形式取时值(slot) */
export function getDuration(ob: GVal): number {
    if (typeof ob === 'string') {
        return durationOf(ob.substring(1));          // 跳过类型字母
    }
    if (isScaleDegree(ob)) {
        return durationOf(gValToString(gThird(ob as GList)));  // 第 3 项是时值
    }
    if (isSlope(ob)) {
        let sum = 0;
        let body = (ob as GList).slice(3);           // 第 4 项起是音符
        for (const t of body) sum += getDuration(t);
        return sum;
    }
    if (isTriadic(ob)) {
        return durationOf(gValToString(gSecond(ob as GList)));  // 第 2 项是时值
    }
    return 0;
}

export function getDurationAbstractMelody(list: GList): number {
    let d = 0;
    for (const t of list) d += getDuration(t);
    return d;
}

/** 累加终结符直到再加会超过 desiredDuration,截断 */
export function truncateAbstractMelody(list: GList, desiredDuration: number): GList {
    const out: GVal[] = [];
    let duration = 0;
    for (const first of list) {
        const dur = getDuration(first);
        if (duration + dur > desiredDuration) break;
        out.push(first);
        duration += dur;
    }
    return out;
}
