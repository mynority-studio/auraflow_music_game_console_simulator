// lstm-gen.ts — imp/lstm/main/LSTMGen + io/leadsheet/DataPartIO 的生成/解码移植。
//   按 RESOLUTION_SCALAR=10 → 1 步 = 10 slot,48 步/小节。每步喂 (beat, chordRoot,
//   chordType) 给 PoE 模型采样一个 midi,再把连续步聚合成 SlotNote。

import type { LoadedModel } from './q8';
import type { Chord } from '../chord';
import type { ChordSpan } from '../chordpart';
import type { SlotNote } from '../lickgen';
import { GenerativeProductModel } from './poex-model';
import { makeRng } from './nn-utils';

const STEP_SLOTS = 10; // RESOLUTION_SCALAR

// 各时值对应的「步数」(DUR / 10),用于 beat 多热编码
const BEAT_PERIODS = [
    48, // WHOLE
    24, // HALF
    12, // QUARTER
    6,  // EIGHTH
    3,  // SIXTEENTH
    16, // HALF_TRIPLET (160/10)
    8,  // QUARTER_TRIPLET (80/10)
    4,  // EIGHTH_TRIPLET (40/10)
    2,  // SIXTEENTH_TRIPLET (20/10)
];

/** step 索引 → 9 维节律编码 */
function beatVector(step: number): Float64Array {
    const v = new Float64Array(9);
    for (let i = 0; i < 9; i++) v[i] = step % BEAT_PERIODS[i]! === 0 ? 1 : 0;
    return v;
}

/** Chord → { root pc(0-11), 12 维根音相对音级位向量 } */
function encodeChord(chord: Chord): { root: number; type: Float64Array } {
    const type = new Float64Array(12);
    if (chord.isNOCHORD()) return { root: 0, type };
    const root = chord.getRootSemitones();
    for (const midi of chord.getSpellMIDIarray()) {
        const rel = (((midi % 12) - root) % 12 + 12) % 12;
        type[rel] = 1;
    }
    return { root, type };
}

export interface LstmGenOptions {
    /** 随机种子(可复现);省略则用一个固定缺省 */
    seed?: number;
    /** 总步数上限保护 */
    maxSteps?: number;
}

/**
 * 用 LSTM(深度学习 connectome)在给定和弦上生成一条单声部旋律。
 * @param spans  和弦段(ChordPart.getSpans()),需覆盖 [0, totalSlots)
 * @param model  已加载的 connectome
 */
export function generateLstmMelody(
    spans: readonly ChordSpan[],
    model: LoadedModel,
    opts: LstmGenOptions = {},
): SlotNote[] {
    if (spans.length === 0) return [];
    const totalSlots = spans[spans.length - 1]!.end;
    const numSteps = Math.floor(totalSlots / STEP_SLOTS);
    const maxSteps = opts.maxSteps ?? 4096;
    const steps = Math.min(numSteps, maxSteps);

    const rng = makeRng(opts.seed ?? 0x9e3779b9);
    const gen = new GenerativeProductModel(model, rng);

    // 当前 slot 落在哪个 chord
    let spanIdx = 0;
    const chordAt = (slot: number): Chord => {
        while (spanIdx < spans.length - 1 && slot >= spans[spanIdx]!.end) spanIdx++;
        return spans[spanIdx]!.chord;
    };

    const midis: number[] = new Array(steps);
    for (let s = 0; s < steps; s++) {
        const slot = s * STEP_SLOTS;
        const { root, type } = encodeChord(chordAt(slot));
        midis[s] = gen.step(beatVector(s), root, type, rng);
    }

    return aggregate(midis);
}

/** 连续步聚合成音符(DataPartIO.addToMelodyPart):-2 延音 / -1 休止合并 / 否则新音 */
function aggregate(midis: number[]): SlotNote[] {
    const out: SlotNote[] = [];
    if (midis.length === 0) return out;

    let noteValue = midis[0] === -2 ? -1 : midis[0]!; // 首步被延音视为休止(异常)
    let startStep = 0;
    let duration = 1;
    const emit = () => out.push({
        pitch: noteValue < 0 ? -1 : noteValue,
        startSlot: startStep * STEP_SLOTS,
        durationSlots: duration * STEP_SLOTS,
    });

    for (let s = 1; s < midis.length; s++) {
        const m = midis[s]!;
        if (m === -2 || (noteValue === -1 && m === -1)) {
            duration++;
        } else {
            emit();
            noteValue = m; // m ∈ {-1, 绝对音高}
            startStep = s;
            duration = 1;
        }
    }
    emit();
    return out;
}
