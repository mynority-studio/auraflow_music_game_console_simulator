/**
 * HarmonyCore — 和声推演与声部连接核心（Phase 6 换脑手术后）
 *
 * 职责：
 *   1. 和弦序列推演 — **委托给 MacroProgressionEngine 做纯代数推演**
 *      （旧版基于 ChordTransitionMatrix 静态字典的实现已删除）
 *   2. 用 WeightedPitchSelector 为相邻和弦计算 Voice Leading 方案 — **Phase 2.5 实现保留不动**
 *      - 共同音保留 + 半音 / 全音步奖励（对称辐射）
 *      - 倾向音解决（向量精准打击）
 *      - 平行 5/8 度后扫描惩罚
 *      - 声部交叉 lo/hi 硬隔离（绝不用拒绝采样 — 保 D-5 PRNG 快照对齐）
 *
 * 风格无关：HarmonyCore 本身是"冷酷的物理推演机"，不认识 Pop / Jazz。
 *   - 进行结构由 HarmonyRulesConfig（4 个变异门 + 3×3 功能矩阵 + 变体权重）驱动
 *   - 声部连接由 VoiceLeadingConfig（multiplier / role 表 / 倾向音规则）驱动
 *
 * Pitch Space: RELATIVE（K-1 / K-7）
 *   输入 chord.root：0~11 相对调式主音
 *   输出 voicings[i][j]：MIDI pitch（相对空间 — 未加 keyOffset）
 *   由 Orchestrator.applyOffset() 统一加 keyOffset 转绝对空间
 *
 * 约束遵从：
 *   D-1: PRNG 走 PRNGManager；D-3: 排序完全确定；D-4: 浮点 epsilon
 *   P-1: 无 Map/Set，全数组线性扫描
 *   T-1: 不做字符串子串分类；T-3: 无 any
 *   S-2 / S-3 / S-4: 显式参数，全同步，输出纯数据
 *   K-2 / K-5: 不读 GlobalContext，不加 keyOffset；voicings 仍在相对空间
 */

import {
    GeneratedChord, SectionMetadata, Tonality,
    ChordQuality, CHORD_INTERVALS,
} from '../types';
import { WeightedPitchSelector } from '../primitives/WeightedPitchSelector';
import {
    MacroProgressionEngine, HarmonyRulesConfig,
} from './MacroProgressionEngine';

const EPSILON = 1e-6;
const PITCH_CLASS_SIZE = 12;
const PARALLEL_FIFTH_INTERVAL = 7;  // P5 半音数
const PARALLEL_OCTAVE_INTERVAL = 0; // P8 / unison

// ============================================================
// Voice Role × Chord Tone Role 二维分类（Phase 2.5）
// ============================================================
//
// Voice 角色（3 种，按 voiceIdx 分类）：
const VR_BASS  = 0;  // voiceIdx === 0
const VR_INNER = 1;  // 0 < voiceIdx < voiceCount - 1
const VR_TOP   = 2;  // voiceIdx === voiceCount - 1
const VR_COUNT = 3;
//
// Chord tone 角色（5 种，按 interval 半音数分类）：
const CT_ROOT    = 0;  // interval 0
const CT_THIRD   = 1;  // interval 3 / 4 / 5（sus4 视为 guide）
const CT_FIFTH   = 2;  // interval 6 / 7 / 8
const CT_SEVENTH = 3;  // interval 9 / 10 / 11
const CT_COLOR   = 4;  // interval 2（add9）/ 14（9）/ 17（11）/ 21（13）
const CT_COUNT = 5;
//
// voiceRoleScoreTable 索引：voiceRole * CT_COUNT + chordToneRole

// ============================================================
// VoiceLeadingConfig — 风格通过 StyleConfig 注入
// ============================================================

export interface VoiceLeadingConfig {
    /** 声部数（典型 SATB = 4；comping pad 也常用 3~4） */
    voiceCount: number;

    /** 共同音保留奖励 — 推荐 Classical/Jazz 3.0 / Pop 2.5 */
    commonToneMultiplier: number;
    /** 半音步奖励 — 推荐 2.0 / Pop 1.8 */
    halfStepMultiplier: number;
    /** 全音步奖励 — 推荐 1.5 */
    wholeStepMultiplier: number;
    /** 大跳惩罚 — Classical 0.5 / Pop 0.8 / Jazz 1.0（不惩罚） */
    leapPenalty: number;
    /** 大跳阈值（半音）— 超过此距离视为大跳。默认 4（即 > 大三度） */
    leapThreshold: number;

    /** 倾向音解决目标 boost — 跨风格普遍 4.0（牵引力是物理性） */
    tendencyToneResolutionBoost: number;
    /** 平行 5/8 度惩罚 — 内声部 0.3 / Jazz 0.7（modal jazz 宽松） */
    parallelFifthPenalty: number;

    /**
     * 声部职能 base score 表 — flat 3×5 矩阵（length === 15）：
     *   行（voice 角色）：0=Bass / 1=Inner / 2=Top
     *   列（chord tone 角色）：0=Root / 1=Third / 2=Fifth / 3=Seventh / 4=Color
     *   索引：voiceRole * 5 + chordToneRole
     *
     * 典型 Pop 配置（root 强锚消除"漏风的壳"）：
     *   Bass:  [1000, 40,  20,  30,  5]   ← root × 100 of inner chord tones
     *   Inner: [10,   40,  25,  40,  15]  ← guide tones (3rd / 7th)
     *   Top:   [20,   15,  30,  15,  40]  ← color / 5th
     */
    voiceRoleScoreTable: number[];

    /**
     * PC diversity 第一次重复乘数 — 同一和弦内同 pitch class 已被选过 1 次时，
     * 后续 voice 的候选 ×此（典型 0.5 — 减半，仍允许但不优先）
     */
    pcDiversityFirstRepMultiplier: number;
    /**
     * PC diversity 第二次及以上重复乘数 — 已重复过 ≥ 2 次时（即同和弦内出现 3 个相同 PC），
     * 候选 ×此（典型 0 — silence，绝对禁忌：四声部不允许 3 个同名音）
     */
    pcDiversitySecondRepMultiplier: number;

    /** 内声部 pitch space 工作区间（相对空间，C=60 中心）— 默认 [48, 72] = C3~C5 */
    voiceRangeLo: number;
    voiceRangeHi: number;
}

// ============================================================
// 和弦推演输入：HarmonyRulesConfig（取代旧 ChordTransitionMatrix）
// ============================================================
//
// Phase 6：旧的 numerals[] / roots[] / qualities[] / N×N transitions 静态字典
// 已彻底删除。新版进行由 MacroProgressionEngine 用以下三件套代数推演产出：
//   - functionTransitions: 3×3 T-S-D 马尔可夫矩阵
//   - tonic/subdominant/dominantVariantWeights: 各功能下的变体抽样权重
//   - 4 个变异门概率（secondaryDominant / tritoneSub / modalInterchange / tensionExtension）
// 详见 MacroProgressionEngine.ts。
// ============================================================

export interface HarmonyCoreInput {
    sections: SectionMetadata[];
    tonality: Tonality;
    harmonyRules: HarmonyRulesConfig;
    voiceLeadingConfig: VoiceLeadingConfig;
    /** 每段和弦数 — 默认 4 */
    chordsPerSection?: number;
    /** V4.2c — 风格进行池（来自 styleConfig.harmony）。提供时 MacroProgression 70% 概率从 pool 抽起手 */
    progressionPool?: {
        major: Record<string, string[][]>;
        minor: Record<string, string[][]>;
    };
}

/**
 * 注：voicings 与 chords 平行索引；voicings[i] 是 chords[i] 的声部分布（升序，相对空间 MIDI）。
 * Pitch Space: RELATIVE
 */
export interface HarmonyResult {
    chords: GeneratedChord[];
    voicings: number[][];
}

// ============================================================
// 倾向音查找表（数据驱动，纯 flat array — P-1）
// ============================================================

/**
 * 单条倾向音规则：从某 chord quality 的特定音 → 解决方向。
 *
 * tendencyOffsets[i] 是相对 chord.root 的半音偏移（如 V7 的 3rd = 4）。
 * resolutionDeltas[i] 是该音"该走"的半音步（+1 = 上行半音，-1 = 下行半音）。
 *
 * 数组长度对齐：tendencyOffsets.length === resolutionDeltas.length。
 */
interface TendencyToneRule {
    quality: ChordQuality;
    tendencyOffsets: number[];
    resolutionDeltas: number[];
}

/**
 * 倾向音规则表 — 由音乐物理性决定，跨风格通用。
 *
 *   Dominant 家族：3rd（导音）→ 上行半音；b7 → 下行半音
 *   Diminished 家族：b3 / b5 / bb7 → 下行半音（dim 解决到大小三和弦）
 *   HalfDim：同 dim 但 b7 而非 bb7
 *
 * Sus4 / Major7 / Minor7 等不在表中 — 它们没有强物理倾向，按稳定音处理。
 */
const TENDENCY_TONE_RULES: TendencyToneRule[] = [
    { quality: ChordQuality.Dominant7,      tendencyOffsets: [4, 10],    resolutionDeltas: [1, -1] },
    { quality: ChordQuality.Dominant9,      tendencyOffsets: [4, 10],    resolutionDeltas: [1, -1] },
    { quality: ChordQuality.Dominant13,     tendencyOffsets: [4, 10],    resolutionDeltas: [1, -1] },
    { quality: ChordQuality.Dominant7Sus4,  tendencyOffsets: [10],       resolutionDeltas: [-1] },
    { quality: ChordQuality.Diminished,     tendencyOffsets: [3, 6],     resolutionDeltas: [-1, -1] },
    { quality: ChordQuality.Diminished7,    tendencyOffsets: [3, 6, 9],  resolutionDeltas: [-1, -1, -1] },
    { quality: ChordQuality.HalfDiminished, tendencyOffsets: [3, 6, 10], resolutionDeltas: [-1, -1, -1] },
];

function findTendencyRule(quality: ChordQuality): TendencyToneRule | null {
    for (let i = 0; i < TENDENCY_TONE_RULES.length; i++) {
        if (TENDENCY_TONE_RULES[i].quality === quality) return TENDENCY_TONE_RULES[i];
    }
    return null;
}

// ============================================================
// HarmonyCore 主类
// ============================================================

export class HarmonyCoreError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'HarmonyCoreError';
        this.context = context;
    }
}

export class HarmonyCore {
    /**
     * Fallback voicing 计算（V3.1 新增）— 给 PassingChordEngine 插入的"无 voicing 和弦"用。
     *
     * 简化算法：直接 chord-tone PC 数组 → 落到 [voiceRangeLo, voiceRangeHi] 区间内升序展开。
     * 不做 voice leading 优化（passing chord 通常仅持续 0.5-2 拍，听不出 voice leading 损失）。
     *
     * 零 PRNG。
     */
    public static computeFallbackVoicing(chord: GeneratedChord): number[] {
        const intervals = CHORD_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) return [60];

        const rootPc = ((chord.root % 12) + 12) % 12;
        const out: number[] = [];
        // 基线放在 C3 (48)，最高 ≤ C5 (72) — 与 HarmonyCore 默认 voiceRange 对齐
        const baseOctave = 48;
        for (let i = 0; i < intervals.length && i < 4; i++) {
            const pc = (rootPc + intervals[i]) % 12;
            let pitch = baseOctave + pc;
            if (i > 0 && pitch <= out[out.length - 1]) pitch += 12;
            if (pitch > 72) pitch -= 12;
            if (pitch < 48) pitch += 12;
            out.push(pitch);
        }
        out.sort((a, b) => a - b);
        return out;
    }

    /**
     * 入口：推演和弦序列 + 计算声部连接。
     *
     * PRNG 消耗：
     *   - 推演：每和弦 1 次（起始 / 状态转移 weighted pick）
     *   - 声部：每和弦 voiceCount 次（每个 voice 1 次 pickWeighted）
     *
     * 输出 voicings 处于 RELATIVE 空间（K-1） — Orchestrator 后续 applyOffset 才加 keyOffset。
     */
    public static generate(input: HarmonyCoreInput): HarmonyResult {
        HarmonyCore.validate(input);
        const chords = HarmonyCore.generateProgression(input);
        const voicings = HarmonyCore.computeVoicings(chords, input.voiceLeadingConfig);
        return { chords, voicings };
    }

    // -----------------------------------------------------------
    // Phase 1: 和弦推演（Phase 6 — 委托 MacroProgressionEngine）
    // -----------------------------------------------------------

    /**
     * 进行推演 — 不再做字典拼接，直接交给 MacroProgressionEngine 走代数推演。
     * 详见 MacroProgressionEngine.generate() 的 PRNG 消耗与算法说明。
     */
    private static generateProgression(input: HarmonyCoreInput): GeneratedChord[] {
        return MacroProgressionEngine.generate({
            sections: input.sections,
            rules: input.harmonyRules,
            chordsPerSection: input.chordsPerSection,
            tonality: input.tonality,
            progressionPool: input.progressionPool,
        });
    }

    // -----------------------------------------------------------
    // Phase 2: Voice Leading
    // -----------------------------------------------------------

    /**
     * Pitch Space: RELATIVE
     * 顺序计算每和弦的 voicing — 每和弦消费上一和弦的 voicing 作为上下文。
     */
    private static computeVoicings(
        chords: GeneratedChord[],
        cfg: VoiceLeadingConfig,
    ): number[][] {
        const voicings: number[][] = [];
        if (chords.length === 0) return voicings;

        // 复用一个 scratch selector — reset() 而非 new，减少分配（M-1）
        const size = cfg.voiceRangeHi + 1;
        const selector = new WeightedPitchSelector({
            pitchSpaceSize: size,
            previousVoicingMultiplier: cfg.commonToneMultiplier,
            halfStepAwayMultiplier:    cfg.halfStepMultiplier,
            fullStepAwayMultiplier:    cfg.wholeStepMultiplier,
            halfStepReducer: 1.0,  // 当前阶段不使用 reducer 路径
            fullStepReducer: 1.0,
            repeatMultiplier: 1.0,
        });

        let prevVoicing: number[] | null = null;
        let prevQuality: ChordQuality = ChordQuality.Major;
        let prevRoot = 0;

        for (let i = 0; i < chords.length; i++) {
            const voicing = HarmonyCore.computeChordVoicing(
                selector, chords[i], prevVoicing, prevQuality, prevRoot, cfg,
            );
            voicings.push(voicing);
            prevVoicing = voicing;
            prevQuality = chords[i].quality;
            prevRoot = chords[i].root;
        }
        return voicings;
    }

    /**
     * Pitch Space: RELATIVE
     * 单和弦 voice leading — 顺序抽 voiceCount 个 voice。
     *
     * 声部交叉防御（D-5 友好）：**硬分区**而非单调 lo bound。
     *   [voiceRangeLo, voiceRangeHi] 等分为 voiceCount 个互斥子区间，voice V 只在
     *   第 V 个子区间内抽。互不重叠 → 交叉天然不可能。同时保证每 voice 有独立预算，
     *   不会被前置 voice "吃掉" — 修复稀疏 voicing bug。
     *
     * 每 voice 1 次 PRNG（D-5），无论候选数量。
     *
     * 每 voice 抽样前完整重置 selector + reseed — 平行/大跳惩罚状态干净，不残留。
     */
    private static computeChordVoicing(
        selector: WeightedPitchSelector,
        chord: GeneratedChord,
        prevVoicing: number[] | null,
        prevQuality: ChordQuality,
        prevRoot: number,
        cfg: VoiceLeadingConfig,
    ): number[] {
        const out: number[] = [];
        const rangeLo = cfg.voiceRangeLo;
        const rangeHi = cfg.voiceRangeHi;

        // 分区策略（Phase 6.4 — 动态下界推斥替代死板抽屉切分）：
        //   - Voice 0（bass）：完整 octave [rangeLo, rangeLo+11]
        //     → 任何 root PC 都至少有 1 个候选 → 根音 score=1000 必然胜出
        //   - Voice v > 0：subLo = max(voiceRangeLo, out[v-1] + 3)（强制距下方声部至少 m3），
        //                  subHi = voiceRangeHi（上界全放开）
        //     → 防交叉天然成立（递增下界 → 单调升序），同时消除"漏风的壳":
        //       旧 innerPer 抽屉会把可用 PC 卡死在 ~8 半音子区间，root/3rd/7th 命中率不均；
        //       新策略让 inner / top voice 在和声允许的最大空间里被 voiceRoleScoreTable 引导。

        // PC diversity 跟踪：12 槽位 flat 数组（C-3 友好 — 不用 Set）
        const selectedPcCounts: number[] = new Array(PITCH_CLASS_SIZE);
        for (let i = 0; i < PITCH_CLASS_SIZE; i++) selectedPcCounts[i] = 0;

        for (let v = 0; v < cfg.voiceCount; v++) {
            let subLo: number;
            let subHi: number;
            if (v === 0) {
                subLo = rangeLo;
                subHi = Math.min(rangeLo + PITCH_CLASS_SIZE - 1, rangeHi);
            } else {
                // 动态下界推斥（任务 4）— 至少 m3 高于上一已选声部，自然防交叉
                const prevPicked = out.length > 0
                    ? out[out.length - 1]
                    : rangeLo;
                subLo = Math.max(rangeLo, prevPicked + 3);
                subHi = rangeHi;
                if (subLo > subHi) {
                    // 上一声部已撞顶 — pickWeighted 在不可行区间返回 -1，voice 留空
                    subLo = rangeHi;
                    subHi = rangeHi;
                }
            }

            // 重置 + voice-aware reseed —— 每 voice 按其角色拿到差异化 base score
            selector.reset();
            HarmonyCore.seedChordTonesForVoice(selector, chord, v, cfg.voiceCount, cfg);
            if (prevVoicing !== null && prevVoicing.length > 0) {
                HarmonyCore.applyVoiceLeading(
                    selector, prevVoicing, prevQuality, prevRoot, cfg,
                );
            }
            // 平行 5/8 度检查
            if (out.length > 0 && prevVoicing !== null) {
                HarmonyCore.applyParallelPenalty(
                    selector, prevVoicing, out, subLo, subHi, cfg,
                );
            }
            // 大跳惩罚
            if (prevVoicing !== null && v < prevVoicing.length) {
                HarmonyCore.applyLeapPenalty(
                    selector, prevVoicing[v], subLo, subHi, cfg,
                );
            }
            // PC diversity 惩罚：抑制同和弦内 PC 重复（B 方案）
            // 必须在 pickWeighted 前 — 确保下一 PRNG 抽样已经看到惩罚后的分布
            HarmonyCore.applyPcDiversityPenalty(
                selector, selectedPcCounts, subLo, subHi, cfg,
            );

            // M9 Filter（任务 4 — 小九度清洗）：
            //   候选与 Bass (out[0]) 的音级差 === 1（m2 / m9 等价类）→ 权重清零。
            //   极度不协和的 dyad，跨风格通用禁忌；优先级最高，覆盖所有正向奖励。
            //   仅在 v > 0 且 bass 已落定时启用。
            if (v > 0 && out.length > 0) {
                HarmonyCore.applyMinorNinthFilter(selector, out[0], subLo, subHi);
            }

            // 单次 PRNG —— D-5 友好
            const picked = selector.pickWeighted(subLo, subHi);
            if (picked < 0) continue;  // 该子区间无可用候选 — 留空 voice
            out.push(picked);
            // 记录已抽 PC
            selectedPcCounts[HarmonyCore.pcOf(picked)]++;
        }

        // 分区互斥已经保证升序，但保留 D-3 sort 作 belt-and-suspenders
        out.sort((a, b) => a - b);
        return out;
    }

    /**
     * Pitch Space: RELATIVE
     * Voice-aware seed —— 按 voice 角色（Bass / Inner / Top）× chord tone 角色（Root /
     *   Third / Fifth / Seventh / Color）查 voiceRoleScoreTable 决定每个候选 pitch 的 base。
     *
     * 这是 Phase 2.5 修复"漏风的壳"的核心：
     *   - Bass voice 的 Root 拿到 1000+ 极高分 → 几乎确定性选 root（防止根音缺失）
     *   - Inner voices 的 Third / Seventh 拿到中等分 → 强调 guide tones（决定和弦色彩）
     *   - Top voice 的 Color / Fifth 拿到中等分 → 厚顶 + 9/11/13 张力
     */
    private static seedChordTonesForVoice(
        selector: WeightedPitchSelector,
        chord: GeneratedChord,
        voiceIdx: number,
        voiceCount: number,
        cfg: VoiceLeadingConfig,
    ): void {
        const intervals = CHORD_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) {
            throw new HarmonyCoreError(
                `unknown ChordQuality: ${chord.quality}`,
                { chordQuality: chord.quality, numeral: chord.numeral },
            );
        }

        const voiceRole = HarmonyCore.classifyVoiceRole(voiceIdx, voiceCount);
        const tableOffset = voiceRole * CT_COUNT;

        for (let p = cfg.voiceRangeLo; p <= cfg.voiceRangeHi; p++) {
            const pc = HarmonyCore.pcOf(p);
            for (let i = 0; i < intervals.length; i++) {
                const intervalPc = HarmonyCore.pcOf(chord.root + intervals[i]);
                if (pc === intervalPc) {
                    const chordToneRole = HarmonyCore.classifyInterval(intervals[i]);
                    const score = cfg.voiceRoleScoreTable[tableOffset + chordToneRole];
                    selector.setBase(p, score);
                    break;
                }
            }
        }
    }

    /** voice index → voice 角色（Bass / Inner / Top） */
    private static classifyVoiceRole(voiceIdx: number, voiceCount: number): number {
        if (voiceIdx === 0) return VR_BASS;
        if (voiceIdx === voiceCount - 1) return VR_TOP;
        return VR_INNER;
    }

    /**
     * chord 半音间隔 → chord tone 角色。
     *
     *   Root:     0
     *   Third:    3 (m3) / 4 (M3) / 5 (sus4 — 视为 guide)
     *   Fifth:    6 (b5) / 7 (P5) / 8 (#5)
     *   Seventh:  9 (dim7=bb7) / 10 (m7=b7) / 11 (M7)
     *   Color:    2 (add9 内嵌)、14 (9th)、17 (11th)、21 (13th) — 任何 12+ 或 = 2
     */
    private static classifyInterval(interval: number): number {
        const s = interval | 0;
        if (s === 0) return CT_ROOT;
        if (s === 3 || s === 4 || s === 5) return CT_THIRD;
        if (s === 6 || s === 7 || s === 8) return CT_FIFTH;
        if (s === 9 || s === 10 || s === 11) return CT_SEVENTH;
        return CT_COLOR;
    }

    /**
     * PC Diversity Penalty —— 同和弦内已被选过的 pitch class 上的候选施加抑制乘数：
     *   - count == 1（已选过 1 次）：×pcDiversityFirstRepMultiplier（典型 0.5）
     *   - count ≥ 2（已选过 ≥ 2 次）：×pcDiversitySecondRepMultiplier（典型 0 — silence）
     *
     * 这强制 4-voice 和弦内 PC 多样性，防止"3 个 C + 1 个 G"这种漏风的壳。
     */
    private static applyPcDiversityPenalty(
        selector: WeightedPitchSelector,
        selectedPcCounts: number[],
        subLo: number,
        subHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        for (let p = subLo; p <= subHi; p++) {
            const pc = HarmonyCore.pcOf(p);
            const count = selectedPcCounts[pc];
            if (count >= 2) {
                selector.applyMultiplier(p, cfg.pcDiversitySecondRepMultiplier);
            } else if (count === 1) {
                selector.applyMultiplier(p, cfg.pcDiversityFirstRepMultiplier);
            }
        }
    }

    /**
     * Phase 6.4 — Minor 9th / Minor 2nd Filter（任务 4）。
     *
     * 计算 diffPc = ((cand - bassPitch) % 12 + 12) % 12，若 === 1（即 m2 / m9 同等价类），
     * 立即将该 cand 的权重置 0（彻底过滤）。
     *
     * 这个过滤是物理性 — bass 与任何上方声部相差 m9 都会产生极度刺耳的拍频与浊度，
     * 跨风格通用禁忌（Pop / Jazz / Classical 都不容忍 root-on-bass 与 b9-above-bass 的并发）。
     * 与 voiceRoleScoreTable 的正向奖励作用相反 — 用 0.0 乘子实现"无论上层多想要这个 PC，
     * bass 钉死后就不允许"的硬约束。
     */
    private static applyMinorNinthFilter(
        selector: WeightedPitchSelector,
        bassPitch: number,
        subLo: number,
        subHi: number,
    ): void {
        for (let cand = subLo; cand <= subHi; cand++) {
            const diff = cand - bassPitch;
            const diffPc = ((diff % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
            if (diffPc === 1) {
                selector.applyMultiplier(cand, 0.0);
            }
        }
    }

    /**
     * 关键 — 倾向音 vs 稳定音二分类处理：
     *   - 稳定音：调 applyProximityMultipliers — 共同音 + 半音 / 全音步对称奖励
     *   - 倾向音：跳过对称奖励，仅对**解决目标 pitch class**做单点 applyMultiplier
     *
     * 这避免了"被锁死的导音"bug — 如果对 V7 的 leading tone 调 applyProximityMultipliers，
     * 共同音保留奖励（3.0×）会高于 boost 后的解决目标（如果不显著高），算法会优先留住 B
     * 而非解决到 C。改为只 boost 解决目标，强制其方向性。
     */
    private static applyVoiceLeading(
        selector: WeightedPitchSelector,
        prevVoicing: number[],
        prevQuality: ChordQuality,
        prevRoot: number,
        cfg: VoiceLeadingConfig,
    ): void {
        const tendencyRule = findTendencyRule(prevQuality);

        for (let i = 0; i < prevVoicing.length; i++) {
            const prevPitch = prevVoicing[i];
            const prevPc = HarmonyCore.pcOf(prevPitch);

            // 判定该 voice 是否倾向音
            let isTendency = false;
            let resolutionPc = 0;
            if (tendencyRule !== null) {
                const offs = tendencyRule.tendencyOffsets;
                const deltas = tendencyRule.resolutionDeltas;
                for (let t = 0; t < offs.length; t++) {
                    const tendencyPc = HarmonyCore.pcOf(prevRoot + offs[t]);
                    if (prevPc === tendencyPc) {
                        isTendency = true;
                        resolutionPc = HarmonyCore.pcOf(prevPitch + deltas[t]);
                        break;
                    }
                }
            }

            if (isTendency) {
                // 倾向音：精准 boost 解决目标 pitch class（跨所有八度，仅在工作区间）
                for (let p = cfg.voiceRangeLo; p <= cfg.voiceRangeHi; p++) {
                    if (HarmonyCore.pcOf(p) === resolutionPc) {
                        selector.applyMultiplier(p, cfg.tendencyToneResolutionBoost);
                    }
                }
            } else {
                // 稳定音：对称辐射 — 共同音 / 半音 / 全音步奖励一并施加
                selector.applyProximityMultipliers(prevPitch);
            }
        }
    }

    /**
     * 平行 5/8 度后扫描：在抽取第 v 个 voice 前，扫描候选 pitch，
     * 若与已抽到的某 j-th voice（j < v）构成"上一和弦同间距 + 同方向"的运动，且
     * 间距类（mod 12）∈ {0, 7}，则对该候选施加 parallelFifthPenalty。
     */
    private static applyParallelPenalty(
        selector: WeightedPitchSelector,
        prevVoicing: number[],
        currentPicked: number[],
        voiceLo: number,
        voiceHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        const V = currentPicked.length;  // 当前正在抽的 voice 索引
        if (V >= prevVoicing.length) return;
        const prevV = prevVoicing[V];

        for (let cand = voiceLo; cand <= voiceHi; cand++) {
            if (cand === prevV) continue;  // voice V 不动 → 无平行可能
            let penalize = false;
            for (let j = 0; j < V; j++) {
                if (j >= prevVoicing.length) break;
                const prevJ = prevVoicing[j];
                const outJ = currentPicked[j];
                if (outJ === prevJ) continue;  // voice j 不动
                const diffPrev = HarmonyCore.pcOf(prevJ - prevV);
                const diffCurr = HarmonyCore.pcOf(outJ - cand);
                if (diffPrev !== diffCurr) continue;
                if (diffPrev === PARALLEL_FIFTH_INTERVAL ||
                    diffPrev === PARALLEL_OCTAVE_INTERVAL) {
                    penalize = true;
                    break;
                }
            }
            if (penalize) {
                selector.applyMultiplier(cand, cfg.parallelFifthPenalty);
            }
        }
    }

    /**
     * 大跳惩罚：候选 pitch 与该 voice 的 prev pitch 距离 > leapThreshold → 降权。
     * 仅对 prev 有该 voice 时生效；首和弦不应用。
     */
    private static applyLeapPenalty(
        selector: WeightedPitchSelector,
        prevPitch: number,
        voiceLo: number,
        voiceHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        if (Math.abs(cfg.leapPenalty - 1.0) < EPSILON) return;  // 风格不惩罚（如 Jazz=1.0）
        const threshold = cfg.leapThreshold | 0;
        for (let cand = voiceLo; cand <= voiceHi; cand++) {
            const dist = Math.abs(cand - prevPitch);
            if (dist > threshold) {
                selector.applyMultiplier(cand, cfg.leapPenalty);
            }
        }
    }

    // -----------------------------------------------------------
    // 工具
    // -----------------------------------------------------------

    /** pitch → [0, 11] 的 pitch class（正确处理负数；P-3 / P-5） */
    private static pcOf(pitch: number): number {
        const r = (pitch | 0) % PITCH_CLASS_SIZE;
        return r < 0 ? r + PITCH_CLASS_SIZE : r;
    }

    /** S-7：非法输入早期失败 — HarmonyRulesConfig 自身由 MacroProgressionEngine 校验 */
    private static validate(input: HarmonyCoreInput): void {
        const cfg = input.voiceLeadingConfig;
        if (cfg.voiceCount < 1) {
            throw new HarmonyCoreError('voiceCount must be >= 1', { actual: cfg.voiceCount });
        }
        if (cfg.voiceRangeLo < 0 || cfg.voiceRangeHi <= cfg.voiceRangeLo) {
            throw new HarmonyCoreError(
                'voiceRangeLo / voiceRangeHi invalid',
                { lo: cfg.voiceRangeLo, hi: cfg.voiceRangeHi },
            );
        }
        const expectedTableLen = VR_COUNT * CT_COUNT;
        if (cfg.voiceRoleScoreTable.length !== expectedTableLen) {
            throw new HarmonyCoreError(
                `voiceRoleScoreTable length must be ${expectedTableLen} (3 voice roles × 5 chord tone roles)`,
                { actual: cfg.voiceRoleScoreTable.length },
            );
        }
    }
}
