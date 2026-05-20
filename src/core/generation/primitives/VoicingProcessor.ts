/**
 * VoicingProcessor — 声部排列统一计算模块（Phase 1 抽取）
 *
 * 设计目标：消除"voicing 计算分散在 3 个模块"的债务。
 *   - 旧 HarmonyCore.computeVoicings + computeChordVoicing + 8 个 voice-leading 规则
 *   - 旧 RootlessVoicer.buildRootlessVoicing + buildQuartalVoicing
 *   - 旧 4 处 PC normalization / m9 撞音检测 / PC→MIDI 放置的散落实现
 *
 * 全部集中到本模块,以静态方法暴露:
 *   - computeSATBVoicings  : 4-voice SATB 全局 voicing(给 HarmonyCore 全曲推演)
 *   - computeFallbackVoicing : 简化版(给 PassingChordEngine 插入的 passing chord)
 *   - buildRootlessRH       : 钢琴右手 rootless voicing(原 RootlessVoicer 入口)
 *   - buildQuartalRH        : 钢琴右手 quartal voicing(原 RootlessVoicer 入口)
 *
 * 暂未纳入(Phase 3 PianoRealizer 化时整合):
 *   - PianoAccompIdiom 内的 LH guide-tone shell voicing
 *
 * Pitch Space: RELATIVE — 所有输出都未加 keyOffset(K-1 / K-7)。
 *
 * PRNG 消耗:
 *   - computeSATBVoicings:每和弦 voiceCount 次(每 voice 1 次 pickWeighted,D-5)
 *   - computeFallbackVoicing / buildRootlessRH / buildQuartalRH: 0(纯决定性)
 *
 * 私有依赖:WeightedPitchSelector(同目录,不对外暴露,VoicingProcessor 是唯一消费者)。
 *
 * 约束遵从(沿用 HarmonyCore):
 *   D-1: PRNG 走 PRNGManager;D-3: 排序完全确定;D-4: 浮点 epsilon
 *   P-1: 无 Map/Set,全数组线性扫描
 *   T-1: 不做字符串子串分类;T-3: 无 any
 *   K-2 / K-5: 不读 GlobalContext,不加 keyOffset
 */

import {
    GeneratedChord,
    ChordQuality,
    CHORD_INTERVALS,
    CQ_IS_DOM,
    CQ_IS_MAJOR,
    CQ_IS_MINOR,
    CQ_IS_DIM,
} from '../types';
import { WeightedPitchSelector } from './WeightedPitchSelector';

// ============================================================
// 共享常量
// ============================================================

const EPSILON = 1e-6;
const PITCH_CLASS_SIZE = 12;
const PARALLEL_FIFTH_INTERVAL = 7;
const PARALLEL_OCTAVE_INTERVAL = 0;

// SATB voice 角色(3 种,按 voiceIdx 分类)
const VR_BASS = 0;
const VR_INNER = 1;
const VR_TOP = 2;
const VR_COUNT = 3;

// SATB chord tone 角色(5 种,按 interval 半音数分类)
const CT_ROOT = 0;
const CT_THIRD = 1;
const CT_FIFTH = 2;
const CT_SEVENTH = 3;
const CT_COLOR = 4;
const CT_COUNT = 5;

// Rootless / Quartal 常量
const DEFAULT_RH_ANCHOR = 60;       // C4
const DEFAULT_RH_RANGE_HI = 84;     // C6
const DEFAULT_QUARTAL_ANCHOR = 62;  // D4
const PERFECT_FOURTH_SEMITONES = 5;
const EXT_9TH = 2;
const EXT_NAT_11TH = 5;
const EXT_SHARP_11TH = 6;
const EXT_13TH = 9;
const BIAS_THRESHOLD_9TH = 0.30;
const BIAS_THRESHOLD_13TH = 0.55;
const BIAS_THRESHOLD_11TH = 0.80;

// LH Guide-Tone Shell 常量(Phase 3a 从 PianoAccompIdiom 迁入)
const SHELL_INTERVAL_3RD_MAJOR = 4;
const SHELL_INTERVAL_3RD_MINOR = 3;
const SHELL_INTERVAL_7TH_MAJ   = 11;
const SHELL_INTERVAL_7TH_DOM   = 10;
const SHELL_INTERVAL_7TH_DIM7  = 9;
const SHELL_INTERVAL_9TH       = 2;
const SHELL_SUS_4TH            = 5;

// ============================================================
// 接口定义
// ============================================================

export interface VoiceLeadingConfig {
    /** 声部数(典型 SATB = 4;comping pad 也常用 3~4) */
    voiceCount: number;

    /** 共同音保留奖励 — 推荐 Classical/Jazz 3.0 / Pop 2.5 */
    commonToneMultiplier: number;
    /** 半音步奖励 — 推荐 2.0 / Pop 1.8 */
    halfStepMultiplier: number;
    /** 全音步奖励 — 推荐 1.5 */
    wholeStepMultiplier: number;
    /** 大跳惩罚 — Classical 0.5 / Pop 0.8 / Jazz 1.0(不惩罚) */
    leapPenalty: number;
    /** 大跳阈值(半音)— 超过此距离视为大跳。默认 4(即 > 大三度) */
    leapThreshold: number;

    /** 倾向音解决目标 boost — 跨风格普遍 4.0(牵引力是物理性) */
    tendencyToneResolutionBoost: number;
    /** 平行 5/8 度惩罚 — 内声部 0.3 / Jazz 0.7(modal jazz 宽松) */
    parallelFifthPenalty: number;

    /**
     * 声部职能 base score 表 — flat 3×5 矩阵(length === 15):
     *   行(voice 角色):0=Bass / 1=Inner / 2=Top
     *   列(chord tone 角色):0=Root / 1=Third / 2=Fifth / 3=Seventh / 4=Color
     *   索引:voiceRole * 5 + chordToneRole
     */
    voiceRoleScoreTable: number[];

    /** PC diversity 第一次重复乘数(典型 0.5) */
    pcDiversityFirstRepMultiplier: number;
    /** PC diversity 第二次及以上重复乘数(典型 0 — silence) */
    pcDiversitySecondRepMultiplier: number;

    /** 内声部 pitch space 工作区间(相对空间,C=60 中心)— 默认 [48, 72] = C3~C5 */
    voiceRangeLo: number;
    voiceRangeHi: number;
}

export interface RootlessVoicerInput {
    chord: GeneratedChord;
    /** 颜色偏好 ∈ [0, 1] — >=0.3 加 9 / >=0.55 加 13 / >=0.8 加 11 */
    colorBias: number;
    /** LH 已占 PC 集(listen) */
    lhPcSet?: number[];
    /** LH 顶音 pitch — RH 同 PC voice 至少要 > lhTopPitch + 11(一个八度以上) */
    lhTopPitch?: number;
    /** RH placement anchor,默认 C4=60 */
    anchorPitch?: number;
    /** RH 上界,默认 C6=84 */
    rangeHi?: number;
    /** RH 下界,默认 max(anchorPitch, lhTopPitch + 3) */
    rangeLo?: number;
}

/**
 * Shell variant 选择:
 *   0 (X) — 仅 3+7 guide tones,最干净的 jazz shell
 *   1 (Y) — 3+7+9,加 9 度色彩(neo-soul / 现代爵士)
 *   2 (Z) — root + 3+7,锚根版 shell(pop ballad / classical 偏好)
 */
export type ShellVariant = 0 | 1 | 2;

export interface ShellLHInput {
    chord: GeneratedChord;
    /** 全曲和弦序号(决定性 hash 输入) */
    chordIndex: number;
    /** 4-bar phrase 内 bar 位置(决定性 hash 输入) */
    barInPhrase: number;
    /** 颜色偏好 ∈ [0, 1] — 决定 variant 分布 */
    colorBias: number;
    /** 放置 anchor(典型 F3=53) */
    anchorPitch: number;
    /** 合法范围下界(典型 E3=52) */
    rangeLo: number;
    /** 合法范围上界(典型 A4=69) */
    rangeHi: number;
}

export interface ShellLHOutput {
    /** 升序 MIDI(RELATIVE),已去重 */
    pitches: number[];
    /** PC 集(给 RH listen 用) */
    pcSet: number[];
    /** 最高 pitch — 没有有效 voice 时为 -1 */
    topPitch: number;
}

export interface QuartalVoicerInput {
    chord: GeneratedChord;
    /** 音数(默认 3) */
    voiceCount?: number;
    /** 起点 anchor,默认 D4=62 */
    anchorPitch?: number;
    /** 上界,默认 C6=84 */
    rangeHi?: number;
    /** LH 已占 PC 集(listen,目前未使用,预留 API 一致性) */
    lhPcSet?: number[];
    /** LH 顶音 pitch(同上) */
    lhTopPitch?: number;
}

interface TendencyToneRule {
    quality: ChordQuality;
    tendencyOffsets: number[];
    resolutionDeltas: number[];
}

// ============================================================
// 倾向音规则表(由音乐物理性决定,跨风格通用)
// ============================================================

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
// 共享工具函数(去重核心 — Phase 1 关键收益)
// ============================================================

/** pitch / pc → [0, 11] 的 pitch class(正确处理负数;P-3 / P-5) */
function normalizePc(x: number): number {
    const r = (x | 0) % PITCH_CLASS_SIZE;
    return r < 0 ? r + PITCH_CLASS_SIZE : r;
}

/** 把 PC 放进 [floor, hi],选离 anchor 最近的 octave;无候选时找最低合法位置 */
function placePcNearAnchor(pc: number, anchor: number, floor: number, hi: number): number {
    const pcNorm = normalizePc(pc);
    const anchorOctaveBase = anchor - normalizePc(anchor);
    // 候选 ± 2 octave
    const candidates = [
        anchorOctaveBase - 12 + pcNorm,
        anchorOctaveBase + pcNorm,
        anchorOctaveBase + 12 + pcNorm,
        anchorOctaveBase + 24 + pcNorm,
    ];
    let best = -1;
    let bestDist = 9999;
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c < floor || c > hi) continue;
        const d = Math.abs(c - anchor);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    if (best >= 0) return best;
    // fallback —— 找最低合法 octave 兜底
    let p = anchorOctaveBase + pcNorm;
    while (p < floor) p += 12;
    while (p > hi)    p -= 12;
    return p;
}

/** 检查 extPc 是否与某个 chord tone PC 形成 minor 9th 撞音(PC = chordTone + 1 半音) */
function checkMinorNinthClashPc(extPc: number, chordTonePcs: number[]): boolean {
    // minor 9th = +13 半音 = +1 PC(环形)
    const target = normalizePc(extPc - 1);
    for (let i = 0; i < chordTonePcs.length; i++) {
        if (chordTonePcs[i] === target) return true;
    }
    return false;
}

/** 数组去重(保持顺序) */
function dedupSortedArray(arr: number[]): number[] {
    if (arr.length <= 1) return arr.slice();
    const out: number[] = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] !== out[out.length - 1]) out.push(arr[i]);
    }
    return out;
}

// ============================================================
// LH Shell 私有 helpers(Phase 3a 从 PianoAccompIdiom verbatim 迁入)
// ============================================================

/**
 * 按 chordIndex / barInPhrase / colorBias 确定性选 shell 变体(D-5)。
 * 同 (chordIndex, barInPhrase, rootPc, colorBias) → 同变体。零 PRNG。
 */
function pickShellVariant(
    chordIndex: number, barInPhrase: number, colorBias: number, rootPc: number,
): ShellVariant {
    const hash = ((chordIndex * 31 + barInPhrase * 17 + rootPc * 11) % 100 + 100) % 100;
    const cb = colorBias < 0 ? 0 : (colorBias > 1 ? 1 : colorBias);
    if (cb < 0.3) {
        // 低 colorBias:以 X 为主,偶尔 Z(pop ballad — 稳重,少加 9)
        return hash < 80 ? 0 : 2;
    }
    if (cb < 0.6) {
        // 中 colorBias:X / Z 主导,少量 Y
        if (hash < 50) return 0;
        if (hash < 80) return 2;
        return 1;
    }
    // 高 colorBias:三者均衡(neo-soul / jazz — 经常 add 9)
    if (hash < 30) return 0;
    if (hash < 65) return 1;
    return 2;
}

/**
 * 按 chord.quality 算 (3rd, 7th) 半音间隔;sus 退化为 (4th, 7th)。
 * 返回 [thirdInterval, seventhInterval];thirdInterval=5 表示 sus 用 4 代 3。
 */
function getShellIntervals(quality: ChordQuality): [number, number] {
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) {
        return [SHELL_SUS_4TH, SHELL_INTERVAL_7TH_DOM];
    }
    const qBit = 1 << quality;
    const isMinorish = (qBit & CQ_IS_MINOR) !== 0 || (qBit & CQ_IS_DIM) !== 0;
    const third = isMinorish ? SHELL_INTERVAL_3RD_MINOR : SHELL_INTERVAL_3RD_MAJOR;
    let seventh: number;
    if (quality === ChordQuality.Diminished7) seventh = SHELL_INTERVAL_7TH_DIM7;
    else if ((qBit & CQ_IS_MAJOR) !== 0
        || quality === ChordQuality.Augmented
        || quality === ChordQuality.Add9) seventh = SHELL_INTERVAL_7TH_MAJ;
    else seventh = SHELL_INTERVAL_7TH_DOM;  // Dom7 / Min7 / HalfDim → b7
    return [third, seventh];
}

/**
 * 按变体 + chord 构建 shell PC 集(顺序:低 → 高,未限制 octave)。
 */
function buildShellPcSet(chord: GeneratedChord, variant: ShellVariant): number[] {
    const rootPc = normalizePc(chord.bassOverride !== undefined ? chord.bassOverride : chord.root);
    const [thirdInt, seventhInt] = getShellIntervals(chord.quality);
    const thirdPc   = (rootPc + thirdInt)   % 12;
    const seventhPc = (rootPc + seventhInt) % 12;
    if (variant === 0) return [thirdPc, seventhPc];                              // X
    if (variant === 1) return [thirdPc, seventhPc, (rootPc + SHELL_INTERVAL_9TH) % 12]; // Y +9
    return [rootPc, thirdPc, seventhPc];                                          // Z root anchored
}

/**
 * 把 PC 放到离 anchor 最近的八度,并钳到 [rangeLo, rangeHi]。
 *
 * 注:与 placePcNearAnchor(Rootless/Quartal 用)的算法不同:
 *   - 此处只考虑 anchor 同八度 ±1 octave 三个候选
 *   - 不预先 floor 检查,而是后置 clamp by ±12
 * 保留两份独立实现以确保 Phase 3a 抽取后行为 bit-exact。
 */
function placePcInShellRange(pc: number, anchor: number, rangeLo: number, rangeHi: number): number {
    const pcNorm = normalizePc(pc);
    const anchorPc = normalizePc(anchor);
    const anchorOctaveBase = anchor - anchorPc;
    const candidate = anchorOctaveBase + pcNorm;
    // 取 candidate / candidate ± 12 三个里离 anchor 最近的
    const c1 = candidate;
    const c2 = candidate + 12;
    const c3 = candidate - 12;
    let best = c1;
    let bestDist = Math.abs(c1 - anchor);
    if (Math.abs(c2 - anchor) < bestDist) { best = c2; bestDist = Math.abs(c2 - anchor); }
    if (Math.abs(c3 - anchor) < bestDist) { best = c3; }
    // 钳到合法 shell 范围
    while (best < rangeLo) best += 12;
    while (best > rangeHi) best -= 12;
    return best;
}

// ============================================================
// VoicingProcessorError
// ============================================================

export class VoicingProcessorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'VoicingProcessorError';
        this.context = context;
    }
}

// ============================================================
// VoicingProcessor 主类
// ============================================================

export class VoicingProcessor {
    // ============================================================
    // SATB 全局 voicing — 公开入口
    // ============================================================

    /**
     * Fallback voicing 计算 — 给 PassingChordEngine 插入的"无 voicing 和弦"用。
     *
     * 简化算法:直接 chord-tone PC 数组 → 落到 [48, 72] 区间内升序展开。
     * 不做 voice leading 优化(passing chord 通常仅持续 0.5-2 拍)。
     *
     * 零 PRNG。
     */
    public static computeFallbackVoicing(chord: GeneratedChord): number[] {
        const intervals = CHORD_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) return [60];

        const rootPc = normalizePc(chord.root);
        const out: number[] = [];
        // 基线放在 C3 (48),最高 ≤ C5 (72) — 与 HarmonyCore 默认 voiceRange 对齐
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
     * Pitch Space: RELATIVE
     * 顺序计算每和弦的 voicing — 每和弦消费上一和弦的 voicing 作为上下文。
     *
     * PRNG 消耗:每和弦 voiceCount 次(每 voice 1 次 pickWeighted)。
     */
    public static computeSATBVoicings(
        chords: GeneratedChord[],
        cfg: VoiceLeadingConfig,
    ): number[][] {
        const voicings: number[][] = [];
        if (chords.length === 0) return voicings;

        // 复用一个 scratch selector — reset() 而非 new,减少分配(M-1)
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
            const voicing = VoicingProcessor.computeChordVoicing(
                selector, chords[i], prevVoicing, prevQuality, prevRoot, cfg,
            );
            voicings.push(voicing);
            prevVoicing = voicing;
            prevQuality = chords[i].quality;
            prevRoot = chords[i].root;
        }
        return voicings;
    }

    // ============================================================
    // SATB 内部规则函数
    // ============================================================

    /**
     * Pitch Space: RELATIVE
     * 单和弦 voice leading — 顺序抽 voiceCount 个 voice。
     *
     * 声部交叉防御(D-5 友好):**动态下界推斥**(任务 4)。
     *   - Voice 0(bass):完整 octave [rangeLo, rangeLo+11]
     *   - Voice v > 0:subLo = max(voiceRangeLo, out[v-1] + 3)(强制距下方声部至少 m3)
     *
     * 每 voice 1 次 PRNG(D-5),无论候选数量。
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

        // PC diversity 跟踪:12 槽位 flat 数组(C-3 友好 — 不用 Set)
        const selectedPcCounts: number[] = new Array(PITCH_CLASS_SIZE);
        for (let i = 0; i < PITCH_CLASS_SIZE; i++) selectedPcCounts[i] = 0;

        for (let v = 0; v < cfg.voiceCount; v++) {
            let subLo: number;
            let subHi: number;
            if (v === 0) {
                subLo = rangeLo;
                subHi = Math.min(rangeLo + PITCH_CLASS_SIZE - 1, rangeHi);
            } else {
                // 动态下界推斥 — 至少 m3 高于上一已选声部,自然防交叉
                const prevPicked = out.length > 0
                    ? out[out.length - 1]
                    : rangeLo;
                subLo = Math.max(rangeLo, prevPicked + 3);
                subHi = rangeHi;
                if (subLo > subHi) {
                    // 上一声部已撞顶 — pickWeighted 在不可行区间返回 -1,voice 留空
                    subLo = rangeHi;
                    subHi = rangeHi;
                }
            }

            // 重置 + voice-aware reseed
            selector.reset();
            VoicingProcessor.seedChordTonesForVoice(selector, chord, v, cfg.voiceCount, cfg);
            if (prevVoicing !== null && prevVoicing.length > 0) {
                VoicingProcessor.applyVoiceLeading(
                    selector, prevVoicing, prevQuality, prevRoot, cfg,
                );
            }
            // 平行 5/8 度检查
            if (out.length > 0 && prevVoicing !== null) {
                VoicingProcessor.applyParallelPenalty(
                    selector, prevVoicing, out, subLo, subHi, cfg,
                );
            }
            // 大跳惩罚
            if (prevVoicing !== null && v < prevVoicing.length) {
                VoicingProcessor.applyLeapPenalty(
                    selector, prevVoicing[v], subLo, subHi, cfg,
                );
            }
            // PC diversity 惩罚:抑制同和弦内 PC 重复
            // 必须在 pickWeighted 前 — 确保下一 PRNG 抽样已经看到惩罚后的分布
            VoicingProcessor.applyPcDiversityPenalty(
                selector, selectedPcCounts, subLo, subHi, cfg,
            );

            // M9 Filter(任务 4 — 小九度清洗):
            //   候选与 Bass (out[0]) 的音级差 === 1(m2 / m9 等价类)→ 权重清零。
            //   极度不协和的 dyad,跨风格通用禁忌。
            if (v > 0 && out.length > 0) {
                VoicingProcessor.applyMinorNinthFilter(selector, out[0], subLo, subHi);
            }

            // 单次 PRNG —— D-5 友好
            const picked = selector.pickWeighted(subLo, subHi);
            if (picked < 0) continue;  // 该子区间无可用候选 — 留空 voice
            out.push(picked);
            selectedPcCounts[normalizePc(picked)]++;
        }

        // 分区互斥已经保证升序,但保留 D-3 sort 作 belt-and-suspenders
        out.sort((a, b) => a - b);
        return out;
    }

    private static seedChordTonesForVoice(
        selector: WeightedPitchSelector,
        chord: GeneratedChord,
        voiceIdx: number,
        voiceCount: number,
        cfg: VoiceLeadingConfig,
    ): void {
        const intervals = CHORD_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) {
            throw new VoicingProcessorError(
                `unknown ChordQuality: ${chord.quality}`,
                { chordQuality: chord.quality, numeral: chord.numeral },
            );
        }

        const voiceRole = VoicingProcessor.classifyVoiceRole(voiceIdx, voiceCount);
        const tableOffset = voiceRole * CT_COUNT;

        for (let p = cfg.voiceRangeLo; p <= cfg.voiceRangeHi; p++) {
            const pc = normalizePc(p);
            for (let i = 0; i < intervals.length; i++) {
                const intervalPc = normalizePc(chord.root + intervals[i]);
                if (pc === intervalPc) {
                    const chordToneRole = VoicingProcessor.classifyInterval(intervals[i]);
                    const score = cfg.voiceRoleScoreTable[tableOffset + chordToneRole];
                    selector.setBase(p, score);
                    break;
                }
            }
        }
    }

    private static classifyVoiceRole(voiceIdx: number, voiceCount: number): number {
        if (voiceIdx === 0) return VR_BASS;
        if (voiceIdx === voiceCount - 1) return VR_TOP;
        return VR_INNER;
    }

    private static classifyInterval(interval: number): number {
        const s = interval | 0;
        if (s === 0) return CT_ROOT;
        if (s === 3 || s === 4 || s === 5) return CT_THIRD;
        if (s === 6 || s === 7 || s === 8) return CT_FIFTH;
        if (s === 9 || s === 10 || s === 11) return CT_SEVENTH;
        return CT_COLOR;
    }

    private static applyPcDiversityPenalty(
        selector: WeightedPitchSelector,
        selectedPcCounts: number[],
        subLo: number,
        subHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        for (let p = subLo; p <= subHi; p++) {
            const pc = normalizePc(p);
            const count = selectedPcCounts[pc];
            if (count >= 2) {
                selector.applyMultiplier(p, cfg.pcDiversitySecondRepMultiplier);
            } else if (count === 1) {
                selector.applyMultiplier(p, cfg.pcDiversityFirstRepMultiplier);
            }
        }
    }

    private static applyMinorNinthFilter(
        selector: WeightedPitchSelector,
        bassPitch: number,
        subLo: number,
        subHi: number,
    ): void {
        for (let cand = subLo; cand <= subHi; cand++) {
            const diffPc = normalizePc(cand - bassPitch);
            if (diffPc === 1) {
                selector.applyMultiplier(cand, 0.0);
            }
        }
    }

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
            const prevPc = normalizePc(prevPitch);

            let isTendency = false;
            let resolutionPc = 0;
            if (tendencyRule !== null) {
                const offs = tendencyRule.tendencyOffsets;
                const deltas = tendencyRule.resolutionDeltas;
                for (let t = 0; t < offs.length; t++) {
                    const tendencyPc = normalizePc(prevRoot + offs[t]);
                    if (prevPc === tendencyPc) {
                        isTendency = true;
                        resolutionPc = normalizePc(prevPitch + deltas[t]);
                        break;
                    }
                }
            }

            if (isTendency) {
                // 倾向音:精准 boost 解决目标 pitch class(跨所有八度,仅在工作区间)
                for (let p = cfg.voiceRangeLo; p <= cfg.voiceRangeHi; p++) {
                    if (normalizePc(p) === resolutionPc) {
                        selector.applyMultiplier(p, cfg.tendencyToneResolutionBoost);
                    }
                }
            } else {
                // 稳定音:对称辐射 — 共同音 / 半音 / 全音步奖励一并施加
                selector.applyProximityMultipliers(prevPitch);
            }
        }
    }

    private static applyParallelPenalty(
        selector: WeightedPitchSelector,
        prevVoicing: number[],
        currentPicked: number[],
        voiceLo: number,
        voiceHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        const V = currentPicked.length;
        if (V >= prevVoicing.length) return;
        const prevV = prevVoicing[V];

        for (let cand = voiceLo; cand <= voiceHi; cand++) {
            if (cand === prevV) continue;
            let penalize = false;
            for (let j = 0; j < V; j++) {
                if (j >= prevVoicing.length) break;
                const prevJ = prevVoicing[j];
                const outJ = currentPicked[j];
                if (outJ === prevJ) continue;
                const diffPrev = normalizePc(prevJ - prevV);
                const diffCurr = normalizePc(outJ - cand);
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

    private static applyLeapPenalty(
        selector: WeightedPitchSelector,
        prevPitch: number,
        voiceLo: number,
        voiceHi: number,
        cfg: VoiceLeadingConfig,
    ): void {
        if (Math.abs(cfg.leapPenalty - 1.0) < EPSILON) return;
        const threshold = cfg.leapThreshold | 0;
        for (let cand = voiceLo; cand <= voiceHi; cand++) {
            const dist = Math.abs(cand - prevPitch);
            if (dist > threshold) {
                selector.applyMultiplier(cand, cfg.leapPenalty);
            }
        }
    }

    // ============================================================
    // 钢琴 RH 局部 voicing 策略(原 RootlessVoicer)
    // ============================================================

    /**
     * 构造 Rootless 右手 voicing(原 buildRootlessVoicing)。
     *
     * 算法(D-1 零 PRNG):
     *   1. 取 chord tone PC 集(无 root)→ 3rd / 5th / 7th 等
     *   2. 按 colorBias 决定加哪些扩展(9 / 13 / 11)
     *   3. 过 minor 9th 撞音 filter(伯克利 avoid-note)
     *   4. listen LH:与 lhPcSet 同 PC 的 voice 强制升到 lhTopPitch + 12 以上
     *   5. 放置到 [rangeLo, rangeHi]、anchor 附近,升序 + 去重
     */
    public static buildRootlessRH(input: RootlessVoicerInput): number[] {
        const chord  = input.chord;
        const anchor = input.anchorPitch ?? DEFAULT_RH_ANCHOR;
        const hi     = input.rangeHi      ?? DEFAULT_RH_RANGE_HI;
        const lhTop  = input.lhTopPitch   ?? -1;
        const lo     = input.rangeLo      ?? Math.max(anchor, lhTop + 3);
        const lhPcs  = input.lhPcSet      ?? [];

        const rootPc = normalizePc(chord.bassOverride !== undefined ? chord.bassOverride : chord.root);
        const intervals = CHORD_INTERVALS[chord.quality] ?? [0, 4, 7];
        const qBit   = 1 << chord.quality;

        // chord tone PC 集(含 root,用于 minor 9th 检测) + 不含 root 的版本(放进 voicing)
        const allChordPcs: number[] = [];
        const chordTonePcsNoRoot: number[] = [];
        for (let i = 0; i < intervals.length; i++) {
            const pc = normalizePc(rootPc + intervals[i]);
            if (allChordPcs.indexOf(pc) === -1) allChordPcs.push(pc);
            if (intervals[i] !== 0 && chordTonePcsNoRoot.indexOf(pc) === -1) {
                chordTonePcsNoRoot.push(pc);
            }
        }

        // colorBias 阶梯抽扩展音
        const cb = input.colorBias < 0 ? 0 : (input.colorBias > 1 ? 1 : input.colorBias);
        const candidateExts: number[] = [];
        if (cb >= BIAS_THRESHOLD_9TH)  candidateExts.push((rootPc + EXT_9TH)  % PITCH_CLASS_SIZE);
        if (cb >= BIAS_THRESHOLD_13TH) candidateExts.push((rootPc + EXT_13TH) % PITCH_CLASS_SIZE);
        if (cb >= BIAS_THRESHOLD_11TH) {
            // Dom 家族用 #11(Lydian Dominant),其他用 nat 11
            const isDom = (qBit & CQ_IS_DOM) !== 0;
            candidateExts.push((rootPc + (isDom ? EXT_SHARP_11TH : EXT_NAT_11TH)) % PITCH_CLASS_SIZE);
        }

        // minor 9th 撞音过滤
        const cleanExts: number[] = [];
        for (let i = 0; i < candidateExts.length; i++) {
            if (!checkMinorNinthClashPc(candidateExts[i], allChordPcs)) cleanExts.push(candidateExts[i]);
        }

        // 最终 PC 集:chord tone (no root) + 清洗后扩展(去重)
        const finalPcs: number[] = [];
        for (let i = 0; i < chordTonePcsNoRoot.length; i++) {
            if (finalPcs.indexOf(chordTonePcsNoRoot[i]) === -1) finalPcs.push(chordTonePcsNoRoot[i]);
        }
        for (let i = 0; i < cleanExts.length; i++) {
            if (finalPcs.indexOf(cleanExts[i]) === -1) finalPcs.push(cleanExts[i]);
        }
        // 保底:至少要有 [3, 7]
        if (finalPcs.length === 0 && chordTonePcsNoRoot.length > 0) {
            finalPcs.push(chordTonePcsNoRoot[0]);
            if (chordTonePcsNoRoot.length > 1) finalPcs.push(chordTonePcsNoRoot[1]);
        }

        // 放置 + listen LH
        const pitches: number[] = [];
        for (let i = 0; i < finalPcs.length; i++) {
            const pc = finalPcs[i];
            let isLhPc = false;
            for (let j = 0; j < lhPcs.length; j++) {
                if (lhPcs[j] === pc) { isLhPc = true; break; }
            }
            const effectiveLo = isLhPc ? Math.max(lo, lhTop + 12) : lo;
            const p = placePcNearAnchor(pc, anchor, effectiveLo, hi);
            pitches.push(p);
        }

        pitches.sort((a, b) => a - b);
        return dedupSortedArray(pitches);
    }

    /**
     * 构造 Quartal(纯四度叠置) voicing(原 buildQuartalVoicing)。
     *
     * 算法:
     *   1. 起点 PC = root + 7(5th) — 经典 So What voicing 起点
     *   2. 向上叠 voiceCount-1 个纯四度(5 半音步长)
     *   3. 起点放在 anchor 附近最近八度,后续 voice 顺次 +5 半音直到越界
     */
    public static buildQuartalRH(input: QuartalVoicerInput): number[] {
        const chord  = input.chord;
        const anchor = input.anchorPitch ?? DEFAULT_QUARTAL_ANCHOR;
        const hi     = input.rangeHi      ?? DEFAULT_RH_RANGE_HI;
        const lhTop  = input.lhTopPitch   ?? -1;
        const voiceCount = (input.voiceCount ?? 3) | 0;
        if (voiceCount <= 0) return [];

        const rootPc = normalizePc(chord.bassOverride !== undefined ? chord.bassOverride : chord.root);
        const startPc = (rootPc + 7) % PITCH_CLASS_SIZE;

        // 起点放置(>= max(anchor, lhTop+3),避免与 LH shell 撞)
        const floor = Math.max(anchor, lhTop + 3);
        const startPitch = placePcNearAnchor(startPc, anchor, floor, hi);

        const out: number[] = [startPitch];
        for (let i = 1; i < voiceCount; i++) {
            const next = startPitch + i * PERFECT_FOURTH_SEMITONES;
            if (next > hi) break;
            out.push(next);
        }
        return out;
    }

    // ============================================================
    // 钢琴 LH guide-tone shell voicing(Phase 3a 从 PianoAccompIdiom 迁入)
    // ============================================================

    /**
     * 构造钢琴 LH guide-tone shell voicing(原 PianoAccompIdiom.renderLHShellVoicing 内核)。
     *
     * 算法(D-1 零 PRNG):
     *   1. pickShellVariant — 按 (chordIndex, barInPhrase, colorBias, rootPc) hash 选 X/Y/Z 变体
     *   2. buildShellPcSet — 按 chord.quality 构建 [3rd, 7th] / [3rd, 7th, 9] / [root, 3rd, 7th] PC 集
     *   3. placePcInShellRange — 每个 PC 放置到 anchor 附近最近八度,钳到 [rangeLo, rangeHi]
     *   4. 去重 + 升序排序 + 计算 topPitch
     *
     * 调用方负责:
     *   - 提供 SHELL_ANCHOR_PITCH / SHELL_RANGE_LO / SHELL_RANGE_HI(钢琴专属配置)
     *   - 渲染时把 pitches 转 NoteData 并 push 到 track(本函数不做副作用,纯计算)
     *   - 用 pcSet + topPitch 给 RH 做 listen 协调(applyRhListenToLhShell 留在 PianoAccompIdiom)
     */
    public static buildShellLH(input: ShellLHInput): ShellLHOutput {
        const rootPc = normalizePc(input.chord.bassOverride !== undefined ? input.chord.bassOverride : input.chord.root);
        const variant = pickShellVariant(input.chordIndex, input.barInPhrase, input.colorBias, rootPc);
        const pcSet = buildShellPcSet(input.chord, variant);

        const pitches: number[] = [];
        let topPitch = -1;
        for (let i = 0; i < pcSet.length; i++) {
            const p = placePcInShellRange(pcSet[i], input.anchorPitch, input.rangeLo, input.rangeHi);
            // 防同 pitch 重复
            let dup = false;
            for (let j = 0; j < pitches.length; j++) {
                if (pitches[j] === p) { dup = true; break; }
            }
            if (!dup) {
                pitches.push(p);
                if (p > topPitch) topPitch = p;
            }
        }
        pitches.sort((a, b) => a - b);
        return { pitches, pcSet, topPitch };
    }
}
