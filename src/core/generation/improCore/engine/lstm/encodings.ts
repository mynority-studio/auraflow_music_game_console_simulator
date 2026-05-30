// encodings.ts — imp/lstm/architecture/poex 的两个 RelativeNoteEncoding 移植。
//   每个 expert 一个编码器:把网络输出(相对表示)remap 到「公共绝对空间」
//     [rest, sustain, pitch(low .. high-1)]  长度 = 2 + (high-low)
//   再由 PoE 逐元素相乘。midi 值约定:-1=rest,-2=sustain,其余=绝对 MIDI。

import { roll, onehot, softmax } from './nn-utils';

export interface RelativeNoteEncoding {
    /** 输出层激活宽度(= Dense 输出维度) */
    activationWidth(): number;
    /** 复位内部相对位置,返回初始 last_output 向量 */
    reset(): Float64Array;
    /** 把一个 midi 值编码成 last_output 向量(并更新内部 relpos) */
    encode(midi: number, chordRoot: number): Float64Array;
    /** 当前相对参考位置(IntervalRel=前一个音;ChordRel=和弦根) */
    getRelativePosition(chordRoot: number): number;
    /** 激活 → 公共绝对空间概率(长 2+(high-low)) */
    getProbabilities(activations: Float64Array, chordRoot: number, low: number, high: number): Float64Array;
}

/** 把 padded 概率原地归一(除以元素和) */
function normalize(v: Float64Array): Float64Array {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i]!;
    if (s > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / s;
    return v;
}

/**
 * Expert 0:IntervalRelativeNoteEncoding(withArtic=true,宽 27)。
 *   编码 = [rest, sustain, 25 个音程槽(delta -12..+12,相对 relpos=上一个音)]
 *   relpos 初值随机落在 [low, high)。
 */
export class IntervalRelativeNoteEncoding implements RelativeNoteEncoding {
    private relpos = 0;
    constructor(private low: number, private high: number, private rng: () => number) {}

    activationWidth(): number { return 1 + 1 + (12 + 1 + 12); } // 27

    reset(): Float64Array {
        this.relpos = this.low + Math.floor(this.rng() * (this.high - this.low));
        return onehot(0, this.activationWidth());
    }

    encode(midi: number, _chordRoot: number): Float64Array {
        const W = this.activationWidth();
        if (midi === -1) return onehot(0, W);
        if (midi === -2) return onehot(1, W);
        let delta = midi - this.relpos;
        if (delta > 12 || delta < -12) delta = delta % 12;
        this.relpos = midi;
        return onehot(delta + 12 + 2, W);
    }

    getRelativePosition(_chordRoot: number): number { return this.relpos; }

    getProbabilities(activations: Float64Array, _chordRoot: number, low: number, high: number): Float64Array {
        const probs = softmax(activations);             // 27
        const absolute = probs.subarray(0, 2);          // rest, sustain
        const relative = probs.subarray(2);             // 25 个音程槽

        const startDiff = low - (this.relpos - 12);
        const startIdx = Math.max(0, startDiff);
        const startPad = Math.max(0, -startDiff);
        const endIdx = Math.min(25, high - (this.relpos - 12));
        const endPad = Math.max(0, high - (this.relpos + 12 + 1));

        const cropLen = Math.max(0, endIdx - startIdx);
        const out = new Float64Array(2 + startPad + cropLen + endPad);
        out[0] = absolute[0]!; out[1] = absolute[1]!;
        let w = 2 + startPad;                           // startPad 个 0 已由默认填充
        for (let j = 0; j < cropLen; j++) out[w++] = relative[startIdx + j]!;
        // endPad 个 0 已由默认填充
        return normalize(out);
    }
}

/**
 * Expert 1:ChordRelativeNoteEncoding(withArtic=true,宽 14)。
 *   编码 = [rest, sustain, 12 个音级槽((midi-chordRoot)%12)]
 *   relpos = 和弦根。
 */
export class ChordRelativeNoteEncoding implements RelativeNoteEncoding {
    activationWidth(): number { return 1 + 1 + 12; } // 14

    reset(): Float64Array { return onehot(0, this.activationWidth()); }

    encode(midi: number, chordRoot: number): Float64Array {
        const W = this.activationWidth();
        if (midi === -1) return onehot(0, W);
        if (midi === -2) return onehot(1, W);
        let rel = (midi - chordRoot) % 12;
        if (rel < 0) rel += 12;
        return onehot(rel + 2, W);
    }

    getRelativePosition(chordRoot: number): number { return chordRoot; }

    getProbabilities(activations: Float64Array, chordRoot: number, low: number, high: number): Float64Array {
        const probs = softmax(activations);             // 14
        const absolute = probs.subarray(0, 2);          // rest, sustain
        const relative = Float64Array.from(probs.subarray(2)); // 12 音级
        const rolled = roll(relative, chordRoot - low); // 让 index 0 对应 pitch=low
        const span = high - low;
        const out = new Float64Array(2 + span);
        out[0] = absolute[0]!; out[1] = absolute[1]!;
        for (let m = 0; m < span; m++) out[2 + m] = rolled[m % 12]!; // 跨八度平铺
        return out; // 注意:ChordRel 原版不在此归一,留给 PoE 相乘后统一归一
    }
}
