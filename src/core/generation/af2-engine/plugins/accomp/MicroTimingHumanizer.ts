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
//
// 2026-05-25 修(HandPartitioner 启用副作用 — 听感"小心翼翼按下去突然变响"):
//   原固定 0.008 beat/step,cluster ≥ 6 音时总跨度 ≥ 40ms,远超 20ms 人耳"同时"
//   阈值,叠加 Fletcher-Munson 等响曲线(低音 vs 高音 @ 同 velocity 感知响度不同)
//   → 听众感觉"刚按时声音小→ 突然变响"的 fake crescendo。
//   修:加 MAX_TOTAL_STRUM_BEATS = 0.018 beat (~9ms@120BPM) cap 总跨度。
//   cluster 大时均匀压缩 step delay,总跨度 ≤ 18ms — 保留 strum 自然感但
//   绝不变成 crescendo。小 cluster(2-3 音)行为完全不变。
// ============================================================

import type { NoteData } from '../../../types';
import type { AccompPluginMeta } from './types';

const MICRO_DELAY = 0.008;             // beat,单 step(小 cluster 自然 strum)
const MAX_TOTAL_STRUM_BEATS = 0.018;   // beat,总 strum 跨度硬上限(~9ms @ 120BPM)
const ONSET_CLUSTER_EPSILON = 1e-4;    // 同 onset 判定容差

export const MicroTimingHumanizer: AccompPluginMeta & {
    apply(notes: ReadonlyArray<NoteData>): NoteData[];
} = {
    name: 'MicroTimingHumanizer',
    version: 'v1.1 (cluster cap)',
    prngConsumption: 'zero',
    description: '同 onset cluster pitch-ascending strum(总跨度 cap 18ms,防止 HandPartitioner 拓宽 voicing 后退化为 fake crescendo)',

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
                // step delay:小 cluster 用 MICRO_DELAY,大 cluster 压缩到 MAX_TOTAL_STRUM_BEATS 内
                const naiveTotal = (clusterSize - 1) * MICRO_DELAY;
                const stepDelay = naiveTotal > MAX_TOTAL_STRUM_BEATS
                    ? MAX_TOTAL_STRUM_BEATS / (clusterSize - 1)
                    : MICRO_DELAY;
                for (let k = 1; k < clusterSize; k++) {
                    out[i + k] = { ...out[i + k], onset: baseOnset + k * stepDelay };
                }
            }
            i = j;
        }
        return out;
    },
};
