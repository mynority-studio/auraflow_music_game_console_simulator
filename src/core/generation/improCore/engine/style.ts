// ============================================================
// ImproCore engine — Style(.sty 解析)
// imp/style/Style.java + stylePatterns/ 的生成路径子集
// ============================================================
//
// .sty 顶层 (style ...):
//   (name …)(bass-high/low/base …)(chord-high/low …)(swing …)(comp-swing …)
//   (bass-pattern (rules B4 C2)(weight 3.0)) …
//   (chord-pattern (rules X2+4 X2)(weight 10.0)) …
//   (drum-pattern (drum Ride_Cymbal_1 X4 X8 …)(drum …)(weight 10.0)) …
//
// 这里只解析成数据;渲染在 comp.ts。
// ============================================================

import { readSexpr } from '../data/sexpr-reader';
import { findTagged, findAllTagged, singleValue, type Polylist } from '../data/polylist';
import { makeNoteSymbol } from './pitch';
import { CMIDI } from './constants';

export interface WeightedRule { tokens: string[]; weight: number; }
export interface DrumLine { name: string; hits: string[]; }
export interface DrumPattern { drums: DrumLine[]; weight: number; }

export interface Style {
    name: string;
    bassLow: number;     // MIDI
    bassHigh: number;
    chordLow: number;
    chordHigh: number;
    swing: number;       // 旋律 swing
    compSwing: number;   // 伴奏 swing
    bassPatterns: WeightedRule[];
    chordPatterns: WeightedRule[];
    drumPatterns: DrumPattern[];
}

const noteMidi = (s: string | null, fallback: number): number => {
    if (!s) return fallback;
    const ns = makeNoteSymbol(s);
    return ns && !ns.isRest() ? ns.getMIDI() : fallback;
};

const asNum = (v: unknown, d: number): number => {
    const n = typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
};

const strTokens = (list: Polylist | null): string[] =>
    list ? list.slice(1).filter((x): x is string => typeof x === 'string') : [];

function weightedRules(style: Polylist, tag: string): WeightedRule[] {
    return findAllTagged(style, tag).map(p => ({
        tokens: strTokens(findTagged(p, 'rules')),
        weight: asNum(singleValue(p, 'weight'), 1),
    })).filter(r => r.tokens.length > 0 && r.weight > 0);
}

function drumPatterns(style: Polylist): DrumPattern[] {
    return findAllTagged(style, 'drum-pattern').map(dp => ({
        drums: findAllTagged(dp, 'drum').map(d => {
            const toks = strTokens(d);
            return { name: toks[0] ?? '', hits: toks.slice(1) };
        }).filter(d => d.name && d.hits.length > 0),
        weight: asNum(singleValue(dp, 'weight'), 1),
    })).filter(dp => dp.drums.length > 0 && dp.weight > 0);
}

/** 解析 .sty 文本 → Style */
export function parseStyle(styText: string): Style {
    const style = readSexpr(styText);
    const nameVal = singleValue(style, 'name');
    return {
        name: typeof nameVal === 'string' ? nameVal : 'unnamed',
        bassLow: noteMidi(singleValue(style, 'bass-low') as string | null, CMIDI - 24),
        bassHigh: noteMidi(singleValue(style, 'bass-high') as string | null, CMIDI - 5),
        chordLow: noteMidi(singleValue(style, 'chord-low') as string | null, CMIDI - 12),
        chordHigh: noteMidi(singleValue(style, 'chord-high') as string | null, CMIDI + 9),
        swing: asNum(singleValue(style, 'swing'), 0.5),
        compSwing: asNum(singleValue(style, 'comp-swing'), 0.5),
        bassPatterns: weightedRules(style, 'bass-pattern'),
        chordPatterns: weightedRules(style, 'chord-pattern'),
        drumPatterns: drumPatterns(style),
    };
}
