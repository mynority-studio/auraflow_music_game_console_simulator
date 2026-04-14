// ==========================================
// 📄 /src/core/generation/harmony/CandidatePool.ts
// 🌟 PR #2: Viterbi 候选和弦池构建
//
// 风格驱动的"白名单"：对每种 Tonality（PR #2 仅大调），
// 提供一组 ChordCandidate，作为 Viterbi 选择的上界。
//
// 设计哲学：
//   - 候选池一旦构建就不变（运行时静态读取，无热路径分配）
//   - 风格通过"包含哪些候选 + 候选权重"驱动，而非"概率开关"
//   - PR #2 限定 C 大调 + Default 风格，未来 PR 可按 styleId 提供不同池
//
// 当前 Default 大调池 = 28 个候选，K ≤ MAX_K(40) 充裕
// ==========================================

import { ChordQuality } from '../types';
import { Tonality } from '../types';
import {
    ChordCandidate,
    HarmonicFunction,
    makeCandidate,
} from './ViterbiChordSelector';

const T = HarmonicFunction.Tonic;
const S = HarmonicFunction.Subdominant;
const D = HarmonicFunction.Dominant;

/**
 * Default 风格 — C 大调（相对空间）候选池。
 *
 * 分层组织：
 *   1. 主三和弦骨架（I/IV/V/vi/ii/iii，共 6 个）
 *   2. 七和弦扩展（Imaj7/IVmaj7/V7/vi7/ii7/iii7，共 6 个）
 *   3. 高级色彩（Imaj9/Cadd9/vi9/ii9，共 4 个）
 *   4. 副属和弦（V/V, V/vi, V/ii, V/iii，共 4 个）
 *   5. 借调和弦（bIII, bVI, bVII, iv，共 4 个）
 *   6. sus 和 dim（V7sus4, Vsus4, viidim, viidim7，共 4 个）
 *
 * 总计 28 个候选。
 */
function buildMajorPool(): ChordCandidate[] {
    return [
        // ── 1. 自然三和弦骨架 ──
        makeCandidate(0,  ChordQuality.Major,         T),  // I    C
        makeCandidate(2,  ChordQuality.Minor,         S),  // ii   Dm
        makeCandidate(4,  ChordQuality.Minor,         T),  // iii  Em (T 代理)
        makeCandidate(5,  ChordQuality.Major,         S),  // IV   F
        makeCandidate(7,  ChordQuality.Major,         D),  // V    G
        makeCandidate(9,  ChordQuality.Minor,         T),  // vi   Am (T 代理)

        // ── 2. 七和弦扩展 ──
        makeCandidate(0,  ChordQuality.Major7,        T),  // Imaj7
        makeCandidate(2,  ChordQuality.Minor7,        S),  // ii7
        makeCandidate(4,  ChordQuality.Minor7,        T),  // iii7
        makeCandidate(5,  ChordQuality.Major7,        S),  // IVmaj7
        makeCandidate(7,  ChordQuality.Dominant7,     D),  // V7
        makeCandidate(9,  ChordQuality.Minor7,        T),  // vi7

        // ── 3. 高级色彩 ──
        makeCandidate(0,  ChordQuality.Major9,        T),  // Imaj9
        makeCandidate(0,  ChordQuality.Add9,          T),  // Cadd9
        makeCandidate(2,  ChordQuality.Minor9,        S),  // ii9
        makeCandidate(9,  ChordQuality.Minor9,        T),  // vi9

        // ── 4. 副属（Secondary Dominants）──
        makeCandidate(2,  ChordQuality.Dominant7,     D),  // V/V  = D7  (II7)
        makeCandidate(4,  ChordQuality.Dominant7,     D),  // V/vi = E7  (III7)
        makeCandidate(9,  ChordQuality.Dominant7,     D),  // V/ii = A7  (VI7)
        makeCandidate(11, ChordQuality.Dominant7,     D),  // V/iii = B7 (VII7)

        // ── 5. 借调（Modal Mixture）──
        makeCandidate(3,  ChordQuality.Major,         S),  // bIII Eb
        makeCandidate(8,  ChordQuality.Major,         S),  // bVI  Ab
        makeCandidate(10, ChordQuality.Major,         S),  // bVII Bb
        makeCandidate(5,  ChordQuality.Minor,         S),  // iv   Fm  (同主小借)

        // ── 6. sus & 减和弦 ──
        makeCandidate(7,  ChordQuality.Sus4,          D),  // Vsus4 Gsus4
        makeCandidate(7,  ChordQuality.Dominant7Sus4, D),  // V7sus4
        makeCandidate(0,  ChordQuality.Sus4,          T),  // Isus4 Csus4
        makeCandidate(11, ChordQuality.HalfDiminished, D), // viim7b5
    ];
}

/**
 * 主入口：根据 tonality 返回对应的候选池。
 * PR #2 仅支持 Major，其他调式回退到 Major（PR #3 会补全）。
 */
export function getCandidatePool(tonality: Tonality): ChordCandidate[] {
    void tonality; // PR #2 限定大调
    return buildMajorPool();
}
