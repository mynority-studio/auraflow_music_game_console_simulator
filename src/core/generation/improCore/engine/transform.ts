// ============================================================
// ImproCore engine — Transform(变换语法装饰 / embellishment)
// imp/lickgen/transformations/{Transform,Substitution,Transformation,Evaluate}.java
// ============================================================
//
// 把生成的旋律按 .transform 规则改写(加经过音/装饰)。每条 transformation:
//   source-notes(变量 n1 n2…)→ 匹配连续 N 个音
//   guard-condition(布尔 DSL)→ 满足才应用
//   target-notes(改写表达式)→ 新音符
// 安全阀(Transformation.apply enforceDuration):target 总时值 ≠ source 总时值 → 丢弃,
//   保证不破坏时序。用不到的 DSL 函数(member/chord-family/triplet? 等)→ 该 sub 不触发。
//
// DSL 子集(覆盖 ~99% 用量):
//   guard:  and/or/not/= · duration/duration>=/duration</= · rest? · note-category ·
//           relative-pitch · absolute-pitch · pitch>=/pitch</pitch>/pitch<=
//   target: multiply-duration · transpose-diatonic · transpose-chromatic · make-rest
// ============================================================

import { readMultiSexpr } from '../data/sexpr-reader';
import { numberize, isGList, gAssoc, type GVal, type GList } from './terminals';
import { makeRelativeNote, type SlotNote } from './lickgen';
import type { Chord } from './chord';
import type { ChordPart } from './chordpart';

// NoteConverter.java semitone→degree(relative-pitch 用)
const SCALE_DEGREES: Record<string, string[]> = {
    major: ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', '#5', '6', 'b7', '7'],
    minor: ['1', 'b2', '2', '3', '#3', '4', 'b5', '5', 'b6', '6', 'b7', '7'],
    minor7: ['1', 'b2', '2', '3', '#3', '4', 'b5', '5', 'b6', '6', '7', '#7'],
    dominant: ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', '#5', '6', '7', '#7'],
    'half-diminished': ['1', '2', '#2', '3', '#3', '4', '5', '#5', '6', '#6', '7', '#7'],
    diminished: ['1', 'b2', '2', '3', '#3', '4', 'b5', '5', '6', '7', '#7', 'b8'],
    augmented: ['1', 'b2', '2', 'b3', '3', '4', '#4', 'b5', '5', '6', 'b7', '7'],
};
function degreesFor(family: string): string[] {
    if (family === 'minor') return SCALE_DEGREES.minor!;
    if (family === 'minor7') return SCALE_DEGREES.minor7!;
    if (family === 'dominant' || family === 'sus4' || family === 'alt') return SCALE_DEGREES.dominant!;
    if (family === 'half-diminished') return SCALE_DEGREES['half-diminished']!;
    if (family === 'diminished') return SCALE_DEGREES.diminished!;
    if (family === 'augmented') return SCALE_DEGREES.augmented!;
    return SCALE_DEGREES.major!;
}

interface NCP { pitch: number; duration: number; chord: Chord | null; }
const isNCP = (x: unknown): x is NCP => typeof x === 'object' && x !== null && 'pitch' in x && 'duration' in x;

// ------------------------------------------------------------
// DSL 基元
// ------------------------------------------------------------
function relativePitch(ncp: NCP): string | number | null {
    if (ncp.pitch < 0 || !ncp.chord || ncp.chord.isNOCHORD()) return null;
    const root = ncp.chord.getRootSemitones();
    const interval = (((ncp.pitch % 12) - root) % 12 + 12) % 12;
    const deg = degreesFor(ncp.chord.getFamily())[interval]!;
    return /^\d+$/.test(deg) ? Number(deg) : deg;
}

function noteCategory(ncp: NCP): string {
    if (ncp.pitch < 0) return 'R';
    if (!ncp.chord || ncp.chord.isNOCHORD()) return 'X';
    const pc = ((ncp.pitch % 12) + 12) % 12;
    if (ncp.chord.getSpell().some(ns => ns.getSemitones() === pc)) return 'C';
    if (ncp.chord.getColor().some(ns => ns.getSemitones() === pc)) return 'L';
    return 'X';
}

/** Evaluate.addRelPitch:两个级数串相加(5+4=8) */
function addRelPitch(a: string, b: string): string {
    let aug1 = '', aug2 = '';
    while (a[0] === '#' || a[0] === 'b') { aug1 += a[0]; a = a.slice(1); }
    while (b[0] === '#' || b[0] === 'b') { aug2 += b[0]; b = b.slice(1); }
    const v1 = parseInt(a, 10), v2 = parseInt(b, 10);
    let total = v2 + v1;
    if (v1 > 0) total--;
    if (v2 > 0) total--;
    if (total >= 0) total++;
    let flats = 0, sharps = 0;
    for (const c of aug1 + aug2) { if (c === 'b') flats++; else if (c === '#') sharps++; }
    const net = flats - sharps;
    const augs = net > 0 ? 'b'.repeat(net) : '#'.repeat(-net);
    return augs + total;
}

function transposeDiatonic(ncp: NCP, relPitch: string): NCP | null {
    if (!ncp.chord || ncp.chord.isNOCHORD() || ncp.pitch < 0) return null;
    const cur = relativePitch(ncp);
    if (cur === null) return null;
    const curStr = String(cur);
    let total = addRelPitch(curStr, relPitch);

    let insert = '';
    while (total[0] === 'b' || total[0] === '#') { insert += total[0]; total = total.slice(1); }
    const orig = parseInt(total, 10);
    let shiftOct = 0, num: number;
    if (orig < 0) { shiftOct += Math.floor(orig / 7) - 1; num = (orig % 7) + 8; }
    else { shiftOct += Math.floor((orig - 1) / 7); num = ((orig - 1) % 7) + 1; }
    const totalStr = insert + num;

    const fake = makeRelativeNote(['X', totalStr, '4'] as GList, ncp.chord);
    const fakeInit = makeRelativeNote(['X', curStr, '4'] as GList, ncp.chord);
    if (!fake || !fakeInit) return null;
    const newPitch = ncp.pitch + (fake.pitch - fakeInit.pitch) + 12 * shiftOct;
    return { pitch: newPitch, duration: ncp.duration, chord: ncp.chord };
}

function transposeChromatic(ncp: NCP, n: number): NCP | null {
    if (ncp.pitch < 0) return null;
    return { pitch: ncp.pitch + Math.round(n * 2), duration: ncp.duration, chord: ncp.chord };
}

const multiplyDuration = (ncp: NCP, f: number): NCP => ({ ...ncp, duration: Math.max(1, Math.round(ncp.duration * f)) });
const makeRest = (ncp: NCP): NCP => ({ pitch: -1, duration: ncp.duration, chord: ncp.chord });

// ------------------------------------------------------------
// 求值:guard(布尔)/ target(音符)
// ------------------------------------------------------------
type Env = Map<string, NCP>;
type GuardVal = boolean | number | string | NCP | null;

const num = (v: GuardVal): number => (typeof v === 'number' ? v : Number(v));

function evalGuard(expr: GVal, env: Env): GuardVal {
    if (typeof expr === 'number') return expr;
    if (typeof expr === 'string') return env.get(expr) ?? expr;
    if (!isGList(expr) || expr.length === 0) return null;
    const head = expr[0];
    const a = (i: number) => evalGuard(expr[i]!, env);
    switch (head) {
        case 'and': return expr.slice(1).every(e => evalGuard(e, env) === true);
        case 'or': return expr.slice(1).some(e => evalGuard(e, env) === true);
        case 'not': return evalGuard(expr[1]!, env) !== true;
        case '=': { const x = a(1), y = a(2); return x === y; }
        case 'note-category': { const n = a(1); return isNCP(n) ? noteCategory(n) : null; }
        case 'relative-pitch': { const n = a(1); return isNCP(n) ? relativePitch(n) : null; }
        case 'absolute-pitch': { const n = a(1); return isNCP(n) ? n.pitch : null; }
        case 'duration': { const n = a(1); return isNCP(n) ? n.duration : null; }
        case 'rest?': { const n = a(1); return isNCP(n) ? n.pitch < 0 : false; }
        case 'duration>=': return num(a(1)) >= num(a(2));
        case 'duration<': return num(a(1)) < num(a(2));
        case 'duration<=': return num(a(1)) <= num(a(2));
        case 'duration=': return num(a(1)) === num(a(2));
        case 'pitch>=': { const x = a(1), y = a(2); return isNCP(x) && isNCP(y) ? x.pitch >= y.pitch : false; }
        case 'pitch>': { const x = a(1), y = a(2); return isNCP(x) && isNCP(y) ? x.pitch > y.pitch : false; }
        case 'pitch<': { const x = a(1), y = a(2); return isNCP(x) && isNCP(y) ? x.pitch < y.pitch : false; }
        case 'pitch<=': { const x = a(1), y = a(2); return isNCP(x) && isNCP(y) ? x.pitch <= y.pitch : false; }
        default: return null; // 未支持的谓词 → 视为不满足
    }
}

/** 求值 target 表达式 → NCP 或 NCP[](未支持 → null) */
function evalTarget(expr: GVal, env: Env): NCP | null {
    if (typeof expr === 'string') return env.get(expr) ?? null;
    if (!isGList(expr) || expr.length === 0) return null;
    const head = expr[0];
    switch (head) {
        case 'multiply-duration': { const n = evalTarget(expr[2]!, env); return n ? multiplyDuration(n, Number(expr[1])) : null; }
        case 'transpose-diatonic': { const n = evalTarget(expr[2]!, env); return n ? transposeDiatonic(n, String(expr[1])) : null; }
        case 'transpose-chromatic': { const n = evalTarget(expr[2]!, env); return n ? transposeChromatic(n, Number(expr[1])) : null; }
        case 'make-rest': { const n = evalTarget(expr[1]!, env); return n ? makeRest(n) : null; }
        case 'get-note': return evalTarget(expr[1]!, env);
        default: return null; // 未支持 → 该 target 作废(整条 transformation 因时值不匹配被丢弃)
    }
}

// ------------------------------------------------------------
// 解析 .transform
// ------------------------------------------------------------
export interface TransRule { sourceVars: string[]; guard: GVal; targets: GList; weight: number; }
export interface Substitution { name: string; type: string; weight: number; enabled: boolean; rules: TransRule[]; }

const numVal = (l: GList | null, d = 1): number => { const v = l?.[1]; return typeof v === 'number' ? v : d; };
const boolVal = (l: GList | null): boolean => l?.[1] === 'true';

export function parseTransform(text: string): Substitution[] {
    const out: Substitution[] = [];
    for (const raw of readMultiSexpr(text)) {
        const form = numberize(raw) as GList;
        if (form[0] !== 'substitution') continue;
        const nameEl = gAssoc(form, 'name');
        const typeEl = gAssoc(form, 'type');
        const rules: TransRule[] = [];
        for (const t of form) {
            if (!isGList(t) || t[0] !== 'transformation') continue;
            const src = gAssoc(t, 'source-notes');
            const guardEl = gAssoc(t, 'guard-condition');
            const tgtEl = gAssoc(t, 'target-notes');
            if (!src || !guardEl || !tgtEl) continue;
            rules.push({
                sourceVars: src.slice(1).filter((x): x is string => typeof x === 'string'),
                guard: guardEl[1] ?? [],
                targets: tgtEl.slice(1),
                weight: numVal(gAssoc(t, 'weight')),
            });
        }
        out.push({
            name: typeof nameEl?.[1] === 'string' ? nameEl[1] : 'sub',
            type: typeof typeEl?.[1] === 'string' ? typeEl[1] : 'motif',
            weight: numVal(gAssoc(form, 'weight')),
            enabled: boolVal(gAssoc(form, 'enabled')),
            rules,
        });
    }
    return out;
}

// ------------------------------------------------------------
// 应用
// ------------------------------------------------------------
interface Applicable { targets: NCP[]; k: number; weight: number; }

function tryRules(melody: SlotNote[], cp: ChordPart, subs: Substitution[], i: number): Applicable | null {
    const cands: Applicable[] = [];
    for (const sub of subs) {
        if (!sub.enabled) continue;
        for (const rule of sub.rules) {
            const k = rule.sourceVars.length;
            if (k === 0 || i + k > melody.length) continue;
            const env: Env = new Map();
            let srcDur = 0;
            for (let j = 0; j < k; j++) {
                const n = melody[i + j]!;
                env.set(rule.sourceVars[j]!, { pitch: n.pitch, duration: n.durationSlots, chord: cp.getCurrentChord(n.startSlot) });
                srcDur += n.durationSlots;
            }
            if (evalGuard(rule.guard, env) !== true) continue;
            const targets = rule.targets.map(t => evalTarget(t, env)).filter(isNCP);
            if (targets.length === 0) continue;
            const tgtDur = targets.reduce((s, t) => s + t.duration, 0);
            if (tgtDur !== srcDur) continue;               // 保时值安全阀
            cands.push({ targets, k, weight: sub.weight * rule.weight });
        }
    }
    if (cands.length === 0) return null;
    let total = 0; for (const c of cands) total += c.weight;
    let r = Math.random() * (total || cands.length);
    for (const c of cands) { r -= (c.weight || 1); if (r <= 0) return c; }
    return cands[cands.length - 1]!;
}

/** 对旋律应用一批 substitution(motif 先、embellishment 后)*/
export function applyTransform(melody: SlotNote[], cp: ChordPart, subs: Substitution[]): SlotNote[] {
    let notes = melody;
    for (const passType of ['motif', 'embellishment']) {
        const passSubs = subs.filter(s => s.enabled && s.type === passType);
        if (passSubs.length === 0) continue;
        const out: SlotNote[] = [];
        let i = 0, guard = 0;
        while (i < notes.length && guard++ < 100000) {
            const cand = tryRules(notes, cp, passSubs, i);
            if (cand) {
                let pos = notes[i]!.startSlot;
                for (const t of cand.targets) {
                    out.push({ pitch: t.pitch, startSlot: pos, durationSlots: t.duration, velocity: notes[i]!.velocity });
                    pos += t.duration;
                }
                i += cand.k;
            } else {
                out.push(notes[i]!);
                i++;
            }
        }
        notes = out;
    }
    return notes;
}
