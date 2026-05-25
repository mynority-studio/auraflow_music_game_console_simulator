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
// 默认极简 grammar
// ============================================================
// 4 个 4-beat melody 模板:中速 / 8 分流动 / 长持续 / 切分
// 每 chord 跑一次 grammar(start P,总 4 beat 输出)
// ============================================================

const DEFAULT_GRAMMAR: GrammarDef = {
    start: 'P',
    rules: [
        // P → BRICK_4(4 beat 的 melody 片段)
        { head: 'P', body: ['BRICK_4'], weight: 1.0 },

        // BRICK_4 — 4 beat 的几个旋律 motif
        // 中速 quarter chord-tone motif
        { head: 'BRICK_4', body: ['C4', 'L4', 'C4', 'L4'], weight: 0.20 },
        // 8 分流动 — 多 chord-tone + 偶尔 color
        { head: 'BRICK_4', body: ['C8', 'L8', 'C8', 'L8', 'C8', 'L8', 'C8', 'L8'], weight: 0.20 },
        // 长持续 — half note 沉稳
        { head: 'BRICK_4', body: ['C2', 'L2'], weight: 0.15 },
        // 切分 — 强拍 chord + 偏 off 色彩
        { head: 'BRICK_4', body: ['C4', 'R8', 'L8', 'C4', 'L4'], weight: 0.15 },
        // 16 分密集
        { head: 'BRICK_4', body: ['C16', 'L16', 'C16', 'L16', 'C8', 'L4', 'C4'], weight: 0.10 },
        // 短 + 留白
        { head: 'BRICK_4', body: ['C4', 'R4', 'C4', 'R4'], weight: 0.10 },
        // arp-ish chord run
        { head: 'BRICK_4', body: ['C8', 'C8', 'L8', 'C8', 'C8', 'L8', 'C8', 'C8'], weight: 0.10 },
    ],
};

// ============================================================
// Grammar PCFG runner
// ============================================================
/**
 * Expand grammar 从 start 符号 → terminals(全 string atom)。
 * Weighted random rule pick,无 backtrack。
 * 简化:不限 step 数 / 不限 token 深度,信任 grammar 是 well-formed。
 */
function expandGrammar(grammar: GrammarDef, rng: Random, maxIter: number = 1000): string[] {
    const out: string[] = [];
    const stack: GrammarToken[] = [grammar.start];
    let iter = 0;
    while (stack.length > 0 && iter++ < maxIter) {
        const top = stack.pop()!;
        if (Array.isArray(top)) {
            // nested list — flatten 到 stack 头(reverse 保 left-to-right 处理)
            for (let i = top.length - 1; i >= 0; i--) stack.push(top[i]!);
            continue;
        }
        // top 是 string atom — 找匹配规则
        const matchingRules = grammar.rules.filter(r => r.head === top);
        if (matchingRules.length === 0) {
            // 没规则匹配 = terminal,push 到 out
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
 * @param chordColorPcs  color tones pcs
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
    prevMidi: number,
    lo: number,
    hi: number,
    rng: Random,
): number {
    // build candidates by type in [lo, hi]
    const chordCands: number[] = [];
    const colorCands: number[] = [];
    const randomCands: number[] = [];
    const spellSet = new Set(chordSpellPcs.map(p => ((p % 12) + 12) % 12));
    const colorSet = new Set(chordColorPcs.map(p => ((p % 12) + 12) % 12));
    for (let m = lo; m <= hi; m++) {
        const pc = ((m % 12) + 12) % 12;
        if (spellSet.has(pc)) chordCands.push(m);
        else if (colorSet.has(pc)) colorCands.push(m);
        else randomCands.push(m);
    }
    const finalType = chooseNoteType(
        requestedType,
        chordCands.length > 0,
        colorCands.length > 0,
        randomCands.length > 0,
        rng,
    );
    let pool: number[];
    switch (finalType) {
        case TYPE_CHORD: pool = chordCands; break;
        case TYPE_COLOR: pool = colorCands; break;
        case TYPE_RANDOM: pool = randomCands; break;
        default:         pool = chordCands.length > 0 ? chordCands : (colorCands.length > 0 ? colorCands : randomCands);
    }
    if (pool.length === 0) return Math.max(lo, Math.min(hi, prevMidi));
    // prefer 距 prev 最近的(简化 voice leading)
    pool.sort((a, b) => Math.abs(a - prevMidi) - Math.abs(b - prevMidi));
    // 在前 3 个最近的里 weighted random(stop 完全 deterministic-by-prev)
    const top = pool.slice(0, Math.min(3, pool.length));
    return top[Math.floor(rng.next() * top.length)]!;
}

// ============================================================
// Terminal parser(C8 / L4 / R8 → 类型 + 时值)
// ============================================================
/**
 * 解析 grammar terminal token:
 *   C4   chord tone, quarter note
 *   L8   color tone, eighth
 *   R8   rest, eighth
 *   X4   random, quarter
 *   S4   scale, quarter
 *
 * 返:{ type: 0/1/2/3, isRest, beats }
 */
interface ParsedTerminal {
    type: number;       // 0=CHORD 1=COLOR 2=RANDOM 3=SCALE
    isRest: boolean;
    beats: number;
}

function parseTerminal(token: string): ParsedTerminal | null {
    if (!token) return null;
    const ch = token[0]!;
    const durStr = token.slice(1);
    const beats = parseTerminalDuration(durStr);
    if (beats <= 0) return null;
    switch (ch) {
        case 'C': return { type: 0, isRest: false, beats };
        case 'L': return { type: 1, isRest: false, beats };
        case 'X': return { type: 2, isRest: false, beats };
        case 'S': return { type: 3, isRest: false, beats };
        case 'R': return { type: 0, isRest: true, beats };
        default:  return null;
    }
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
    /** ABSOLUTE chord tone pcs 0-11(已加 keyOffset) */
    spellPcs: number[];
    /** ABSOLUTE color tone pcs */
    colorPcs: number[];
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

    for (const cc of chordCtxs) {
        if (cc.beats <= 0) continue;
        // expand grammar 一次得到 terminal 序列
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
            const pitch = chooseNote(
                parsed.type,
                cc.spellPcs,
                cc.colorPcs,
                prevMidi,
                melodyLo,
                melodyHi,
                rng,
            );
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
