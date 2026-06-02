// ============================================================
// motifCore — Guide Tone 线生成(Impro-Visor GuideLineGenerator 移植)
// ============================================================
//
// 忠实移植 Impro-Visor 的 guidetone/GuideLineGenerator.java(单线路径)。
// 与 Grammar 路线互补:Grammar = 加权随机的 lick;GuideTone = 确定性、声部
// 进行平滑、100% 落和弦音/色彩音的「骨架线」。
//
// 算法本质(贪心评分选音器):
//   逐和弦,从「该和弦所有 chord(+可选 color)音」里选下一个音。
//   候选音先 octave-adjust 到离前音最近(getClosest),再按
//     score = directionScore + distanceScore   (越低越好)
//   平手用 priorityScore(和弦 priority 列表索引,色彩音排最后)tiebreak。
//   撞音域边缘则反向。和弦时值超 maxDuration 则拆短。
//
// 只依赖 improCore 的 Chord/ChordPart getter(全现成),improCore 不改。
// 输出 SlotNote[](与 grammar realize 同构,可共用下游发展层)。
// ============================================================

import type { Chord } from '../improCore/engine/chord';
import type { ChordPart } from '../improCore/engine/chordpart';
import type { SlotNote } from '../improCore/engine/lickgen';

const OCTAVE = 12;
export const ASCENDING = 1, NOPREFERENCE = 0, DESCENDING = -1;
const HIGHER = 1, LOWER = -1, SAME = 0;
const NOCHANGE = -2;

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
    /** 起始音级(相对和弦根的度数,如 '1''3''5''7';默认 '3' guide tone 经典) */
    startDegree?: string;
    /** 是否允许色彩音 */
    allowColor?: boolean;
    /** 音域 */
    lowLimit?: number;
    highLimit?: number;
    /** 单音最长时值(slot);超过则拆。0/省略=不拆 */
    maxDuration?: number;
}

interface GNote { pitch: number; dur: number; rest?: boolean }

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

/**
 * 单线 Guide Tone 生成器。返回 SlotNote[](slot 时基)。
 */
export function makeGuideLine(cp: ChordPart, params: GuideLineParams = {}): SlotNote[] {
    const direction0 = params.direction ?? NOPREFERENCE;
    const startDegree = params.startDegree ?? '3';
    const allowColor = params.allowColor ?? true;
    const lo = params.lowLimit ?? 55;
    const hi = params.highLimit ?? 84;
    const maxDur = params.maxDuration ?? 0;
    const mid = lo + Math.floor((hi - lo) / 2);

    let direction = direction0;

    // 某和弦的候选音池(chord +可选 color),返回 pitch-class 列表 + priority 索引
    const chordPCs = (ch: Chord): number[] => {
        const pcs = ch.getSpellMIDIarray().map(mod);
        if (allowColor) for (const c of ch.getColorMIDIarray().map(mod)) if (!pcs.includes(c)) pcs.push(c);
        return pcs;
    };
    const priorityIndex = (ch: Chord, pitch: number): number => {
        const pri = ch.getPriorityMIDIarray().map(mod);
        const i = pri.indexOf(mod(pitch));
        return i < 0 ? pri.length : i; // 不在 priority(色彩音)→ 最差
    };

    // 把某 pc 八度调整到离 prev 最近(getClosest)
    const getClosest = (prevPitch: number, pc: number): number => {
        const prevMod = mod(prevPitch), nextMod = pc;
        const cMods = cmp(nextMod, prevMod);
        const d1 = Math.abs(prevMod - nextMod);
        const d2 = OCTAVE - d1;
        const cDist = cmp(d2, d1);
        let pitch = prevPitch;
        if (cDist === HIGHER) {            // 用 d1
            if (cMods === HIGHER) pitch += d1; else if (cMods === LOWER) pitch -= d1;
        } else if (cDist === LOWER) {      // 用 d2
            if (cMods === HIGHER) pitch -= d2; else if (cMods === LOWER) pitch += d2;
        } else {                           // 三全音:按方向 tiebreak,默认上行
            pitch += direction === DESCENDING ? -d1 : d1;
        }
        if (pitch < 0) pitch = prevPitch;
        if (pitch > hi) pitch -= OCTAVE;
        else if (pitch < lo) pitch += OCTAVE;
        return pitch;
    };

    const distScore = (prev: number, next: number, disallowSame: boolean): number => {
        const d = Math.min(Math.abs(prev - next), 6); // 半音距,封顶到 tritone 索引
        if (d === 0) return disallowSame ? Number.MAX_SAFE_INTEGER : DISTANCE_SCORES[0]!;
        return DISTANCE_SCORES[d] ?? DISTANCE_SCORES[5]!;
    };
    const dirScore = (prev: number, next: number): number =>
        DIRECTION_SCORES[direction + 1]![cmp(next, prev) + 1]!;

    // 从候选里选最优(score 低优先,平手用 priority)
    const bestNote = (prevPitch: number, ch: Chord, disallowSame: boolean): number => {
        const cands = chordPCs(ch).map(pc => getClosest(prevPitch, pc));
        let best = cands[0]!, bestScore = dirScore(prevPitch, best) + distScore(prevPitch, best, disallowSame);
        for (const c of cands) {
            const sc = dirScore(prevPitch, c) + distScore(prevPitch, c, disallowSame);
            if (sc < bestScore) { bestScore = sc; best = c; }
            else if (sc === bestScore && priorityIndex(ch, c) < priorityIndex(ch, best)) best = c;
        }
        return best;
    };

    // 起始音:取 startDegree 在和弦上的音,折到音域中部附近
    const firstNote = (ch: Chord): number => {
        const root = ((ch.getRootSemitones() % 12) + 12) % 12;
        let pc = mod(root + degreeToSemi(startDegree));
        // 若该度数不在和弦/色彩音里,退化到最高优先级音
        const pool = chordPCs(ch);
        if (!pool.includes(pc)) { const pri = ch.getPriorityMIDIarray().map(mod); pc = pri[0] ?? pool[0] ?? pc; }
        // 折到中部
        let pitch = pc;
        while (pitch < mid - 6) pitch += OCTAVE;
        while (pitch > mid + 6) pitch -= OCTAVE;
        if (pitch < lo) pitch += OCTAVE; if (pitch > hi) pitch -= OCTAVE;
        return pitch;
    };

    // 撞边缘反向
    const maybeSwitchDirection = (pitch: number): void => {
        if (Math.abs(pitch - lo) <= 1) direction = ASCENDING;
        else if (Math.abs(pitch - hi) <= 1) direction = DESCENDING;
    };

    // --- 主循环:逐和弦段 ---
    const out: SlotNote[] = [];
    const spans = cp.getSpans();
    if (spans.length === 0) return out;

    let prevPitch = firstNote(spans[0]!.chord);
    let first = true;

    for (const span of spans) {
        const ch = span.chord;
        const dur = span.end - span.start;
        if (ch.isNOCHORD()) { out.push({ pitch: -1, startSlot: span.start, durationSlots: dur }); continue; }

        const pitch = first ? prevPitch : bestNote(prevPitch, ch, false);
        first = false;

        // 时值拆分(超 maxDur):平均切成 k 段,每段重新 bestNote 连下去
        if (maxDur > 0 && dur > maxDur) {
            const k = Math.ceil(dur / maxDur);
            const seg = Math.floor(dur / k);
            let p = pitch, t = span.start;
            for (let i = 0; i < k; i++) {
                const d = i === k - 1 ? span.end - t : seg;
                out.push({ pitch: p, startSlot: t, durationSlots: d, velocity: 88 });
                maybeSwitchDirection(p);
                t += d;
                p = bestNote(p, ch, true); // disallowSame:段内不停在同音
            }
            prevPitch = out[out.length - 1]!.pitch;
        } else {
            out.push({ pitch, startSlot: span.start, durationSlots: dur, velocity: 88 });
            maybeSwitchDirection(pitch);
            prevPitch = pitch;
        }
    }
    return out;
}
