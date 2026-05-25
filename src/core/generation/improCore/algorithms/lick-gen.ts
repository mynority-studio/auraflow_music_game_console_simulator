// ============================================================
// lick-gen.ts — Impro-Visor LickGen + Grammar 极简移植(Step A 最小可跑)
// ============================================================
//
// 原型:
//   `Impro-Visor/src/imp/lickgen/Grammar.java`   — PCFG runner
//   `Impro-Visor/src/imp/lickgen/NoteChooser.java` — 28 行 lookup table
//   `Impro-Visor/src/imp/lickgen/LickGen.java`   — chooseNote 主入口
//
// 设计哲学(Impro-Visor):
//   melody = 单声部独奏线条,弹 chord tones / color tones / scale tones / random
//   每个 grammar terminal 是抽象的"音类别 + 时值",不指定具体 pitch
//   pitch 由 NoteChooser 在 chord 上下文里挑(prev pitch 附近找匹配类别)
//
// Step A 最小版(2026-05-25):
//   - Grammar runner:weighted PCFG expand,无 backtrack
//   - 极简 hardcode grammar(C/L/R 三种 terminal,4 bar 规则)
//   - NoteChooser 28 行完整 table(支持 fallback 降级)
//   - chooseNote:简单版,只处理 type + range,无 slope / approach
//   - 输出 NoteData[] 接入 GeneratedTrack.melody
//
// 后续 Step B:搬 .grammar 文件 + UI selector
// 后续 Step C:slope / approach / scale-degree token / tension
//
// PRNG 协议:全 D-5 deterministic(共识 2)— 用 AF2 Random class
// ============================================================

import type { Random } from '../../af2-engine/utils/Random';
import { placeNearMidi } from './note-utils';

// ============================================================
// Grammar 类型
// ============================================================

/** Grammar rule:left-hand-side → right-hand-side (with weight) */
export interface GrammarRule {
    /** LHS 非终结符,如 'P' / 'BRICK' / 'PHRASE' */
    head: string;
    /** RHS 序列(token 或 非终结符)— string atom 或 list */
    body: GrammarToken[];
    weight: number;
}

/** Token = atom string(terminal 如 'C8' / non-terminal 如 'P' / 'BRICK')或 nested list */
export type GrammarToken = string | GrammarToken[];

export interface GrammarDef {
    /** start 符号(典型 'P') */
    start: string;
    rules: GrammarRule[];
}

// ============================================================
// 6 个风格化 hardcode grammar(Step B 第一版)
// ============================================================
// 每 grammar 是 per-4-beat motif pool。Q+H UI 切换 grammar 听不同 melody 风格。
// 后续 Step B 第二版可搬真 .grammar 文件(BillEvans / Bach / 等)。
// ============================================================

const GRAMMAR_QUARTER_BASELINE: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // 中速 quarter chord-tone
        { head: 'BRICK_4', body: ['C4', 'L4', 'C4', 'L4'], weight: 0.25 },
        // 长持续 half
        { head: 'BRICK_4', body: ['C2', 'L2'], weight: 0.20 },
        // 8 分流动
        { head: 'BRICK_4', body: ['C8', 'L8', 'C8', 'L8', 'C8', 'L8', 'C8', 'L8'], weight: 0.15 },
        // 切分
        { head: 'BRICK_4', body: ['C4', 'R8', 'L8', 'C4', 'L4'], weight: 0.15 },
        // 短+留白
        { head: 'BRICK_4', body: ['C4', 'R4', 'C4', 'R4'], weight: 0.15 },
        // arp-ish run
        { head: 'BRICK_4', body: ['C8', 'C8', 'L8', 'C8', 'C8', 'L8', 'C8', 'C8'], weight: 0.10 },
    ],
};

const GRAMMAR_JAZZ_BEBOP: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // 8 分密集流动 chord+color
        { head: 'BRICK_4', body: ['C8', 'L8', 'C8', 'L8', 'C8', 'A8', 'C8', 'L8'], weight: 0.25 },
        // 8 分 + 16 分混
        { head: 'BRICK_4', body: ['C8', 'L8', 'C16', 'L16', 'C16', 'L16', 'C8', 'L8', 'C8'], weight: 0.20 },
        // scale-degree run(直接 emit 3rd / 5th / 7th 度)
        { head: 'BRICK_4', body: [['X', '3', '8'], ['X', '5', '8'], ['X', '7', '8'], 'L8', 'C4'], weight: 0.15 },
        // approach + chord 切分
        { head: 'BRICK_4', body: ['L8', 'A8', 'C4', 'L8', 'A8', 'C4'], weight: 0.15 },
        // 8th triplet feel(简化:更密 8 分)
        { head: 'BRICK_4', body: ['C8', 'L8', 'A8', 'C8', 'L8', 'A8', 'C8', 'L8'], weight: 0.15 },
        // 长持续 + bebop 装饰
        { head: 'BRICK_4', body: ['C2', 'L8', 'A8', 'C4'], weight: 0.10 },
    ],
};

const GRAMMAR_BACH_CHORD_TONE: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // chord-tone arpeggio(古典三和弦运动)
        { head: 'BRICK_4', body: [['X', '1', '8'], ['X', '3', '8'], ['X', '5', '8'], ['X', '3', '8'], ['X', '1', '8'], ['X', '3', '8'], ['X', '5', '8'], ['X', '3', '8']], weight: 0.30 },
        // 三度跳行
        { head: 'BRICK_4', body: [['X', '1', '4'], ['X', '3', '4'], ['X', '5', '4'], ['X', '3', '4']], weight: 0.25 },
        // 长 chord tone 持续
        { head: 'BRICK_4', body: [['X', '1', '2'], ['X', '5', '2']], weight: 0.20 },
        // 阶梯式
        { head: 'BRICK_4', body: [['X', '1', '8'], ['X', '2', '8'], ['X', '3', '8'], ['X', '4', '8'], ['X', '5', '8'], ['X', '4', '8'], ['X', '3', '8'], ['X', '2', '8']], weight: 0.15 },
        // 简朴 chord-tone whole
        { head: 'BRICK_4', body: [['X', '1', '1']], weight: 0.10 },
    ],
};

const GRAMMAR_CHROMATIC_COLOR: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // color tone 主导
        { head: 'BRICK_4', body: ['L8', 'L8', 'C8', 'L8', 'L8', 'C8', 'L8', 'L8'], weight: 0.25 },
        // chromatic approach 密集
        { head: 'BRICK_4', body: ['A8', 'C8', 'A8', 'L8', 'A8', 'C8', 'A8', 'L8'], weight: 0.20 },
        // X random + color
        { head: 'BRICK_4', body: ['X8', 'L8', 'X8', 'L8', 'X8', 'L8', 'X8', 'L8'], weight: 0.20 },
        // 长 color + chromatic 修饰
        { head: 'BRICK_4', body: ['L4', 'A8', 'L8', 'L4', 'A4'], weight: 0.20 },
        // chord 锚 + 大量 chromatic
        { head: 'BRICK_4', body: ['C4', 'A8', 'X8', 'L4', 'A4'], weight: 0.15 },
    ],
};

const GRAMMAR_LONG_SPARSE: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // whole 持续
        { head: 'BRICK_4', body: ['C1'], weight: 0.30 },
        // half + rest
        { head: 'BRICK_4', body: ['C2', 'R2'], weight: 0.25 },
        // 短 + 长 rest
        { head: 'BRICK_4', body: ['C4', 'R2', 'R4'], weight: 0.20 },
        // 全 rest(留白)
        { head: 'BRICK_4', body: ['R1'], weight: 0.10 },
        // 两 half
        { head: 'BRICK_4', body: ['C2', 'L2'], weight: 0.15 },
    ],
};

const GRAMMAR_SWING_SYNCOPATED: GrammarDef = {
    start: 'P',
    rules: [
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },
        // 切分 8 分(off-beat 重音感)
        { head: 'BRICK_4', body: ['R8', 'C8', 'C8', 'L8', 'R8', 'C8', 'L8', 'C8'], weight: 0.25 },
        // dotted quarter + 8 切分
        { head: 'BRICK_4', body: ['C4+8', 'L8', 'C4+8', 'L8'], weight: 0.20 },
        // off-beat anchor
        { head: 'BRICK_4', body: ['R8', 'C8', 'L4', 'R8', 'C8', 'L4'], weight: 0.20 },
        // approach 切分
        { head: 'BRICK_4', body: ['R8', 'A8', 'C4', 'R8', 'A8', 'C4'], weight: 0.20 },
        // tied 长持续
        { head: 'BRICK_4', body: ['C2+4', 'L4'], weight: 0.15 },
    ],
};

/** 6 grammar Map — UI dropdown 用 */
export const ALL_GRAMMARS_MAP: ReadonlyMap<string, GrammarDef> = new Map([
    ['quarter-baseline', GRAMMAR_QUARTER_BASELINE],
    ['jazz-bebop',       GRAMMAR_JAZZ_BEBOP],
    ['bach-chord-tone',  GRAMMAR_BACH_CHORD_TONE],
    ['chromatic-color',  GRAMMAR_CHROMATIC_COLOR],
    ['long-sparse',      GRAMMAR_LONG_SPARSE],
    ['swing-syncopated', GRAMMAR_SWING_SYNCOPATED],
]);

export const ALL_GRAMMAR_NAMES: ReadonlyArray<string> = Array.from(ALL_GRAMMARS_MAP.keys());

export function getGrammarByName(name: string): GrammarDef {
    return ALL_GRAMMARS_MAP.get(name) ?? GRAMMAR_QUARTER_BASELINE;
}

const DEFAULT_GRAMMAR: GrammarDef = GRAMMAR_QUARTER_BASELINE;

// ============================================================
// Grammar PCFG runner
// ============================================================
/**
 * Expand grammar 从 start 符号 → terminals(string atom 或 terminal list 如 (X 5 8))。
 * Weighted random rule pick,无 backtrack。
 *
 * Terminal list 识别:list head 若不是 grammar rule 的 head,treat 为 terminal(保留 list)。
 * 这让 (X 5 8) (slope -3 5 C8) 等 list terminal 跟 atom terminal 平行存活到 out。
 */
function expandGrammar(grammar: GrammarDef, rng: Random, maxIter: number = 1000): GrammarToken[] {
    const out: GrammarToken[] = [];
    const stack: GrammarToken[] = [grammar.start];
    const ruleHeads = new Set(grammar.rules.map(r => r.head));
    let iter = 0;
    while (stack.length > 0 && iter++ < maxIter) {
        const top = stack.pop()!;
        if (Array.isArray(top)) {
            // 检查 list head 是否是 non-terminal(在 grammar.rules.heads 内)
            const head = top[0];
            if (typeof head === 'string' && !ruleHeads.has(head)) {
                // head 不是 non-terminal → terminal list,保留 push 到 out
                out.push(top);
                continue;
            }
            // head 是 non-terminal 或空 → flatten 到 stack 头(reverse 保 left-to-right)
            for (let i = top.length - 1; i >= 0; i--) stack.push(top[i]!);
            continue;
        }
        // top 是 string atom — 找匹配规则
        const matchingRules = grammar.rules.filter(r => r.head === top);
        if (matchingRules.length === 0) {
            // 没规则匹配 = terminal atom,push 到 out
            out.push(top);
            continue;
        }
        // weighted random pick
        const total = matchingRules.reduce((s, r) => s + r.weight, 0);
        let target = rng.next() * total;
        let chosen = matchingRules[0]!;
        for (const r of matchingRules) {
            target -= r.weight;
            if (target <= 0) { chosen = r; break; }
        }
        // push body reverse 到 stack
        for (let i = chosen.body.length - 1; i >= 0; i--) stack.push(chosen.body[i]!);
    }
    return out;
}

// ============================================================
// NoteChooser — 28 行 lookup table
// ============================================================
// 行格式:(type, haveChord, haveColor, haveRandom, P_chord, P_color, P_random, P_scale)
//   type:0=CHORD requested / 1=COLOR / 2=RANDOM / 3=SCALE
//   haveX:1 if any candidate of that type in range else 0
//   P_*:百分比(0-100)— 抽到该类的概率
//
// 来源:Impro-Visor/src/imp/lickgen/NoteChooser.java line 61-93 直接 port
// ============================================================
type ChooserRow = [number, number, number, number, number, number, number, number];

const CHOOSER_TABLE: ChooserRow[] = [
    // type 0 (want CHORD)
    [0, 1, 1, 1, 100,   0,   0,   0],
    [0, 1, 1, 0, 100,   0,   0,   0],
    [0, 1, 0, 1, 100,   0,   0,   0],
    [0, 1, 0, 0, 100,   0,   0,   0],
    [0, 0, 1, 1,   0,  90,  10,   0],
    [0, 0, 1, 0,   0, 100,   0,   0],
    [0, 0, 0, 1,   0,   0, 100,   0],
    // type 1 (want COLOR)
    [1, 1, 1, 1,   0, 100,   0,   0],
    [1, 1, 1, 0,   0, 100,   0,   0],
    [1, 1, 0, 1,  20,   0,  80,   0],
    [1, 1, 0, 0, 100,   0,   0,   0],
    [1, 0, 1, 1,   0,  90,  10,   0],
    [1, 0, 1, 0,   0, 100,   0,   0],
    [1, 0, 0, 1,   0,   0, 100,   0],
    // type 2 (want RANDOM)
    [2, 1, 1, 1,  20,  30,  50,   0],
    [2, 1, 1, 0,  40,  60,   0,   0],
    [2, 1, 0, 1,  30,   0,  70,   0],
    [2, 1, 0, 0, 100,   0,   0,   0],
    [2, 0, 1, 1,   0,  40,  60,   0],
    [2, 0, 1, 0,   0, 100,   0,   0],
    [2, 0, 0, 1,   0,   0, 100,   0],
    // type 3 (want SCALE — fallback to scale tone if no chord)
    [3, 1, 1, 1,  60,  20,   0,  20],
    [3, 1, 1, 0,  70,  30,   0,   0],
    [3, 1, 0, 1,  60,   0,  20,  20],
    [3, 1, 0, 0, 100,   0,   0,   0],
    [3, 0, 1, 1,   0,  60,  20,  20],
    [3, 0, 1, 0,   0, 100,   0,   0],
    [3, 0, 0, 1,   0,   0, 100,   0],
];

const TYPE_CHORD = 0;
const TYPE_COLOR = 1;
const TYPE_RANDOM = 2;
// TYPE_SCALE = 3(暂未用)

/**
 * 根据 (requestedType, available types) 查表选 final type。
 * 返回 final type 0/1/2/3,caller 用此 type 在 candidates 内 uniform random 抽 pitch。
 */
function chooseNoteType(
    requestedType: number,
    haveChord: boolean,
    haveColor: boolean,
    haveRandom: boolean,
    rng: Random,
): number {
    const hc = haveChord ? 1 : 0;
    const hl = haveColor ? 1 : 0;
    const hr = haveRandom ? 1 : 0;
    const row = CHOOSER_TABLE.find(r => r[0] === requestedType && r[1] === hc && r[2] === hl && r[3] === hr);
    if (!row) return requestedType;  // fallback
    const probs: [number, number, number, number] = [row[4], row[5], row[6], row[7]];
    let target = rng.next() * 100;
    for (let i = 0; i < 4; i++) {
        target -= probs[i]!;
        if (target <= 0) return i;
    }
    return requestedType;
}

// ============================================================
// chooseNote — 给定 chord 上下文 + range,选 pitch
// ============================================================
/**
 * @param requestedType  0=CHORD / 1=COLOR / 2=RANDOM / 3=SCALE
 * @param chordSpellPcs  chord tones pcs (ABSOLUTE,加了 keyOffset)
 * @param chordColorPcs  color tones pcs(chord 内 extension,可能含 altered tension)
 * @param scalePcs       当前 chord 的 local scale pcs(chord-scale relationship)
 * @param prevMidi       上一音 MIDI(给 range 找最近)
 * @param lo / hi        melody range(MIDI 区间)
 * @param rng            AF2 Random
 *
 * @returns final MIDI pitch
 */
export function chooseNote(
    requestedType: number,
    chordSpellPcs: number[],
    chordColorPcs: number[],
    scalePcs: number[],
    prevMidi: number,
    lo: number,
    hi: number,
    rng: Random,
): number {
    // build candidates by type in [lo, hi]
    //   chordCands  = chord spell 内
    //   colorCands  = chord color 内但不在 spell(altered tension 或 extension)
    //   scaleCands  = local scale 内但不在 chord(scale tone)
    //   randomCands = 不在以上 — scale 外 chromatic(极少用)
    const chordCands: number[] = [];
    const colorCands: number[] = [];
    const scaleCands: number[] = [];
    const randomCands: number[] = [];
    const spellSet = new Set(chordSpellPcs.map(p => ((p % 12) + 12) % 12));
    const colorSet = new Set(chordColorPcs.map(p => ((p % 12) + 12) % 12));
    const scaleSet = new Set(scalePcs.map(p => ((p % 12) + 12) % 12));
    for (let m = lo; m <= hi; m++) {
        const pc = ((m % 12) + 12) % 12;
        if (spellSet.has(pc)) chordCands.push(m);
        else if (scaleSet.has(pc)) scaleCands.push(m);   // local scale 内非 chord
        else if (colorSet.has(pc)) colorCands.push(m);   // chord color 但不在 local scale(altered)
        else randomCands.push(m);                        // 完全调外 chromatic — 极少用
    }
    // RANDOM type 改用 scale candidates(调内非 chord)替代真 random — 避免调外音
    // 真 randomCands 只在 scale 也为空时启用
    const effectiveRandomCands = scaleCands.length > 0 ? scaleCands : randomCands;
    // chooseNoteType 的 "haveRandom" 用 effective 是否非空(表面是 random,实际是 scale tone)
    const finalType = chooseNoteType(
        requestedType,
        chordCands.length > 0,
        colorCands.length > 0,
        effectiveRandomCands.length > 0,
        rng,
    );
    let pool: number[];
    switch (finalType) {
        case TYPE_CHORD: pool = chordCands; break;
        case TYPE_COLOR: pool = colorCands; break;
        case TYPE_RANDOM: pool = effectiveRandomCands; break;
        default:         pool = chordCands.length > 0 ? chordCands : (effectiveRandomCands.length > 0 ? effectiveRandomCands : colorCands);
    }
    if (pool.length === 0) return Math.max(lo, Math.min(hi, prevMidi));
    // prefer 距 prev 最近的(简化 voice leading)
    pool.sort((a, b) => Math.abs(a - prevMidi) - Math.abs(b - prevMidi));
    // 在前 3 个最近的里 weighted random(stop 完全 deterministic-by-prev)
    const top = pool.slice(0, Math.min(3, pool.length));
    return top[Math.floor(rng.next() * top.length)]!;
}

// ============================================================
// Terminal parser(C8 / L4 / R8 / A8 / (X 5 8) → 类型 + 时值)
// ============================================================
/**
 * 解析 grammar terminal:
 *   atom string:
 *     C4   chord tone, quarter
 *     L8   color tone, eighth
 *     X4   random, quarter
 *     S4   scale, quarter
 *     A8   approach tone(±1 半音进入 next chord root)
 *     R8   rest
 *   list:
 *     (X N dur)   scale-degree N(chord 第 N 度)at dur
 */
interface ParsedTerminal {
    type: number;                  // 0=CHORD 1=COLOR 2=RANDOM 3=SCALE
    isRest: boolean;
    beats: number;
    isApproach: boolean;           // A token
    scaleDegree?: number;          // (X N dur) token
}

function parseTerminal(token: GrammarToken): ParsedTerminal | null {
    if (Array.isArray(token)) {
        // list terminal:(X N dur) = scale-degree
        if (token.length >= 3 && token[0] === 'X') {
            const degree = parseInt(token[1] as string, 10);
            const beats = parseTerminalDuration(token[2] as string);
            if (isNaN(degree) || beats <= 0) return null;
            return { type: 0, isRest: false, beats, isApproach: false, scaleDegree: degree };
        }
        // (slope ...) / 其他 list — 第一版不支持,跳过
        return null;
    }
    // atom string
    if (!token) return null;
    const ch = token[0]!;
    const durStr = token.slice(1);
    const beats = parseTerminalDuration(durStr);
    if (beats <= 0) return null;
    switch (ch) {
        case 'C': return { type: 0, isRest: false, beats, isApproach: false };
        case 'L': return { type: 1, isRest: false, beats, isApproach: false };
        case 'X': return { type: 2, isRest: false, beats, isApproach: false };
        case 'S': return { type: 3, isRest: false, beats, isApproach: false };
        case 'A': return { type: 1, isRest: false, beats, isApproach: true };
        case 'R': return { type: 0, isRest: true, beats, isApproach: false };
        default:  return null;
    }
}

/** scale degree → chord spell array index(简化:1→0 / 3→1 / 5→2 / 7→3 / 9→4 / 11→5 / 13→6) */
const SPELL_IDX_BY_DEGREE: Record<number, number> = {
    1: 0, 3: 1, 5: 2, 7: 3, 9: 4, 11: 5, 13: 6,
};
/** fallback degree → major scale interval(用于 spell 不够时) */
const MAJOR_SCALE_INTERVAL: Record<number, number> = {
    1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11,
    9: 14, 11: 17, 13: 21,
};

function scaleDegreeToPc(degree: number, chordSpellPcs: number[], chordRootPc: number): number {
    const idx = SPELL_IDX_BY_DEGREE[degree];
    if (idx !== undefined && idx < chordSpellPcs.length) {
        return chordSpellPcs[idx]!;
    }
    // fallback major scale
    const iv = MAJOR_SCALE_INTERVAL[degree] ?? 0;
    return (((chordRootPc + iv) % 12) + 12) % 12;
}

/** 简化 duration parser — 只支持 '4' / '8' / '16' / '2' / '1' + 'n+m' tied */
function parseTerminalDuration(s: string): number {
    if (!s) return 0;
    let total = 0;
    for (const part of s.split('+')) {
        const n = parseInt(part, 10);
        if (isNaN(n) || n <= 0) continue;
        total += 4 / n;
    }
    return total;
}

// ============================================================
// MAIN API — 给一首 chord progression 生成 melody
// ============================================================

export interface MelodyChordCtx {
    /** chord 起拍 */
    startBeat: number;
    /** chord 拍长 */
    beats: number;
    /** ABSOLUTE chord root pc 0-11(已加 keyOffset)— 给 scale-degree 计算用 */
    rootPc: number;
    /** ABSOLUTE chord tone pcs 0-11(已加 keyOffset) */
    spellPcs: number[];
    /** ABSOLUTE color tone pcs(chord 内 extension,可能含 altered tension)
     *  melody chooseNote COLOR type 用此 */
    colorPcs: number[];
    /** ABSOLUTE 当前 chord 的 local scale pcs(chord-scale relationship):
     *  C maj7 → C major / lydian / Dm7 → D dorian / G7 → G mixolydian / etc.
     *  melody RANDOM/SCALE 候选限制此 — chord 在 dorian 时 melody 也在 dorian。
     *  典型已跟 key scale 做交集,保 chord 跟 melody/bass 永远同 local scale。 */
    scalePcs: number[];
    /** Step C:本 chord 是否在 section 末(phrase ending)— true 则 emit 长 tonic 不跑 grammar */
    isPhraseEnd?: boolean;
}

export interface MelodyNote {
    pitch: number;
    onset: number;
    duration: number;
    velocity: number;   // 0-127
}

const MELODY_LO_DEFAULT = 60;   // C4
const MELODY_HI_DEFAULT = 84;   // C6
const MELODY_VELOCITY = 90;

/**
 * 主入口:per chord 跑 grammar → expand terminals → 每 terminal 调 chooseNote。
 *
 * @param chordCtxs   chord 序列(每个含 chord tones + 时间)
 * @param rng         AF2 Random
 * @param grammar     可选 grammar(默认 DEFAULT_GRAMMAR)
 * @param melodyLo / melodyHi  音域(默认 C4-C6)
 *
 * @returns melody NoteData[]
 */
export function generateMelody(
    chordCtxs: MelodyChordCtx[],
    rng: Random,
    grammar: GrammarDef = DEFAULT_GRAMMAR,
    melodyLo: number = MELODY_LO_DEFAULT,
    melodyHi: number = MELODY_HI_DEFAULT,
): MelodyNote[] {
    const out: MelodyNote[] = [];
    let prevMidi = Math.floor((melodyLo + melodyHi) / 2);  // 72 ≈ C5 起点

    for (let ci = 0; ci < chordCtxs.length; ci++) {
        const cc = chordCtxs[ci]!;
        const nextCc = chordCtxs[ci + 1] ?? null;
        if (cc.beats <= 0) continue;

        // Step C:phrase ending — 跳过 grammar,emit 单个长 tonic 占整 chord
        // melody 真正"落地" — 长持续 root 音给听众明确解决感
        if (cc.isPhraseEnd) {
            // 短 pickup(可选):前 1/4 beat emit 1 个 chord tone 装饰
            // 长 tonic:剩 3/4 beat root pitch sustain
            const tonicMidi = placeNearMidi(cc.rootPc, prevMidi, melodyLo, melodyHi);
            // 整 chord = 1 个长 tonic(简化版,不加装饰)
            out.push({
                pitch: tonicMidi,
                onset: cc.startBeat,
                duration: cc.beats * 0.95,
                velocity: MELODY_VELOCITY,
            });
            prevMidi = tonicMidi;
            continue;
        }

        // 非 phrase end:正常跑 grammar
        const terminals = expandGrammar(grammar, rng);
        // 时间累积 fill 到 chord beats(超出截断,不够循环 padding)
        let cursor = 0;
        let ti = 0;
        let safeguard = 0;
        while (cursor < cc.beats && safeguard++ < 200) {
            const tok = terminals[ti % terminals.length];
            if (!tok) break;
            ti++;
            const parsed = parseTerminal(tok);
            if (!parsed) continue;
            const remainingBeats = cc.beats - cursor;
            const noteBeats = Math.min(parsed.beats, remainingBeats);
            if (parsed.isRest) {
                cursor += noteBeats;
                continue;
            }

            let pitch: number;
            // C 扩展 1:(X N dur) scale-degree — 直接 emit chord 第 N 度
            if (parsed.scaleDegree !== undefined) {
                const targetPc = scaleDegreeToPc(parsed.scaleDegree, cc.spellPcs, cc.rootPc);
                pitch = placeNearMidi(targetPc, prevMidi, melodyLo, melodyHi);
            }
            // C 扩展 2:A approach — ±1 半音进入 next chord root
            else if (parsed.isApproach && nextCc) {
                const nextRoot = nextCc.rootPc;
                const belowPc = ((nextRoot - 1) + 12) % 12;
                const abovePc = (nextRoot + 1) % 12;
                const belowMidi = placeNearMidi(belowPc, prevMidi, melodyLo, melodyHi);
                const aboveMidi = placeNearMidi(abovePc, prevMidi, melodyLo, melodyHi);
                pitch = Math.abs(belowMidi - prevMidi) <= Math.abs(aboveMidi - prevMidi)
                    ? belowMidi : aboveMidi;
            }
            // A 路径 baseline:C/L/X/S 走 NoteChooser
            else {
                pitch = chooseNote(
                    parsed.type,
                    cc.spellPcs,
                    cc.colorPcs,
                    cc.scalePcs,
                    prevMidi,
                    melodyLo,
                    melodyHi,
                    rng,
                );
            }

            out.push({
                pitch,
                onset: cc.startBeat + cursor,
                duration: noteBeats * 0.95,
                velocity: MELODY_VELOCITY,
            });
            prevMidi = pitch;
            cursor += parsed.beats;
        }
    }
    return out;
}
