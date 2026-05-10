// ============================================================
// ViterbiChordSelector — 张力驱动的 HMM + Viterbi 智能重配
// ============================================================
// Pitch Space: RELATIVE（candidates 的 root 全部 0~11，相对调式主音）
//
// 算法概览：
//   - 输入  basicChords (HarmonyCore 骨架) + melody + tonality + tensionMultiplier
//   - 状态  N 个候选和弦（动态构建：顺阶 ∪ 借调色彩 ∪ 骨架保底）
//   - 时间  T 个槽位（与 basicChords 一一对应，保留时间结构）
//   - DP    V[t][i] = 到第 t 步选第 i 个候选的最佳累计分
//           ptr[t][i] = 选 i 时的最优前驱 prev
//   - 终止  全曲末尾给主音和弦 (root=0) 额外 +10 分以倾向收束
//
// 评分维度：
//   emission(cand, slice)     — 旋律音落入候选和弦音得 +5×duration，落外 -3×duration
//   transition(prev, curr)    — 环形距离 + 张力门 + 半音平滑 + bVI→V 黄金奖励
//
// tensionMultiplier (0.0 ~ 1.0)：
//   - 0.0 → 离调被强烈惩罚 (-10)，乖乖弹原调
//   - 1.0 → 离调零惩罚，开始秀操作（神级编配 1-6-b6-5 自发涌现）
//   - 由 runPipeline 按段落传入：第一段 Chorus = 0.2，Final Chorus / Bridge = 1.0
//
// C++ 移植：DP 矩阵全部用 Float32Array (V) 和 Int32Array (ptr) 扁平化，
//   索引 t*N + i，零内部对象分配，零 GC 压力。
// ============================================================

import { GeneratedChord, NoteData, Tonality, ChordQuality, ChordQualityName, SCALE_INTERVALS } from '../types';
import { MusicTheory } from '../theory/MusicTheory';

interface ChordCandidate {
    numeral: string;
    root: number;
    quality: ChordQuality;
}

const BEAT_EPS = 0.001;
const NEG_INF = -999999;

// 评分权重（emission / 末态）
const EMIT_IN_CHORD = 5.0;
const EMIT_OUT_OF_CHORD = 3.0;
const INIT_TONIC_BONUS = 5.0;
const INIT_MATCH_BONUS = 5.0;
const SKELETON_MATCH_BONUS = 4.0;
const FINAL_TONIC_BONUS = 10.0;

// 评分权重（transition：基础环形距离）
const TRANS_FOURTH = 8.0;
const TRANS_FIFTH = 4.0;
const TRANS_SECOND = 2.0;
const TRANS_THIRD = 1.0;
const TRANS_TRITONE_PENALTY = 5.0;
const TRANS_REPEAT_PENALTY = 4.0;
const TRANS_V7_TO_I_BONUS = 5.0;

// 评分权重（transition：高级法则）
const BORROWED_PENALTY_MAX = 10.0;   // 离调最大惩罚（tension=0 时全额扣）
const CHROMATIC_SMOOTH_BONUS = 6.0;  // 半音平滑（vi→bVI→V 类）
const BVI_TO_V_BONUS = 5.0;          // bVI(8) → V(7) 黄金进行

export class ViterbiChordSelector {
    /**
     * @param basicChords        HarmonyCore 骨架（已含 startBeat / endBeat / keyOffset）
     * @param melody             已生成的旋律（相对空间 pitch）
     * @param tonality           调式
     * @param tensionMultiplier  张力乘数 0~1（默认 0.5 — 中等张力，向后兼容旧调用）
     */
    public static reharmonize(
        basicChords: GeneratedChord[],
        melody: NoteData[],
        tonality: Tonality,
        tensionMultiplier: number = 0.5,
    ): GeneratedChord[] {
        const tension = tensionMultiplier < 0 ? 0 : tensionMultiplier > 1 ? 1 : tensionMultiplier;

        const candidates = this.buildCandidates(tonality, basicChords);
        const diatonicMask = this.buildDiatonicMask(tonality);

        const T = basicChords.length;
        const N = candidates.length;
        if (T === 0) return [];

        // 扁平 DP 矩阵：dp[t * N + i] / ptr[t * N + i]
        const dp = new Float32Array(T * N);
        const ptr = new Int32Array(T * N);

        // 预切片：每个时间槽内的旋律音，避免内层重复扫描全曲
        const melodySlices: NoteData[][] = [];
        for (let t = 0; t < T; t++) {
            const c = basicChords[t];
            const slice: NoteData[] = [];
            for (let i = 0; i < melody.length; i++) {
                const n = melody[i];
                if (n.onset >= c.startBeat - BEAT_EPS && n.onset < c.endBeat - BEAT_EPS) {
                    slice.push(n);
                }
            }
            melodySlices.push(slice);
        }

        // t=0 初始化：emission + 主音 / 骨架匹配奖励
        for (let i = 0; i < N; i++) {
            const em = this.getEmissionScore(candidates[i], melodySlices[0]);
            let trans = 0;
            if (candidates[i].root === 0) trans += INIT_TONIC_BONUS;
            if (candidates[i].root === basicChords[0].root) trans += INIT_MATCH_BONUS;
            dp[i] = em + trans;
            ptr[i] = -1;
        }

        // t=1..T-1 转移
        for (let t = 1; t < T; t++) {
            const slice = melodySlices[t];
            const origChord = basicChords[t];

            for (let currIdx = 0; currIdx < N; currIdx++) {
                const curr = candidates[currIdx];
                const em = this.getEmissionScore(curr, slice);
                let maxVal = NEG_INF;
                let bestPrev = 0;

                for (let prevIdx = 0; prevIdx < N; prevIdx++) {
                    const prev = candidates[prevIdx];
                    let trans = this.getTransitionScore(prev, curr, diatonicMask, tension);

                    // 骨架匹配：与 HarmonyCore 原推荐根音一致额外加分（保留风格池倾向）
                    if (curr.root === origChord.root) trans += SKELETON_MATCH_BONUS;
                    // 末态收束：最后一拍倾向主音
                    if (t === T - 1 && curr.root === 0) trans += FINAL_TONIC_BONUS;

                    const val = dp[(t - 1) * N + prevIdx] + trans + em;
                    if (val > maxVal) {
                        maxVal = val;
                        bestPrev = prevIdx;
                    }
                }
                dp[t * N + currIdx] = maxVal;
                ptr[t * N + currIdx] = bestPrev;
            }
        }

        // 末态选择：argmax + 主音奖励
        let bestLast = 0;
        let maxV = NEG_INF;
        for (let i = 0; i < N; i++) {
            let score = dp[(T - 1) * N + i];
            if (candidates[i].root === 0) score += FINAL_TONIC_BONUS;
            if (score > maxV) {
                maxV = score;
                bestLast = i;
            }
        }

        // 回溯 path
        const path: number[] = [];
        let currState = bestLast;
        for (let t = T - 1; t >= 0; t--) {
            path.push(currState);
            currState = ptr[t * N + currState];
        }
        path.reverse();

        // 装配输出（保持原 startBeat / endBeat / keyOffset，含抢拍后的非整拍切分）
        const finalChords: GeneratedChord[] = [];
        for (let t = 0; t < T; t++) {
            const cand = candidates[path[t]];
            const orig = basicChords[t];
            // 保留原始 slash-chord bassOverride（仅当 Viterbi 维持了同根音的和弦时）
            const preserveBass = orig.bassOverride !== undefined && cand.root === orig.root;
            finalChords.push({
                numeral: cand.numeral,
                root: cand.root,
                quality: ChordQualityName[cand.quality] as GeneratedChord['quality'],
                startBeat: orig.startBeat,
                endBeat: orig.endBeat,
                keyOffset: orig.keyOffset,
                ...(preserveBass ? { bassOverride: orig.bassOverride } : {}),
            });
        }
        return finalChords;
    }

    // --------------------------------------------------------
    // 候选池构建：顺阶 ∪ 借调 ∪ 骨架保底
    // --------------------------------------------------------
    /**
     * 用 (root << 5 | quality) 做唯一性比较——root 0~11 占 4 bit、quality 0~16 占 5 bit，
     * 单 int 编码 (root, quality) 对，避免 Map/Set（rule P-1）。
     * 总数控制在 25-30 个内（性能上限），实际通常 ~20。
     */
    private static buildCandidates(
        tonality: Tonality,
        basicChords: GeneratedChord[],
    ): ChordCandidate[] {
        const isMinor =
            tonality === Tonality.Minor ||
            tonality === Tonality.Minor_Pentatonic ||
            tonality === Tonality.Dorian ||
            tonality === Tonality.Melodic_Minor ||
            tonality === Tonality.Harmonic_Minor ||
            tonality === Tonality.Phrygian ||
            tonality === Tonality.Blues;

        const merged: ChordCandidate[] = [];
        const seen: number[] = [];

        const add = (cand: ChordCandidate) => {
            const key = (cand.root << 5) | cand.quality;
            for (let i = 0; i < seen.length; i++) {
                if (seen[i] === key) return;
            }
            merged.push(cand);
            seen.push(key);
        };

        // 1) 顺阶和弦（提取自当前 tonality）
        if (isMinor) {
            add({ numeral: 'i',      root: 0,  quality: ChordQuality.Minor });
            add({ numeral: 'iidim',  root: 2,  quality: ChordQuality.Diminished });
            add({ numeral: 'III',    root: 3,  quality: ChordQuality.Major });
            add({ numeral: 'iv',     root: 5,  quality: ChordQuality.Minor });
            add({ numeral: 'v',      root: 7,  quality: ChordQuality.Minor });
            add({ numeral: 'V',      root: 7,  quality: ChordQuality.Major });        // 和声小调 V
            add({ numeral: 'V7',     root: 7,  quality: ChordQuality.Dominant7 });    // 和声小调 V7
            add({ numeral: 'VI',     root: 8,  quality: ChordQuality.Major });
            add({ numeral: 'VII',    root: 10, quality: ChordQuality.Major });
            // 七和弦色彩
            add({ numeral: 'i7',     root: 0,  quality: ChordQuality.Minor7 });
            add({ numeral: 'iv7',    root: 5,  quality: ChordQuality.Minor7 });
            add({ numeral: 'VImaj7', root: 8,  quality: ChordQuality.Major7 });
        } else {
            add({ numeral: 'I',      root: 0,  quality: ChordQuality.Major });
            add({ numeral: 'ii',     root: 2,  quality: ChordQuality.Minor });
            add({ numeral: 'iii',    root: 4,  quality: ChordQuality.Minor });
            add({ numeral: 'IV',     root: 5,  quality: ChordQuality.Major });
            add({ numeral: 'V',      root: 7,  quality: ChordQuality.Major });
            add({ numeral: 'vi',     root: 9,  quality: ChordQuality.Minor });
            add({ numeral: 'viidim', root: 11, quality: ChordQuality.Diminished });
            // 七和弦色彩
            add({ numeral: 'Imaj7',  root: 0,  quality: ChordQuality.Major7 });
            add({ numeral: 'ii7',    root: 2,  quality: ChordQuality.Minor7 });
            add({ numeral: 'IVmaj7', root: 5,  quality: ChordQuality.Major7 });
            add({ numeral: 'V7',     root: 7,  quality: ChordQuality.Dominant7 });
            add({ numeral: 'vi7',    root: 9,  quality: ChordQuality.Minor7 });
        }

        // 2) 常见借调/离调色彩和弦（无视 tonality 一律开放，由 tension gate 控制使用）
        add({ numeral: 'bVI',  root: 8,  quality: ChordQuality.Major });    // 平行小调借（神级 1-6-b6-5 关键和弦）
        add({ numeral: 'bIII', root: 3,  quality: ChordQuality.Major });    // 平行小调借
        add({ numeral: 'iv',   root: 5,  quality: ChordQuality.Minor });    // modal mixture（大调借小四）
        add({ numeral: 'bII',  root: 1,  quality: ChordQuality.Major });    // Neapolitan
        add({ numeral: 'bVII', root: 10, quality: ChordQuality.Major });    // Mixolydian

        // 3) 骨架保底：风格池里出现的所有 (root, quality) 唯一对一定能选回来
        for (let i = 0; i < basicChords.length; i++) {
            const ch = basicChords[i];
            const qEnum = ChordQuality[ch.quality as keyof typeof ChordQuality];
            if (qEnum === undefined) continue;
            add({ numeral: ch.numeral, root: ch.root, quality: qEnum });
        }

        return merged;
    }

    /**
     * 当前调式的 pitch class 位掩码（bit i 设位 = i 是顺阶音）。
     * 用于 transition 中判断 curr.root 是否为离调和弦根（O(1) 位运算）。
     */
    private static buildDiatonicMask(tonality: Tonality): number {
        const intervals = SCALE_INTERVALS[tonality];
        let mask = 0;
        for (let i = 0; i < intervals.length; i++) {
            mask |= (1 << intervals[i]);
        }
        return mask | 0;
    }

    /**
     * 发射分：旋律音落入候选和弦音得 +5×duration，落外 -3×duration。
     * 没有旋律音时返回 0（不影响候选偏好）。
     */
    private static getEmissionScore(cand: ChordCandidate, notes: NoteData[]): number {
        if (notes.length === 0) return 0;

        const intervals = MusicTheory.getChordTones(cand.quality);
        const chordPcs: number[] = [];
        for (let i = 0; i < intervals.length; i++) {
            chordPcs.push(((cand.root + intervals[i]) % 12 + 12) % 12);
        }

        let score = 0;
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const pc = ((Math.round(note.pitch) % 12) + 12) % 12;

            let inChord = false;
            for (let j = 0; j < chordPcs.length; j++) {
                if (chordPcs[j] === pc) {
                    inChord = true;
                    break;
                }
            }

            if (inChord) score += note.duration * EMIT_IN_CHORD;
            else score -= note.duration * EMIT_OUT_OF_CHORD;
        }
        return score;
    }

    /**
     * 转移分：基础环形距离 + 张力门 + 半音平滑 + 黄金进行。
     *
     * 1. 环形距离（保留旧逻辑）
     *    diff 5  上四度 / V→I 类         +8
     *    diff 7  上五度                   +4
     *    diff 2/10 二度                   +2
     *    diff 3/4/8/9 三度                +1
     *    diff 6  三全音                   -5
     *    diff 0 同质量 (停滞)             -4
     *    prev=Dom7 + diff 5 (V7→I 解决)   +5
     *
     * 2. 离调惩罚 (Tension Gate)
     *    curr.root ∉ diatonic           -10 × (1 - tension)
     *    tension=0 → 全额惩罚（乖乖弹原调）
     *    tension=1 → 零惩罚（开始秀操作）
     *
     * 3. 半音平滑 (Chromatic Bass Descent)
     *    diff 1 或 11                    +6
     *    （vi → bVI → V 这种声部下行串联会被算法主动选中）
     *
     * 4. 功能替代 (bVI → V 黄金进行)
     *    prev.root=8 ∧ curr.root=7       +5
     *    （平滑下属替代，进入 V 解决）
     */
    private static getTransitionScore(
        prev: ChordCandidate,
        curr: ChordCandidate,
        diatonicMask: number,
        tensionMultiplier: number,
    ): number {
        let score = 0;
        const diff = ((curr.root - prev.root) % 12 + 12) % 12;

        // 1. 基础环形距离打分
        if (diff === 5) score += TRANS_FOURTH;
        else if (diff === 7) score += TRANS_FIFTH;
        else if (diff === 2 || diff === 10) score += TRANS_SECOND;
        else if (diff === 3 || diff === 4 || diff === 8 || diff === 9) score += TRANS_THIRD;
        else if (diff === 6) score -= TRANS_TRITONE_PENALTY;

        if (diff === 0 && curr.quality === prev.quality) score -= TRANS_REPEAT_PENALTY;

        if (prev.quality === ChordQuality.Dominant7 && diff === 5) score += TRANS_V7_TO_I_BONUS;

        // 2. 离调惩罚受张力乘数控制（Tension Gate）
        const isCurrBorrowed = (diatonicMask & (1 << curr.root)) === 0;
        if (isCurrBorrowed) {
            score -= BORROWED_PENALTY_MAX * (1.0 - tensionMultiplier);
        }

        // 3. 半音平滑法则（vi → bVI → V 串联自发涌现）
        if (diff === 1 || diff === 11) {
            score += CHROMATIC_SMOOTH_BONUS;
        }

        // 4. 功能替代法则：bVI(8) → V(7) 黄金进行
        if (prev.root === 8 && curr.root === 7) {
            score += BVI_TO_V_BONUS;
        }

        return score;
    }
}
