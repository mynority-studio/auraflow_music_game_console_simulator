// ============================================================
// ImproCore engine — LickGen(抽象旋律 → 具体音高)
// imp/lickgen/LickGen.java + NoteChooser.java 生成路径的忠实移植
// ============================================================
//
// 把 grammar 产出的抽象 token 流(C8 / (X 1 8) / (slope …) / R8 …)+ 和弦上下文
// 变成具体 MIDI 音符:
//   - 普通音(C/L/S/N 等):getRandomNote 风格 —— 窗口 [old±maxInterval] 内挑该 type 合法音
//   - slope:NoteChooser 概率表 —— 窗口 [old+lo, old+hi] 内按 chord/color/random/scale 分布选音
//   - scaleDegree (X deg dur):makeRelativeNote —— 60 + rootSemitones + per-family diatonic 偏移
//   - R 休止;A approach;Y outside
//
// 简化(已记录):GOAL_PROB=0(GOAL 永不触发,跳过);getRandomNote 的 per-section 概率
//   表用均匀随机替代;SCALE 音阶约束暂缺(checkNote SCALE→true,Phase 3.5 补音阶);
//   triadic(2 grammar)暂作休止;无 syncopation/expectancy/approach-target 复杂分支。
// ============================================================

import { CMIDI, OCTAVE, REST } from './constants';
import { getDuration as durationOf } from './duration';
import {
    type GVal, type GList, isGList, gSecond, gThird,
    isScaleDegree, isSlope, isTriadic, getDuration,
} from './terminals';
import type { Chord } from './chord';
import type { ChordPart } from './chordpart';

// 类型 sentinel(= NoteChooser/LickGen 常量值)
const NOTE = 1000, CHORD = 1001, SCALE = 1002, COLOR = 1003,
    APPROACH = 1004, RANDOM = 1005, OUTSIDE = 1008;

const MIN_JUMP_UPPER_BOUND = 6;

// 抽象音首字母 → 类型(Terminals.java:A 接近/C 和弦/H 帮助/L 色彩/R 休止/S 音阶/X 任意/Y 外)
const LETTER_TYPE: Record<string, number> = {
    C: CHORD, L: COLOR, S: SCALE, A: APPROACH, R: REST, Y: OUTSIDE,
    X: RANDOM, H: NOTE, N: NOTE, G: CHORD, B: CHORD, E: NOTE,
};

export interface SlotNote {
    pitch: number;          // < 0 = 休止
    startSlot: number;
    durationSlots: number;
    velocity?: number;
}

export interface LickGenParams {
    minPitch: number;
    maxPitch: number;
    minInterval: number;
    maxInterval: number;
}

export const DEFAULT_PARAMS: LickGenParams = {
    minPitch: 58, maxPitch: 82, minInterval: 0, maxInterval: 6,
};

/** 从 grammar 的 (parameter …) Map 取 LickGen 参数 —— 忠实 IMP:每条 grammar 用自己的音域/音程,
 *  而非全局写死(默认值恰好=MilesDavis,导致其它 grammar 误用 MilesDavis 音域)。缺项回退默认。
 *  注:chord/color/scale-tone-weight、rest/leap-prob、min/max-duration 属 IMP 非 grammar 的
 *  fillMelody 路(NoteChooser 用固定表,已 oracle 验证),grammar-realize 路不消费 → 此处不取。 */
export function lickGenParamsFrom(params: ReadonlyMap<string, unknown>): LickGenParams {
    const num = (key: string, dflt: number): number => {
        const v = params.get(key);                          // ROM grammar 存字符串,fromText 存 number → 都兼容
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        return Number.isFinite(n) ? n : dflt;
    };
    return {
        minPitch: num('min-pitch', DEFAULT_PARAMS.minPitch),
        maxPitch: num('max-pitch', DEFAULT_PARAMS.maxPitch),
        minInterval: num('min-interval', DEFAULT_PARAMS.minInterval),
        maxInterval: num('max-interval', DEFAULT_PARAMS.maxInterval),
    };
}

// ------------------------------------------------------------
// per-family diatonic 级(1-7)→ 半音偏移(LickGen.makeRelativeNote 内联表)
// 下标 = 级数(1-7);级 1 → 0
// ------------------------------------------------------------
const DIATONIC: Record<string, number[]> = {
    major:             [0, 0, 2, 4, 5, 7, 9, 11],
    minor:             [0, 0, 2, 3, 5, 7, 9, 11],
    minor7:            [0, 0, 2, 3, 5, 7, 9, 10],
    dominant:          [0, 0, 2, 4, 5, 7, 9, 10],
    'half-diminished': [0, 0, 2, 3, 5, 7, 9, 10],
    diminished:        [0, 0, 2, 3, 5, 6, 8, 9],
    augmented:         [0, 0, 2, 4, 5, 8, 9, 10],
};

const randInt = (n: number): number => Math.floor(Math.random() * n);

function parseNote(str: string): { type: number; duration: number } {
    const type = LETTER_TYPE[str.charAt(0)] ?? NOTE;
    return { type, duration: durationOf(str.substring(1)) };
}

/** 折叠到音域内 */
function octaveFold(pitch: number, minPitch: number, maxPitch: number): number {
    while (pitch > maxPitch) pitch -= OCTAVE;
    while (pitch < minPitch) pitch += OCTAVE;
    return pitch;
}

// ------------------------------------------------------------
// 音分类:checkNote / getNoteTypes
// ------------------------------------------------------------

/** 某 pitch 是否当前和弦的指定 type 合法音(LickGen.checkNote) */
function checkNote(chord: Chord | null, pitch: number, type: number): boolean {
    if (!chord || chord.isNOCHORD()) return true;
    const pc = ((pitch % 12) + 12) % 12;
    switch (type) {
        case CHORD:
            return chord.getSpell().some(ns => ns.getSemitones() === pc);
        case COLOR:
            return chord.getColor().some(ns => ns.getSemitones() === pc);
        case SCALE: {
            const sc = chord.getFirstScalePCs();      // Phase 6:吸附到和弦音阶
            return sc ? sc.includes(pc) : true;        // 无音阶 → 任意(faithful)
        }
        case NOTE:
            return true;
        default:
            return true;
    }
}

/** 窗口内每个 pitch 分类为 CHORD/COLOR/RANDOM(LickGen.getNoteTypes) */
function getNoteTypes(chord: Chord | null, low: number, high: number): number[] {
    const out: number[] = [];
    for (let p = low; p <= high; p++) {
        if (checkNote(chord, p, CHORD)) out.push(CHORD);
        else if (checkNote(chord, p, COLOR)) out.push(COLOR);
        else out.push(RANDOM);
    }
    return out;
}

/** [chord, color, random, scale=chord+color] 计数 */
function countTypes(noteTypes: number[]): number[] {
    const n = [0, 0, 0, 0];
    for (const t of noteTypes) {
        if (t === CHORD) { n[0]!++; n[3]!++; }
        else if (t === COLOR) { n[1]!++; n[3]!++; }
        else n[2]!++;
    }
    return n;
}

// ------------------------------------------------------------
// NoteChooser 概率表(slope 路径用)
// 键 "type-haveC-haveL-haveR" → [pChord, pColor, pRandom, pScale]
// ------------------------------------------------------------
const PROB_TABLE: ReadonlyMap<string, number[]> = new Map([
    ['0-1-1-1', [100, 0, 0, 0]], ['0-1-1-0', [100, 0, 0, 0]], ['0-1-0-1', [100, 0, 0, 0]],
    ['0-1-0-0', [100, 0, 0, 0]], ['0-0-1-1', [0, 100, 0, 0]], ['0-0-1-0', [0, 100, 0, 0]],
    ['0-0-0-1', [0, 0, 100, 0]],
    ['1-1-1-1', [0, 100, 0, 0]], ['1-1-1-0', [10, 90, 0, 0]], ['1-1-0-1', [85, 0, 15, 0]],
    ['1-1-0-0', [100, 0, 0, 0]], ['1-0-1-1', [0, 100, 0, 0]], ['1-0-1-0', [0, 100, 0, 0]],
    ['1-0-0-1', [0, 0, 100, 0]],
    ['3-1-1-1', [0, 0, 0, 100]], ['3-1-1-0', [0, 0, 0, 100]], ['3-1-0-1', [0, 0, 0, 100]],
    ['3-1-0-0', [0, 0, 0, 100]], ['3-0-1-1', [0, 0, 0, 100]], ['3-0-1-0', [0, 0, 0, 100]],
    ['3-0-0-1', [0, 0, 100, 0]],
    ['2-1-1-1', [50, 25, 25, 0]], ['2-1-1-0', [80, 20, 0, 0]], ['2-1-0-1', [50, 0, 50, 0]],
    ['2-1-0-0', [100, 0, 0, 0]], ['2-0-1-1', [0, 50, 50, 0]], ['2-0-1-0', [0, 100, 0, 0]],
    ['2-0-0-1', [0, 0, 100, 0]],
]);
const TYPE_MAP = [CHORD, COLOR, RANDOM, SCALE];

function noteChooserGetNote(low: number, high: number, type: number, numTypes: number[], noteTypes: number[]): number {
    const t = type === CHORD ? 0 : type === COLOR ? 1 : type === RANDOM ? 2 : type === SCALE ? 3 : 2;
    const hC = numTypes[0] ? 1 : 0, hL = numTypes[1] ? 1 : 0, hR = numTypes[2] ? 1 : 0;
    const probs = PROB_TABLE.get(`${t}-${hC}-${hL}-${hR}`);
    if (!probs) return low + randInt(high - low + 1); // 无匹配行 → 窗口随机

    let r = randInt(100) + 1;
    let newType = 0;
    for (let i = 0; i < 4; i++) { r -= probs[i]!; if (r <= 0) { newType = i; break; } }

    if (numTypes[newType] === 0) return low + randInt(high - low + 1); // 该类型无音 → 兜底
    let r2 = randInt(numTypes[newType]!) + 1;
    let pitchdiff = 0;
    for (let i = 0; i < noteTypes.length; i++) {
        if (noteTypes[i] === TYPE_MAP[newType] || (newType === 3 && (noteTypes[i] === CHORD || noteTypes[i] === COLOR))) r2--;
        if (r2 <= 0) { pitchdiff = i; break; }
    }
    return low + pitchdiff;
}

/** slope 路径选音(LickGen.chooseNote,GOAL_PROB=0 已省 goal 分支) */
function chooseNote(
    pos: number, low: number, high: number, chordPart: ChordPart,
    type: number, lastPitch: number, minPitch: number, maxPitch: number,
): number {
    if (low === high) { if (low !== lastPitch + 1) low--; if (high !== lastPitch - 1) high++; }
    if (low - lastPitch >= MIN_JUMP_UPPER_BOUND) low -= MIN_JUMP_UPPER_BOUND / 2;
    if (high - lastPitch <= -MIN_JUMP_UPPER_BOUND) high += MIN_JUMP_UPPER_BOUND / 2;
    if (low > high && low > lastPitch) low = high;
    if (high < low && high < lastPitch) high = low;
    if (type === NOTE) type = SCALE;

    let chord = chordPart.getCurrentChord(pos);
    if (!chord || chord.isNOCHORD()) type = RANDOM;

    let noteTypes: number[] = [];
    let numTypes: number[] = [0, 0, 0, 0];
    for (let j = 0; j === 0 || (type === CHORD && j < 3 && numTypes[0] === 0); j++) {
        noteTypes = getNoteTypes(chord, low, high);
        numTypes = countTypes(noteTypes);
        if (type === CHORD && numTypes[0] === 0) {
            if (low !== lastPitch + 1) low--;
            if (high !== lastPitch - 1) high++;
        }
    }
    const pitch = noteChooserGetNote(low, high, type, numTypes, noteTypes);
    return octaveFold(pitch, minPitch, maxPitch);
}

/** 普通音选音(LickGen default 分支:窗口内挑该 type 合法音,均匀随机) */
function pickValidNote(
    chord: Chord | null, type: number, oldPitch: number,
    minInterval: number, maxInterval: number, minPitch: number, maxPitch: number,
): number {
    const low = Math.max(minPitch, oldPitch - maxInterval);
    const high = Math.min(maxPitch, oldPitch + maxInterval);
    const inMinZone = (p: number) => p > oldPitch - minInterval && p < oldPitch + minInterval;

    const valid: number[] = [];
    for (let p = low; p <= high; p++) if (!inMinZone(p) && checkNote(chord, p, type)) valid.push(p);
    if (valid.length > 0) return valid[randInt(valid.length)]!;

    const validAny: number[] = [];
    for (let p = low; p <= high; p++) if (checkNote(chord, p, type)) validAny.push(p);
    if (validAny.length > 0) return validAny[randInt(validAny.length)]!;

    if (high >= low) return low + randInt(high - low + 1);
    return oldPitch;
}

/** scaleDegree (X deg dur) → 具体音(LickGen.makeRelativeNote) */
export function makeRelativeNote(item: GList, chord: Chord): { pitch: number; duration: number } | null {
    let pitch = chord.getRootSemitones() + CMIDI;
    let degreeValue = 1;

    const second = gSecond(item);
    if (typeof second === 'number') {
        degreeValue = second;
    } else if (typeof second === 'string') {
        let s = second;
        while (s.length > 0 && (s.charAt(0) === 'b' || s.charAt(0) === '#')) {
            if (s.charAt(0) === 'b') pitch--; else pitch++;
            s = s.substring(1);
        }
        degreeValue = parseInt(s, 10);
        if (Number.isNaN(degreeValue)) return null;
    } else {
        return null;
    }

    let octaveAdj = 0;
    while (degreeValue < 0) { octaveAdj--; degreeValue += 8; }
    while (degreeValue > 7) { octaveAdj++; degreeValue -= 7; }

    const table = DIATONIC[chord.getFamily()] ?? DIATONIC.major!;
    pitch += table[degreeValue] ?? 0;
    pitch += octaveAdj * OCTAVE;

    const duration = durationOf(String(gThird(item) ?? '8'));
    if (duration <= 0) return null;
    return { pitch, duration };
}

// APPROACH(`A` 音)= 趋近/包围:落在目标音的上/下半音。忠实 IMP LickGen.fillMelody。
// 一般路径(LickGen.java:2322-2345):50/50 上下,但避开等于上一音(oldPitch)。
function generalApproachPitch(target: number, oldPitch: number): number {
    if (target + 1 === oldPitch) return target - 1;
    if (target - 1 === oldPitch) return target + 1;
    return Math.random() < 0.5 ? target + 1 : target - 1;
}
// slope 路径(LickGen.java:2069-2101):方向随 slope 轮廓正负;同样避开 oldPitch。
function slopeApproachPitch(target: number, oldPitch: number, lo: number, hi: number): number {
    if (target + 1 === oldPitch) return target - 1;
    if (target - 1 === oldPitch) return target + 1;
    if (lo === 0 || hi === 0) {
        if (hi > 0) return target - 1;
        if (lo < 0) return target + 1;
        return target - 1;                 // lo==hi==0 兜底(IMP 此处未定义,取下趋近)
    }
    if (lo > 0) return target - 1;         // 上行轮廓 → 从下方半音趋近
    if (hi < 0) return target + 1;         // 下行轮廓 → 从上方半音趋近
    return target - 1;
}

// ------------------------------------------------------------
// 主入口:抽象旋律 → 具体音符
// ------------------------------------------------------------
export function realize(abstractMelody: GList, chordPart: ChordPart, params: LickGenParams = DEFAULT_PARAMS): SlotNote[] {
    const { minPitch, maxPitch, minInterval, maxInterval } = params;
    const out: SlotNote[] = [];
    let position = 0;
    let oldPitch = octaveFold(Math.floor((minPitch + maxPitch) / 2) + randInt(7) - 3, minPitch, maxPitch);

    const emit = (pitch: number, dur: number) => {
        out.push({ pitch, startSlot: position, durationSlots: dur, velocity: 88 });
        position += dur;
    };
    const emitRest = (dur: number) => { out.push({ pitch: REST, startSlot: position, durationSlots: dur }); position += dur; };

    for (let i = 0; i < abstractMelody.length; i++) {
        const item = abstractMelody[i]!;
        // scaleDegree (X deg dur)
        if (isScaleDegree(item)) {
            const chord = chordPart.getCurrentChord(position);
            const dur = getDuration(item);
            if (!chord || chord.isNOCHORD()) { emitRest(dur); continue; }
            const note = makeRelativeNote(item as GList, chord);
            if (note) { const p = octaveFold(note.pitch, minPitch, maxPitch); emit(p, note.duration); oldPitch = p; }
            else emitRest(dur);
            continue;
        }

        // slope (slope lo hi T…)
        if (isSlope(item)) {
            const sl = item as GList;
            const lo = Number(sl[1]);
            const hi = Number(sl[2]);
            for (let k = 3; k < sl.length; k++) {
                const inner = sl[k];
                if (typeof inner !== 'string') continue;
                const { type, duration } = parseNote(inner);
                if (type === REST) { emitRest(duration); continue; }
                // slope 内 APPROACH:消费下一个 inner token 当 target(类型取自该 token),
                // A 落 target±半音(方向随 slope 轮廓),再依次发 approach + target。忠实 IMP slope/approach。
                if (type === APPROACH) {
                    const nextInner = sl[k + 1];
                    if (typeof nextInner === 'string') {
                        const tgt = parseNote(nextInner);
                        if (tgt.type !== REST) {
                            const targetPitch = chooseNote(position + duration, oldPitch + lo, oldPitch + hi, chordPart, tgt.type, oldPitch, minPitch, maxPitch);
                            emit(slopeApproachPitch(targetPitch, oldPitch, lo, hi), duration);
                            emit(targetPitch, tgt.duration); oldPitch = targetPitch;
                            k++;                              // 已消费 target
                            continue;
                        }
                    }
                    const pitch = chooseNote(position, oldPitch + lo, oldPitch + hi, chordPart, RANDOM, oldPitch, minPitch, maxPitch);
                    emit(pitch, duration); oldPitch = pitch;  // 无合法 target → 普通 slope 选音
                    continue;
                }
                const pitch = chooseNote(position, oldPitch + lo, oldPitch + hi, chordPart, type, oldPitch, minPitch, maxPitch);
                emit(pitch, duration); oldPitch = pitch;
            }
            continue;
        }

        // triadic(2 grammar):暂作休止
        if (isTriadic(item)) { emitRest(getDuration(item)); continue; }

        // 普通音(string)
        if (typeof item === 'string') {
            const { type, duration } = parseNote(item);
            if (type === REST) { emitRest(duration); continue; }
            const chord = chordPart.getCurrentChord(position);
            // 一般 APPROACH:消费下一个 token 当 target(强制和弦音,贴近上一音),A 落 target±半音(50/50,避开上一音),
            // 依次发 approach + target。忠实 IMP LickGen.fillMelody APPROACH 分支。
            if (type === APPROACH) {
                const next = abstractMelody[i + 1];
                if (typeof next === 'string') {
                    const tgt = parseNote(next);
                    if (tgt.type !== REST) {
                        const targetPitch = pickValidNote(chord, CHORD, oldPitch, minInterval, maxInterval, minPitch, maxPitch);
                        emit(generalApproachPitch(targetPitch, oldPitch), duration);
                        emit(targetPitch, tgt.duration); oldPitch = targetPitch;
                        i++;                                  // 已消费 target
                        continue;
                    }
                }
                const pitch = pickValidNote(chord, RANDOM, oldPitch, minInterval, maxInterval, minPitch, maxPitch);
                emit(pitch, duration); oldPitch = pitch;      // 下一个非普通音/末尾 → 退回随机音(IMP approach->random)
                continue;
            }
            const useType = (type === RANDOM || !chord || chord.isNOCHORD()) ? RANDOM : type;
            const pitch = pickValidNote(chord, useType, oldPitch, minInterval, maxInterval, minPitch, maxPitch);
            emit(pitch, duration); oldPitch = pitch;
            continue;
        }
        // 其它(wrapped 已在 grammar 内展开为 string)→ 跳过
    }
    return out;
}
