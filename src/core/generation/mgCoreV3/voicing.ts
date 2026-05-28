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
 * 从 chord 提取"essential chord tones" PC 集合:root + 3 + 5 + 7。
 * 跳过 9 / 11 / 13 等 tension extensions,避免 voicing 内 m2 cluster。
 *
 * Bm7b5(notesMidi 含 Db5 = b9)→ essentials = [B, D, F, A](去掉 Db b9)
 * E7b9(notesMidi 含 F b9)→ essentials = [E, G#, B, D](去掉 F b9)
 */
function getEssentialChordPcs(chord: ChordDef): number[] {
    const rootPc = ((chord.rootMidi % 12) + 12) % 12;
    const intervals = new Set<number>();
    for (const m of chord.notesMidi) {
        intervals.add((((m % 12) - rootPc) + 12) % 12);
    }
    // Essentials:root + 3rd(3 or 4)+ 5th(6, 7, 8)+ 7th(10 or 11)
    const essentialIntervals: number[] = [0];
    if (intervals.has(3)) essentialIntervals.push(3);
    else if (intervals.has(4)) essentialIntervals.push(4);
    if (intervals.has(7)) essentialIntervals.push(7);
    else if (intervals.has(6)) essentialIntervals.push(6);
    else if (intervals.has(8)) essentialIntervals.push(8);
    if (intervals.has(10)) essentialIntervals.push(10);
    else if (intervals.has(11)) essentialIntervals.push(11);
    return essentialIntervals.map(s => (rootPc + s) % 12).sort((a, b) => a - b);
}

/**
 * 给一个 chord 生成 voicing 候选数组。
 *
 * 策略:
 *   1. Full close voicing(全 PCs)各转位 × 多八度
 *   2. Essential close voicing(去 extension)各转位 × 多八度 — 关键!
 *      避免 b9 / b13 引入 m2 cluster
 *   3. Drop-2:close voicing 的次高音降八度
 *   4. Shell voicing:只 3 + 7(去 root + 5)
 *
 * 输出:全部在 [REG_LO, REG_HI] 内的 voicing,去重,sorted。
 */
export function enumerateVoicings(chord: ChordDef): Voicing[] {
    const fullPcs = [...new Set(chord.notesMidi.map(m => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
    const essentialPcs = getEssentialChordPcs(chord);
    if (fullPcs.length === 0) return [];

    const candidates: Voicing[] = [];
    const seen = new Set<string>();
    const tryPush = (v: Voicing): void => {
        if (v.length === 0) return;
        const sorted = [...v].sort((a, b) => a - b);
        if (sorted[0] < REG_LO) return;
        if (sorted[sorted.length - 1] > REG_HI) return;
        if (sorted[sorted.length - 1] - sorted[0] > 30) return;
        const key = sorted.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(sorted);
    };

    /** 从 pc set + 起 PC + 起八度生成 close voicing */
    const buildClose = (pcs: number[], rotation: number, baseOct: number): number[] => {
        if (pcs.length === 0) return [];
        const rotated = [...pcs.slice(rotation), ...pcs.slice(0, rotation)];
        const v: number[] = [];
        let prev = baseOct * 12 + rotated[0];
        v.push(prev);
        for (let i = 1; i < rotated.length; i++) {
            let p = (Math.floor(prev / 12)) * 12 + rotated[i];
            while (p <= prev) p += 12;
            v.push(p);
            prev = p;
        }
        return v;
    };

    // —— 策略 1:Full close(含 extensions)——
    for (let rotation = 0; rotation < fullPcs.length; rotation++) {
        for (let baseOct = 3; baseOct <= 5; baseOct++) {
            tryPush(buildClose(fullPcs, rotation, baseOct));
        }
    }

    // —— 策略 2:Essential close(只 root/3/5/7,无 extension)——
    // 关键!给 Viterbi 提供"无 m2 内部冲撞"的候选
    if (essentialPcs.length !== fullPcs.length) {
        for (let rotation = 0; rotation < essentialPcs.length; rotation++) {
            for (let baseOct = 3; baseOct <= 5; baseOct++) {
                tryPush(buildClose(essentialPcs, rotation, baseOct));
            }
        }
    }

    // —— 策略 3:Drop-2 of full close ——
    const fullCloseSnapshot = [...candidates];
    for (const v of fullCloseSnapshot) {
        if (v.length >= 4) {
            const dropped = [...v];
            dropped[dropped.length - 2] -= 12;
            tryPush(dropped);
        }
    }

    // —— 策略 4:Shell(去 root + 5)of essentials ——
    if (essentialPcs.length >= 4) {
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        const fifthPc = (rootPc + 7) % 12;
        const altFifthPc = (rootPc + 6) % 12;
        const altFifthPc2 = (rootPc + 8) % 12;
        const shellPcs = essentialPcs.filter(pc => pc !== rootPc && pc !== fifthPc && pc !== altFifthPc && pc !== altFifthPc2);
        if (shellPcs.length >= 2) {
            for (let rotation = 0; rotation < shellPcs.length; rotation++) {
                for (let baseOct = 4; baseOct <= 5; baseOct++) {
                    tryPush(buildClose(shellPcs, rotation, baseOct));
                }
            }
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

/**
 * Internal m2 cluster penalty — voicing 内任两音 m2(半音相邻)是冲撞,
 * 必须重罚,Viterbi 才会优先挑 essential(无 b9 / 无 #11)的子集。
 *
 * mg V1 用 arrangementContract 在播放时主动 drop b9 等 tension 紧张音;
 * V3 用静态 voicing,只能靠 cost function 让 Viterbi 自己避开。
 */
export function internalClusterPenalty(v: Voicing): number {
    if (v.length <= 1) return 0;
    let penalty = 0;
    for (let i = 0; i < v.length; i++) {
        for (let j = i + 1; j < v.length; j++) {
            const diff = v[j] - v[i];
            // 同八度内 m2(diff=1)极重罚
            if (diff === 1) penalty += 15;
            // 跨八度 m9(diff=13)较轻罚 — 还能接受
            else if (diff === 13) penalty += 4;
            // M7 / m7(diff=11):mid penalty,允许但不偏好
            else if (diff === 11) penalty += 2;
        }
    }
    return penalty;
}
