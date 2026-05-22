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

import type { NoteData, SectionMetadata } from '../../types';
import { BandRole } from '../../types';
import type { Random } from '../../mg-engine/musicEngine';
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
        const { score, musicianId, assignments, mgStyle, bassNotes = [], chordNotes = [], rng } = input;
        const sections = score.sections;
        const beatsPerMeasure = score.timeSignature[0];
        const grid = getDrumGridByMgStyle(mgStyle);
        const out: NoteData[] = [];

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
    const isHighEnergy = section.energyLevel >= 7;
    const isBuildUp = nextSection !== undefined && nextSection.energyLevel > section.energyLevel;
    const isVeryHigh = section.energyLevel >= 8;

    const gridLen = grid.grid.length;
    const stepsPerBar = STEPS_PER_BAR;  // 16

    for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
        const cellIdx = stepIdx % gridLen;
        const cell = grid.grid[cellIdx];
        const stepBeat = startBeat + stepIdx / STEPS_PER_BEAT;
        const barStart = startBeat + Math.floor(stepIdx / stepsPerBar) * beatsPerMeasure;

        // ----------------------------------------------------------
        // chord/bass modifier(Phase 2b.2 新增,不消耗 PRNG)
        // ----------------------------------------------------------
        let kickProbAdj = cell.kickProb * probScale;
        let snareProbAdj = (snareGateOpen ? cell.snareProb : 0) * probScale;
        const hihatProbAdj = cell.hihatProb * probScale;

        // bass strong onset → 提 kick prob
        if (hasBassStrongNear(stepBeat, bassNotes)) {
            kickProbAdj = Math.min(0.95, Math.max(kickProbAdj, 0.75));
        }
        // chord syncopate → 提 snare prob(ghost-like accent)
        if (snareGateOpen && hasChordSyncopateNear(stepBeat, barStart, chordNotes)) {
            snareProbAdj = Math.min(0.85, snareProbAdj * 1.3);
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
        // ----------------------------------------------------------
        const isCrashStep = stepIdx === 0 && isHighEnergy;
        const isFillBar = isBuildUp && (totalSteps - stepIdx <= stepsPerBar);

        if (isCrashStep) {
            // 高能段首拍:Crash + 加强 kick
            outHHit = true;
            outHPitch = DRUM_CRASH;
            outHVel = Math.min(1.0, velScale * 1.2);
            outKHit = true;
            outKVel = Math.min(1.0, velScale * 1.1);
        } else if (isFillBar) {
            // BuildUp 段最后一 bar:Tom 阶梯 fill
            outHHit = false;  // mute hihat
            outSHit = true;   // 强制 snare roll
            const fillProgression = 1 - (totalSteps - stepIdx) / stepsPerBar;
            outSVel = 0.5 + 0.5 * fillProgression;

            const subBeat = stepIdx % STEPS_PER_BEAT;
            if (subBeat === 3) outSPitch = DRUM_TOM_HI;
            else if (subBeat === 2 && fillProgression > 0.5) outSPitch = DRUM_TOM_MID;
            else if (subBeat === 1 && fillProgression > 0.8) outSPitch = DRUM_TOM_LO;
        } else if (isVeryHigh && outHHit && stepIdx % 2 === 0) {
            // 高能段 + 偶数 step + hihat 命中 → Ride 替代
            outHPitch = DRUM_RIDE;
        }

        // 发射音符
        if (outKHit) out.push({ pitch: outKPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outKVel });
        if (outSHit) out.push({ pitch: outSPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outSVel });
        if (outHHit) out.push({ pitch: outHPitch, onset: stepBeat, duration: HIT_DURATION, velocity: outHVel });
    }
}

export const DrumIdiom = {
    /** Drums 透传 — DrumGenerator 已直接产 NoteData */
    realize(notes: NoteData[]): NoteData[] {
        return notes.map(n => ({ ...n }));
    },
};
