// ============================================================
// viterbi.ts — Viterbi DP 求全曲最平滑 voicing 序列
// ============================================================
//
// 标准 Viterbi 算法:
//   dp[i][k] = min cost 到达 (chord i, voicing index k) 的最优路径代价
//   back[i][k] = 前 chord 最优 voicing index(用于 backtrace)
//
// 初始 prior:第 0 chord 各 voicing 按 priorCost(中心距离 F4)赋初值
// 转移:dp[i][j] = min over k { dp[i-1][k] + cost(v_{i-1,k} → v_{i,j}) }
// 终止:argmin dp[N-1][k] 回溯
//
// 复杂度 O(N × K²),N=chord 数 K=每 chord 候选数 ≈ 15。N=18 时 18×15² ≈ 4050
// 次 cost 计算,毫秒级。
// ============================================================

import type { Voicing } from './voicing';
import { voiceLeadingCost, priorCost, internalClusterPenalty } from './voicing';

export interface ViterbiResult {
    /** 最优 voicing 序列(每 chord 一个) */
    voicings: Voicing[];
    /** 总代价(全曲累计 voice leading + prior) */
    totalCost: number;
    /** 每 chord 候选数(诊断用) */
    candidateCounts: number[];
}

/**
 * 跑 Viterbi DP,从 chord-by-chord 候选集找全曲最平滑路径。
 *
 * @param candidatesPerChord  每 chord 的候选 voicing 数组
 */
export function viterbiVoiceLeading(candidatesPerChord: Voicing[][]): ViterbiResult {
    const N = candidatesPerChord.length;
    if (N === 0) {
        return { voicings: [], totalCost: 0, candidateCounts: [] };
    }

    // 应对某 chord 候选集为空的边角:占位空 voicing,cost 0,不参与 Viterbi
    const candidateCounts = candidatesPerChord.map(cs => cs.length);

    // dp[i][k] 和 back[i][k]
    const dp: number[][] = candidatesPerChord.map(cs => cs.map(() => Infinity));
    const back: number[][] = candidatesPerChord.map(cs => cs.map(() => -1));

    // —— 初始 prior:第 0 chord 各候选用 priorCost + clusterPenalty ——
    for (let k = 0; k < candidatesPerChord[0].length; k++) {
        const v = candidatesPerChord[0][k];
        dp[0][k] = priorCost(v) + internalClusterPenalty(v);
    }

    // —— Forward DP ——
    // 每 chord 状态附加 internalClusterPenalty 进 cost,Viterbi 自动避开有
    // m2 内部冲撞的 voicing(典型如 b9 / b13 紧贴本音的密排)。
    for (let i = 1; i < N; i++) {
        const prevCs = candidatesPerChord[i - 1];
        const curCs = candidatesPerChord[i];
        for (let j = 0; j < curCs.length; j++) {
            const stateCost = internalClusterPenalty(curCs[j]);
            for (let k = 0; k < prevCs.length; k++) {
                if (!Number.isFinite(dp[i - 1][k])) continue;
                const c = dp[i - 1][k] + voiceLeadingCost(prevCs[k], curCs[j]) + stateCost;
                if (c < dp[i][j]) {
                    dp[i][j] = c;
                    back[i][j] = k;
                }
            }
        }
    }

    // —— Backtrace ——
    // 找最后 chord 最小 cost
    let lastK = 0;
    let lastCost = Infinity;
    for (let k = 0; k < candidatesPerChord[N - 1].length; k++) {
        if (dp[N - 1][k] < lastCost) {
            lastCost = dp[N - 1][k];
            lastK = k;
        }
    }

    const voicings: Voicing[] = new Array(N);
    let cur = lastK;
    for (let i = N - 1; i >= 0; i--) {
        if (cur < 0 || cur >= candidatesPerChord[i].length) {
            // 退化情况:用空 voicing 占位
            voicings[i] = [];
            break;
        }
        voicings[i] = candidatesPerChord[i][cur];
        cur = i > 0 ? back[i][cur] : cur;
    }

    return {
        voicings,
        totalCost: lastCost,
        candidateCounts,
    };
}
