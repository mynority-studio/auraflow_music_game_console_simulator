/**
 * TextureMapper — 织体映射器
 *
 * 把 RhythmMutator 生成的 1/0 节奏网格 + HarmonyCore 算出的 voicing 数组（声部分布），
 * 按 Persona.contourPreference 决定每次击点是 Block（齐砸）还是 Arpeggio（单音琶音），
 * 输出符合 NoteData[] 契约的一维数组。
 *
 * 这是 HarmonyCore 的下游消费者 — 与 HarmonyCore 共享同一个 voicing（声部决策），
 * 不重新生成和弦音高。本模块在算法上是"纯渲染器"：和声/律动都已经被前置模块决定，
 * 我们只负责把它们映射成可调度的 NoteData。
 *
 * Contour 解释：
 *
 *   Upward      — 上行琶音：依次取 voicing[0], voicing[1], ..., 循环。
 *   Downward    — 下行琶音：依次取 voicing[n-1], voicing[n-2], ..., 循环。
 *   Alternating — 交替：偶数 hit = Block 齐砸，奇数 hit = 中声部单音。
 *   Random      — 随机：每个 hit 由 PRNG 决定 Block (≥0.5) / 单音 (<0.5)，
 *                  单音随机选 voicing 一个 voice。
 *
 * Velocity 算法：
 *   weight = SyncopationEvaluator.getMetricalWeight(stepInBar)
 *   归一化 weight ∈ [0, maxWeight=4] → 线性映射到 [lo, hi] (0~127 整数)，再 / 127
 *   → 强拍击点力度接近 dynamicRange[1]，弱拍接近 dynamicRange[0]。
 *
 * Duration 算法（默认开启 truncation）：
 *   对每次击点 i，查找下一个击点 j > i。duration = (j - i) / stepsPerBeat。
 *   末击点 duration 延伸到 grid 尾部（不超出 chord 边界）。
 *   truncation 关闭时 duration 固定为 (1 / stepsPerBeat) 单 step。
 *
 * 设计约束（music_generation_pipeline_rule.md）：
 *   D-1: 所有随机来自 PRNGManager
 *   D-3: 最终 sort 提供 (onset ASC, pitch ASC) 完全确定的比较函数
 *   D-4: 浮点比较走 EPSILON
 *   P-1: 无 Map/Set；输出 NoteData[] 是连续 array
 *   S-3: 全同步纯函数
 *   S-4: 输出纯数据（NoteData 接口可直接 JSON.stringify）
 *
 * Pitch Space: RELATIVE（K-1 / K-2 / K-3 / K-7）
 *   - 输入 voicing[] 已是 HarmonyCore 输出的相对空间 MIDI（C=60 中心，不含 keyOffset）
 *   - 输出 NoteData.pitch 直接抄自 voicing[]
 *   - 绝对禁止 +keyOffset / -keyOffset / 任何调号补偿（K-4）
 *   - 由 AbsoluteTransposer.applyOffset() 在管道末端统一加 keyOffset 转绝对空间
 *
 * @author AuraFlow Tap! Phase 2.6
 */

import { PRNGManager } from '../../utils/PRNG';
import { ContourType, GeneratedChord, NoteData } from '../types';
import { SyncopationEvaluator } from './SyncopationEvaluator';

const EPSILON = 1e-6;
const MAX_METRICAL_WEIGHT = 4;  // 4/4 16-step 表中 step 0 的 whole-note 权重
const DEFAULT_STEPS_PER_BEAT = 4;
const MIDI_MAX = 127;
const RANDOM_BLOCK_THRESHOLD = 0.5;

// ============================================================
// 公开 API
// ============================================================

export interface TextureMapperInput {
    /** 单和弦元数据 — 提供 startBeat / endBeat 作为网格时间基准 */
    chord: GeneratedChord;

    /**
     * HarmonyCore 输出的相对空间 voicing（升序 MIDI，C=60 中心）。
     * 长度通常 3~4（SATB-like comping）。length === 0 时返回空 NoteData[]。
     */
    voicing: number[];

    /**
     * RhythmMutator 输出的 0/1 网格。
     * 长度必须 === (chord.endBeat - chord.startBeat) × stepsPerBeat（caller 保证）。
     */
    grid: Int8Array | number[];

    /** 每拍 step 数（默认 4，即 16 分网格） */
    stepsPerBeat?: number;

    /** 每小节拍数（默认 4），与 timeSignature[0] 对齐 */
    beatsPerBar?: number;

    /** Persona.contourPreference */
    contour: ContourType;

    /**
     * Persona.dynamicRange — 力度范围（0~127 整数）。
     * 内部归一化除以 127 写入 NoteData.velocity（0.0~1.0 浮点）。
     */
    velocityRange: [number, number];

    /**
     * 默认 true — 同声部下一击点前裁掉前一音的尾部，避免堆叠浑浊。
     * 关闭时所有 NoteData duration === 1 / stepsPerBeat（单 step 长）。
     */
    truncateOverlap?: boolean;
}

export class TextureMapper {

    /**
     * 单和弦渲染 → NoteData[]（升序：onset ASC, pitch ASC）。
     *
     * PRNG 消耗：
     *   - Upward / Downward / Alternating: 0
     *   - Random: 每个击点 ×1（Block/单音决策）+ Block 失败时再 ×1（选 voice）
     *
     * 输出最大长度（C-4 文档化）：
     *   - 最坏情况（grid 全 1 + Block contour + 4-voice）：totalSteps × 4
     *   - 典型 1 chord = 4 beat = 16 step，Block 时 ≤ 64 NoteData
     */
    public static render(input: TextureMapperInput): NoteData[] {
        const out: NoteData[] = [];

        // 早期返回 — 空 voicing / 空网格 / 非法时长
        if (input.voicing.length === 0) return out;
        const chordDur = input.chord.endBeat - input.chord.startBeat;
        if (chordDur <= EPSILON) return out;

        const stepsPerBeat = input.stepsPerBeat ?? DEFAULT_STEPS_PER_BEAT;
        const beatsPerBar = input.beatsPerBar ?? 4;
        const stepsPerBar = stepsPerBeat * beatsPerBar;
        const truncate = input.truncateOverlap !== false;  // default true
        const L = input.grid.length;
        const stepLen = 1 / stepsPerBeat;  // 1 step = 多少拍

        // 校验 grid 长度对齐 chord 时长
        const expectedLen = Math.floor(chordDur * stepsPerBeat + 0.5);
        if (L !== expectedLen) {
            throw new TextureMapperError(
                'grid length mismatches chord duration × stepsPerBeat',
                { gridLength: L, expected: expectedLen, chordDur, stepsPerBeat },
            );
        }

        const [veloLo, veloHi] = input.velocityRange;
        if (veloLo < 0 || veloHi > MIDI_MAX || veloLo > veloHi) {
            throw new TextureMapperError(
                'velocityRange must be [lo, hi] within [0, 127]',
                { veloLo, veloHi },
            );
        }

        // 预扫一次记录所有 hit 位置 — 后续 truncate 用 next-hit 查找
        // 同时也用于上下文："hit 第几次" 的 index（驱动 contour 循环）
        const hitPositions: number[] = [];
        for (let i = 0; i < L; i++) {
            if (input.grid[i] === 1) hitPositions.push(i);
        }
        if (hitPositions.length === 0) return out;

        const n = input.voicing.length;
        const midVoiceIdx = n >> 1;  // 中声部 — Alternating 单音用

        for (let h = 0; h < hitPositions.length; h++) {
            const step = hitPositions[h];
            const onset = input.chord.startBeat + step * stepLen;

            // duration 计算
            let duration: number;
            if (truncate) {
                const nextStep = (h + 1 < hitPositions.length)
                    ? hitPositions[h + 1]
                    : L;
                duration = (nextStep - step) * stepLen;
            } else {
                duration = stepLen;
            }
            // 兜底：不超出 chord 边界
            const maxDur = input.chord.endBeat - onset;
            if (duration > maxDur) duration = maxDur;
            if (duration <= EPSILON) continue;  // 退化击点（onset 已超 endBeat）

            // velocity = weight 线性映射
            const weight = SyncopationEvaluator.getMetricalWeight(step, stepsPerBar);
            const weightRatio = weight / MAX_METRICAL_WEIGHT;
            const veloInt = Math.floor(veloLo + (veloHi - veloLo) * weightRatio + 0.5);
            const velocity = veloInt / MIDI_MAX;

            // 🌟 计算绝对拍位，注入给 emitNotes
            const absStep = Math.floor(onset * stepsPerBeat + EPSILON);

            // 依 contour 派发
            TextureMapper.emitNotes(
                out, input.contour, h, n, midVoiceIdx, input.voicing,
                onset, duration, velocity, absStep, stepsPerBar // 🌟 新增最后两个参数
            );
        }

        // D-3：onset ASC，pitch ASC（ε 友好）
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });

        return out;
    }

    /**
     * 一个和弦进行的批量渲染 — 平行数组接口。
     * caller 已经为每个 chord 跑过 RhythmMutator → 各自 grid。
     * 本方法直接把每个 chord 的 NoteData[] 拼接 + 全局排序。
     *
     * grids[i].length 必须 === (chords[i].endBeat - chords[i].startBeat) × stepsPerBeat。
     */
    public static renderProgression(input: {
        chords: GeneratedChord[];
        voicings: number[][];
        grids: Array<Int8Array | number[]>;
        stepsPerBeat?: number;
        beatsPerBar?: number;
        contour: ContourType;
        velocityRange: [number, number];
        truncateOverlap?: boolean;
    }): NoteData[] {
        const { chords, voicings, grids } = input;
        if (chords.length !== voicings.length || chords.length !== grids.length) {
            throw new TextureMapperError(
                'chords / voicings / grids length must match',
                { chords: chords.length, voicings: voicings.length, grids: grids.length },
            );
        }

        const out: NoteData[] = [];
        for (let i = 0; i < chords.length; i++) {
            const segment = TextureMapper.render({
                chord: chords[i],
                voicing: voicings[i],
                grid: grids[i],
                stepsPerBeat: input.stepsPerBeat,
                beatsPerBar: input.beatsPerBar,
                contour: input.contour,
                velocityRange: input.velocityRange,
                truncateOverlap: input.truncateOverlap,
            });
            for (let k = 0; k < segment.length; k++) out.push(segment[k]);
        }

        // 全局排序
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });
        return out;
    }

    // ============================================================
    // 内部：单击点 → NoteData 发射
    // ============================================================

    /**
     * Pitch Space: RELATIVE — 直接抄 voicing[]，绝对禁止 +keyOffset。
     */
    private static emitNotes(
        out: NoteData[],
        contour: ContourType,
        hitIdx: number,
        n: number,
        midVoiceIdx: number,
        voicing: number[],
        onset: number,
        duration: number,
        velocity: number,
        absStep: number,        // 🌟 新增
        stepsPerBar: number     // 🌟 新增
    ): void {
        switch (contour) {
            case ContourType.Upward: {
                const pitch = voicing[hitIdx % n];
                out.push({ pitch, onset, duration, velocity });
                return;
            }
            case ContourType.Downward: {
                const pitch = voicing[n - 1 - (hitIdx % n)];
                out.push({ pitch, onset, duration, velocity });
                return;
            }
            case ContourType.Alternating: {
                if (n <= 1) {
                    out.push({ pitch: voicing[0], onset, duration, velocity });
                    return;
                }
                // 🌟 基于节拍权重的交替：强拍齐砸 Block，弱拍/反拍弹单音
                const weight = SyncopationEvaluator.getMetricalWeight(absStep, stepsPerBar);
                if (weight >= 2) {
                    for (let v = 0; v < n; v++) {
                        out.push({ pitch: voicing[v], onset, duration, velocity });
                    }
                } else {
                    out.push({ pitch: voicing[midVoiceIdx], onset, duration, velocity });
                }
                return;
            }
            case ContourType.Random: {
                // 🌟 D-5 确定性：空转两次随机数，保持序列对齐
                PRNGManager.next();
                PRNGManager.next();

                // 🌟 结构化律动点：强拍大概率砸和弦，弱拍大概率弹单音
                const weight = SyncopationEvaluator.getMetricalWeight(absStep, stepsPerBar);
                const blockProb = weight >= 2 ? 0.8 : 0.15;

                // 基于绝对拍位的伪随机，使循环更有记忆点，不吃真 PRNG
                const roll1 = ((absStep * 37) % 100) / 100;

                if (roll1 < blockProb) {
                    for (let v = 0; v < n; v++) {
                        out.push({ pitch: voicing[v], onset, duration, velocity });
                    }
                } else {
                    const roll2 = ((absStep * 59) % 100) / 100;
                    const voiceIdx = Math.floor(roll2 * n);
                    const clamped = voiceIdx >= n ? n - 1 : voiceIdx;
                    out.push({ pitch: voicing[clamped], onset, duration, velocity });
                }
                return;
            }
            default: {
                throw new TextureMapperError(
                    'unknown ContourType',
                    { contour },
                );
            }
        }
    }
}

// ============================================================
// Error
// ============================================================

export class TextureMapperError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'TextureMapperError';
        this.context = context;
    }
}
