/**
 * WeightedPitchSelector — 一维加权 pitch 打分 + 抽样 / Top-N 选择器
 *
 * 参考实现：Impro-Visor `imp.voicing.VoicingGenerator`
 *   - allMidiValues[128] 作为 score buffer
 *   - setupNote / weightPreviousVoicing / multiplyNotes 等乘法工具
 *   - calculate() 的加权抽样 + 邻近压制循环
 *
 * **命名说明**：参考源虽然挂在 voicing 目录下，但其算法是带局部上下文感知的加权打分 + 抽样，
 *   并非标准 Viterbi DP（无状态序列、无 backtrace）。本类如实保留参考语义，
 *   命名为 WeightedPitchSelector。若未来需要"跨和弦最优 voicing 路径"的真 Viterbi，
 *   新建 ViterbiPathFinder 调用本类即可。
 *
 * Pitch Space（K-7）：由 caller 通过 ctor 的 pitchSpaceSize 决定 —
 *   - 12  → RELATIVE pitch class（0..11，半音步）
 *   - 128 → ABSOLUTE MIDI（0..127）
 *   - 其它正整数也合法，caller 自负其义。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: pickWeighted 走 PRNGManager
 *   D-3: selectTopN 同分时 pitch 升序破 tie（完全确定的比较）
 *   P-1: 扁平 number[] score buffer
 *   P-3 / P-4: 整型边界 Math.floor / `| 0`
 *   T-3: 无 any
 *   S-3 / S-4: 同步，可序列化（仅暴露 number 接口）
 */

import { PRNGManager } from '../../utils/PRNG';

const PITCH_CLASS_SIZE = 12;

export interface WeightedPitchSelectorConfig {
    /**
     * Pitch Space:
     *   - 12  → RELATIVE pitch class
     *   - 128 → ABSOLUTE MIDI
     *   - 其它正整数也合法，但语义由 caller 决定
     */
    pitchSpaceSize: number;
    /** 应用到上次 voicing 同 pitch 的乘数（>1 加权 voice leading） */
    previousVoicingMultiplier?: number;
    /** 应用到上次 voicing 半音邻居的乘数 */
    halfStepAwayMultiplier?: number;
    /** 应用到上次 voicing 全音邻居的乘数 */
    fullStepAwayMultiplier?: number;
    /** 选中音后，对其半音邻居施加的乘数（<1 压制） */
    halfStepReducer?: number;
    /** 选中音后，对其全音邻居施加的乘数（<1 压制） */
    fullStepReducer?: number;
    /** 同 pitch class 跨八度乘数（<1 抑制重复，>1 鼓励八度叠加） */
    repeatMultiplier?: number;
}

interface ResolvedConfig {
    pitchSpaceSize: number;
    previousVoicingMultiplier: number;
    halfStepAwayMultiplier: number;
    fullStepAwayMultiplier: number;
    halfStepReducer: number;
    fullStepReducer: number;
    repeatMultiplier: number;
}

export class WeightedPitchSelectorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'WeightedPitchSelectorError';
        this.context = context;
    }
}

export class WeightedPitchSelector {
    private readonly cfg: ResolvedConfig;
    private readonly size: number;
    private readonly scores: number[];

    constructor(config: WeightedPitchSelectorConfig) {
        const size = Math.floor(config.pitchSpaceSize);
        if (!(size > 0)) {
            throw new WeightedPitchSelectorError(
                'pitchSpaceSize must be > 0',
                { actual: config.pitchSpaceSize },
            );
        }
        this.size = size;
        this.scores = new Array<number>(size);
        for (let i = 0; i < size; i++) this.scores[i] = 0;

        this.cfg = {
            pitchSpaceSize: size,
            previousVoicingMultiplier: config.previousVoicingMultiplier ?? 1,
            halfStepAwayMultiplier:    config.halfStepAwayMultiplier ?? 1,
            fullStepAwayMultiplier:    config.fullStepAwayMultiplier ?? 1,
            halfStepReducer:           config.halfStepReducer ?? 1,
            fullStepReducer:           config.fullStepReducer ?? 1,
            repeatMultiplier:          config.repeatMultiplier ?? 1,
        };
    }

    /** 清零整个 score buffer */
    public reset(): void {
        for (let i = 0; i < this.size; i++) this.scores[i] = 0;
    }

    /**
     * 单点设置 base score（覆盖原值，转 int32）。
     * Pitch Space: 同 ctor 的 pitchSpaceSize。
     */
    public setBase(pitch: number, score: number): void {
        const p = pitch | 0;
        if (p < 0 || p >= this.size) return;
        this.scores[p] = score | 0;
    }

    /**
     * 把某 pitch class 在所有八度上同时设为 score。
     * 对齐 VoicingGenerator.setupNote(midiValue, priority)。
     * 当 pitchSpaceSize=12 时退化为单点；当 pitchSpaceSize=128 时跨所有八度。
     */
    public setBaseAllOctaves(pitchClass: number, score: number): void {
        const pc = WeightedPitchSelector.normalizePitchClass(pitchClass);
        const s = score | 0;
        for (let i = pc; i < this.size; i += PITCH_CLASS_SIZE) {
            this.scores[i] = s;
        }
    }

    /**
     * 对 centerPitch 同点 + 半音/全音邻居施加加权乘数（典型用法：voice leading 偏向）。
     * 对齐 VoicingGenerator.weightPreviousVoicing。
     */
    public applyProximityMultipliers(centerPitch: number): void {
        const c = centerPitch | 0;
        this.mulSlot(c, this.cfg.previousVoicingMultiplier);
        this.mulSlot(c - 1, this.cfg.halfStepAwayMultiplier);
        this.mulSlot(c + 1, this.cfg.halfStepAwayMultiplier);
        this.mulSlot(c - 2, this.cfg.fullStepAwayMultiplier);
        this.mulSlot(c + 2, this.cfg.fullStepAwayMultiplier);
    }

    /**
     * 选中 centerPitch 之后对其半音/全音邻居施加压制乘数（避免半音 crash）。
     * 对齐 VoicingGenerator.calculate() 内 halfStepReducer/fullStepReducer 分支。
     */
    public applyProximityReducers(centerPitch: number): void {
        const c = centerPitch | 0;
        this.mulSlot(c - 1, this.cfg.halfStepReducer);
        this.mulSlot(c + 1, this.cfg.halfStepReducer);
        this.mulSlot(c - 2, this.cfg.fullStepReducer);
        this.mulSlot(c + 2, this.cfg.fullStepReducer);
    }

    /**
     * 同 pitch class 跨八度施加 repeatMultiplier（抑制 / 鼓励八度叠加）。
     * 对齐 VoicingGenerator.multiplyNotes(midiValue, multiplier)。
     */
    public applyRepeatMultiplier(pitch: number): void {
        const pc = WeightedPitchSelector.normalizePitchClass(pitch);
        const m = this.cfg.repeatMultiplier;
        for (let i = pc; i < this.size; i += PITCH_CLASS_SIZE) {
            this.scores[i] = (this.scores[i] * m) | 0;
        }
    }

    /** 把单 slot score 置 0（用于"已选音"屏蔽） */
    public silence(pitch: number): void {
        const p = pitch | 0;
        if (p < 0 || p >= this.size) return;
        this.scores[p] = 0;
    }

    /**
     * 单点不对称乘数 — 处理音乐物理规则中带方向 / 精准打击的需求：
     *   - 倾向音解决目标 boost（V7 的 leading tone 只允许上行解决到主音，而非对称辐射）
     *   - parallel 5/8 度惩罚（仅对特定候选 pitch 降权）
     *   - 任何 caller 自定义的 vector / targeted 操作
     *
     * 与 applyProximityMultipliers 的对称辐射互补 — 后者是它的多点组合包装。
     * score == 0 时跳过（避免负 multiplier 翻正、避免对未 seed 的 slot 误伤）。
     * Pitch Space: 同 ctor 的 pitchSpaceSize。
     */
    public applyMultiplier(pitch: number, multiplier: number): void {
        const p = pitch | 0;
        if (p < 0 || p >= this.size) return;
        const cur = this.scores[p];
        if (cur <= 0) return;
        this.scores[p] = (cur * multiplier) | 0;
    }

    /**
     * 加权抽样：在 [lo, hi] 闭区间内按 score 作权重抽 1 个 pitch。
     *
     * 算法对齐 VoicingGenerator.calculate() 的 allLeftValues 抽样：
     *   1. 第 1 次扫描累加 total
     *   2. r = PRNGManager.next() * total
     *   3. 第 2 次扫描，累计区间命中
     *
     * 不构造扁平 pool 数组（避免 O(Σscore) 内存放大，C-3 友好）。
     *
     * 返回 -1：区间内全部为 0 / 区间非法。caller 自检。
     *
     * Pitch Space: 同 ctor 的 pitchSpaceSize。
     */
    public pickWeighted(lo: number = 0, hi?: number): number {
        const lowB = Math.max(0, lo | 0);
        const highB = Math.min(this.size - 1, (hi !== undefined ? (hi | 0) : this.size - 1));
        if (lowB > highB) return -1;

        let total = 0;
        for (let i = lowB; i <= highB; i++) {
            const s = this.scores[i];
            if (s > 0) total += s;
        }
        if (total <= 0) return -1;

        const pick = PRNGManager.next() * total;
        let cumulative = 0;
        let lastValid = -1;
        for (let i = lowB; i <= highB; i++) {
            const s = this.scores[i];
            if (s > 0) {
                cumulative += s;
                lastValid = i;
                if (pick < cumulative) return i;
            }
        }
        return lastValid;  // 浮点边界回退
    }

    /**
     * 确定性 top-N：返回 score 最高的 N 个 pitch。
     *
     * 同分破 tie 规则（D-3）：pitch 升序 — 完全确定，不依赖排序算法稳定性。
     *
     * Pitch Space: 同 ctor 的 pitchSpaceSize。
     */
    public selectTopN(n: number, lo: number = 0, hi?: number): number[] {
        const lowB = Math.max(0, lo | 0);
        const highB = Math.min(this.size - 1, (hi !== undefined ? (hi | 0) : this.size - 1));
        const limit = Math.max(0, n | 0);
        if (limit === 0 || lowB > highB) return [];

        // 平行数组收集候选（C-3 友好 — C 端直接两个 int 数组）
        const pitchesBuf: number[] = [];
        const scoresBuf: number[] = [];
        for (let i = lowB; i <= highB; i++) {
            const s = this.scores[i];
            if (s > 0) {
                pitchesBuf.push(i);
                scoresBuf.push(s);
            }
        }

        const count = pitchesBuf.length;
        if (count === 0) return [];

        // 索引数组排序 — 比较器完全确定（score 降序 → pitch 升序破 tie）
        const idx: number[] = new Array(count);
        for (let i = 0; i < count; i++) idx[i] = i;
        idx.sort((a, b) => {
            const sa = scoresBuf[a];
            const sb = scoresBuf[b];
            if (sb !== sa) return sb - sa;
            return pitchesBuf[a] - pitchesBuf[b];
        });

        const outLen = Math.min(limit, count);
        const out: number[] = new Array(outLen);
        for (let i = 0; i < outLen; i++) out[i] = pitchesBuf[idx[i]];
        return out;
    }

    /** 单 slot 当前 score（调试 / 测试用） */
    public getScore(pitch: number): number {
        const p = pitch | 0;
        if (p < 0 || p >= this.size) return 0;
        return this.scores[p];
    }

    /** 当前 pitch space 大小 */
    public getSize(): number {
        return this.size;
    }

    /**
     * 内部：单 slot 乘法。score == 0 时直接跳过（避免 0 * m 浪费指令，
     * 也避免负 score 因 m<0 翻正）。
     */
    private mulSlot(pitch: number, m: number): void {
        if (pitch < 0 || pitch >= this.size) return;
        const cur = this.scores[pitch];
        if (cur <= 0) return;
        this.scores[pitch] = (cur * m) | 0;
    }

    /** pitch → [0, 11] 的 pitch class，正确处理负数（P-3 / P-5） */
    private static normalizePitchClass(pitch: number): number {
        const raw = (pitch | 0) % PITCH_CLASS_SIZE;
        return raw < 0 ? raw + PITCH_CLASS_SIZE : raw;
    }
}
