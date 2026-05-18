/**
 * MacroProgressionEngine — Phase 6 纯代数推演 / 功能和声引擎
 *
 * 设计宗旨（与旧版静态字典 ChordTransitionMatrix 的根本差异）：
 *   旧版：风格 = N 个具名罗马数字 + N×N 权重矩阵（拼接字典）
 *   新版：风格 = 4 个变异门概率 + T-S-D 功能转移矩阵 + 各功能下的变体权重
 *         → 用代数推演（功能马尔可夫 + 算法变异）派生出和弦序列，无字典拼接
 *
 * 拓扑：
 *   Step A   骨架（Diatonic Framework）：
 *     状态机在 Tonic / Subdominant / Dominant 三态间做加权马尔可夫游走，
 *     每个功能下再按子权重抽具体三和弦变体：
 *       Tonic       → [I, vi, iii]
 *       Subdominant → [IV, ii]
 *       Dominant    → [V, vii°]
 *
 *   Step B   算法变异门（顺序串行 — D-5 PRNG 稳定）：
 *     Gate 1  Secondary Dominant  — 当前 → V7/next
 *     Gate 2  Tritone Substitution — V7 → bII7（root + 6）
 *     Gate 3  Modal Interchange    — 借用小调色彩（iv m7 或 bVI maj7）
 *     Gate 4  Tension Extension    — 7 和弦升级到 9（Dom7→Dom9 / Maj7→Maj9 / Min7→Min9）
 *
 * Pitch Space: RELATIVE（K-1 / K-2 / K-7）
 *   输出 GeneratedChord.root ∈ [0, 11]，相对调式主音；不含 keyOffset。
 *   由 Orchestrator.applyOffset() 唯一接管相对 → 绝对的转换。
 *
 * 约束遵从：
 *   D-1: PRNG 全部走 PRNGManager.next()，无 Math.random
 *   D-5: 每个 gate 恒定消耗 1 次 PRNG（命中与否不影响消耗次数），保证下游音轨序列对齐
 *   P-1: 全 flat number[] / enum，零 Map/Set
 *   P-3: 整数运算显式 truncate；负数取模用 ((x % 12) + 12) % 12 安全写法
 *   T-1: numeral 仅作显示字符串，不参与逻辑分类
 *   K-1 / K-2: root 严格在 0~11，绝不注入 keyOffset
 *   S-7: 非法 rules 抛 MacroProgressionError，runPipeline 入口统一 catch
 */

import { PRNGManager } from '../../utils/PRNG';
import {
    GeneratedChord, SectionMetadata, ChordQuality, Tonality, SectionType,
} from '../types';
import { parseNumeral } from '../data/ChordNumeralParser';

// ============================================================
// 基础类型
// ============================================================

/** 功能和声三态（T-S-D）— 严格 enum，禁字符串 */
export enum HarmonicFunction {
    Tonic       = 0,
    Subdominant = 1,
    Dominant    = 2,
}

const FUNCTION_COUNT  = 3;
const PITCH_CLASS_SIZE = 12;
const EPSILON          = 1e-6;

/**
 * Phase 2 — 预置和弦骨架（Progression Template）。
 *
 * 数据布局：纯 flat number[] / ChordQuality[]，C 端直接映射。
 *   - roots[i]     : 第 i 个槽位的根音（相对调式主音的 pitch class 0~11）
 *   - qualities[i] : 第 i 个槽位的和弦质（与 roots 平行索引）
 *   - weight       : 风格池内的抽样权重（与其他模板竞争）
 *
 * 用法：HarmonyRulesConfig.progressionSkeletons 注入 → MacroProgressionEngine.generate
 *       80% 概率走骨架循环（绕过马尔可夫），20% 仍走 T-S-D 推演（保多样性）。
 */
export interface ProgressionSkeleton {
    roots: number[];
    qualities: ChordQuality[];
    weight: number;
}

/**
 * 和声规则配置 — 取代旧 ChordTransitionMatrix。
 *
 * 数据布局全部为 flat number[]：
 *   - functionTransitions: 3×3 flat 矩阵，行优先（行 = from，列 = to）
 *   - tonic/subdominant/dominantVariantWeights: 各功能下变体的权重表
 *   - 四个 *Prob 字段：四道变异门的命中概率（[0, 1]）
 *
 * 风格通过塑造这些数值参数来表达色彩偏好 — 无需新建字典。
 */
export interface HarmonyRulesConfig {
    /** 3×3 功能转移矩阵 — index: from * 3 + to (Tonic=0 / Subdom=1 / Dom=2)，length === 9 */
    functionTransitions: number[];

    /** Tonic 下变体权重 — 索引：0=I / 1=vi / 2=iii，长度 3 */
    tonicVariantWeights: number[];
    /** Subdominant 下变体权重 — 索引：0=IV / 1=ii，长度 2 */
    subdominantVariantWeights: number[];
    /** Dominant 下变体权重 — 索引：0=V / 1=vii°，长度 2 */
    dominantVariantWeights: number[];

    /** Gate 1 — Secondary Dominant 命中概率 */
    secondaryDominantProb: number;
    /** Gate 2 — Tritone Substitution 命中概率 */
    tritoneSubProb: number;
    /** Gate 3 — Modal Interchange 命中概率（内部二分两种借调变体） */
    modalInterchangeProb: number;
    /** Gate 4 — Tension Extension（7 升 9）命中概率 */
    tensionExtensionProb: number;

    /**
     * Cadential Hijacking — 段落倒数第二个和弦（半终止位）强制覆写的功能。
     *
     * 一阶马尔可夫无法提供宏观乐句归宿感；本字段在 Step A 推演时拦截 c=chordsPer-2，
     * 强制 curFunc = 本字段值（Pop/Jazz: Dominant；NeoSoul: Subdominant）。
     * c=chordsPer-1（全终止位）始终强制 Tonic（硬编码，不参数化）。
     *
     * D-5：发生覆写时空转一次 PRNG，替代 pickNextFunction 原本的骰子消耗。
     *
     * 缺省时（undefined）退化为 Dominant（保留传统 V→I 完全终止式行为）。
     */
    cadentialPredominant?: HarmonicFunction;

    /** Phase 2: 预置和弦骨架池。若提供，则绕过马尔可夫游走，直接循环骨架，再应用变异门 */
    progressionSkeletons?: ProgressionSkeleton[];
}

export interface MacroProgressionInput {
    sections: SectionMetadata[];
    rules: HarmonyRulesConfig;
    /** 每段和弦数 — 默认 4 */
    chordsPerSection?: number;
    /** V4.2c — 调式（pool 路径需要选 major/minor + parseNumeral 用） */
    tonality?: Tonality;
    /** V4.2c — 进行池（来自 styleConfig.harmony）。
     *  提供时 70% 概率从 pool 抽起手 + 跳过 Step B 变异门（保留 pool 的"文化记忆"），
     *  30% 概率走原代数推演 + 4 道变异门。 */
    progressionPool?: {
        major: Record<string, string[][]>;
        minor: Record<string, string[][]>;
    };
}

// ============================================================
// 变体表（flat parallel arrays，C 端可直接翻译为 const int8_t[]）
// ============================================================

// Tonic 变体：I (root=0, Maj7) / vi (root=9, Min7) / iii (root=4, Min7)
const TONIC_VARIANT_ROOTS:     number[]        = [0, 9, 4];
const TONIC_VARIANT_QUALITIES: ChordQuality[]  = [
    ChordQuality.Major7, ChordQuality.Minor7, ChordQuality.Minor7,
];
const TONIC_VARIANT_NUMERALS:  string[]        = ['Imaj7', 'vi7', 'iii7'];

// Subdominant 变体：IV (root=5, Maj7) / ii (root=2, Min7)
const SUBDOM_VARIANT_ROOTS:     number[]       = [5, 2];
const SUBDOM_VARIANT_QUALITIES: ChordQuality[] = [
    ChordQuality.Major7, ChordQuality.Minor7,
];
const SUBDOM_VARIANT_NUMERALS:  string[]       = ['IVmaj7', 'ii7'];

// Dominant 变体：V (root=7, Dom7) / vii° (root=11, HalfDim)
const DOM_VARIANT_ROOTS:     number[]          = [7, 11];
const DOM_VARIANT_QUALITIES: ChordQuality[]    = [
    ChordQuality.Dominant7, ChordQuality.HalfDiminished,
];
const DOM_VARIANT_NUMERALS:  string[]          = ['V7', 'viiø7'];

// 根音 → 罗马数字大写显示名（仅显示，T-1 合规）
const ROOT_NUMERAL_NAMES: string[] = [
    'I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII',
];

// ============================================================
// 错误类型
// ============================================================

export class MacroProgressionError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'MacroProgressionError';
        this.context = context;
    }
}

// ============================================================
// 主类
// ============================================================

export class MacroProgressionEngine {
    /**
     * 入口：纯代数推演 — Step A 骨架 → Step B 变异门。
     *
     * PRNG 消耗（确定性，无视分支）：
     *   每个和弦 6 次（首和弦 5 次 — 段首无功能转移）：
     *     [Step A]
     *       1) functionTransitions 抽下一功能（段首跳过）   × 0 / 1
     *       2) variantWeights 抽变体                       × 1
     *     [Step B]
     *       3) Gate 1 Secondary Dominant                   × 1
     *       4) Gate 2 Tritone Sub                          × 1
     *       5) Gate 3 Modal Interchange                    × 1
     *       6) Gate 4 Tension Extension                    × 1
     *
     * 输出 GeneratedChord.root: RELATIVE [0, 11]（K-1 / K-2）。
     */
    public static generate(input: MacroProgressionInput): GeneratedChord[] {
        MacroProgressionEngine.validate(input);

        const globalChordsPer = input.chordsPerSection;
        const rules     = input.rules;
        const out: GeneratedChord[]       = [];
        // 与 out 平行索引 — 跟踪每和弦的"原始/Gate1 后"功能标签，仅供 Gate 3 判定使用
        const functionTags: HarmonicFunction[] = [];
        // V4.2c — 与 out 平行索引，true = chord 来自 progression pool（Step B 跳过变异门）
        const fromPool: boolean[] = [];

        // -----------------------------------------------------------
        // Step A — 骨架推演（T-S-D 马尔可夫游走 + 变体抽取）
        // -----------------------------------------------------------
        for (let secIdx = 0; secIdx < input.sections.length; secIdx++) {
            const section          = input.sections[secIdx];
            const sectionDuration  = section.endBeat - section.startBeat;
            if (sectionDuration < EPSILON) continue;

            // V4.2c — 优先尝试 pool 路径（70% 概率从风格进行池抽起手）
            if (MacroProgressionEngine.tryPoolPath(section, input, out, functionTags, fromPool)) {
                continue;
            }
            // Step 1B：chordsPer 改 per-section 解析
            //   优先 section.chordsHint（Pipeline 按段长 / styleBeatsPerChord 算出）
            //   回落 input.chordsPerSection（向后兼容）
            //   最终 4
            //   下限 2 钳制 — Cadential Hijacking 需要至少半终止 + 全终止两个位置
            const chordsPer = Math.max(2, Math.floor(
                section.chordsHint ?? globalChordsPer ?? 4
            ));
            const beatsPerChord    = sectionDuration / chordsPer;

            // Phase 2 — 段首预抽 ProgressionSkeleton：恒定消耗 2 次 PRNG（不论是否注入骨架池）
            //   useSkeletonRoll < 0.8 命中（且池非空）→ activeTemplate 接管整段和弦
            //   否则退化为 T-S-D 推演（兼容旧路径）
            //   无骨架池时也空转 2 次 PRNG，保证 D-5 PRNG 序列对齐
            let activeTemplate: ProgressionSkeleton | null = null;
            if (input.rules.progressionSkeletons && input.rules.progressionSkeletons.length > 0) {
                const useSkeletonRoll = PRNGManager.next();
                const idxRoll = PRNGManager.next();
                let totalW = 0;
                for (let i = 0; i < input.rules.progressionSkeletons.length; i++) {
                    totalW += input.rules.progressionSkeletons[i].weight;
                }
                if (useSkeletonRoll < 0.8 && totalW > EPSILON) {
                    const pick = idxRoll * totalW;
                    let cum = 0;
                    for (let i = 0; i < input.rules.progressionSkeletons.length; i++) {
                        cum += input.rules.progressionSkeletons[i].weight;
                        if (pick < cum) {
                            activeTemplate = input.rules.progressionSkeletons[i];
                            break;
                        }
                    }
                }
            } else {
                PRNGManager.next();
                PRNGManager.next();
            }

            let curFunc: HarmonicFunction = HarmonicFunction.Tonic;
            const cadentialPredominant = input.rules.cadentialPredominant !== undefined
                ? input.rules.cadentialPredominant
                : HarmonicFunction.Dominant;

            for (let c = 0; c < chordsPer; c++) {
                let root0 = 0;
                let quality0 = ChordQuality.Major7;
                let numeral0 = '';

                if (activeTemplate) {
                    const skelLen = activeTemplate.roots.length;
                    root0 = activeTemplate.roots[c % skelLen];
                    quality0 = activeTemplate.qualities[c % skelLen];
                    numeral0 = MacroProgressionEngine['numeralOfRoot'](root0);

                    const r = MacroProgressionEngine['modPC'](root0);
                    if (r === 5 || r === 2) curFunc = HarmonicFunction.Subdominant;
                    else if (r === 7 || r === 11) curFunc = HarmonicFunction.Dominant;
                    else curFunc = HarmonicFunction.Tonic;

                    if (c > 0) PRNGManager.next(); // D-5 spin：替代 pickNextFunction
                    PRNGManager.next();            // D-5 spin：替代 pickVariant
                } else {
                    if (c > 0) {
                        const isHalfCadence = (c === chordsPer - 2);
                        const isFullCadence = (c === chordsPer - 1);
                        if (isHalfCadence) {
                            curFunc = cadentialPredominant;
                            PRNGManager.next();   // D-5 spin
                        } else if (isFullCadence) {
                            curFunc = HarmonicFunction.Tonic;
                            PRNGManager.next();   // D-5 spin
                        } else {
                            curFunc = MacroProgressionEngine['pickNextFunction'](
                                curFunc, input.rules.functionTransitions,
                            );
                        }
                    }
                    const variantIdx = MacroProgressionEngine['pickVariant'](curFunc, input.rules);
                    root0 = MacroProgressionEngine['variantRoot'](curFunc, variantIdx);
                    quality0 = MacroProgressionEngine['variantQuality'](curFunc, variantIdx);
                    numeral0 = MacroProgressionEngine['variantNumeral'](curFunc, variantIdx);
                }

                const startBeat  = section.startBeat + c * beatsPerChord;
                const endBeat    = section.startBeat + (c + 1) * beatsPerChord;

                out.push({
                    numeral: numeral0,
                    root:    root0,
                    quality: quality0,
                    startBeat,
                    endBeat,
                });
                functionTags.push(curFunc);
                fromPool.push(false);
            }
        }

        // -----------------------------------------------------------
        // Step B — 四道变异门串行处理（每和弦恒定 4 次 PRNG）
        //   V4.2c：fromPool[i]=true 的 chord 跳过变异（保留 pool 的"文化记忆"），
        //          但仍空转 4 次 PRNG 保 D-5 序列对齐
        // -----------------------------------------------------------
        for (let i = 0; i < out.length; i++) {
            if (fromPool[i]) {
                // Pool chord：跳过 4 道门，空转 PRNG 保对齐
                PRNGManager.next();
                PRNGManager.next();
                PRNGManager.next();
                PRNGManager.next();
                continue;
            }
            const chord     = out[i];
            const nextChord = (i + 1 < out.length) ? out[i + 1] : null;

            // 当前功能标签 — Gate 1 可能将其变更为 Dominant（影响 Gate 3 的判定）
            let funcTag: HarmonicFunction = functionTags[i];

            // ─── Gate 1: Secondary Dominant ───
            // 命中 + 有 next → 将当前和弦变为 next 的属和弦 (root = (next+7)%12, qual = Dom7)
            const r1 = PRNGManager.next();
            if (r1 < rules.secondaryDominantProb && nextChord !== null) {
                chord.root    = MacroProgressionEngine.modPC(nextChord.root + 7);
                chord.quality = ChordQuality.Dominant7;
                chord.numeral = `V7/${MacroProgressionEngine.numeralOfRoot(nextChord.root)}`;
                funcTag       = HarmonicFunction.Dominant;
            }

            // ─── Gate 2: Tritone Substitution ───
            // 命中 + 当前 quality === Dominant7 → root + 6（quality 保持 Dom7）
            const r2 = PRNGManager.next();
            if (r2 < rules.tritoneSubProb && chord.quality === ChordQuality.Dominant7) {
                chord.root    = MacroProgressionEngine.modPC(chord.root + 6);
                chord.numeral = nextChord !== null
                    ? `subV7/${MacroProgressionEngine.numeralOfRoot(nextChord.root)}`
                    : 'subV7';
                // funcTag 保持 Dominant
            }

            // ─── Gate 3: Modal Interchange ───
            // 命中 + funcTag === Subdominant → 二分两种借调变体
            //   r3 ∈ [0,           p/2)              → 变体 A: 当前 root，quality = Minor7（如 IV → iv）
            //   r3 ∈ [p/2,         p   )              → 变体 B: root + 3，quality = Major7（如 IV → bVI maj7）
            //   r3 ∈ [p,           1   )              → 不变
            const r3 = PRNGManager.next();
            if (funcTag === HarmonicFunction.Subdominant) {
                const pFull = rules.modalInterchangeProb;
                const pHalf = pFull * 0.5;
                if (r3 < pHalf) {
                    // 变体 A：借小调 — quality 降为 Minor7（IV→iv，ii→已是 Min7 则 no-op）
                    chord.quality = ChordQuality.Minor7;
                    chord.numeral = `iv7(borrowed)`;
                } else if (r3 < pFull) {
                    // 变体 B：bVI maj7（root + 3）
                    chord.root    = MacroProgressionEngine.modPC(chord.root + 3);
                    chord.quality = ChordQuality.Major7;
                    chord.numeral = 'bVImaj7';
                }
            }

            // ─── Gate 4: Tension Extension ───
            // 命中 → 把 7 和弦升到 9（Dom7→Dom9 / Maj7→Maj9 / Min7→Min9）
            //   其他 quality（Sus / HalfDim / Dim / 三和弦）不升级 — 已经够色彩 / 物理上不规整
            const r4 = PRNGManager.next();
            if (r4 < rules.tensionExtensionProb) {
                MacroProgressionEngine.upgradeQuality(chord);
            }
        }

        return out;
    }

    // ─────────────── V4.2c Pool path ───────────────

    /**
     * 尝试从风格进行池抽起手（70% 概率）。
     *
     * 返回 true = pool 路径被采用（caller 跳过算法路径）；false = 走原代数路径。
     *
     * PRNG 消耗（确定性）：
     *   - 始终 2 次（决定 use vs algebraic + pool idx）— 即使无 pool 也空转保对齐
     *   - 若 pool 命中：每和弦 0 次额外 PRNG（parseNumeral 纯字符串解析）
     *
     * Pool 命中时 fromPool[i] 全标记 true，Step B 自动跳过变异门。
     */
    private static tryPoolPath(
        section: SectionMetadata,
        input: MacroProgressionInput,
        out: GeneratedChord[],
        functionTags: HarmonicFunction[],
        fromPool: boolean[],
    ): boolean {
        // 始终消耗 2 次 PRNG（保 D-5 对齐，无视 pool 是否可用）
        const useRoll = PRNGManager.next();
        const idxRoll = PRNGManager.next();

        if (input.progressionPool === undefined || input.tonality === undefined) return false;
        const sectionKey = MacroProgressionEngine.sectionTypeToPoolKey(section.sectionType);
        if (sectionKey === null) return false;

        const poolByTonality = input.tonality === Tonality.Minor
            ? input.progressionPool.minor
            : input.progressionPool.major;
        const sectionPool = poolByTonality[sectionKey];
        if (sectionPool === undefined || sectionPool.length === 0) return false;

        if (useRoll >= 0.7) return false;  // 30% 走原算法

        const progIdx = Math.floor(idxRoll * sectionPool.length) % sectionPool.length;
        const progression = sectionPool[progIdx];
        if (progression.length === 0) return false;

        const numChords = progression.length;
        const sectionDuration = section.endBeat - section.startBeat;
        const beatsPerChord = sectionDuration / numChords;

        for (let c = 0; c < numChords; c++) {
            const numeral = progression[c];
            const parsed = parseNumeral(numeral, input.tonality);
            const startBeat = section.startBeat + c * beatsPerChord;
            const endBeat = section.startBeat + (c + 1) * beatsPerChord;
            const chord: GeneratedChord = {
                numeral,
                root: parsed.root,
                quality: parsed.quality,
                startBeat,
                endBeat,
            };
            if (parsed.bassOverride !== undefined) chord.bassOverride = parsed.bassOverride;
            out.push(chord);
            functionTags.push(MacroProgressionEngine.classifyFunctionByRoot(parsed.root));
            fromPool.push(true);
        }
        return true;
    }

    /** SectionType → 进行池 key（与 StyleRegistry pool 键对齐） */
    private static sectionTypeToPoolKey(s: SectionType | undefined): string | null {
        if (s === undefined) return null;
        switch (s) {
            case SectionType.Intro:       return 'intro';
            case SectionType.Verse:       return 'verse';
            case SectionType.PreChorus:   return 'preChorus';
            case SectionType.Chorus:      return 'chorus';
            case SectionType.Bridge:      return 'bridge';
            case SectionType.Outro:       return 'outro';
            case SectionType.PreOutro:    return 'outro';
            case SectionType.BuildUp:     return 'preChorus';
            case SectionType.Solo_Bridge: return 'bridge';
            // Drop / Break / Breakdown 无 pool 映射 → 走算法路径
            default: return null;
        }
    }

    /** 按 root PC 反推功能标签（pool chord 没有原生 functionTag） */
    private static classifyFunctionByRoot(rootPc: number): HarmonicFunction {
        const r = ((rootPc | 0) % 12 + 12) % 12;
        if (r === 5 || r === 2) return HarmonicFunction.Subdominant;
        if (r === 7 || r === 11) return HarmonicFunction.Dominant;
        return HarmonicFunction.Tonic;
    }

    // ─────────────── Step A helpers ───────────────

    /**
     * 按 functionTransitions 的 `from` 行做加权抽样 — 恒消耗 1 次 PRNG。
     * total <= 0 时兜底返回 from（仍消耗 PRNG 以保 D-5 对齐）。
     */
    private static pickNextFunction(
        from: HarmonicFunction, transitions: number[],
    ): HarmonicFunction {
        const rowStart = (from | 0) * FUNCTION_COUNT;
        let total = 0;
        for (let i = 0; i < FUNCTION_COUNT; i++) {
            const w = transitions[rowStart + i];
            if (w > 0) total += w;
        }
        const r = PRNGManager.next();
        if (total <= EPSILON) return from;

        const pick = r * total;
        let cum = 0;
        let lastValid: HarmonicFunction = from;
        for (let i = 0; i < FUNCTION_COUNT; i++) {
            const w = transitions[rowStart + i];
            if (w > 0) {
                cum += w;
                lastValid = i as HarmonicFunction;
                if (pick < cum) return i as HarmonicFunction;
            }
        }
        return lastValid;
    }

    /**
     * 在 curFunc 对应的 variantWeights 上做加权抽样 — 恒消耗 1 次 PRNG。
     */
    private static pickVariant(
        func: HarmonicFunction, rules: HarmonyRulesConfig,
    ): number {
        let weights: number[];
        if (func === HarmonicFunction.Tonic) {
            weights = rules.tonicVariantWeights;
        } else if (func === HarmonicFunction.Subdominant) {
            weights = rules.subdominantVariantWeights;
        } else {
            weights = rules.dominantVariantWeights;
        }

        const len = weights.length;
        let total = 0;
        for (let i = 0; i < len; i++) {
            if (weights[i] > 0) total += weights[i];
        }
        const r = PRNGManager.next();
        if (total <= EPSILON) return 0;

        const pick = r * total;
        let cum = 0;
        let lastValid = 0;
        for (let i = 0; i < len; i++) {
            const w = weights[i];
            if (w > 0) {
                cum += w;
                lastValid = i;
                if (pick < cum) return i;
            }
        }
        return lastValid;
    }

    private static variantRoot(func: HarmonicFunction, idx: number): number {
        if (func === HarmonicFunction.Tonic) {
            return TONIC_VARIANT_ROOTS[idx] ?? 0;
        }
        if (func === HarmonicFunction.Subdominant) {
            return SUBDOM_VARIANT_ROOTS[idx] ?? 5;
        }
        return DOM_VARIANT_ROOTS[idx] ?? 7;
    }

    private static variantQuality(func: HarmonicFunction, idx: number): ChordQuality {
        if (func === HarmonicFunction.Tonic) {
            return TONIC_VARIANT_QUALITIES[idx] ?? ChordQuality.Major7;
        }
        if (func === HarmonicFunction.Subdominant) {
            return SUBDOM_VARIANT_QUALITIES[idx] ?? ChordQuality.Major7;
        }
        return DOM_VARIANT_QUALITIES[idx] ?? ChordQuality.Dominant7;
    }

    private static variantNumeral(func: HarmonicFunction, idx: number): string {
        if (func === HarmonicFunction.Tonic) {
            return TONIC_VARIANT_NUMERALS[idx] ?? '?';
        }
        if (func === HarmonicFunction.Subdominant) {
            return SUBDOM_VARIANT_NUMERALS[idx] ?? '?';
        }
        return DOM_VARIANT_NUMERALS[idx] ?? '?';
    }

    // ─────────────── Step B helpers ───────────────

    /**
     * 仅供 numeral 拼接使用 — T-1 合规（不用于逻辑分类）。
     */
    private static numeralOfRoot(root: number): string {
        const r = MacroProgressionEngine.modPC(root);
        return ROOT_NUMERAL_NAMES[r];
    }

    /**
     * Tension 升级：7 和弦 → 9 和弦（in-place 修改 chord.quality）。
     * 不升级 Sus / HalfDim / Dim / 三和弦 — 这些质保留原貌。
     */
    private static upgradeQuality(chord: GeneratedChord): void {
        const q = chord.quality;
        if (q === ChordQuality.Dominant7) {
            chord.quality = ChordQuality.Dominant9;
        } else if (q === ChordQuality.Major7) {
            chord.quality = ChordQuality.Major9;
        } else if (q === ChordQuality.Minor7) {
            chord.quality = ChordQuality.Minor9;
        }
        // 其他 quality 不动
    }

    // ─────────────── 工具 ───────────────

    /** 安全 mod 12（处理负数；P-3 / P-5） */
    private static modPC(x: number): number {
        const r = Math.trunc(x) % PITCH_CLASS_SIZE;
        return r < 0 ? r + PITCH_CLASS_SIZE : r;
    }

    /** S-7：非法输入早期失败 */
    private static validate(input: MacroProgressionInput): void {
        const r = input.rules;
        if (r.functionTransitions.length !== FUNCTION_COUNT * FUNCTION_COUNT) {
            throw new MacroProgressionError(
                `functionTransitions length must be ${FUNCTION_COUNT * FUNCTION_COUNT}`,
                { actual: r.functionTransitions.length },
            );
        }
        if (r.tonicVariantWeights.length === 0 ||
            r.subdominantVariantWeights.length === 0 ||
            r.dominantVariantWeights.length === 0) {
            throw new MacroProgressionError(
                'variant weights arrays must be non-empty',
                {
                    T: r.tonicVariantWeights.length,
                    S: r.subdominantVariantWeights.length,
                    D: r.dominantVariantWeights.length,
                },
            );
        }
        if (r.secondaryDominantProb < 0 || r.secondaryDominantProb > 1 ||
            r.tritoneSubProb < 0       || r.tritoneSubProb > 1 ||
            r.modalInterchangeProb < 0 || r.modalInterchangeProb > 1 ||
            r.tensionExtensionProb < 0 || r.tensionExtensionProb > 1) {
            throw new MacroProgressionError(
                'gate probability out of [0, 1] range',
                {
                    secDom: r.secondaryDominantProb,
                    tt:     r.tritoneSubProb,
                    mod:    r.modalInterchangeProb,
                    tens:   r.tensionExtensionProb,
                },
            );
        }
        if (r.cadentialPredominant !== undefined) {
            const v = r.cadentialPredominant | 0;
            if (v < 0 || v >= FUNCTION_COUNT) {
                throw new MacroProgressionError(
                    'cadentialPredominant must be a HarmonicFunction enum value',
                    { actual: r.cadentialPredominant },
                );
            }
        }
    }
}
