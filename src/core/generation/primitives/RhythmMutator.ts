/**
 * RhythmMutator — 律动变异器
 *
 * 移植参考：ImproVisor / Tension.java 的 generateSyncopation 思路。
 *
 * 两阶段算法：
 *
 *   Phase A — 密度铺底：
 *     按 sparsityTendency 算出目标击点数 targetHits，强制 step 0 锚 downbeat，
 *     剩余位用 "metrical weight × 2 + PRNG noise" 加权排序，取分数最高的 targetHits-1 个。
 *     PRNG noise 范围 [0,1) 永远小于 weight 跨级差（最小差=1），故 weight 主导排序，
 *     仅在 weight 相等时 PRNG 破平局 → 高拍永远先填，但同级位置由种子决定。
 *
 *   Phase B — 张力逼近（有界变异循环）：
 *     评估当前 syncopation，与目标 syncopationAssault 比对：
 *       diff > 0  → "强→弱" shift：把强拍上的击点搬到相邻弱拍空槽位 → 增切分
 *       diff < 0  → "弱→强" shift：把弱拍上的击点搬到相邻强拍空槽位 → 减切分
 *     每次迭代消耗 PRNG ×2（pick 候选 + pick 方向），失败则不改动。
 *     再评估 syncopation，若新差值绝对值 > 旧差值（变异适得其反）→ 回滚。
 *     有界 maxIterations（默认 20 — C-4 硬上限，确保 ESP32 不死循环）。
 *
 * 设计约束（music_generation_pipeline_rule.md）：
 *   D-1: 所有随机来自 PRNGManager；无 Math.random()
 *   D-3: 排序提供完全确定的比较函数（score DESC，stableSecondary = index ASC 兜底）
 *   D-4: 浮点比较走 EPSILON
 *   P-1: grid = Int8Array；候选索引用预分配 number[] + 计数（无 Map/Set）
 *   P-3: 整数除法显式 Math.floor
 *   C-3: 热循环不创建临时数组
 *   C-4: 输出 grid 长度 = totalBeats × stepsPerBeat（caller 显式给出，文档化最大长度）
 *   S-3: 全同步纯函数
 *
 * Pitch Space: N/A（本模块不接触 pitch）
 *
 * @author AuraFlow Tap! Phase 2.6
 */

import { PRNGManager } from '../../utils/PRNG';
import { SyncopationEvaluator } from './SyncopationEvaluator';

const EPSILON = 1e-6;
const CONVERGE_EPSILON = 0.02;  // |sync - target| 小于此即认为收敛
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_STEPS_PER_BEAT = 4;
const STRONG_BEAT_THRESHOLD = 2;  // weight >= 2 视为强拍（quarter/half/whole）

// Phase A 密度系数 — 防止 (1 - sparsity) 直接作为 density 后过满；0.6 是经验值，
// 对应 sparsity=0 时 60% 网格密度（4/4 16-step = 9~10 击），近似 funk comping 上限。
const DENSITY_BASE_FACTOR = 0.6;

// ============================================================
// 公开 API
// ============================================================

export interface RhythmMutatorInput {
    /** 段长（拍）— 必须 > 0 */
    totalBeats: number;

    /** 每拍 step 数（默认 4，即 16 分网格）— 当前仅支持 4 */
    stepsPerBeat?: number;

    /** Persona.sparsityTendency：0=密集弹满 / 1=极稀疏 */
    sparsityTendency: number;

    /** Persona.syncopationAssault 目标张力 [0, 1] */
    syncopationAssault: number;

    /** 变异循环上限（防 ESP32 死循环）；默认 20，建议 ≤ 30 */
    maxIterations?: number;
}

export interface RhythmMutatorDiagnostics {
    /** 实际产出的击点数 */
    finalHits: number;
    /** 最终 syncopation 实测值 */
    finalSyncopation: number;
    /** 实际跑了多少轮变异（≤ maxIterations） */
    iterationsUsed: number;
    /** 成功 shift 次数（含被后续 rollback 抵消的） */
    shiftsAttempted: number;
    /** 因新差值变差而回滚的次数 */
    shiftsRolledBack: number;
}

export class RhythmMutator {

    /**
     * 生成节奏网格。详细算法见文件头注释。
     *
     * PRNG 消耗：
     *   Phase A: totalSteps - 1（每个非锚步骤 1 次 noise）
     *   Phase B: 2 × iterationsUsed（pickIdx + pickDir）
     *
     * Pitch Space: N/A
     */
    public static generate(input: RhythmMutatorInput): Int8Array {
        return RhythmMutator.generateWithDiagnostics(input).grid;
    }

    /**
     * 带诊断信息的生成 — 用于 sanity check 和测试日志。
     */
    public static generateWithDiagnostics(input: RhythmMutatorInput): {
        grid: Int8Array;
        diagnostics: RhythmMutatorDiagnostics;
    } {
        RhythmMutator.validate(input);

        const stepsPerBeat = input.stepsPerBeat ?? DEFAULT_STEPS_PER_BEAT;
        const totalSteps = Math.floor(input.totalBeats * stepsPerBeat);
        const stepsPerBar = stepsPerBeat * 4;  // 4/4 假定
        const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

        const grid = new Int8Array(totalSteps);

        // ============================================================
        // Phase A — 密度铺底
        // ============================================================
        const density = 1 - clamp01(input.sparsityTendency);
        let targetHits = Math.floor(totalSteps * density * DENSITY_BASE_FACTOR + 0.5);
        if (targetHits < 1) targetHits = 1;
        if (targetHits > totalSteps) targetHits = totalSteps;

        // 锚 step 0：downbeat 永远发声（drummer 直觉 + 切分算法要求 "首音" 存在）
        grid[0] = 1;
        let remainingHits = targetHits - 1;

        // 评分 + 排序（剩余 step）— **target-aware polarity**
        //
        //   polarity = 1 - 2 × syncopationAssault  ∈ [-1, +1]
        //     target=0   → polarity=+1，score=weight+noise → 偏强拍（"干净"）
        //     target=0.5 → polarity= 0，score=noise        → 均匀分布
        //     target=1   → polarity=-1，score=-weight+noise → 偏弱拍（"切分"）
        //
        //   weight ∈ [0,4]，|polarity×weight| ∈ [0,4]，noise ∈ [0,1)。
        //   当 |polarity| ≥ 0.5 时，weight 跨级差 ≥ 0.5 仍主导 noise → 同级 PRNG 破平局。
        //   高目标时直接铺到 offbeat 16th，Phase B 只需做局部精修 → 收敛快 + 可达 sync≈1.0。
        //
        // 用两个 number[] 平行索引避免临时对象（C-3 兼容）
        const target = clamp01(input.syncopationAssault);
        const polarity = 1 - 2 * target;
        const scoreScratch: number[] = new Array(totalSteps);
        const indexScratch: number[] = new Array(totalSteps);
        let scratchCount = 0;
        for (let i = 1; i < totalSteps; i++) {
            const weight = SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
            const noise = PRNGManager.next();
            scoreScratch[scratchCount] = weight * polarity + noise;
            indexScratch[scratchCount] = i;
            scratchCount++;
        }
        scoreScratch.length = scratchCount;
        indexScratch.length = scratchCount;

        // 平行数组排序 — 按 score DESC，tie 时 index ASC（确定性 D-3）
        // 简单选择排序 N×M（M = remainingHits） — totalSteps 通常 ≤ 256，可接受。
        // 不能用 Array.sort 因为它无法平行交换。
        const picksToMake = Math.min(remainingHits, scratchCount);
        for (let pick = 0; pick < picksToMake; pick++) {
            let bestIdx = pick;
            for (let k = pick + 1; k < scratchCount; k++) {
                if (scoreScratch[k] > scoreScratch[bestIdx] + EPSILON) {
                    bestIdx = k;
                } else if (
                    Math.abs(scoreScratch[k] - scoreScratch[bestIdx]) < EPSILON &&
                    indexScratch[k] < indexScratch[bestIdx]
                ) {
                    bestIdx = k;
                }
            }
            if (bestIdx !== pick) {
                const tmpScore = scoreScratch[pick];
                scoreScratch[pick] = scoreScratch[bestIdx];
                scoreScratch[bestIdx] = tmpScore;
                const tmpIdx = indexScratch[pick];
                indexScratch[pick] = indexScratch[bestIdx];
                indexScratch[bestIdx] = tmpIdx;
            }
            grid[indexScratch[pick]] = 1;
        }

        // ============================================================
        // Phase B — 张力逼近（有界变异循环）
        // ============================================================
        const diag: RhythmMutatorDiagnostics = {
            finalHits: 0,
            finalSyncopation: 0,
            iterationsUsed: 0,
            shiftsAttempted: 0,
            shiftsRolledBack: 0,
        };

        // 候选 step 索引 buffer — 复用，避免每轮分配（C-3）
        const candidateBuf: number[] = new Array(totalSteps);

        let curSync = SyncopationEvaluator.calculateSyncopation(grid, stepsPerBar);

        for (let iter = 0; iter < maxIterations; iter++) {
            diag.iterationsUsed = iter + 1;

            const diff = target - curSync;
            if (Math.abs(diff) < CONVERGE_EPSILON) break;

            const pickRandom = PRNGManager.next();
            const dirRandom = PRNGManager.next();

            const forIncrease = diff > 0;
            const swapped = RhythmMutator.attemptShift(
                grid, stepsPerBar, candidateBuf,
                forIncrease, pickRandom, dirRandom,
            );

            if (swapped < 0) continue;  // 无可用候选 / 邻位不空 — 跳过

            diag.shiftsAttempted++;
            const newSync = SyncopationEvaluator.calculateSyncopation(grid, stepsPerBar);
            const newDiff = target - newSync;

            if (Math.abs(newDiff) > Math.abs(diff) + EPSILON) {
                // 变异适得其反 → 回滚
                const fromStep = swapped >>> 16;
                const toStep = swapped & 0xFFFF;
                grid[fromStep] = 1;
                grid[toStep] = 0;
                diag.shiftsRolledBack++;
            } else {
                curSync = newSync;
            }
        }

        // ============================================================
        // 诊断信息收尾
        // ============================================================
        let finalHits = 0;
        for (let i = 0; i < totalSteps; i++) {
            if (grid[i] === 1) finalHits++;
        }
        diag.finalHits = finalHits;
        diag.finalSyncopation = curSync;

        return { grid, diagnostics: diag };
    }

    // ============================================================
    // 内部：单步 shift
    // ============================================================

    /**
     * 尝试一次 shift：返回 (fromStep << 16) | toStep 表示成功；返回 -1 表示无变化。
     *
     * forIncrease=true：
     *   候选 = grid[i]===1 且 weight(i) >= STRONG_BEAT_THRESHOLD 且 i !== 0 的 step
     *   邻位选择：weight(neighbor) < weight(candidate) 且 neighbor 空
     *
     * forIncrease=false：
     *   候选 = grid[i]===1 且 weight(i) === 0 的 step（弱拍击点）
     *   邻位选择：weight(neighbor) > weight(candidate) 且 neighbor 空
     *
     * 方向：dirRandom < 0.5 试 backward，否则试 forward；首选失败再试另一向。
     */
    private static attemptShift(
        grid: Int8Array,
        stepsPerBar: number,
        candidateBuf: number[],
        forIncrease: boolean,
        pickRandom: number,
        dirRandom: number,
    ): number {
        const L = grid.length;

        // 收集候选
        let candidateCount = 0;
        for (let i = 0; i < L; i++) {
            if (grid[i] !== 1) continue;
            if (i === 0) continue;  // 永远不动 downbeat
            const w = SyncopationEvaluator.getMetricalWeight(i, stepsPerBar);
            const isCandidate = forIncrease
                ? w >= STRONG_BEAT_THRESHOLD
                : w === 0;
            if (isCandidate) {
                candidateBuf[candidateCount++] = i;
            }
        }
        if (candidateCount === 0) return -1;

        // 选一个候选
        const pickIdx = Math.floor(pickRandom * candidateCount);
        const candidate = candidateBuf[pickIdx >= candidateCount ? candidateCount - 1 : pickIdx];
        const wCandidate = SyncopationEvaluator.getMetricalWeight(candidate, stepsPerBar);

        // 决定方向次序：first 试 dirRandom 选定的方向，second 试另一向
        const firstDir = dirRandom < 0.5 ? -1 : 1;
        const secondDir = -firstDir;

        // 试图把 candidate 上的击点搬到 neighbor
        const tryDir = (dir: number): number => {
            const neighbor = candidate + dir;
            if (neighbor < 0 || neighbor >= L) return -1;
            if (grid[neighbor] !== 0) return -1;
            const wNeighbor = SyncopationEvaluator.getMetricalWeight(neighbor, stepsPerBar);
            const ok = forIncrease
                ? wNeighbor < wCandidate
                : wNeighbor > wCandidate;
            if (!ok) return -1;
            grid[candidate] = 0;
            grid[neighbor] = 1;
            return (candidate << 16) | neighbor;
        };

        let result = tryDir(firstDir);
        if (result < 0) result = tryDir(secondDir);
        return result;
    }

    // ============================================================
    // 输入校验
    // ============================================================
    private static validate(input: RhythmMutatorInput): void {
        if (!Number.isFinite(input.totalBeats) || input.totalBeats <= 0) {
            throw new RhythmMutatorError('totalBeats must be > 0', { totalBeats: input.totalBeats });
        }
        const stepsPerBeat = input.stepsPerBeat ?? DEFAULT_STEPS_PER_BEAT;
        if (stepsPerBeat !== DEFAULT_STEPS_PER_BEAT) {
            throw new RhythmMutatorError(
                'unsupported stepsPerBeat; currently only 4 is implemented',
                { stepsPerBeat },
            );
        }
        if (!Number.isFinite(input.sparsityTendency) ||
            input.sparsityTendency < 0 || input.sparsityTendency > 1) {
            throw new RhythmMutatorError(
                'sparsityTendency must be in [0, 1]',
                { sparsityTendency: input.sparsityTendency },
            );
        }
        if (!Number.isFinite(input.syncopationAssault) ||
            input.syncopationAssault < 0 || input.syncopationAssault > 1) {
            throw new RhythmMutatorError(
                'syncopationAssault must be in [0, 1]',
                { syncopationAssault: input.syncopationAssault },
            );
        }
        const maxIter = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        if (!Number.isFinite(maxIter) || maxIter < 0 || maxIter > 1000) {
            throw new RhythmMutatorError(
                'maxIterations must be in [0, 1000]',
                { maxIterations: maxIter },
            );
        }
    }
}

// ============================================================
// 辅助
// ============================================================

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

export class RhythmMutatorError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'RhythmMutatorError';
        this.context = context;
    }
}
