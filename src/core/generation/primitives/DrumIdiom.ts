/**
 * DrumIdiom — 16-step grid 鼓机渲染器（Phase 5 落地）
 *
 * 职责（纯渲染）：
 *   - 输入：DrumGridConfig（16-step 概率表 + Energy 缩放曲线）+ sections 数组 + 总拍数
 *   - 输出：NoteData[]，pitch ∈ {36, 38, 42} 三个 GM Drum Map 物理键位
 *   - 与 RhythmMutator / TextureMapper 同宗 — 纯算法 + 数据驱动，零硬编码风味
 *
 * Pitch Space: GM Drum Map (ABSOLUTE 物理键位)
 *   依 pipeline rule K-8 — Drum 是第三空间（INSTRUMENT_COMMAND），**不**经过
 *   AbsoluteTransposer.applyOffset，**不**叠加 keyOffset。Kick=36 / Snare=38 / ClosedHihat=42
 *   从 DrumIdiom → GeneratedTrack.drums → ArrangedTrack.drums → Channel 9 全程透传。
 *
 * 确定性铁律（D-5）：
 *
 *   1. **遍历顺序**：段落 ASC（sIdx 升序）→ 全曲 step ASC（不在段落边界 reset）
 *      → 三鼓位 ASC（Kick → Snare → Hihat，与 MIDI 值升序一致）。
 *
 *   2. **PRNG 消耗模式**（每 step 无条件 ×3 + 条件 ×0~3）：
 *        - PRNG.next() × 1   Kick  gate（无条件消耗）
 *        - PRNG.next() × 1   Snare gate（无条件消耗）
 *        - PRNG.next() × 1   Hihat gate（无条件消耗）
 *        - 若 Kick  gate 命中 → PRNG.next() × 1 抽 Kick  velocity（条件消耗）
 *        - 若 Snare gate 命中 → PRNG.next() × 1 抽 Snare velocity
 *        - 若 Hihat gate 命中 → PRNG.next() × 1 抽 Hihat velocity
 *      → 全曲 PRNG 消耗 = 3 × totalSteps + Σ hits，**与 energy 大小无关**
 *      （gate PRNG 始终消耗，只是结果被 scale 缩小）。
 *
 *   3. **Energy 映射**（无 PRNG，纯查表）：
 *        - probScale  = grid.energyProbScale[energy - 1]  → 缩小 gate 命中概率
 *        - velScale   = grid.energyVelScale[energy - 1]   → 缩小 velocity 抽样结果
 *        - Snare 额外硬阈值：energy < grid.snareEnergyGate → snareProb × 0（彻底 mute）
 *
 *   4. 段落 PRNG 不重置 — 整个 sections 走全曲连续 step 序列，与 D-3 一致。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 所有掷骰走 PRNGManager
 *   D-3: 输出 onset ASC（按 step 顺序天然有序），三鼓位用稳定排序回顾
 *   D-4 / C-1: epsilon 容差比较 duration
 *   P-1: flat 数组，无 Map/Set
 *   P-3 / P-4: 整型走 | 0
 *   S-3 / S-4: 同步函数，输出纯数据
 *   T-3: 无 any
 *   K-8: GM Drum Map 第三空间，全程禁加 keyOffset
 *
 * @author AuraFlow Tap! Phase 5
 */

import { PRNGManager } from '../../utils/PRNG';
import { NoteData, SectionMetadata } from '../types';
import type { RenderContext } from '../ir/RenderContext';

// ============================================================
// GM Drum Map 物理键位（不可移调，K-8 第三空间）
// ============================================================

/** Pitch Space: GM Drum Map (ABSOLUTE 物理键位) */
export const DRUM_KICK = 36;
/** Pitch Space: GM Drum Map (ABSOLUTE 物理键位) */
export const DRUM_SNARE = 38;
/** Pitch Space: GM Drum Map (ABSOLUTE 物理键位) */
export const DRUM_HIHAT_CLOSED = 42;
/** Pitch Space: GM Drum Map (ABSOLUTE 物理键位) — Tom (high / mid / low) */
export const DRUM_TOM_HI = 50;
export const DRUM_TOM_MID = 47;
export const DRUM_TOM_LO = 45;
/** Pitch Space: GM Drum Map (ABSOLUTE 物理键位) — Crash / Ride 镲片 */
export const DRUM_CRASH = 49;
export const DRUM_RIDE = 51;

// ============================================================
// Grid 常量
// ============================================================

const STEPS_PER_BEAT = 4;          // 16 分网格
const STEPS_PER_BAR = 16;          // 4/4 下一小节 16 step
const HIT_DURATION = 0.125;        // 32 分音符长度 — attack-only，由 SF2 自然衰减
const ENERGY_LEVELS = 10;          // 1~10 → 数组 length 10
const EPSILON = 1e-6;

// ============================================================
// 配置契约
// ============================================================

/**
 * 单 step 的三鼓概率（length 必须为 STEPS_PER_BAR=16 的 grid 内一项）。
 * 各概率 ∈ [0, 1]，经 Energy 缩放后再与 PRNG.next() 比较。
 */
export interface DrumStepConfig {
    /** Kick 触发概率 0~1 */
    kickProb: number;
    /** Snare 触发概率 0~1 */
    snareProb: number;
    /** Closed Hihat 触发概率 0~1 */
    hihatProb: number;
}

/**
 * 鼓机 Grid 配置（per Style）。
 *
 * 设计要点：
 *   - grid.length === 16（一小节 16 step），多小节按 step % 16 循环。
 *   - energyProbScale / energyVelScale 长度 === 10，下标 = energyLevel - 1。
 *   - snareEnergyGate 是硬阈值：energy < gate 时 Snare gate PRNG 仍消耗，但概率被压到 0。
 */
export interface DrumGridConfig {
    grid: DrumStepConfig[];                    // length === 16
    energyProbScale: number[];                 // length === 10
    energyVelScale: number[];                  // length === 10
    snareEnergyGate: number;                   // 通常 4（energy 1~3 不出 Snare）
    kickVelocity: [number, number];            // [min, max], MIDI 0~127
    snareVelocity: [number, number];
    hihatVelocity: [number, number];
}

// ============================================================
// 错误类型
// ============================================================

export class DrumIdiomError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'DrumIdiomError';
        this.context = context;
    }
}

// ============================================================
// 公开 API
// ============================================================

export interface DrumIdiomInput {
    sections: SectionMetadata[];
    grid: DrumGridConfig;
    /**
     * Phase 0 — RenderContext 接入点(weather sampler / lookahead / state)。
     * 当前实装不消费 context(bit-exact 保证;鼓 PRNG 配额对 D-5 锁帧关键,
     * 任何 weather 调制必须严守每 step ×3 gate PRNG 预算)。
     * Phase 3+ 可调制 ghost note 概率 / open hihat 切换等。
     */
    context: RenderContext;
}

export class DrumIdiom {
    /**
     * 渲染整条 drums 轨。
     *
     * 输出最大长度估算（C-4）：
     *   ≤ 3 × totalSteps（每 step 最多 Kick + Snare + Hihat 三击）
     *   典型 64 拍曲：3 × 64 × 4 = 768 个 NoteData 上界。
     *
     * Pitch Space: GM Drum Map (ABSOLUTE 物理键位) — K-8 第三空间。
     */
    public static render(input: DrumIdiomInput): NoteData[] {
        DrumIdiom.validate(input);

        const out: NoteData[] = [];
        const { sections, grid } = input;

        // Phase 6a:K 阈值静默逻辑已迁出 — 由 WakeStateMachine.attachWakeStates
        // 在 Conductor 层按 musician.wakeK(individualized + per-song mutation)决定
        // 哪些 section 进入本 Idiom。本 Idiom 收到的 sections 已经被 sleeping=true
        // 的段落 pre-filter 过(Conductor.ts 处理),DrumIdiom 不再判 K。

        for (let sIdx = 0; sIdx < sections.length; sIdx++) {
            const section = sections[sIdx];
            const dur = section.endBeat - section.startBeat;
            if (dur < EPSILON) continue;

            const nextSection = sIdx + 1 < sections.length ? sections[sIdx + 1] : undefined;
            renderSection(out, section, grid, nextSection);
        }

        // D-3：onset ASC，同 onset 时按 pitch ASC（Kick < Snare < Hihat 已自然有序，
        // 但段落边界 + 浮点累加后保险排一次）
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });

        return out;
    }

    private static validate(input: DrumIdiomInput): void {
        if (!Array.isArray(input.sections)) {
            throw new DrumIdiomError('sections must be an array', {
                actual: typeof input.sections,
            });
        }
        const g = input.grid;
        if (!g || !Array.isArray(g.grid) || g.grid.length !== STEPS_PER_BAR) {
            throw new DrumIdiomError(
                `grid.grid length must be ${STEPS_PER_BAR}`,
                { actual: g?.grid?.length },
            );
        }
        if (!Array.isArray(g.energyProbScale) || g.energyProbScale.length !== ENERGY_LEVELS) {
            throw new DrumIdiomError(
                `grid.energyProbScale length must be ${ENERGY_LEVELS}`,
                { actual: g.energyProbScale?.length },
            );
        }
        if (!Array.isArray(g.energyVelScale) || g.energyVelScale.length !== ENERGY_LEVELS) {
            throw new DrumIdiomError(
                `grid.energyVelScale length must be ${ENERGY_LEVELS}`,
                { actual: g.energyVelScale?.length },
            );
        }
    }
}

// ============================================================
// 内部：单段落渲染
// ============================================================

/**
 * Pitch Space: GM Drum Map (ABSOLUTE 物理键位)
 *
 * 段落内严格按 step ASC 遍历，每 step 消耗：
 *   3 次 gate PRNG（无条件）+ ≤3 次 velocity PRNG（条件，仅命中时消耗）。
 *
 * onset 计算：onset = section.startBeat + (step - startStep) / STEPS_PER_BEAT
 *   step 是段落内的局部 index，但 step % STEPS_PER_BAR 用于查 grid（每小节循环）。
 */
function renderSection(
    out: NoteData[],
    section: SectionMetadata,
    grid: DrumGridConfig,
    nextSection?: SectionMetadata,
): void {
    const startBeat = section.startBeat;
    const endBeat = section.endBeat;
    const sectionBeats = endBeat - startBeat;

    // 全长 step 数 = 段落拍数 × STEPS_PER_BEAT，向下取整避免越界
    const totalSteps = Math.floor(sectionBeats * STEPS_PER_BEAT + EPSILON);
    if (totalSteps < 1) return;

    // Energy 缩放因子（一段内固定，无 PRNG）
    const energyIdx = clampEnergy(section.energyLevel) - 1;
    const probScale = grid.energyProbScale[energyIdx];
    const velScale = grid.energyVelScale[energyIdx];
    const snareGateOpen = (section.energyLevel | 0) >= grid.snareEnergyGate;

    const gridLen = grid.grid.length;
    for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
        const cellIdx = stepIdx % gridLen;
        const cell = grid.grid[cellIdx];

        const stepBeat = startBeat + stepIdx / STEPS_PER_BEAT;

        // 1. Ghost Evaluation (绝对不改变 PRNG 消耗次数)
        const kickDice = PRNGManager.next();
        const kickHitOrig = kickDice < (cell.kickProb * probScale);
        const kickVelOrig = kickHitOrig ? sampleVelocity(grid.kickVelocity, velScale) : 0;

        const snareDice = PRNGManager.next();
        const snareHitOrig = snareDice < (snareGateOpen ? cell.snareProb * probScale : 0);
        const snareVelOrig = snareHitOrig ? sampleVelocity(grid.snareVelocity, velScale) : 0;

        const hihatDice = PRNGManager.next();
        const hihatHitOrig = hihatDice < (cell.hihatProb * probScale);
        const hihatVelOrig = hihatHitOrig ? sampleVelocity(grid.hihatVelocity, velScale) : 0;

        // 2. 默认继承原始判定
        let outKPitch = DRUM_KICK, outKHit = kickHitOrig, outKVel = kickVelOrig;
        let outSPitch = DRUM_SNARE, outSHit = snareHitOrig, outSVel = snareVelOrig;
        let outHPitch = DRUM_HIHAT_CLOSED, outHHit = hihatHitOrig, outHVel = hihatVelOrig;

        // 3. Dynamic Overrides (算法强制覆写，0 PRNG 消耗)
        const isHighEnergy = section.energyLevel >= 7;
        const isBuildUp = nextSection !== undefined && nextSection.energyLevel > section.energyLevel;
        const isCrashStep = stepIdx === 0 && isHighEnergy;
        const isFillBar = isBuildUp && (totalSteps - stepIdx <= gridLen);

        if (isCrashStep) {
            outHHit = true; outHPitch = DRUM_CRASH; outHVel = Math.min(1.0, velScale * 1.2);
            outKHit = true; outKVel = Math.min(1.0, velScale * 1.1);
        } else if (isFillBar) {
            outHHit = false; // Mute hihat during fill
            outSHit = true;  // Force roll
            const fillProgression = 1 - (totalSteps - stepIdx) / gridLen;
            outSVel = 0.5 + 0.5 * fillProgression;

            const subBeat = stepIdx % STEPS_PER_BEAT;
            if (subBeat === 3) outSPitch = DRUM_TOM_HI;
            else if (subBeat === 2 && fillProgression > 0.5) outSPitch = DRUM_TOM_MID;
            else if (subBeat === 1 && fillProgression > 0.8) outSPitch = DRUM_TOM_LO;
        } else if (section.energyLevel >= 8 && outHHit && stepIdx % 2 === 0) {
            outHPitch = DRUM_RIDE;
        }

        // 4. 发射音符
        if (outKHit) out.push({ pitch: outKPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outKVel });
        if (outSHit) out.push({ pitch: outSPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outSVel });
        if (outHHit) out.push({ pitch: outHPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outHVel });
    }
}

/**
 * Velocity 抽样：在 [min, max] 内均匀抽 → MIDI int → 应用 energy 缩放 → 转 [0, 1] float。
 * 消耗 PRNG ×1（仅在 gate 命中时调用）。
 */
function sampleVelocity(range: [number, number], scale: number): number {
    const lo = range[0] | 0;
    const hi = range[1] | 0;
    const raw = PRNGManager.next() * (hi - lo) + lo;
    const scaled = raw * scale;
    // clamp to MIDI 1..127（0 视为 noteOff，不允许出现在 noteOn）
    let intVel = Math.floor(scaled + 0.5) | 0;
    if (intVel < 1) intVel = 1;
    if (intVel > 127) intVel = 127;
    return intVel / 127;
}

/** energyLevel clamp 到 [1, 10] 避免越界 */
function clampEnergy(e: number | undefined): number {
    if (e === undefined || !Number.isFinite(e)) return 5;
    const i = e | 0;
    if (i < 1) return 1;
    if (i > ENERGY_LEVELS) return ENERGY_LEVELS;
    return i;
}
