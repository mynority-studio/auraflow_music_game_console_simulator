// ============================================================
// DrumIdiom — AF2 鼓组 idiom(Phase 2b.2)
// ============================================================
//
// 演进历史:
//   Phase 2a:阈值跳变(energy 1-3 仅 Kick / 4-5 加 Snare / 6+ 加 Hihat 8th),
//             完全独立运作,不感知其他乐手
//   Phase 2b.2(本版):port AF 16-step grid 架构 + per-mgStyle 4 套 grid +
//             energy 双轴缩放 + Dynamic Override(Crash/Fill/Ride)+
//             保留 chord/bass 感知作为 modifier
//
// 架构概览(借鉴 AF DrumIdiom + AF2 独有 modifier):
//
//   for each section:
//     for each step (16th note grid, 16 steps/bar):
//       1. Energy 双轴缩放(probScale × velScale)
//       2. 计算 chord/bass modifier(bass strong onset → kick boost,
//                                    chord syncopate → snare boost)
//       3. 3 次 gate PRNG(kick / snare / hihat,无条件消耗 D-5 锁帧)
//       4. 命中时 velocity PRNG 抽样([min, max] × velScale)
//       5. Dynamic Override:
//          - isCrashStep (energy>=7 + step 0)        → Crash + kick 加强
//          - isFillBar (next.energy > current + 最后 bar) → Tom 阶梯 fill
//          - energy>=8 + 偶数 step + hihat hit       → Ride 替代
//
// 物理约束(不变):
//   GM Drum Map (K-8 第三空间):Kick=36 / Snare=38 / ClosedHihat=42 /
//   Tom Hi=50 / Mid=47 / Lo=45 / Crash=49 / Ride=51
//   Channel 9 硬路由(由 MidiConverter 处理)
//
// PRNG(D-5 锁帧):
//   每 step 固定消耗 3 次 gate PRNG(即使概率为 0)+ 命中时 velocity PRNG。
//   rng 从 Af2EngineFacade 显式注入(派生 seed,与 mg / ChordTextureEngine 独立)。
// ============================================================

import type { NoteData, SectionMetadata, MusicianPersona } from '../../types';
import { BandRole, SectionType } from '../../types';
import type { Random } from '../utils/Random';
import type { MgStyle } from '../../../../state/EngineSelectionStore';
import { getDrumGridByMgStyle } from './drum-grid/grids';
import type { DrumGridConfig } from './drum-grid/types';
import { STEPS_PER_BEAT, STEPS_PER_BAR, ENERGY_LEVELS } from './drum-grid/types';
// C.5:MusicianPlanInput 协议(DrumPlanInput 扩展)
import type { Score } from '../Score';
import type { SectionAssignment } from '../Conductor';

/** GM Drum Map 物理键位 */
const DRUM_KICK = 36;
const DRUM_SNARE = 38;
const DRUM_CLOSED_HIHAT = 42;
const DRUM_OPEN_HIHAT = 46;        // V 阶段(2026-05-25)— POP/RNB 副歌标志
const DRUM_TOM_HI = 50;
const DRUM_TOM_MID = 47;
const DRUM_TOM_LO = 45;
const DRUM_CRASH = 49;
const DRUM_RIDE = 51;

/** 击点固定时长(32 分音符,attack-only,GM Drum 自带 envelope) */
const HIT_DURATION = 0.125;
const EPSILON = 1e-6;

/** chord/bass modifier 时间窗口(beat) */
const MODIFIER_TIME_WINDOW = 0.1;
/** bass strong velocity 阈值 */
const BASS_STRONG_VEL = 0.75;

/**
 * O 阶段:Crash-triggering section types。
 * Chorus / Drop / Bridge / BuildUp 起点几乎必然 Crash(不论 energy);
 * 其他 sectionType 仍走 isHighEnergy ≥ 7 阈值。
 */
const CRASH_SECTION_TYPES: ReadonlySet<SectionType> = new Set([
    SectionType.Chorus,
    SectionType.Drop,
    SectionType.Bridge,
    SectionType.BuildUp,
]);

/**
 * Y 阶段(2026-05-25):per-mgStyle drum swing ratio
 * 影响 16-step grid 内 sub-step 的 onset 位置(8th off-beat 推后)。
 *
 *   POP   0.50 — 直拍
 *   JAZZ  0.66 — triplet swing(8th 第二个推到 0.66 拍)
 *   BLUES 0.66 — shuffle(12/8 类似 jazz swing)
 *   RNB   0.50 — 直 16th(neo-soul 神经质来自 syncopate 不是 swing)
 *
 * 公式:per beat 4 sub-steps onset 位置:
 *   subStep 0: 0
 *   subStep 1: swing/2     (16th e,strong 跟 off-beat 之间 1/2)
 *   subStep 2: swing       (8th and,off-beat 主位)
 *   subStep 3: swing + (1-swing)/2 (16th a,off-beat 跟 next strong 1/2)
 *
 * 直拍(swing=0.5)= [0, 0.25, 0.5, 0.75] — 跟原行为一致
 * Jazz(swing=0.66)= [0, 0.33, 0.66, 0.83] — 8th 摆动 triplet feel
 */
const SWING_RATIO_BY_STYLE: Record<MgStyle, number> = {
    POP:   0.50,
    JAZZ:  0.66,
    BLUES: 0.66,
    RNB:   0.50,
};

function stepOnsetWithinBeat(subStep: number, swingRatio: number): number {
    if (subStep === 0) return 0;
    if (subStep === 1) return swingRatio / 2;
    if (subStep === 2) return swingRatio;
    return swingRatio + (1 - swingRatio) / 2;  // subStep === 3
}

export const DRUM_INSTRUMENT_SPEC = {
    eligibleSlots: [BandRole.Drums] as const,
} as const;

/**
 * C.5:DrumPlanInput 扩展 MusicianPlanInput 加 drum-specific extras。
 *
 * sections + beatsPerMeasure 现从 score 派生(timeSignature[0]),DrumGenerator
 * 不再独立持有。
 */
export interface DrumPlanInput {
    /** 总谱(provides sections + timeSignature) */
    score: Score;
    /** 本 musician id(per-section role gate 用)*/
    musicianId: string;
    /** Conductor 输出 */
    assignments: ReadonlyArray<SectionAssignment>;
    /** mgStyle decide grid */
    mgStyle: MgStyle;
    /** PRNG 显式注入(与 mg 独立 stream 推荐派生 seed) */
    rng: Random;
    /** 跨乐手感知 — bass strong onset 提 kick prob */
    bassNotes?: ReadonlyArray<NoteData>;
    /** 跨乐手感知 — chord syncopate onset 提 snare prob */
    chordNotes?: ReadonlyArray<NoteData>;
    /**
     * Musician persona(可选)。当前消费:
     *   sparsityTendency 高 → kick/snare/hihat prob 整体 × (1 - sparsity * 0.4)
     *   syncopationAssault 高 → syncopated step 上 snare prob 加成
     */
    persona?: MusicianPersona;
}

/**
 * energyLevel clamp 到 [1, ENERGY_LEVELS]
 */
function clampEnergy(e: number | undefined): number {
    if (e === undefined || !Number.isFinite(e)) return 5;
    const i = e | 0;
    if (i < 1) return 1;
    if (i > ENERGY_LEVELS) return ENERGY_LEVELS;
    return i;
}

/**
 * Velocity 抽样:[min, max] random + scale,clamp MIDI 1-127,返回 0-1 float。
 * 消耗 1 次 PRNG。
 */
function sampleVelocity(rng: Random, range: [number, number], scale: number): number {
    const lo = range[0] | 0;
    const hi = range[1] | 0;
    const raw = rng.next() * (hi - lo) + lo;
    const scaled = raw * scale;
    let intVel = Math.floor(scaled + 0.5) | 0;
    if (intVel < 1) intVel = 1;
    if (intVel > 127) intVel = 127;
    return intVel / 127;
}

/**
 * 检测 onset 是否在 syncopated 位置(0.34 / 0.66 内)。
 */
function isSyncopatedOffset(beatOffsetInBar: number): boolean {
    const fraction = beatOffsetInBar - Math.floor(beatOffsetInBar);
    return Math.abs(fraction - 0.34) < 0.08 || Math.abs(fraction - 0.66) < 0.08;
}

/**
 * 该 step 时间窗口内是否有 bass strong onset。
 */
function hasBassStrongNear(stepBeat: number, bassNotes: NoteData[]): boolean {
    for (const n of bassNotes) {
        if (Math.abs(n.onset - stepBeat) <= MODIFIER_TIME_WINDOW && n.velocity >= BASS_STRONG_VEL) {
            return true;
        }
    }
    return false;
}

/**
 * 该 step 时间窗口内是否有 chord syncopate onset。
 */
function hasChordSyncopateNear(
    stepBeat: number,
    barStart: number,
    chordNotes: NoteData[],
): boolean {
    for (const n of chordNotes) {
        if (Math.abs(n.onset - stepBeat) <= MODIFIER_TIME_WINDOW) {
            const relTime = n.onset - barStart;
            if (isSyncopatedOffset(relTime)) return true;
        }
    }
    return false;
}

export const DrumGenerator = {
    /**
     * C.5:plan(DrumPlanInput) — Conductor + Score 协议下的 drums 生成。
     *
     * 流程:
     *   1. 遍历 score.sections
     *   2. **per-section gate**:assignments[sIdx].byMusician.get(musicianId) 不含 'drums'
     *      → 跳过(Conductor 让我这段 silent)
     *   3. 通过的 section 走原 renderSection 逻辑(grid + energy + modifiers)
     *
     * peers via bassNotes / chordNotes(跨乐手 onset 触发 kick/snare prob 修正)。
     */
    plan(input: DrumPlanInput): NoteData[] {
        const { score, musicianId, assignments, mgStyle, bassNotes = [], chordNotes = [], rng, persona } = input;
        const sections = score.sections;
        const beatsPerMeasure = score.timeSignature[0];
        const grid = getDrumGridByMgStyle(mgStyle);
        const out: NoteData[] = [];
        const sparsity = persona?.sparsityTendency ?? 0;
        const syncopation = persona?.syncopationAssault ?? 0;

        for (let sIdx = 0; sIdx < sections.length; sIdx++) {
            // C.5:per-section role gate
            const myRoles = assignments[sIdx]?.byMusician.get(musicianId) ?? [];
            if (!myRoles.includes('drums')) continue;  // Conductor 让我这段 silent

            const section = sections[sIdx];
            const dur = section.endBeat - section.startBeat;
            if (dur < EPSILON) continue;
            const nextSection = sIdx + 1 < sections.length ? sections[sIdx + 1] : undefined;
            renderSection(
                out, section, nextSection, grid, beatsPerMeasure,
                bassNotes as NoteData[], chordNotes as NoteData[], rng,
                sparsity, syncopation, mgStyle,
            );
        }

        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });
        return out;
    },
};

function renderSection(
    out: NoteData[],
    section: SectionMetadata,
    nextSection: SectionMetadata | undefined,
    grid: DrumGridConfig,
    beatsPerMeasure: number,
    bassNotes: NoteData[],
    chordNotes: NoteData[],
    rng: Random,
    sparsity: number = 0,
    syncopation: number = 0,
    mgStyle: MgStyle = 'POP',
): void {
    const startBeat = section.startBeat;
    const sectionBeats = section.endBeat - startBeat;
    const totalSteps = Math.floor(sectionBeats * STEPS_PER_BEAT + EPSILON);
    if (totalSteps < 1) return;

    // Energy 双轴缩放
    const energyIdx = clampEnergy(section.energyLevel) - 1;
    const probScale = grid.energyProbScale[energyIdx];
    const velScale = grid.energyVelScale[energyIdx];
    const snareGateOpen = (section.energyLevel | 0) >= grid.snareEnergyGate;

    // Dynamic Override 标志
    // O 阶段扩展:section-type-aware crash + 任何能量升 / Chorus 类切换都触发 fill。
    //   原 isBuildUp 只看能量升(BuildUp 段名),现 isSectionTransition 看更宽:
    //   任何 next 存在且(能量升 OR next 是 crash-section-type)都做 fill。
    const isHighEnergy = section.energyLevel >= 7;
    const isCrashSection = CRASH_SECTION_TYPES.has(section.sectionType);
    const isVeryHigh = section.energyLevel >= 8;
    const nextIsCrashSection = nextSection !== undefined && CRASH_SECTION_TYPES.has(nextSection.sectionType);
    const energyJump = nextSection !== undefined ? (nextSection.energyLevel - section.energyLevel) : 0;
    const isSectionTransition = nextSection !== undefined && (energyJump >= 1 || nextIsCrashSection);

    // O 阶段:fill 形态选择(per-section hash,deterministic 0 PRNG)
    //   'tom'        = 原 Tom 阶梯(snare → tom-hi/mid/lo)
    //   'snare_roll' = 纯 Snare 16th roll(velocity 渐升,无 tom)
    type FillStyle = 'tom' | 'snare_roll';
    const fillStyle: FillStyle = (Math.floor(section.startBeat) & 1) === 0 ? 'tom' : 'snare_roll';

    const gridLen = grid.grid.length;
    const stepsPerBar = STEPS_PER_BAR;  // 16

    // Y 阶段:swing-aware step onset(JAZZ/BLUES 8th 摆动 triplet feel)
    const swingRatio = SWING_RATIO_BY_STYLE[mgStyle] ?? 0.5;

    for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
        const cellIdx = stepIdx % gridLen;
        const cell = grid.grid[cellIdx];
        // Y 阶段:swing-aware stepBeat(POP/RNB swing=0.5 跟原行为一致,
        // JAZZ/BLUES swing=0.66 让 8th 第二个推后到 0.66 拍)
        const beatBase = Math.floor(stepIdx / STEPS_PER_BEAT);
        const subStep = stepIdx % STEPS_PER_BEAT;
        const stepBeat = startBeat + beatBase + stepOnsetWithinBeat(subStep, swingRatio);
        const barStart = startBeat + Math.floor(stepIdx / stepsPerBar) * beatsPerMeasure;

        // ----------------------------------------------------------
        // chord/bass modifier(Phase 2b.2 新增,不消耗 PRNG)
        //   + persona DNA(sparsity 减密 / syncopation syncopated-step boost)
        // ----------------------------------------------------------
        // Persona sparsity → 整体 prob 降低(留白)
        const sparsityFactor = 1 - sparsity * 0.4;
        let kickProbAdj = cell.kickProb * probScale * sparsityFactor;
        let snareProbAdj = (snareGateOpen ? cell.snareProb : 0) * probScale * sparsityFactor;
        const hihatProbAdj = cell.hihatProb * probScale * sparsityFactor;

        // bass strong onset → 提 kick prob
        if (hasBassStrongNear(stepBeat, bassNotes)) {
            kickProbAdj = Math.min(0.95, Math.max(kickProbAdj, 0.75));
        }
        // chord syncopate → 提 snare prob(ghost-like accent)
        if (snareGateOpen && hasChordSyncopateNear(stepBeat, barStart, chordNotes)) {
            snareProbAdj = Math.min(0.85, snareProbAdj * 1.3);
        }
        // Persona syncopation → syncopated step 上 snare prob 加成
        if (syncopation > 0 && snareGateOpen) {
            const relStep = stepIdx % STEPS_PER_BEAT;
            // 16-step 中 syncopated 位 = 第 2 / 第 4 sub-step(off-beat 16th)
            if (relStep === 1 || relStep === 3) {
                snareProbAdj = Math.min(0.90, snareProbAdj + syncopation * 0.3);
            }
        }

        // ----------------------------------------------------------
        // Gate evaluation — D-5 锁帧:每 step 固定 3 次 PRNG,无条件消耗
        // ----------------------------------------------------------
        const kickDice = rng.next();
        const kickHitOrig = kickDice < kickProbAdj;
        const kickVelOrig = kickHitOrig ? sampleVelocity(rng, grid.kickVelocity, velScale) : 0;

        const snareDice = rng.next();
        const snareHitOrig = snareDice < snareProbAdj;
        const snareVelOrig = snareHitOrig ? sampleVelocity(rng, grid.snareVelocity, velScale) : 0;

        const hihatDice = rng.next();
        const hihatHitOrig = hihatDice < hihatProbAdj;
        const hihatVelOrig = hihatHitOrig ? sampleVelocity(rng, grid.hihatVelocity, velScale) : 0;

        // 默认继承原始判定
        let outKPitch = DRUM_KICK, outKHit = kickHitOrig, outKVel = kickVelOrig;
        let outSPitch = DRUM_SNARE, outSHit = snareHitOrig, outSVel = snareVelOrig;
        let outHPitch = DRUM_CLOSED_HIHAT, outHHit = hihatHitOrig, outHVel = hihatVelOrig;

        // ----------------------------------------------------------
        // Dynamic Override(强制规则,0 PRNG 消耗)
        // O 阶段:Crash / Fill 触发条件放宽 + Fill 形态变体
        // V 阶段(2026-05-25):Break(BuildUp→Drop transition 末 1/4 bar 静音)+
        //                     Open Hihat(高能段 and-of-4)
        // ----------------------------------------------------------
        // Crash 触发:段首 + (Chorus/Drop/Bridge/BuildUp section type OR high energy)
        const isCrashStep = stepIdx === 0 && (isCrashSection || isHighEnergy);
        // V2 Break 触发:next section 是 Drop + 当前 section 末 1/4 bar(让 Drop
        //   起点产生戏剧性静默冲击,优先级高于 Fill)
        const nextIsDrop = nextSection !== undefined && nextSection.sectionType === SectionType.Drop;
        const isBreakStep = nextIsDrop && (totalSteps - stepIdx <= Math.floor(stepsPerBar / 4));
        // Fill 触发:next section 存在 + (能量升 OR next 是 crash section type)
        //   触发后 last bar 走 fill 形态(per fillStyle)
        //   注:Break 优先级更高,Break 区间内 Fill 自动让位
        const isFillBar = isSectionTransition && !isBreakStep && (totalSteps - stepIdx <= stepsPerBar);

        if (isBreakStep) {
            // V2 Break:全静音(BuildUp→Drop 末 1/4 bar,dramatic silence)
            //   让 Drop 起点的 Crash 冲击最大化(silence 后击鼓 = "炸开"听感)
            outKHit = false;
            outSHit = false;
            outHHit = false;
        } else if (isCrashStep) {
            // Crash + 加强 kick(section 标志起点)
            outHHit = true;
            outHPitch = DRUM_CRASH;
            outHVel = Math.min(1.0, velScale * 1.2);
            outKHit = true;
            outKVel = Math.min(1.0, velScale * 1.1);
        } else if (isFillBar) {
            // section transition 最后一 bar:fill(2 种形态 per-section hash)
            outHHit = false;  // mute hihat
            outSHit = true;   // 强制 snare(or tom)击
            const fillProgression = 1 - (totalSteps - stepIdx) / stepsPerBar;
            outSVel = 0.5 + 0.5 * fillProgression;

            if (fillStyle === 'tom') {
                // Tom 阶梯(原有)— sub-beat 3 → tom_hi,sub-beat 2 fill_prog>0.5 → tom_mid,
                //                    sub-beat 1 fill_prog>0.8 → tom_lo
                const subBeat = stepIdx % STEPS_PER_BEAT;
                if (subBeat === 3) outSPitch = DRUM_TOM_HI;
                else if (subBeat === 2 && fillProgression > 0.5) outSPitch = DRUM_TOM_MID;
                else if (subBeat === 1 && fillProgression > 0.8) outSPitch = DRUM_TOM_LO;
            }
            // 'snare_roll':保 DRUM_SNARE 不动,纯 snare 16th velocity 渐升
        } else if (isVeryHigh && outHHit && stepIdx % 2 === 0) {
            // 高能段 + 偶数 step + hihat 命中 → Ride 替代
            outHPitch = DRUM_RIDE;
        }

        // V1 Open Hihat:高能段 + and-of-4(step 14 of bar)+ hihat 命中
        //   → 替换 closed → open hihat + velocity ×1.1
        //   听感:POP/RNB 副歌每 bar 末 "ts-ts-ts-tssss" 开镲点,过渡到 next bar
        //   注:在所有其他 override 后跑(独立 layer,不冲突 Crash/Fill/Ride)
        if (isHighEnergy && outHHit && (stepIdx % stepsPerBar) === 14) {
            outHPitch = DRUM_OPEN_HIHAT;
            outHVel = Math.min(1.0, outHVel * 1.1);
        }

        // 发射音符
        if (outKHit) out.push({ pitch: outKPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outKVel });
        if (outSHit) out.push({ pitch: outSPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outSVel });
        if (outHHit) out.push({ pitch: outHPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outHVel });
    }
}

export const DrumIdiom = {
    /** Drums 透传 — DrumGenerator 已直接产 NoteData,无需 clone(notes 来自本地 out 数组) */
    realize(notes: NoteData[]): NoteData[] {
        return notes;
    },
};
