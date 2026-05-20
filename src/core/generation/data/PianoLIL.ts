// ============================================================
// PianoLIL — 钢琴 Low Interval Limit(低音区禁止间隔表)
// ============================================================
//
// 出处:Henry Mancini 1962 "Sounds and Scores" + 实证 Bill Evans / Glasper
// voicing dictionary 校准。当前钢琴 voicing 在低音区出现某些紧致间隔时,
// 会触发耳蜗的临界带搏动(critical-band beating),听感"糊"。本表给出
// register-conditional 的 penalty:某半音间隔在低音区禁止,但在高音区是
// 合法的色彩(Debussy / b9 dominant 等)。
//
// 关键区分(与 Walter Piston 1955 管弦乐 LIL 不同):
//   - Piston:m3 / M3 / P4 在低音区也禁止 — 但这会杀死 stride / boogie /
//     blues 钢琴左手的体裁签名(那些恰恰用 m3/M3 在低八度)
//   - Mancini-tuned:只禁 m2(E4 下)和 M2(D3 下)— Bill Evans 实际 voicing
//     里 cluster 出现的最低边界
//
// 4 条法则:
//   1) m2 (1 半音) 较低音必须 ≥ E4 (MIDI 64)
//   2) M2 (2 半音) 较低音必须 ≥ D3 (MIDI 50)
//   3) m2 在高音区(>= E4)仍有轻微 friction(penalty=4)
//   4) 同 pitch 重复 = forbidden(penalty=100)
//
// 消费方(Batch 1 暂不接):
//   - Batch 3:VoicingProcessor.buildRootlessRH 的 placement cost function
//   - Batch 4:PianoLHPatterns 的 stride / open-tenth 排列
//   - Batch 7:Solo Piano M8 mode 选 voicing
//
// 零 PRNG。零依赖(不 import 任何 auraflow 模块)。
// ============================================================

/** 单条 LIL 规则定义 */
export interface PianoLILRule {
    /** 半音间隔(两音 MIDI 差) */
    semitones: number;
    /** 较低音必须 ≥ 此 MIDI 才能逃离 penalty;低于此值视为 "muddy" */
    minLowerMidi: number;
    /** penalty 数值(越高越禁止) */
    penalty: number;
}

/**
 * 主表 — 当前 2 条规则覆盖 m2 / M2 两个主要 muddy 间隔。
 * m3 / M3 / P4 故意不入表(stride / boogie / blues 体裁签名)。
 */
export const PIANO_LIL_THRESHOLDS: ReadonlyArray<PianoLILRule> = Object.freeze([
    Object.freeze({ semitones: 1, minLowerMidi: 64, penalty: 40 }),  // m2 below E4 = critical-band beating
    Object.freeze({ semitones: 2, minLowerMidi: 50, penalty: 8  }),  // M2 below D3 = deep-bass partial overlap
]);

/** m2 在高音区(>= E4)的 mild upper-structure friction */
export const PIANO_LIL_HIGH_REGISTER_M2_PENALTY = 4;

/** 同 pitch 重复 — 任何区间禁止 */
export const PIANO_LIL_DUPLICATE_PENALTY = 100;

// ============================================================
// 查询函数 — 给定两个 MIDI pitch,返回此对的 LIL penalty
// ============================================================

/**
 * 计算两个 MIDI 音之间的 LIL penalty。
 *
 * 调用约定:任意顺序 (lowerMidi, upperMidi) 均可,函数内部归一化。
 *
 * 返回:
 *   - 0:无 penalty(合法间隔)
 *   - >0:违规等级(越大越禁止)
 *
 * 零 PRNG / 零分配 / O(PIANO_LIL_THRESHOLDS.length) 线性扫描。
 */
export function getPianoLILPenalty(midiA: number, midiB: number): number {
    const lower = midiA < midiB ? midiA : midiB;
    const upper = midiA < midiB ? midiB : midiA;
    const dist = upper - lower;

    if (dist < 1) return PIANO_LIL_DUPLICATE_PENALTY;

    for (let i = 0; i < PIANO_LIL_THRESHOLDS.length; i++) {
        const rule = PIANO_LIL_THRESHOLDS[i];
        if (rule.semitones !== dist) continue;
        if (lower < rule.minLowerMidi) return rule.penalty;
        // m2 在 ≥ E4 仍有 mild friction
        if (dist === 1) return PIANO_LIL_HIGH_REGISTER_M2_PENALTY;
        return 0;
    }
    return 0;
}
