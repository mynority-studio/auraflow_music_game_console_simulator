// ============================================================
// motifCore — Guide Tone 线生成(Impro-Visor GuideLineGenerator 忠实移植)
// ============================================================
//
// 1:1 移植 Impro-Visor 的 guidetone/GuideLineGenerator.java(单线 + 双线/mix)。
// 与 Grammar 路线互补:Grammar = 加权随机 lick;GuideTone = 确定性、声部进行平滑、
// 100% 落和弦音/色彩音的「骨架线」。
//
// 算法(确定性贪心评分选音器):
//   逐和弦,从「该和弦所有 chord(+可选 color)音」里选下一个:候选先 octave-adjust 到离前音
//   最近(getClosest),再按 score = directionScore + distanceScore(越低越好),平手用 priorityScore
//   (和弦 priority 列表索引,色彩音排最后)tiebreak。首音用 closestToMiddle 放到音域中部(按方向偏下/上)。
//   撞音域边缘则反向(possibleDirectionSwitch);时值超 maxDuration 则逐段重选拆短。
//   mix=true → 两条 guide line 在每和弦内前后半交替(alternating 时左右轮换 + fixConvergingLines 防汇合)。
//
// 只依赖 improCore 的 Chord/ChordPart getter(全现成),improCore 不改。
// 经 scripts/compare-improvisor-guidetone-oracle.ts 对照编译的 IMP GuideLineGenerator 验证。
// ============================================================

import type { Chord } from '../improCore/engine/chord';
import type { ChordPart } from '../improCore/engine/chordpart';
import type { SlotNote } from '../improCore/engine/lickgen';

const OCTAVE = 12;
export const ASCENDING = 1, NOPREFERENCE = 0, DESCENDING = -1;
const HIGHER = 1, LOWER = -1, SAME = 0;
const NOCHANGE = -2;
const IN_RANGE = 0, BELOW_RANGE = -1, ABOVE_RANGE = 1;
const HALF_STEP = 1, SAME_NOTE = 0;
const LINE_ONE = 1, LINE_TWO = 2;
const DISALLOW_SAME = true, SAME_OKAY = false;
const REST = -1;
const SAME_SCORE_MAX = Number.MAX_SAFE_INTEGER;

// 评分表(逐字对应 GuideLineGenerator.java)
// distance: same / half / whole / m3 / M3 / tritone
const DISTANCE_SCORES = [1, 1, 1, 2, 2, 3];
// direction[dir+1][cmp+1]:DESCENDING/NOPREF/ASCENDING × down/same/up
const DIRECTION_SCORES = [
    [0, 0, 1],  // DESCENDING:逆(up)罚 1
    [0, 0, 0],  // NOPREFERENCE
    [1, 0, 0],  // ASCENDING:逆(down)罚 1
];

const cmp = (a: number, b: number): number => (a > b ? HIGHER : b > a ? LOWER : SAME);
const mod = (m: number): number => ((m % OCTAVE) + OCTAVE) % OCTAVE;

export interface GuideLineParams {
    /** 方向:ASCENDING/DESCENDING/NOPREFERENCE */
    direction?: number;
    /** 线 1 起始音级(相对和弦根的度数,如 '1''3''5''7';默认 '3') */
    startDegree?: string;
    /** 线 2 起始音级(mix 时用;默认 '7') */
    startDegree2?: string;
    /** 是否允许色彩音 */
    allowColor?: boolean;
    /** 音域 */
    lowLimit?: number;
    highLimit?: number;
    /** 单音最长时值(slot);超过则拆。<=0/省略=不拆 */
    maxDuration?: number;
    /** 双线 mix(true=两条 guide line 交替,false=单线) */
    mix?: boolean;
    /** alternating(/\/\ vs ////);mix 时左右轮换 */
    alternating?: boolean;
    /** 始终禁止同音(IMP alwaysDisallowSame) */
    alwaysDisallowSame?: boolean;
    /** contour 字符串("1"=升 "0"=降),长度 ≥ 和弦数-1 时启用 */
    contour?: string;
    /** 平手规则:true=原始列表序(score+priority 平手后取候选列表第一,= IMP 的平手【方法】);
     *  false(默认)=音乐性规则(平手后①靠近下个和弦根音 ②夹在前后中点)。
     *  注:因我们 Chord.getColor() 排序≠IMP 和弦字典,true 也非 IMP 逐音等同,仅供 A/B 试听。 */
    impTiebreak?: boolean;
}

// 度数名 → 相对根音半音(支持 b/#;guide tone 常用 1/3/5/7)
const DEGREE_SEMI: Record<string, number> = {
    '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11,
    '9': 2, '11': 5, '13': 9,
};
function degreeToSemi(deg: string): number {
    let s = deg, adj = 0;
    while (s[0] === 'b' || s[0] === '#') { adj += s[0] === 'b' ? -1 : 1; s = s.slice(1); }
    return (DEGREE_SEMI[s] ?? 0) + adj;
}

/** 内部生成器状态(闭包持有可变 direction1/2 + contourIndex,镜像 IMP 实例字段)。 */
interface Gen {
    cp: ChordPart;
    originalDirection: number;
    direction1: number;
    direction2: number;
    startDegree1: string;
    startDegree2: string;
    alternating: boolean;
    mix: boolean;
    lowLimit: number;
    highLimit: number;
    maxDuration: number;
    durationSpecified: boolean;
    allowColor: boolean;
    alwaysDisallowSame: boolean;
    contour: number[];
    contourBased: boolean;
    contourIndex: number;
    impTiebreak: boolean;
}

type GNote = { pitch: number; dur: number; rest: boolean };

const chordTonePCs = (g: Gen, chord: Chord): number[] => {
    const pcs = chord.getSpellMIDIarray().map(mod);
    if (g.allowColor) pcs.push(...chord.getColorMIDIarray().map(mod));
    return pcs;
};
const priorityPCs = (chord: Chord): number[] => chord.getPriorityMIDIarray().map(mod);
const getDir = (g: Gen, line: number): number => (line === LINE_ONE ? g.direction1 : g.direction2);
const setDir = (g: Gen, line: number, d: number): void => { if (line === LINE_ONE) g.direction1 = d; else g.direction2 = d; };

function inRange(g: Gen, n: number): number {
    if (n > g.highLimit) return ABOVE_RANGE;
    if (n < g.lowLimit) return BELOW_RANGE;
    return IN_RANGE;
}

/** 与 next 同 pitch-class、离 prevPitch 最近的音(三全音平手按 line 方向,NOPREF→上);末尾硬卡音域(±八度一次)。 */
function getClosest(g: Gen, prevPitch: number, nextPc: number, line: number): number {
    const prevMod = mod(prevPitch);
    const nextMod = nextPc;
    const compareMods = cmp(nextMod, prevMod);
    const dist1 = Math.abs(prevMod - nextMod);
    const dist2 = OCTAVE - dist1;
    const compareDists = cmp(dist2, dist1);
    let pitch = prevPitch;
    if (compareDists === HIGHER) {            // dist2>dist1 → 用 dist1
        if (compareMods === HIGHER) pitch += dist1;
        else if (compareMods === LOWER) pitch -= dist1;
    } else if (compareDists === LOWER) {      // dist1>dist2 → 用 dist2
        if (compareMods === HIGHER) pitch -= dist2;
        else if (compareMods === LOWER) pitch += dist2;
    } else {                                  // 三全音:按方向平手
        const d = getDir(g, line);
        if (d === DESCENDING) pitch -= dist1; else pitch += dist1; // ASC/NOPREF → 上
    }
    if (pitch < 0) pitch = prevPitch;
    const ir = inRange(g, pitch);
    if (ir === ABOVE_RANGE) pitch -= OCTAVE;
    else if (ir === BELOW_RANGE) pitch += OCTAVE;
    return pitch;
}

function distanceScore(g: Gen, prevPitch: number, nextPitch: number, disallowSame: boolean): number {
    const dist = Math.abs(prevPitch - nextPitch);
    const last = DISTANCE_SCORES.length - 1;
    if (dist >= 0 && dist <= last) {
        if (dist === SAME_NOTE) return (disallowSame || g.alwaysDisallowSame) ? SAME_SCORE_MAX : DISTANCE_SCORES[dist]!;
        return DISTANCE_SCORES[dist]!;
    }
    return DISTANCE_SCORES[last]!;
}
function directionScore(g: Gen, prevPitch: number, nextPitch: number, line: number): number {
    return DIRECTION_SCORES[getDir(g, line) + 1]![cmp(nextPitch, prevPitch) + 1]!;
}
function scoreOf(g: Gen, prevPitch: number, nextPitch: number, line: number, disallowSame: boolean): number {
    const ds = distanceScore(g, prevPitch, nextPitch, disallowSame);
    if (ds === SAME_SCORE_MAX) return ds;     // 防溢出(IMP 注:此时 directionScore 必为 0)
    return directionScore(g, prevPitch, nextPitch, line) + ds;
}
/** priority 列表里 pc 的索引;不在(色彩音)→ 列表长度(最差)。 */
function priorityScore(chord: Chord, pc: number): number {
    const pri = priorityPCs(chord);
    const idx = pri.indexOf(pc);
    return idx < 0 ? pri.length : idx;
}

// pc 环形距离(0..6):a、b 两个 pitch-class 之间最近的半音数
function circularPcDist(a: number, b: number): number { const d = mod(a - b); return Math.min(d, OCTAVE - d); }
// pc 放到离 ref 最近的那个八度(返回具体音高)
function nearestPitchOfPc(pc: number, ref: number): number {
    let delta = mod(pc - mod(ref)); if (delta > 6) delta -= OCTAVE; return ref + delta;
}

// bestNote:score(dir+dist)最低 → priority 最高(列表索引最小)→ 仍并列时改用音乐性平手:
//   ① 离「下个和弦根音」最近(pc 环形距离)② 仍并列 → 离「上一音↔下个根音」中点最近 ③ 再并列回退列表顺序。
//   nextRootPc==null(末和弦)→ ①② 退化为 0,完全回退 priority + 列表顺序(= IMP 忠实兜底)。
//   注:这是为 GuideTone 有意加的音乐性规则(用户指定),非 IMP 原版"取列表第一"。
function bestNote(g: Gen, prevPitch: number, candidates: number[], chord: Chord, line: number, disallowSame: boolean, nextRootPc: number | null): number {
    const midpoint = nextRootPc === null ? prevPitch : (prevPitch + nearestPitchOfPc(nextRootPc, prevPitch)) / 2;
    // impTiebreak=true → 关掉 ①② 音乐性平手,退回纯 IMP(score+priority 平手后取列表第一)。
    const musical = !g.impTiebreak && nextRootPc !== null;
    const keyOf = (cand: number, idx: number): number[] => [
        scoreOf(g, prevPitch, cand, line, disallowSame),
        priorityScore(chord, mod(cand)),
        musical ? circularPcDist(mod(cand), nextRootPc!) : 0,   // ① 靠近下个和弦根音
        musical ? Math.abs(cand - midpoint) : 0,                // ② 夹在前后中点
        idx,                                                    // ③ 列表顺序兜底(IMP 平手即此)
    ];
    let best = candidates[0]!, bestKey = keyOf(best, 0);
    for (let i = 1; i < candidates.length; i++) {
        const k = keyOf(candidates[i]!, i);
        for (let j = 0; j < k.length; j++) { if (k[j]! < bestKey[j]!) { best = candidates[i]!; bestKey = k; break; } if (k[j]! > bestKey[j]!) break; }
    }
    return best;
}

function middleOfRange(g: Gen): number { return g.lowLimit + Math.floor((g.highLimit - g.lowLimit) / 2); }
function closestBelowMiddle(g: Gen, pc: number): number { let p = middleOfRange(g); while (mod(p) !== pc) p--; return p; }
function closestAboveMiddle(g: Gen, pc: number): number { let p = middleOfRange(g); while (mod(p) !== pc) p++; return p; }

/** 把 pc 放到音域中部最近的八度:升→偏下、降→偏上、无偏好→最近(平手取上)。 */
function closestToMiddle(g: Gen, pc: number, line: number): number {
    const dir = getDir(g, line);
    const below = closestBelowMiddle(g, pc), belowIn = inRange(g, below) === IN_RANGE;
    const above = closestAboveMiddle(g, pc), aboveIn = inRange(g, above) === IN_RANGE;
    if (dir === ASCENDING) return belowIn ? below : above;
    if (dir === DESCENDING) return aboveIn ? above : below;
    if (belowIn && aboveIn) {
        const m = middleOfRange(g);
        return (m - below) < (above - m) ? below : above;
    }
    return belowIn ? below : above;
}

/** 段首音:取 startDegree 的音;非和弦/色彩音 → 改最高 priority;再 closestToMiddle。NOCHORD → 休止。 */
function firstNote(g: Gen, chord: Chord, start: string, line: number, dur: number): GNote {
    if (chord.isNOCHORD()) return { pitch: REST, dur, rest: true };
    let pc = mod(chord.getRootSemitones() + degreeToSemi(start));
    const spell = chord.getSpellMIDIarray().map(mod);
    const color = chord.getColorMIDIarray().map(mod);
    const isChord = spell.includes(pc);
    if (!isChord) {
        if (g.allowColor) { if (!color.includes(pc)) pc = priorityPCs(chord)[0] ?? pc; }
        else pc = priorityPCs(chord)[0] ?? pc;
    }
    return { pitch: closestToMiddle(g, pc, line), dur, rest: false };
}

/** 下一音:NOCHORD→休止;前音是休止→firstNote;否则在 closestChordTones 里评分选最佳。
 *  nextRootPc = 下个和弦根音 pc(供 bestNote 音乐性平手;末和弦传 null)。 */
function nextNote(g: Gen, prev: GNote, chord: Chord, line: number, dur: number, disallowSame: boolean, nextRootPc: number | null): GNote {
    if (chord.isNOCHORD()) return { pitch: REST, dur, rest: true };
    if (prev.rest) return firstNote(g, chord, line === LINE_ONE ? g.startDegree1 : g.startDegree2, line, dur);
    const candidates = chordTonePCs(g, chord).map(pc => getClosest(g, prev.pitch, pc, line));
    return { pitch: bestNote(g, prev.pitch, candidates, chord, line, disallowSame, nextRootPc), dur, rest: false };
}

/** 撞音域边缘(半步内)则反向;contour 模式按 contour 串取方向。 */
function possibleDirectionSwitch(g: Gen, n: GNote, line: number): void {
    let newDir: number;
    if (!g.contourBased) {
        if (Math.abs(n.pitch - g.lowLimit) <= HALF_STEP) newDir = ASCENDING;
        else if (Math.abs(n.pitch - g.highLimit) <= HALF_STEP) newDir = DESCENDING;
        else newDir = NOCHANGE;
    } else {
        newDir = g.contourIndex < g.contour.length ? g.contour[g.contourIndex++]! : NOCHANGE;
    }
    if (newDir !== NOCHANGE) setDir(g, line, newDir);
}

function splitUp(g: Gen, dur: number): number[] {
    const out: number[] = [];
    let rem = dur;
    for (; rem > g.maxDuration; rem -= g.maxDuration) out.push(g.maxDuration);
    out.push(rem);
    return out;
}
/** 时值超 maxDuration → 拆段:首段同音,后续逐段 nextNote(DISALLOW_SAME)+ 可能反向。 */
function notesToAdd(g: Gen, note: GNote, chord: Chord, line: number, nextRootPc: number | null): GNote[] {
    const durs = splitUp(g, note.dur);
    const out: GNote[] = [{ pitch: note.pitch, dur: durs.shift()!, rest: note.rest }];
    let prev = out[0]!;
    for (const d of durs) {
        const nn = nextNote(g, prev, chord, line, d, DISALLOW_SAME, nextRootPc);
        out.push(nn); prev = nn;
        possibleDirectionSwitch(g, nn, line);
    }
    return out;
}

/** 下个和弦的根音 pc(供 bestNote 音乐性平手);无下一和弦或 NOCHORD → null。 */
function nextRootPcAt(g: Gen, s: number): number | null {
    const spans = g.cp.getSpans();
    const nxt = spans[s + 1]?.chord;
    if (!nxt || nxt.isNOCHORD()) return null;
    return mod(nxt.getRootSemitones());
}

/** 单线(mix=false)。 */
function oneGuideLine(g: Gen): GNote[] {
    const spans = g.cp.getSpans();
    const out: GNote[] = [];
    let prev: GNote = { pitch: REST, dur: 0, rest: true };
    for (let s = 0; s < spans.length; s++) {
        const chord = spans[s]!.chord;
        const dur = spans[s]!.end - spans[s]!.start;
        const nextRoot = nextRootPcAt(g, s);
        let note: GNote;
        if (s === 0) { g.direction1 = g.originalDirection; note = firstNote(g, chord, g.startDegree1, LINE_ONE, dur); }
        else note = nextNote(g, prev, chord, LINE_ONE, dur, SAME_OKAY, nextRoot);
        if (g.durationSpecified && !note.rest && note.dur > g.maxDuration) {
            const parts = notesToAdd(g, note, chord, LINE_ONE, nextRoot);
            out.push(...parts); prev = parts[parts.length - 1]!;
        } else { out.push(note); possibleDirectionSwitch(g, note, LINE_ONE); prev = note; }
    }
    return out;
}

/** 双线 mix:每和弦前后半 = 两条线(alternating 时左右轮换),fixConvergingLines 防汇合。 */
function twoGuideLine(g: Gen): GNote[] {
    const spans = g.cp.getSpans();
    const out: GNote[] = [];
    let prev1: GNote = { pitch: REST, dur: 0, rest: true };
    let prev2: GNote = { pitch: REST, dur: 0, rest: true };
    let threeFirst = true;
    for (let s = 0; s < spans.length; s++) {
        const chord = spans[s]!.chord;
        const half = Math.floor((spans[s]!.end - spans[s]!.start) / 2);
        const nextRoot = nextRootPcAt(g, s);
        let n1: GNote, n2: GNote;
        if (s === 0) {
            threeFirst = true; g.direction1 = g.originalDirection; g.direction2 = g.originalDirection;
            n1 = firstNote(g, chord, g.startDegree1, LINE_ONE, half);
            n2 = firstNote(g, chord, g.startDegree2, LINE_TWO, half);
        } else {
            n1 = nextNote(g, prev1, chord, LINE_ONE, half, SAME_OKAY, nextRoot);
            n2 = nextNote(g, prev2, chord, LINE_TWO, half, SAME_OKAY, nextRoot);
        }
        const tooLong1 = g.durationSpecified && !n1.rest && n1.dur > g.maxDuration;
        const tooLong2 = g.durationSpecified && !n2.rest && n2.dur > g.maxDuration;
        const addLine = (n: GNote, line: number, tooLong: boolean): GNote => {
            if (tooLong) { const parts = notesToAdd(g, n, chord, line, nextRoot); out.push(...parts); return parts[parts.length - 1]!; }
            out.push(n); possibleDirectionSwitch(g, n, line); return n;
        };
        if (tooLong1 || tooLong2) {
            if (threeFirst) { prev1 = addLine(n1, LINE_ONE, tooLong1); prev2 = addLine(n2, LINE_TWO, tooLong2); }
            else { prev2 = addLine(n2, LINE_TWO, tooLong2); prev1 = addLine(n1, LINE_ONE, tooLong1); }
        } else {
            if (threeFirst) { out.push(n1); out.push(n2); } else { out.push(n2); out.push(n1); }
            prev1 = n1; prev2 = n2;
            possibleDirectionSwitch(g, n1, LINE_ONE);
            possibleDirectionSwitch(g, n2, LINE_TWO);
        }
        if (prev1.pitch === prev2.pitch && g.direction1 === g.direction2) { g.direction1 = ASCENDING; g.direction2 = DESCENDING; } // fixConverging
        if (g.alternating) threeFirst = !threeFirst;
    }
    return out;
}

/**
 * Guide Tone 线生成器。返回 SlotNote[](slot 时基)。忠实 IMP GuideLineGenerator.makeGuideLine。
 */
export function makeGuideLine(cp: ChordPart, params: GuideLineParams = {}): SlotNote[] {
    const direction = params.direction ?? NOPREFERENCE;
    const maxDuration = params.maxDuration ?? 0;
    const contourStr = params.contour ?? '';
    const numChords = cp.getSpans().length;
    const useContour = contourStr.length >= Math.max(0, numChords - 1) && contourStr.length > 0;
    const g: Gen = {
        cp,
        originalDirection: direction, direction1: direction, direction2: direction,
        startDegree1: params.startDegree ?? '3',
        startDegree2: params.startDegree2 ?? '7',
        alternating: params.alternating ?? false,
        mix: params.mix ?? false,
        lowLimit: params.lowLimit ?? 55,
        highLimit: params.highLimit ?? 84,
        maxDuration,
        durationSpecified: maxDuration > 0,
        allowColor: params.allowColor ?? true,
        alwaysDisallowSame: params.alwaysDisallowSame ?? false,
        contour: useContour ? Array.from(contourStr).map(c => (c === '1' ? ASCENDING : DESCENDING)) : [],
        contourBased: useContour,
        contourIndex: useContour ? 0 : -1,
        impTiebreak: params.impTiebreak ?? false,
    };
    const line = g.mix ? twoGuideLine(g) : oneGuideLine(g);
    // GNote[] → SlotNote[](累加 startSlot)
    const out: SlotNote[] = [];
    let pos = 0;
    for (const n of line) {
        out.push({ pitch: n.rest ? REST : n.pitch, startSlot: pos, durationSlots: n.dur, velocity: 88 });
        pos += n.dur;
    }
    return out;
}
