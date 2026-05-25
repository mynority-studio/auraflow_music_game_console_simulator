// ============================================================
// MicroTimingHumanizer(U 阶段)— strum 滚奏感
// ============================================================
//
// 原 Af2AccompGen.applyMicroTiming(2026-05-25 拆 plugin)。
//
// 同 onset chord cluster(>=2 notes at same time)按 pitch 升序加递增
// delay,模拟人手按和弦时低音→高音的极小先后顺序:
//   note[0] (lowest):  onset += 0
//   note[1]:           onset += MICRO_DELAY
//   note[2]:           onset += 2 × MICRO_DELAY
//   note[3] (highest): onset += 3 × MICRO_DELAY
//
// MICRO_DELAY = 0.008 beat
//   @ 120 BPM: ~4ms / step,4-音 chord 总跨度 ~12ms
//   @ 88  BPM: ~5.5ms / step,~16ms total
//   在人类感知"自然滚奏"范围内(< 20ms 不破节奏感)。
//
// 只 accomp 用 — bass/melody/drums 单声部 + 节奏感强,不需要。
// pad 已有 attack pre-roll,不重复加。
//
// 实现:slice + sort by onset(同 onset 内 pitch 升序 tie-break),然后找
//       相邻同 onset cluster(±ONSET_CLUSTER_EPSILON 容差),低音不动,
//       高音按 pitch 升序 reassign onset(deterministic)。
// ============================================================

import type { NoteData } from '../../../types';
import type { AccompPluginMeta } from './types';

const MICRO_DELAY = 0.008;            // beat,单 step
const ONSET_CLUSTER_EPSILON = 1e-4;   // 同 onset 判定容差

export const MicroTimingHumanizer: AccompPluginMeta & {
    apply(notes: ReadonlyArray<NoteData>): NoteData[];
} = {
    name: 'MicroTimingHumanizer',
    version: 'v1.0 (U phase)',
    prngConsumption: 'zero',
    description: '同 onset cluster pitch-ascending strum micro-delay(0.008 beat ≈ 4ms@120BPM)',

    apply(notes) {
        if (notes.length < 2) return notes.slice();
        const out = notes.slice();
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > ONSET_CLUSTER_EPSILON) return d;
            return a.pitch - b.pitch;  // tie-break by pitch ascending
        });

        let i = 0;
        while (i < out.length) {
            const baseOnset = out[i].onset;
            let j = i + 1;
            while (j < out.length && Math.abs(out[j].onset - baseOnset) <= ONSET_CLUSTER_EPSILON) {
                j++;
            }
            const clusterSize = j - i;
            if (clusterSize >= 2) {
                // out[i..j-1] 已按 pitch 升序(sort tie-break 保证)
                // 加递增 delay(low pitch 不动,high pitch delay 最大)
                for (let k = 1; k < clusterSize; k++) {
                    out[i + k] = { ...out[i + k], onset: baseOnset + k * MICRO_DELAY };
                }
            }
            i = j;
        }
        return out;
    },
};
