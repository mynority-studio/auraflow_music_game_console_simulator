// ============================================================
// DrumIdiom — AF2 鼓组 orchestrator(Phase 2b.2 + plugin 拆分 2026-05-25)
// ============================================================
//
// 8 层架构 #6 "乐手 idiom"。
//
// 2026-05-25 重构:renderSection 主循环拆分为
//   - Core(本文件):per-section + per-step 主循环 + PRNG 3 gate + base hit
//                  + emit + DrumGenerator.plan(role gate)
//   - Modifier(plugins/drum/):pre-PRNG prob 调整(3 个)
//   - Override(plugins/drum/):post-PRNG hit state 调整(5 个,4 互斥 + 1 独立)
//
// PRNG(D-5 锁帧)— **核心不变式**:
//   每 step 固定消耗 3 次 gate PRNG(即使概率为 0)+ 命中时 velocity PRNG。
//   所有 plugin prngConsumption='zero',拔某 plugin 不破坏 PRNG stream。
//
// 物理约束:
//   GM Drum Map(K-8 第三空间)— pitches 由 plugin / core 共同管理,
//   GM Channel 9 由 MidiConverter 路由。
// ============================================================

import type { NoteData, SectionMetadata, MusicianPersona } from '../../types';
import { BandRole, SectionType } from '../../types';
import type { Random } from '../utils/Random';
import type { MgStyle } from '../../../../state/EngineSelectionStore';
import { getDrumGridByMgStyle } from './drum-grid/grids';
import type { DrumGridConfig } from './drum-grid/types';
import { STEPS_PER_BEAT, STEPS_PER_BAR, ENERGY_LEVELS } from './drum-grid/types';
import type { Score } from '../Score';
import type { SectionAssignment } from '../Conductor';
import {
    DEFAULT_DRUM_MODIFIERS,
    EXCLUSIVE_DRUM_OVERRIDES,
    INDEPENDENT_DRUM_OVERRIDES,
    pickFillStyle,
} from '../plugins/drum';
import type { DrumHitState, DrumOverrideContext, DrumModifierContext } from '../plugins/drum';
import { DRUM_KICK, DRUM_SNARE, DRUM_CLOSED_HIHAT } from '../plugins/drum/constants';

/** 击点固定时长(32 分音符,attack-only,GM Drum 自带 envelope) */
const HIT_DURATION = 0.125;
const EPSILON = 1e-6;

/**
 * O 阶段:Crash-triggering section types(CrashOverride 用)。
 * Chorus / Drop / Bridge / BuildUp 起点几乎必然 Crash(不论 energy)。
 */
const CRASH_SECTION_TYPES: ReadonlySet<SectionType> = new Set([
    SectionType.Chorus,
    SectionType.Drop,
    SectionType.Bridge,
    SectionType.BuildUp,
]);

/**
 * Y 阶段:per-mgStyle drum swing ratio(影响 16-step grid sub-step onset)。
 *   POP   0.50 — 直拍
 *   JAZZ  0.66 — triplet swing
 *   BLUES 0.66 — shuffle
 *   RNB   0.50 — 直 16th
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
    return swingRatio + (1 - swingRatio) / 2;
}

export const DRUM_INSTRUMENT_SPEC = {
    eligibleSlots: [BandRole.Drums] as const,
} as const;

/**
 * C.5:DrumPlanInput 扩展 MusicianPlanInput 加 drum-specific extras。
 */
export interface DrumPlanInput {
    score: Score;
    musicianId: string;
    assignments: ReadonlyArray<SectionAssignment>;
    mgStyle: MgStyle;
    rng: Random;
    bassNotes?: ReadonlyArray<NoteData>;
    chordNotes?: ReadonlyArray<NoteData>;
    persona?: MusicianPersona;
}

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

export const DrumGenerator = {
    /**
     * C.5:plan(DrumPlanInput) — Conductor + Score 协议下的 drums 生成。
     *
     * 流程:
     *   1. 遍历 score.sections
     *   2. per-section role gate(Conductor 让此段 silent 则跳过)
     *   3. 通过的 section 走 renderSection 主循环 + plugin chain
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
            const myRoles = assignments[sIdx]?.byMusician.get(musicianId) ?? [];
            if (!myRoles.includes('drums')) continue;

            const section = sections[sIdx];
            const dur = section.endBeat - section.startBeat;
            if (dur < EPSILON) continue;
            const nextSection = sIdx + 1 < sections.length ? sections[sIdx + 1] : undefined;
            renderSection(
                out, section, nextSection, grid, beatsPerMeasure,
                bassNotes, chordNotes, rng,
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
    bassNotes: ReadonlyArray<NoteData>,
    chordNotes: ReadonlyArray<NoteData>,
    rng: Random,
    sparsity: number,
    syncopation: number,
    mgStyle: MgStyle,
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

    // Override 触发 flags(per-section,plugin shouldApply 用)
    const isHighEnergy = section.energyLevel >= 7;
    const isCrashSection = CRASH_SECTION_TYPES.has(section.sectionType);
    const isVeryHigh = section.energyLevel >= 8;
    const nextIsCrashSection = nextSection !== undefined && CRASH_SECTION_TYPES.has(nextSection.sectionType);
    const energyJump = nextSection !== undefined ? (nextSection.energyLevel - section.energyLevel) : 0;
    const isSectionTransition = nextSection !== undefined && (energyJump >= 1 || nextIsCrashSection);
    const nextIsDrop = nextSection !== undefined && nextSection.sectionType === SectionType.Drop;

    // Fill style per-section deterministic 选(0 PRNG)
    const fillStyle = pickFillStyle(mgStyle, startBeat);

    const gridLen = grid.grid.length;
    const stepsPerBar = STEPS_PER_BAR;
    const swingRatio = SWING_RATIO_BY_STYLE[mgStyle] ?? 0.5;

    for (let stepIdx = 0; stepIdx < totalSteps; stepIdx++) {
        const cellIdx = stepIdx % gridLen;
        const cell = grid.grid[cellIdx];
        const beatBase = Math.floor(stepIdx / STEPS_PER_BEAT);
        const subStep = stepIdx % STEPS_PER_BEAT;
        const stepBeat = startBeat + beatBase + stepOnsetWithinBeat(subStep, swingRatio);
        const barStart = startBeat + Math.floor(stepIdx / stepsPerBar) * beatsPerMeasure;

        // ----------------------------------------------------------
        // Modifier chain(pre-PRNG,3 plugin 顺序:Sparsity → CrossTrack → Syncopation)
        // ----------------------------------------------------------
        const modCtx: DrumModifierContext = {
            cell, probScale, snareGateOpen,
            stepIdx, stepBeat, barStart,
            bassNotes, chordNotes,
            sparsity, syncopation,
            stepsPerBeat: STEPS_PER_BEAT,
        };
        let probs = {
            kickProbAdj: cell.kickProb * probScale,
            snareProbAdj: (snareGateOpen ? cell.snareProb : 0) * probScale,
            hihatProbAdj: cell.hihatProb * probScale,
        };
        for (const mod of DEFAULT_DRUM_MODIFIERS) {
            probs = mod.apply(probs, modCtx);
        }

        // ----------------------------------------------------------
        // Gate evaluation — D-5 锁帧:每 step 固定 3 次 PRNG,无条件消耗
        // ----------------------------------------------------------
        const kickDice = rng.next();
        const kickHitOrig = kickDice < probs.kickProbAdj;
        const kickVelOrig = kickHitOrig ? sampleVelocity(rng, grid.kickVelocity, velScale) : 0;

        const snareDice = rng.next();
        const snareHitOrig = snareDice < probs.snareProbAdj;
        const snareVelOrig = snareHitOrig ? sampleVelocity(rng, grid.snareVelocity, velScale) : 0;

        const hihatDice = rng.next();
        const hihatHitOrig = hihatDice < probs.hihatProbAdj;
        const hihatVelOrig = hihatHitOrig ? sampleVelocity(rng, grid.hihatVelocity, velScale) : 0;

        // Base hit state(默认继承原始判定)
        let state: DrumHitState = {
            outKPitch: DRUM_KICK,        outKHit: kickHitOrig,  outKVel: kickVelOrig,
            outSPitch: DRUM_SNARE,       outSHit: snareHitOrig, outSVel: snareVelOrig,
            outHPitch: DRUM_CLOSED_HIHAT, outHHit: hihatHitOrig, outHVel: hihatVelOrig,
        };

        // ----------------------------------------------------------
        // Override chain(post-PRNG,0 PRNG 消耗)
        //   - Exclusive:Break > Crash > Fill > Ride(任一触发其他不跑)
        //   - Independent:OpenHihat(在 Exclusive 之后跑,可与 Ride 叠加)
        // ----------------------------------------------------------
        const ovCtx: DrumOverrideContext = {
            stepIdx, totalSteps, stepsPerBar, stepsPerBeat: STEPS_PER_BEAT,
            section, nextSection,
            mgStyle, fillStyle, velScale,
            isHighEnergy, isCrashSection, isVeryHigh, isSectionTransition, nextIsDrop,
        };
        for (const ov of EXCLUSIVE_DRUM_OVERRIDES) {
            if (ov.shouldApply(state, ovCtx)) {
                state = ov.apply(state, ovCtx);
                break;  // 互斥:首个 match 即停
            }
        }
        for (const ov of INDEPENDENT_DRUM_OVERRIDES) {
            if (ov.shouldApply(state, ovCtx)) {
                state = ov.apply(state, ovCtx);
            }
        }

        // 发射音符
        if (state.outKHit) out.push({ pitch: state.outKPitch, onset: stepBeat, duration: HIT_DURATION, velocity: state.outKVel });
        if (state.outSHit) out.push({ pitch: state.outSPitch, onset: stepBeat, duration: HIT_DURATION, velocity: state.outSVel });
        if (state.outHHit) out.push({ pitch: state.outHPitch, onset: stepBeat, duration: HIT_DURATION, velocity: state.outHVel });
    }
}

export const DrumIdiom = {
    /** Drums 透传 — DrumGenerator 已直接产 NoteData */
    realize(notes: NoteData[]): NoteData[] {
        return notes;
    },
};
