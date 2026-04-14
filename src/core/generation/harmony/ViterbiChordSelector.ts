// ==========================================
// 📄 /src/core/generation/harmony/ViterbiChordSelector.ts
// 🌟 PR #1: Viterbi 和弦选择器 — 法则 1+2+3 的算法核心
//
// 输入：
//   - anchors[]：每个和弦槽位对应的"旋律骨架音"（pitch class 0~11，主调相对）
//   - pool[]：候选和弦池（每个元素预计算好 mask / rootPc / quality / functionClass）
//   - options：可选功能约束 / 前瞻权重调节
//
// 输出：
//   - 每个槽位选中的和弦（和 pool 元素同一对象，不拷贝）
//   - 可选：每步的得分明细（debug 用）
//
// 算法：
//   标准 Viterbi，状态 dp[i][k] = "前 i+1 个槽位，第 i 个用 pool[k]" 的最高累计分
//   转移：dp[i][k] = max_j (dp[i-1][j] + score(pool[k], pool[j], anchor[i], lookahead))
//   回溯：path[i][k] 记录最优前驱
//
// 决定论：
//   - DP 表和 path 表静态预分配（扁平化 Int16Array / Uint8Array）
//   - 所有"同分"分歧通过 PRNGManager.nextInt 注入微小扰动（base * 10 + jitter）
//   - PRNG 消耗次数 = N × K × K（Viterbi 转移次数），可预测可复现
//
// 性能（ESP32 @ 240MHz 预算）：
//   N ≤ 32, K ≤ 40 → 32 × 40 × 40 ≈ 51k 次转移评分 × ~20 cycles ≈ 1ms
// ==========================================

import { ChordQuality } from '../types';
import { ChordMask, commonTones, chordToMask, popcount12 } from './ChordMask';
import { SCORE_TABLE } from './ChordScoreTable';
import { PRNGManager } from '../../utils/PRNG';

/**
 * 功能组（Harmonic Function）— Phase 1 影子骨架的输出 / Phase 3 的约束。
 * 数值枚举便于 C 移植和位运算分类。
 */
export enum HarmonicFunction {
    Tonic = 0,        // T — 主
    Subdominant = 1,  // S — 下属
    Dominant = 2,     // D — 属
}

/**
 * 和弦候选。预计算好 mask 和 popcount，避免 Viterbi 热路径重算。
 * Pitch Space: RELATIVE (rootPc 是主调相对空间)
 */
export interface ChordCandidate {
    rootPc: number;              // 0~11, 主调相对
    quality: ChordQuality;
    mask: ChordMask;             // 预计算，chordToMask(rootPc, quality)
    bitCount: number;            // 预计算，popcount(mask) — 热路径用作 complexity tax
    functionClass: HarmonicFunction;
}

/**
 * 构造 ChordCandidate，自动预计算 mask 和 popcount。
 * 非热路径（pool 初始化时一次性调用），可以安全用。
 */
export function makeCandidate(
    rootPc: number,
    quality: ChordQuality,
    functionClass: HarmonicFunction,
): ChordCandidate {
    const mask = chordToMask(rootPc, quality);
    return {
        rootPc: ((rootPc % 12) + 12) % 12,
        quality,
        mask,
        bitCount: popcount12(mask),
        functionClass,
    };
}

/**
 * Viterbi 输入。
 */
export interface ViterbiInput {
    /** 每个槽位的旋律骨架音 pitch class（0~11，主调相对）。长度即 N。 */
    anchors: number[];
    /** 候选和弦池，全局共享。长度即 K，K ≤ MAX_K。 */
    pool: ChordCandidate[];
    /** 可选：每个槽位的功能约束（来自影子骨架）。长度必须等于 anchors.length。 */
    functionConstraint?: HarmonicFunction[];
    /**
     * 可选：进入第一个槽位时的"虚拟前驱"—— 用于段落间 voice leading。
     * null 表示首槽位无前驱（段落首和弦）。
     */
    initialPrev?: ChordCandidate | null;
}

/**
 * 单步得分明细，debug 用。
 */
export interface ScoreBreakdown {
    slot: number;
    chord: ChordCandidate;
    topVoice: number;
    lookAhead1: number;
    lookAhead2: number;
    voiceLeading: number;
    functional: number;
    tiebreaker: number;
    total: number;
}

/**
 * Viterbi 输出。
 */
export interface ViterbiResult {
    selection: ChordCandidate[];           // 长度 = anchors.length
    totalScore: number;                    // 最优路径累计分（含 tiebreaker）
    breakdown?: ScoreBreakdown[];          // 可选 debug 明细
}

// ============================================================
// 静态预分配的 DP 表（严禁热路径 new Array）
// ============================================================

/** DP 表最大容量，对应 per-section Viterbi 的上界。 */
export const MAX_N = 32;
export const MAX_K = 40;

// 扁平化 DP 存储：dp[i * MAX_K + k]
// Int32 而非 Int16 — Luis 的硬件防溢出建议：
//   未来 PR #2/#3 加新评分项后，N=64 段落的累计分数可能突破 32K（Int16 上限）
//   Int32 多 2.5KB 内存（5KB 总），ESP32 完全无压力，且 32-bit 处理器零性能损失
const DP = new Int32Array(MAX_N * MAX_K);
// 回溯表：path[i * MAX_K + k] = 最优前驱的 k（K ≤ 40 < 256，Uint8 足够）
const PATH = new Uint8Array(MAX_N * MAX_K);

// ============================================================
// 评分权重（单位统一为"分 × 10"，低位留给 PRNG tiebreaker）
// ============================================================

const W_TOP_VOICE = 3;          // 当前骨架音权重（最高）
const W_LOOKAHEAD_1 = 1;        // 下一骨架音，权重 /2
const W_LOOKAHEAD_2 = 1;        // 下下骨架音，权重 /4
const W_VOICE_LEADING = 2;      // 每个共同音的分数
const VOICE_LEADING_CAP = 3;    // 共同音上限（防止 self-loop 满分坍塌）
const W_FUNCTIONAL = 8;         // 功能约束匹配 bias（权重提高到能压住 voice leading）
const W_REPEAT_PENALTY = -10;   // 相邻槽位选了同一个和弦的硬惩罚（强制和声运动）
const W_COMPLEXITY_TAX = -1;    // 每个超出三和弦的扩展音 -1（防止 mega-chord 坍塌）
const SCORE_SCALE = 10;         // 基础分放大 10 倍，个位留给 PRNG tiebreaker
const TIEBREAKER_RANGE = 9;     // prng.nextInt(0, 9) 共 10 档扰动（占满个位）
const NEG_INFTY = -(1 << 30);   // DP 初始"不可达"值（Int32 安全哨兵，远离正常分数范围）

// ============================================================
// 核心评分函数（热路径）
// ============================================================

/**
 * 单次评分。包含 PRNG tiebreaker，所以每次调用都会消耗一次 PRNG。
 *
 * Viterbi 的内层循环会对同一个 cand 调用 K 次（每个 prev 一次），
 * 每次 PRNG 扰动不同，这是有意为之 —— 让"同一 cand 对不同 prev"
 * 的分数也有微小差异，避免回溯表偏向数组前部。
 */
function scoreStep(
    cand: ChordCandidate,
    prev: ChordCandidate | null,
    anchor: number,
    nextAnchor: number,       // -1 表示无
    nextNextAnchor: number,   // -1 表示无
    constraint: HarmonicFunction,  // -1 表示无
): number {
    // 1. Top Voice（法则 1+2）：当前骨架音是否是这个和弦的好听音
    const iv0 = ((anchor - cand.rootPc) % 12 + 12) % 12;
    const topVoice = SCORE_TABLE[cand.quality][iv0];

    // 2. Lookahead 1（法则 2 前瞻）：下一骨架音是否也能被这个和弦托住
    let lookAhead1 = 0;
    if (nextAnchor >= 0) {
        const iv1 = ((nextAnchor - cand.rootPc) % 12 + 12) % 12;
        // 除以 2：用 >> 1 处理正数，负数用 Math.trunc 保持对称
        const raw = SCORE_TABLE[cand.quality][iv1];
        lookAhead1 = raw >= 0 ? (raw >> 1) : -((-raw) >> 1);
    }

    // 3. Lookahead 2（法则 2 长线）：下下骨架音的微弱奖励，捕获 ii-V-I 结构
    let lookAhead2 = 0;
    if (nextNextAnchor >= 0) {
        const iv2 = ((nextNextAnchor - cand.rootPc) % 12 + 12) % 12;
        const raw = SCORE_TABLE[cand.quality][iv2];
        lookAhead2 = raw >= 0 ? (raw >> 2) : -((-raw) >> 2);
    }

    // 4. Voice Leading（法则 3）：与前一和弦的共同音数（capped 防 self-loop 坍塌）
    let voiceLeading = 0;
    let repeatPenalty = 0;
    if (prev !== null) {
        if (prev.rootPc === cand.rootPc && prev.quality === cand.quality) {
            // 完全相同的和弦：voice leading 不奖励，触发硬惩罚强制和声运动
            repeatPenalty = W_REPEAT_PENALTY;
        } else {
            const ct = commonTones(cand.mask, prev.mask);
            voiceLeading = ct > VOICE_LEADING_CAP ? VOICE_LEADING_CAP : ct;
        }
    }

    // 5. Functional bias：是否匹配影子骨架的功能约束
    const functional = (constraint >= 0 && cand.functionClass === constraint) ? 1 : 0;

    // 6. Complexity tax：扩展和弦税收 —— 防止 mega-chord 用"包容性"坍塌评分
    // 三和弦 bitCount=3 不扣，每多一个 chord tone 扣 1 分
    const complexity = cand.bitCount - 3;
    const complexityTax = complexity > 0 ? complexity * W_COMPLEXITY_TAX : 0;

    // 加权求和（量纲：score × 10，个位留给 tiebreaker）
    const base =
        topVoice * W_TOP_VOICE +
        lookAhead1 * W_LOOKAHEAD_1 +
        lookAhead2 * W_LOOKAHEAD_2 +
        voiceLeading * W_VOICE_LEADING +
        functional * W_FUNCTIONAL +
        repeatPenalty +
        complexityTax;

    // PRNG tiebreaker —— Luis 的决定论防坍塌机制
    const jitter = PRNGManager.nextInt(0, TIEBREAKER_RANGE);
    return base * SCORE_SCALE + jitter;
}

/**
 * 计算并填充一个 ScoreBreakdown（debug 用，不消耗额外 PRNG）。
 * 仅在返回 breakdown 时复算，保持 PRNG 序列不被 debug 污染。
 */
function explainStep(
    slot: number,
    cand: ChordCandidate,
    prev: ChordCandidate | null,
    anchor: number,
    nextAnchor: number,
    nextNextAnchor: number,
    constraint: HarmonicFunction,
    totalFromDp: number,
): ScoreBreakdown {
    const iv0 = ((anchor - cand.rootPc) % 12 + 12) % 12;
    const topVoice = SCORE_TABLE[cand.quality][iv0];

    let lookAhead1 = 0;
    if (nextAnchor >= 0) {
        const iv1 = ((nextAnchor - cand.rootPc) % 12 + 12) % 12;
        const raw = SCORE_TABLE[cand.quality][iv1];
        lookAhead1 = raw >= 0 ? (raw >> 1) : -((-raw) >> 1);
    }
    let lookAhead2 = 0;
    if (nextNextAnchor >= 0) {
        const iv2 = ((nextNextAnchor - cand.rootPc) % 12 + 12) % 12;
        const raw = SCORE_TABLE[cand.quality][iv2];
        lookAhead2 = raw >= 0 ? (raw >> 2) : -((-raw) >> 2);
    }
    const voiceLeading = prev !== null ? commonTones(cand.mask, prev.mask) : 0;
    const functional = (constraint >= 0 && cand.functionClass === constraint) ? 1 : 0;

    const base =
        topVoice * W_TOP_VOICE +
        lookAhead1 * W_LOOKAHEAD_1 +
        lookAhead2 * W_LOOKAHEAD_2 +
        voiceLeading * W_VOICE_LEADING +
        functional * W_FUNCTIONAL;

    // totalFromDp 是 DP 表记录的总分（含 tiebreaker），
    // 回推 tiebreaker = totalFromDp - base * SCORE_SCALE（仅该步骤）
    return {
        slot,
        chord: cand,
        topVoice,
        lookAhead1,
        lookAhead2,
        voiceLeading,
        functional,
        tiebreaker: 0,  // 不可精确回推（DP 表累加了前面的），留 0 供 debug
        total: totalFromDp,
    };
}

// ============================================================
// 主入口
// ============================================================

/**
 * 执行 Viterbi DP 选择最优和弦序列。
 *
 * @throws 如果 N > MAX_N 或 K > MAX_K
 */
export function selectChords(
    input: ViterbiInput,
    withBreakdown: boolean = false,
): ViterbiResult {
    const { anchors, pool, functionConstraint, initialPrev } = input;
    const N = anchors.length;
    const K = pool.length;

    if (N === 0) {
        return { selection: [], totalScore: 0, breakdown: withBreakdown ? [] : undefined };
    }
    if (N > MAX_N) {
        throw new Error(`ViterbiChordSelector: N=${N} exceeds MAX_N=${MAX_N}. Split into smaller sections.`);
    }
    if (K > MAX_K) {
        throw new Error(`ViterbiChordSelector: K=${K} exceeds MAX_K=${MAX_K}. Shrink candidate pool.`);
    }
    if (K === 0) {
        throw new Error('ViterbiChordSelector: empty candidate pool.');
    }
    if (functionConstraint && functionConstraint.length !== N) {
        throw new Error(`functionConstraint length ${functionConstraint.length} !== anchors length ${N}`);
    }

    // 初始化 DP 第 0 列（清理脏状态）
    for (let k = 0; k < K; k++) {
        DP[k] = NEG_INFTY;
        PATH[k] = 0;
    }

    // lookahead 索引辅助
    const la1 = (i: number): number => (i + 1 < N ? anchors[i + 1] : -1);
    const la2 = (i: number): number => (i + 2 < N ? anchors[i + 2] : -1);
    const cst = (i: number): HarmonicFunction => (functionConstraint ? functionConstraint[i] : -1 as HarmonicFunction);

    // === 第 0 个槽位：initialPrev 作为虚拟前驱 ===
    const prev0 = initialPrev ?? null;
    for (let k = 0; k < K; k++) {
        const s = scoreStep(pool[k], prev0, anchors[0], la1(0), la2(0), cst(0));
        DP[k] = s;
        PATH[k] = 0; // 没有前驱
    }

    // === 第 1..N-1 个槽位：标准 Viterbi 转移 ===
    for (let i = 1; i < N; i++) {
        const anchor = anchors[i];
        const nextA = la1(i);
        const nextNextA = la2(i);
        const constraint = cst(i);
        const rowPrev = (i - 1) * MAX_K;
        const rowCurr = i * MAX_K;

        for (let k = 0; k < K; k++) {
            const cand = pool[k];
            let bestScore = NEG_INFTY;
            let bestPrev = 0;

            for (let j = 0; j < K; j++) {
                const prevScore = DP[rowPrev + j];
                if (prevScore <= NEG_INFTY) continue;
                const trans = scoreStep(cand, pool[j], anchor, nextA, nextNextA, constraint);
                const total = prevScore + trans;
                if (total > bestScore) {
                    bestScore = total;
                    bestPrev = j;
                }
            }

            DP[rowCurr + k] = bestScore;
            PATH[rowCurr + k] = bestPrev;
        }
    }

    // === 回溯：找最后一列的最高分 ===
    let bestLastK = 0;
    let bestLastScore = NEG_INFTY;
    const rowLast = (N - 1) * MAX_K;
    for (let k = 0; k < K; k++) {
        const s = DP[rowLast + k];
        if (s > bestLastScore) {
            bestLastScore = s;
            bestLastK = k;
        }
    }

    const selection: ChordCandidate[] = new Array(N);
    let curK = bestLastK;
    for (let i = N - 1; i >= 0; i--) {
        selection[i] = pool[curK];
        if (i > 0) curK = PATH[i * MAX_K + curK];
    }

    // === 可选：构造 breakdown（不影响 PRNG）===
    // 重新按 selection 顺序回推每步累计分
    let breakdown: ScoreBreakdown[] | undefined;
    if (withBreakdown) {
        breakdown = new Array(N);
        // 先找到每步在 DP 表里对应的 k（直接从 selection + pool 身份相等匹配）
        // pool 中元素独立，selection[i] === pool[k] 时 k 即为该步槽位 k
        // 由于 pool 数组里每个 candidate 是唯一对象，可以用 indexOf
        let prev: ChordCandidate | null = prev0;
        for (let i = 0; i < N; i++) {
            const cand = selection[i];
            const k = pool.indexOf(cand);
            const totalAtSlot = k >= 0 ? DP[i * MAX_K + k] : 0;
            breakdown[i] = explainStep(
                i, cand, prev,
                anchors[i], la1(i), la2(i), cst(i),
                totalAtSlot,
            );
            prev = cand;
        }
    }

    return {
        selection,
        totalScore: bestLastScore,
        breakdown,
    };
}
