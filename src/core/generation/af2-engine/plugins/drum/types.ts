// ============================================================
// Drum Plugin Protocols — layer-local convention
// ============================================================
//
// DrumIdiom 的 renderSection 主循环拆分为两类 plugin:
//
//   Modifier(pre-PRNG):调整 prob 后再 gate roll
//     - PersonaSparsity      — 全 probs × (1 - sparsity * 0.4)
//     - CrossTrack           — bass strong → kick boost / chord syncopate → snare boost
//     - PersonaSyncopation   — off-beat 16th → snare boost
//
//   Override(post-PRNG):改 hit state(已经 gate 完后)
//     - BreakOverride        — BuildUp→Drop 末 1/4 bar 全静音
//     - CrashOverride        — 段首 + crash section / high energy → Crash + 加强 kick
//     - FillOverride         — section transition 末 1 bar fill(per-mgStyle 5 style)
//     - RideOverride         — very high + 偶数 hihat → Ride 替代
//     - OpenHihatOverride    — 高能段 + and-of-4 + hihat → Open Hihat 替代
//
// PRNG 不变式(D-5 锁帧):
//   - 所有 plugin prngConsumption='zero'(不碰 rng)
//   - Orchestrator 每 step 强消耗 3 gate PRNG + 命中时 velocity PRNG
//   - 拔某 plugin → PRNG stream 不变 → 同 seed 仍 bit-exact
//
// Override 优先级:Break > Crash > Fill 互斥;Ride 仅在前三者未触发时;
// OpenHihat 独立 layer(独立 gate,可叠加 Ride)。
// ============================================================

import type { NoteData, SectionMetadata } from '../../../types';
import type { DrumStepConfig } from '../../instruments/drum-grid/types';

export interface DrumPluginMeta {
    readonly name: string;
    readonly version: string;
    /** Drum 层所有 plugin 必须为 'zero'(D-5 锁帧;PRNG 全在 orchestrator) */
    readonly prngConsumption: 'zero';
    readonly description: string;
}

// ============================================================
// Modifier 协议(pre-PRNG)
// ============================================================

export interface DrumProbs {
    kickProbAdj: number;
    snareProbAdj: number;
    hihatProbAdj: number;
}

export interface DrumModifierContext {
    readonly cell: DrumStepConfig;
    readonly probScale: number;
    readonly snareGateOpen: boolean;
    readonly stepIdx: number;
    readonly stepBeat: number;
    readonly barStart: number;
    readonly bassNotes: ReadonlyArray<NoteData>;
    readonly chordNotes: ReadonlyArray<NoteData>;
    readonly sparsity: number;
    readonly syncopation: number;
    /** STEPS_PER_BEAT(用于 syncopation 判定 relStep) */
    readonly stepsPerBeat: number;
}

export interface DrumModifier extends DrumPluginMeta {
    apply(probs: DrumProbs, ctx: DrumModifierContext): DrumProbs;
}

// ============================================================
// Override 协议(post-PRNG)
// ============================================================

export type FillStyle = 'tom' | 'snare_roll' | 'ride_drift' | 'shuffle_fill' | 'ghost_flam';

export interface DrumHitState {
    outKPitch: number; outKHit: boolean; outKVel: number;
    outSPitch: number; outSHit: boolean; outSVel: number;
    outHPitch: number; outHHit: boolean; outHVel: number;
}

export interface DrumOverrideContext {
    readonly stepIdx: number;
    readonly totalSteps: number;
    readonly stepsPerBar: number;
    readonly stepsPerBeat: number;
    readonly section: SectionMetadata;
    readonly nextSection: SectionMetadata | undefined;
    readonly fillStyle: FillStyle;
    readonly velScale: number;
    readonly isHighEnergy: boolean;
    readonly isCrashSection: boolean;
    readonly isVeryHigh: boolean;
    readonly isSectionTransition: boolean;
    readonly nextIsDrop: boolean;
}

export interface DrumOverride extends DrumPluginMeta {
    /** 是否触发(orchestrator 用于 if-else-if 链 short-circuit 判断) */
    shouldApply(state: Readonly<DrumHitState>, ctx: DrumOverrideContext): boolean;
    /** 应用 override 修改 state(返回新对象,不 mutate) */
    apply(state: Readonly<DrumHitState>, ctx: DrumOverrideContext): DrumHitState;
}
