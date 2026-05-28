// ============================================================
// voicing.ts — chord voicing 候选枚举 + voice-leading cost
// ============================================================
//
// V3 实验:全局 Viterbi voice leading 优化(Tonal 风格)。
//
// 流程:
//   chord.notesMidi → pitch class set
//   ↓ enumerateVoicings:生成 ~15 个候选 voicing(各转位 × 多八度 + drop-2)
//   ↓ Viterbi DP 用 voiceLeadingCost 做转移代价,找全曲最平滑路径
//
// 跟 mg widePianoVoicing 区别:mg 是**每 chord 局部选 voicing**,V3 是
// **全曲 Viterbi 全局最短路径**。
// ============================================================

import type { ChordDef } from '../mgEngine/musicEngine';

/** 单个 voicing = 一组 sorted ascending MIDI pitches(RH 范围) */
export type Voicing = number[];

// ─────────────────────────────────────────────────────────────────
// 范围约束 — RH 钢琴 voicing 区
// ─────────────────────────────────────────────────────────────────

/** voicing 最低音 floor(C3) */
const REG_LO = 48;
/** voicing 最高音 ceiling(C6) */
const REG_HI = 84;
/** voicing 中心 prior(F4)— 初始 dp 偏好这个 center */
const REG_CENTER = 65;

// ─────────────────────────────────────────────────────────────────
// 候选枚举
// ─────────────────────────────────────────────────────────────────

/**
 * 给一个 chord 生成 voicing 候选数组。
 *
 * 策略:
 *   1. Close voicing 各转位:把 chord pc set 旋转 N 次,每个 root pc 起一个
 *      stack(每音叠在前一音之上的最低八度)
 *   2. 多八度变体:同 close 在 oct 3/4/5 各试一次
 *   3. Drop-2:close voicing 的次高音降一个八度
 *   4. Shell voicing(可选):只保留 3 和 7(omit root + 5)
 *
 * 输出:全部在 [REG_LO, REG_HI] 内的 voicing,去重,sorted。
 */
export function enumerateVoicings(chord: ChordDef): Voicing[] {
    // chord 的 pitch class set(去重,sorted ascending)
    const pcs = [...new Set(chord.notesMidi.map(m => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
    if (pcs.length === 0) return [];

    const candidates: Voicing[] = [];
    const seen = new Set<string>();
    const tryPush = (v: Voicing): void => {
        if (v.length === 0) return;
        const sorted = [...v].sort((a, b) => a - b);
        if (sorted[0] < REG_LO) return;
        if (sorted[sorted.length - 1] > REG_HI) return;
        // span 限制:voicing 最高最低差超过 2.5 octave 太散
        if (sorted[sorted.length - 1] - sorted[0] > 30) return;
        const key = sorted.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(sorted);
    };

    // —— 策略 1+2:Close voicing 各转位 × 多八度 ——
    for (let rotation = 0; rotation < pcs.length; rotation++) {
        const rotated = [...pcs.slice(rotation), ...pcs.slice(0, rotation)];
        for (let baseOct = 3; baseOct <= 5; baseOct++) {
            const v: number[] = [];
            let prev = baseOct * 12 + rotated[0];
            v.push(prev);
            for (let i = 1; i < rotated.length; i++) {
                let p = (Math.floor(prev / 12)) * 12 + rotated[i];
                while (p <= prev) p += 12;
                v.push(p);
                prev = p;
            }
            tryPush(v);
        }
    }

    // —— 策略 3:Drop-2(次高音降八度)——
    const baseCandidates = [...candidates];  // 此时只有 close 类
    for (const v of baseCandidates) {
        if (v.length >= 4) {
            const dropped = [...v];
            dropped[dropped.length - 2] -= 12;
            tryPush(dropped);
        }
    }

    // —— 策略 4:Shell(去 root,去 5)——
    // 只对 7 和弦有意义(至少 3 + 7);chord 没 7 就跳过
    // 这里粗略实现:从 baseCandidates 取每个 v 去掉 root + 5
    for (const v of baseCandidates) {
        if (v.length >= 4) {
            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const fifthPc = (rootPc + 7) % 12;
            const shell = v.filter(m => {
                const pc = ((m % 12) + 12) % 12;
                return pc !== rootPc && pc !== fifthPc;
            });
            if (shell.length >= 2) tryPush(shell);
        }
    }

    return candidates;
}

// ─────────────────────────────────────────────────────────────────
// Voice leading cost(声部连接代价)
// ─────────────────────────────────────────────────────────────────

/**
 * 两 voicing 之间转移代价。
 *
 * 模型:把 v1 / v2 按 index 配对(都是 sorted ascending),计算每对的
 * 半音差绝对值之和。
 *   - 配对 cost = Σ |Δsemi per voice|
 *   - 单声跳跃 > 7 半音加额外 penalty(过远 = bad)
 *   - size mismatch 加额外 cost(多/少声部惩罚)
 */
export function voiceLeadingCost(v1: Voicing, v2: Voicing): number {
    if (v1.length === 0 || v2.length === 0) return 0;

    const len = Math.min(v1.length, v2.length);
    let cost = 0;
    for (let i = 0; i < len; i++) {
        const delta = Math.abs(v2[i] - v1[i]);
        cost += delta;
        // 单声跳跃 > 7 半音(超过 P5)额外重罚
        if (delta > 7) cost += (delta - 7) * 2;
    }
    // Size mismatch
    cost += Math.abs(v1.length - v2.length) * 4;
    return cost;
}

/** voicing center prior:距离中央 F4(MIDI 65)越近越好,加少量 prior cost */
export function priorCost(v: Voicing): number {
    if (v.length === 0) return 0;
    const center = v.reduce((s, n) => s + n, 0) / v.length;
    return Math.abs(center - REG_CENTER) * 0.3;
}
