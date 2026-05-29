// ============================================================
// scale.ts — 从 mg 抽 chord 的"local scale"信息
// ============================================================
//
// mg 的 chord.forcedScale(tonicization / borrowed planner 设)优先,
// fallback 到 ctx.mode + chord 自身的 root PC。
//
// 用途:P2 walking bass 的 scale run / 后续 layer 的"小跑"过渡。
// 严格保证 walking 经过音 ∈ scale PCs,不出 chromatic 非调音。
// ============================================================

import type { ChordDef, ResolvedGenerationContext } from '../mgEngine/musicEngine';
import { SCALE_TYPES, noteToMidi } from '../mgEngine/musicTheory';

export interface ChordScale {
    /** Scale 名(SCALE_TYPES key,如 'Ionian' / 'Dorian' / 'Mixolydian')*/
    name: string;
    /** Scale root 的 pitch class(0-11) */
    rootPc: number;
    /** Scale 中所有 PCs(absolute,已 mod 12)*/
    pcs: Set<number>;
    /** Scale PCs 数组(sorted ascending,for indexing)*/
    pcsArray: number[];
}

/**
 * 提取某 chord 的 local scale。
 *
 * 优先级:
 *   1. chord.forcedScale(tonicization / 借和弦的 modal 上下文)
 *   2. ctx.mode + chord rootPc(chord 走自家 mode 的同名 scale 起头)
 *   3. fallback Major(C Ionian)
 *
 * Scale root 总是 chord 的 root PC(即"以 chord root 为 1 度起算的 scale")。
 * 例:Cmaj7 在 D 大调里 forcedScale='Mixolydian' → name=Mixolydian, rootPc=0(C),
 * pcs={C,D,E,F,G,A,Bb}。
 */
export function getChordScale(chord: ChordDef, ctx: ResolvedGenerationContext): ChordScale {
    const rootPc = ((noteToMidi(chord.root + '0') % 12) + 12) % 12;

    // Try forcedScale first
    const forced = chord.forcedScale;
    if (forced && SCALE_TYPES[forced]) {
        return buildScale(forced, rootPc);
    }

    // Fall back to ctx.mode(若 SCALE_TYPES 有的话)
    const modeName = ctx.mode;
    if (modeName && SCALE_TYPES[modeName]) {
        return buildScale(modeName, rootPc);
    }

    // Last resort:Major(Ionian)
    return buildScale('Ionian', rootPc);
}

function buildScale(name: string, rootPc: number): ChordScale {
    const intervals = SCALE_TYPES[name] ?? SCALE_TYPES.Ionian;
    const pcs = new Set<number>();
    for (const semis of intervals) {
        pcs.add((rootPc + semis) % 12);
    }
    return {
        name,
        rootPc,
        pcs,
        pcsArray: [...pcs].sort((a, b) => a - b),
    };
}

/**
 * 在 scale 内找"从 fromMidi 走 N 步到 targetMidi"的 walking 序列。
 *
 * 用于 walking bass 的 scale-run:从当前 chord 的 5th 位经过 2 个 scale 步逼近
 * 下一 chord 的 bass。
 *
 * @param scale       当前 chord 的 ChordScale
 * @param fromMidi    起点 MIDI(必须是 scale 内音,或最近 scale 音)
 * @param targetMidi  目标 MIDI(下一 chord bass,通常不在当前 scale 但允许)
 * @param numSteps    经过音个数(典型 1-2)
 * @returns           sorted by time 的 MIDI 序列(不含 fromMidi 也不含 targetMidi)
 */
export function walkScaleToTarget(
    scale: ChordScale,
    fromMidi: number,
    targetMidi: number,
    numSteps: number,
): number[] {
    if (numSteps <= 0) return [];
    // 在 scale.pcsArray 上找方向:targetMidi 上行还是下行
    const dir = targetMidi >= fromMidi ? 1 : -1;
    const out: number[] = [];
    let current = fromMidi;
    for (let i = 0; i < numSteps; i++) {
        // 找下一个 scale 内的 step(在 current ± 1~3 半音范围内,顺方向)
        let next: number | null = null;
        for (let delta = 1; delta <= 4; delta++) {
            const candidate = current + dir * delta;
            const pc = ((candidate % 12) + 12) % 12;
            if (scale.pcs.has(pc)) {
                next = candidate;
                break;
            }
        }
        if (next === null) break;
        // 若已经超过 / 抵达 target,停
        if ((dir > 0 && next >= targetMidi) || (dir < 0 && next <= targetMidi)) break;
        out.push(next);
        current = next;
    }
    return out;
}
