// ============================================================
// motifCore — Fractal / Divide 细分(Impro-Visor Fractal.java 移植)
// ============================================================
//
// 忠实移植 Impro-Visor 的 fractal/Fractal.java。Divide 后处理:把一条旋律
// (GuideTone 骨架 / Grammar lick)递归概率细分成更活跃的线。
//
// 算法本质(逐音概率细分):
//   遍历每个音,按其时值查"细分概率",随机决定:
//     - 不分:保留原音(并按"休止概率"可能变休止)
//     - 二分:切成两半,后半音高 = (本音 + 下一音)/2 插值
//     - 三分:切成三段,音高在本音→下一音之间 1/3、2/3 插值
//   近距离音(<3 半音)走 getCloseNotes(交替邻音)。
//   太短的音(≤ THIRTYSECOND)不再分。可迭代 numTimes 次(分形)。
//
// 音高插值产生的细分音不保证贴和声 → 由调用方在 Fractal 后接遮罩/rectify 兜底
// (与 Transform 后处理同理)。纯 SlotNote 几何操作,不依赖 improCore 逻辑。
// ============================================================

import { WHOLE, HALF, QUARTER, EIGHTH, SIXTEENTH, THIRTYSECOND } from '../improCore/engine/constants';
import type { SlotNote } from '../improCore/engine/lickgen';

export interface FractalParams {
    /** 迭代次数(分形深度),默认 1 */
    numTimes?: number;
    /** 三连音概率 */
    tripletProb?: number;
    /** 各时值的"细分概率"(随机 < 此值才分) */
    divProb?: { whole?: number; half?: number; quarter?: number; eighth?: number; sixteenth?: number; default?: number };
    /** 各时值的"变休止概率"(不分时,随机 < 此值变休止) */
    restProb?: { whole?: number; half?: number; quarter?: number; eighth?: number; sixteenth?: number; default?: number };
}

const DEFAULT_DIV = { whole: 0.9, half: 0.8, quarter: 0.6, eighth: 0.4, sixteenth: 0.2, default: 0.5 };
const DEFAULT_REST = { whole: 0.05, half: 0.05, quarter: 0.05, eighth: 0.05, sixteenth: 0.05, default: 0.05 };

const REST = -1;

function probFor(dur: number, table: Required<NonNullable<FractalParams['divProb']>>): number {
    switch (dur) {
        case WHOLE: return table.whole;
        case HALF: return table.half;
        case QUARTER: return table.quarter;
        case EIGHTH: return table.eighth;
        case SIXTEENTH: return table.sixteenth;
        default: return table.default;
    }
}

const dist = (a: number, b: number): number => Math.abs(a - b);

/** 近距离音(<3 半音):切两半,后半交替邻音(同音则随机 ±2)*/
function closeNotes(first: SlotNote, second: SlotNote): SlotNote[] {
    const half = Math.floor(first.durationSlots / 2);
    let diff = first.pitch - second.pitch;
    if (first.pitch === second.pitch) diff = Math.random() < 0.5 ? 2 : -2;
    return [
        { ...first, durationSlots: half },
        { pitch: first.pitch - diff, startSlot: first.startSlot + half, durationSlots: first.durationSlots - half, velocity: first.velocity },
    ];
}

/** 二分:本音 + 中点插值 */
function splitTwo(first: SlotNote, second: SlotNote): SlotNote[] {
    const sp = second.pitch === REST ? first.pitch + 2 : second.pitch;
    const avg = Math.round((first.pitch + sp) / 2);
    const h = Math.floor(first.durationSlots / 2);
    return [
        { ...first, durationSlots: h },
        { pitch: avg, startSlot: first.startSlot + h, durationSlots: first.durationSlots - h, velocity: first.velocity },
    ];
}

/** 三分:本音 + 1/3、2/3 插值 */
function splitThree(first: SlotNote, second: SlotNote): SlotNote[] {
    const sp = second.pitch === REST ? first.pitch + 3 : second.pitch;
    const p3 = first.pitch + Math.round((sp - first.pitch) / 3);
    const p4 = first.pitch + Math.round(((sp - first.pitch) * 2) / 3);
    const t = Math.floor(first.durationSlots / 3);
    const s0 = first.startSlot;
    return [
        { ...first, durationSlots: t },
        { pitch: p3, startSlot: s0 + t, durationSlots: t, velocity: first.velocity },
        { pitch: p4, startSlot: s0 + 2 * t, durationSlots: first.durationSlots - 2 * t, velocity: first.velocity },
    ];
}

/**
 * Fractal 细分一条旋律。返回新 SlotNote[](slot 已重新顺排)。
 */
export function fractalDivide(notes: SlotNote[], params: FractalParams = {}): SlotNote[] {
    const numTimes = params.numTimes ?? 1;
    const tripletProb = params.tripletProb ?? 0.2;
    const div = { ...DEFAULT_DIV, ...params.divProb };
    const rest = { ...DEFAULT_REST, ...params.restProb };

    let cur = notes.map(n => ({ ...n }));

    for (let iter = 0; iter < numTimes; iter++) {
        const next: SlotNote[] = [];
        let prevRest = true;
        for (let i = 0; i < cur.length; i++) {
            const first = cur[i]!;
            const second = cur[i + 1] ?? first;
            const rv = first.durationSlots;

            if (first.pitch === REST || rv <= THIRTYSECOND) {
                next.push(first);
                prevRest = first.pitch === REST;
                continue;
            }

            const probability = probFor(rv, div);
            if (Math.random() > probability) {
                // 不分:可能变休止(前音是休止时用 whole 的休止概率)
                const rp = prevRest ? rest.whole : probFor(rv, rest);
                if (Math.random() < rp) next.push({ pitch: REST, startSlot: first.startSlot, durationSlots: rv });
                else next.push(first);
                prevRest = next[next.length - 1]!.pitch === REST;
            } else {
                // 分:近距离 → closeNotes;否则按三连音概率二/三分
                let pieces: SlotNote[];
                if (dist(first.pitch, second.pitch) < 3) pieces = closeNotes(first, second);
                else if (Math.random() < tripletProb) pieces = splitThree(first, second);
                else pieces = splitTwo(first, second);
                next.push(...pieces);
                prevRest = false;
            }
        }
        cur = next;
    }

    // 重排 startSlot(细分可能产生整除余数累积),保持连续
    let t = notes.length ? notes[0]!.startSlot : 0;
    for (const n of cur) { n.startSlot = t; t += n.durationSlots; }
    return cur;
}
