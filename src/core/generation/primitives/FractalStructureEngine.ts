/**
 * FractalStructureEngine — 纯时间结构 L-System 切割器
 *
 * 参考实现：Impro-Visor `imp.fractal.Fractal`（splitSolo / determineNewNotes）
 *
 * 职责（纯数学）：
 *   - 输入：总长度（拍）+ DividingProbabilities + RestProbabilities + TripletProbability
 *   - 输出：一维 FractalBlock[]（startBeat 升序），表示一棵被展平的时间区块树
 *   - **不**涉及 pitch / velocity / 乐器 — 那是消费者职责
 *
 * 风格无关：所有概率由 caller 通过 FractalConfig 传入，引擎不带任何 Pop/Jazz 硬编码。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 所有概率掷骰走 PRNGManager
 *   D-4 / C-1: duration 比较一律走 epsilon
 *   P-1: 仅扁平数组，无 Map/Set
 *   P-3 / P-4: 整型走 Math.floor，无隐式截断
 *   S-3 / S-4: 同步函数，输出纯数据
 *   T-3: 无 any
 *   K-7: 不返回 pitch — 无空间标注义务
 */

import { PRNGManager } from '../../utils/PRNG';

const EPSILON = 1e-6;

// 桶索引：0..4 对齐 whole/half/quarter/eighth/sixteenth；5 = default fallback
const BUCKET_WHOLE = 0;
const BUCKET_HALF = 1;
const BUCKET_QUARTER = 2;
const BUCKET_EIGHTH = 3;
const BUCKET_SIXTEENTH = 4;
const BUCKET_DEFAULT = 5;
const BUCKET_COUNT = 6;

// 标准桶对应的拍长（4/4 拍下）
const BUCKET_DURATIONS: number[] = [4.0, 2.0, 1.0, 0.5, 0.25];

const SUBDIVS_BINARY = 2;
const SUBDIVS_TERNARY = 3;

export interface FractalBlock {
    /** 起始拍位（相对曲首） */
    startBeat: number;
    /** 时长（拍） */
    duration: number;
    /** L-System 推导深度 — 0 = 初始整块 */
    depth: number;
    /** 该块是否被概率性地转成休止 */
    isRest: boolean;
}

export interface FractalConfig {
    /** 索引 0..5 对齐 whole/half/quarter/eighth/sixteenth/default — length MUST be 6 */
    dividingProbabilities: number[];
    /** 同上索引 — length MUST be 6 */
    restProbabilities: number[];
    /** 0~1 — 切分时落入三连音而非二分的概率 */
    tripletProbability: number;
    /** 递归终止下界 — 若 block.duration < 2 * minSubdivisionBeats 则保留不切 */
    minSubdivisionBeats: number;
}

export class FractalStructureEngineError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'FractalStructureEngineError';
        this.context = context;
    }
}

export class FractalStructureEngine {
    /**
     * 展开成 FractalBlock[]。
     *
     * 输出最大长度估算：max ≈ totalBeats / minSubdivisionBeats。
     * 4/4 拍 32 拍曲、minSubdivisionBeats=0.125 时 ≤ 256 块。（C-4）
     *
     * PRNG 消耗：每个未达终止条件的 block 每次 iteration 消耗 2~3 次（split 决策 + rest/triplet 二选一）。
     */
    public static expand(
        totalBeats: number,
        config: FractalConfig,
        numIterations: number,
    ): FractalBlock[] {
        FractalStructureEngine.validateConfig(config);
        if (totalBeats < EPSILON) return [];

        const iters = Math.max(0, Math.floor(numIterations));

        // 双 buffer 交替 — M-1：减少分配；C 端用两块预分配 FractalBlock 数组
        let current: FractalBlock[] = [{
            startBeat: 0,
            duration: totalBeats,
            depth: 0,
            isRest: false,
        }];
        let next: FractalBlock[] = [];

        for (let iter = 0; iter < iters; iter++) {
            next.length = 0;
            FractalStructureEngine.expandOnce(current, next, config);
            // swap buffers
            const tmp = current;
            current = next;
            next = tmp;
        }

        return current;
    }

    /**
     * 单次展开 — 遍历 input，把展开后的子 block 追加到 output。
     * Side effect：写入 output，PRNG 状态前进。
     */
    private static expandOnce(
        input: FractalBlock[],
        output: FractalBlock[],
        config: FractalConfig,
    ): void {
        const inputLen = input.length;
        const minLen = config.minSubdivisionBeats;

        for (let idx = 0; idx < inputLen; idx++) {
            const block = input[idx];

            // 已是 rest → 原样保留（rest 不再分裂）
            if (block.isRest) {
                output.push(block);
                continue;
            }

            // 切分会让子块短于 minSubdivisionBeats → 保留不切（D-4 / C-1 epsilon）
            if (block.duration < 2 * minLen - EPSILON) {
                output.push(block);
                continue;
            }

            const bucket = FractalStructureEngine.durationToBucket(block.duration);
            const divProb = config.dividingProbabilities[bucket];
            const splitDice = PRNGManager.next();

            // 概率不切：可能转 rest，可能保留原 note block（与 Impro-Visor noSplit 同语义）
            if (splitDice >= divProb) {
                const restProb = config.restProbabilities[bucket];
                const restDice = PRNGManager.next();
                if (restDice < restProb) {
                    output.push({
                        startBeat: block.startBeat,
                        duration: block.duration,
                        depth: block.depth,
                        isRest: true,
                    });
                } else {
                    output.push(block);
                }
                continue;
            }

            // 切：二分 vs 三分
            const tripletDice = PRNGManager.next();
            const subdivs = tripletDice < config.tripletProbability
                ? SUBDIVS_TERNARY
                : SUBDIVS_BINARY;

            const partDur = block.duration / subdivs;
            const newDepth = block.depth + 1;
            for (let s = 0; s < subdivs; s++) {
                output.push({
                    startBeat: block.startBeat + s * partDur,
                    duration: partDur,
                    depth: newDepth,
                    isRest: false,
                });
            }
        }
    }

    /**
     * duration → 桶索引。epsilon-相等命中标准桶；否则归入 DEFAULT。
     * 切分产生的三连音子块（如 4/3、1/3）不会命中标准桶 → 走 DEFAULT 概率。
     */
    private static durationToBucket(duration: number): number {
        if (Math.abs(duration - BUCKET_DURATIONS[BUCKET_WHOLE]) < EPSILON) return BUCKET_WHOLE;
        if (Math.abs(duration - BUCKET_DURATIONS[BUCKET_HALF]) < EPSILON) return BUCKET_HALF;
        if (Math.abs(duration - BUCKET_DURATIONS[BUCKET_QUARTER]) < EPSILON) return BUCKET_QUARTER;
        if (Math.abs(duration - BUCKET_DURATIONS[BUCKET_EIGHTH]) < EPSILON) return BUCKET_EIGHTH;
        if (Math.abs(duration - BUCKET_DURATIONS[BUCKET_SIXTEENTH]) < EPSILON) return BUCKET_SIXTEENTH;
        return BUCKET_DEFAULT;
    }

    /** S-7：非法输入抛带上下文的 Error 子类，外部调用方在管道入口统一 catch */
    private static validateConfig(config: FractalConfig): void {
        if (config.dividingProbabilities.length !== BUCKET_COUNT) {
            throw new FractalStructureEngineError(
                `dividingProbabilities length must be ${BUCKET_COUNT}`,
                { actual: config.dividingProbabilities.length },
            );
        }
        if (config.restProbabilities.length !== BUCKET_COUNT) {
            throw new FractalStructureEngineError(
                `restProbabilities length must be ${BUCKET_COUNT}`,
                { actual: config.restProbabilities.length },
            );
        }
        if (!(config.minSubdivisionBeats > 0)) {
            throw new FractalStructureEngineError(
                'minSubdivisionBeats must be > 0',
                { actual: config.minSubdivisionBeats },
            );
        }
        if (config.tripletProbability < 0 || config.tripletProbability > 1) {
            throw new FractalStructureEngineError(
                'tripletProbability must be in [0, 1]',
                { actual: config.tripletProbability },
            );
        }
    }
}
