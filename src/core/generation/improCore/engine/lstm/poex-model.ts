// poex-model.ts — imp/lstm/architecture/poex/GenerativeProductModel 的移植。
//   2 个 expert(IntervalRelative + ChordRelative)各跑 2 层 LSTM,概率 remap 到
//   公共绝对空间后逐元素相乘,归一,采样 → 一个 midi 值(-1 rest / -2 sustain / 绝对音高)。
//   每个 expert 输入 = [beat(9), position(2), chord(12, roll 到相对 relpos), lastOutput(27/14)]。

import type { LoadedModel } from './q8';
import { Expert } from './lstm-cell';
import { roll, sample } from './nn-utils';
import {
    type RelativeNoteEncoding,
    IntervalRelativeNoteEncoding,
    ChordRelativeNoteEncoding,
} from './encodings';

export const LSTM_LOW_BOUND = 48;       // MIDI C3
export const LSTM_HIGH_BOUND = 84 + 1;  // MIDI C6(开区间上界)
const POS_DIVISIONS = 2;

/** PositionInputPart(low, high, 2).generate(relpos) → 2 维三角位置指示 */
function positionPart(relpos: number, low: number, high: number): Float64Array {
    const delta = (high - low) / (POS_DIVISIONS - 1); // = high-low
    const out = new Float64Array(POS_DIVISIONS);
    for (let i = 0; i < POS_DIVISIONS; i++) {
        const anchor = low + i * delta;               // [low, high]
        const v = 1 - Math.abs(relpos - anchor) / delta;
        out[i] = v > 0 ? v : 0;
    }
    return out;
}

export class GenerativeProductModel {
    private readonly experts: Expert[];
    private readonly encodings: RelativeNoteEncoding[];
    private readonly lastOutput: Float64Array[];
    private readonly inputBuf: Float64Array[];
    private readonly low: number;
    private readonly high: number;

    constructor(model: LoadedModel, rng: () => number, low = LSTM_LOW_BOUND, high = LSTM_HIGH_BOUND) {
        this.low = low; this.high = high;
        // config = generative_product_interval_chords:expert0 IntervalRel,expert1 ChordRel
        this.encodings = [
            new IntervalRelativeNoteEncoding(low, high, rng),
            new ChordRelativeNoteEncoding(),
        ];
        this.experts = [new Expert(model, 'param_0'), new Expert(model, 'param_1')];
        this.lastOutput = this.encodings.map((e) => e.reset());
        // 输入缓冲:9 + 2 + 12 + activationWidth
        this.inputBuf = this.encodings.map((e) => new Float64Array(9 + 2 + 12 + e.activationWidth()));
    }

    reset(rng?: () => number): void {
        for (const e of this.experts) e.reset();
        for (let i = 0; i < this.encodings.length; i++) this.lastOutput[i] = this.encodings[i]!.reset();
    }

    /**
     * 走一步。
     * @param beat       9 维节律编码(由 step 索引算)
     * @param chordRoot  和弦根 pitch class(0-11)
     * @param chordType  12 维根音相对音级位向量
     * @param rng        随机源
     * @returns midi:-1=rest,-2=sustain,其余=绝对 MIDI
     */
    step(beat: Float64Array, chordRoot: number, chordType: Float64Array, rng: () => number): number {
        let accum: Float64Array | null = null;

        for (let i = 0; i < this.experts.length; i++) {
            const enc = this.encodings[i]!;
            const relpos = enc.getRelativePosition(chordRoot);

            // 拼输入:[beat(9), position(2), chordRoll(12), lastOutput]
            const buf = this.inputBuf[i]!;
            buf.set(beat, 0);
            buf.set(positionPart(relpos, this.low, this.high), 9);
            buf.set(roll(chordType, chordRoot - relpos), 11);
            buf.set(this.lastOutput[i]!, 23);

            const activations = this.experts[i]!.process(buf);
            const probs = enc.getProbabilities(activations, chordRoot, this.low, this.high);

            if (accum === null) accum = probs.slice();
            else for (let k = 0; k < accum.length; k++) accum[k] = accum[k]! * probs[k]!;
        }

        // 归一(normalizeArticOnly=false)
        const acc = accum!;
        let z = 0;
        for (let k = 0; k < acc.length; k++) z += acc[k]!;
        if (z > 0) for (let k = 0; k < acc.length; k++) acc[k] = acc[k]! / z;

        const sampled = sample(rng, acc);
        let midi: number;
        if (sampled === 0) midi = -1;
        else if (sampled === 1) midi = -2;
        else midi = this.low + (sampled - 2);

        // 回馈:更新每个 expert 的 lastOutput + relpos
        for (let i = 0; i < this.experts.length; i++) {
            this.lastOutput[i] = this.encodings[i]!.encode(midi, chordRoot);
        }
        return midi;
    }
}
