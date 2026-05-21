// ============================================================
// ChordTextureEngine 类型定义(Phase 2b.1)
// ============================================================
//
// 9 子族 + 各自 params interface,组成 discriminated union FamilyParams。
// 主入口 ChordTextureInput = BaseInput & FamilyParams。
//
// 设计参考:af2-engine/CHORD_TEXTURE_ENGINE.md §3 / §4。
// ============================================================

import type { ChordDef, Random } from '../../../mg-engine/musicEngine';

export type FamilyName =
    | 'Sustained'
    | 'PureWalk'
    | 'WalkingBass'
    | 'Bossa'
    | 'Hemiola'
    | 'PureStab'
    | 'GhostStab'
    | 'ScratchSlap'
    | 'ShuffleChop';

/** PureWalk 的 bass 偏移名(对应 PitchPrimitives 的几种 bass 取法) */
export type BassOffsetName = 'root' | '5th' | '7th' | 'octave' | 'low_octave';

// ============================================================
// 各子族 params interface
// ============================================================

export interface SustainedParams {
    /** true = Root_Octave(发 [bMLow, bM]);false = Single_Root(只发 bM) */
    bass_octave_double: boolean;
    velocity: number;
}

export interface PureWalkParams {
    /** beat 位置,如 [0, 0.5, 1, 1.5] */
    grid_points: number[];
    /** 等长于 grid_points,每点的 bass 偏移名 */
    bass_offsets: BassOffsetName[];
    /** 等长于 grid_points,每点的 velocity */
    velocity_sequence: number[];
}

export interface WalkingBassParams {
    /** 中间拍 chord tone 选取方式 */
    middle_pick: 'random_chord_tone' | 'scale_pick';
    /** 是否启用 next-chord chromatic approach(末拍) */
    approach_enabled: boolean;
    /** approach 半步 vs 全步的概率(0.6 = 60% 半步) */
    approach_half_step_ratio: number;
}

export interface BossaParams {
    /** clave 时间点,如 [0, 0.75, 1.5, 2.5, 3.25] */
    clave_points: number[];
    /** bass 形态:fixed_2bar_cycle(bossa root-5 循环)/ simple(全曲一击) */
    bass_layer: 'fixed_2bar_cycle' | 'simple';
    chord_velocity: number;
}

export interface HemiolaParams {
    /** hemiola 时间点(3-against-4),如 [0, 1.5, 3.0] */
    hemiola_points: number[];
    velocity: number;
}

export interface PureStabParams {
    /** stab 位置数组 */
    stab_positions: number[];
    /** 每击持续时间(0.1-0.15) */
    stab_duration: number;
    /** 是否在 beat 0 出 bass(全曲长 bass) */
    bass_at_zero: boolean;
    velocity: number;
}

export interface GhostStabParams {
    /** 每 N beat 一个主 stab */
    main_stab_period: number;
    /** 切分概率(主 stab 提前 0.34) */
    syncopate_probability: number;
    /** ghost stab 概率 */
    ghost_probability: number;
    /** ghost 时间偏移(主 stab 后) */
    ghost_offset: number;
}

export interface ScratchSlapParams {
    /** offbeat_skip_strong(funk scratch)/ slap_anchor_points(slap bass) */
    pattern_kind: 'offbeat_skip_strong' | 'slap_anchor_points';
    /** slap_anchor_points 模式下使用的点位 */
    points: number[];
    short_duration: number;
}

export interface ShuffleChopParams {
    /** shuffle 偏移(0.66 = Chicago shuffle / 0 = 直拍) */
    shuffle_offset: number;
    /** grace 前导(负数,如 -0.05;null 表示无 grace) */
    grace_lead_ms: number | null;
    chop_duration: number;
    velocity: number;
}

// ============================================================
// Discriminated union — FamilyParams
// ============================================================
//
// 通过 family 字段判别,TypeScript 自动 narrow params 类型。
// ============================================================

export type FamilyParams =
    | { family: 'Sustained';   params: SustainedParams }
    | { family: 'PureWalk';    params: PureWalkParams }
    | { family: 'WalkingBass'; params: WalkingBassParams }
    | { family: 'Bossa';       params: BossaParams }
    | { family: 'Hemiola';     params: HemiolaParams }
    | { family: 'PureStab';    params: PureStabParams }
    | { family: 'GhostStab';   params: GhostStabParams }
    | { family: 'ScratchSlap'; params: ScratchSlapParams }
    | { family: 'ShuffleChop'; params: ShuffleChopParams };

// ============================================================
// 主入口 input
// ============================================================

export interface BaseInput {
    chord: ChordDef;
    nextChord: ChordDef | null;
    /** 起始 beat(绝对,全曲范围) */
    startBeat: number;
    /** 该 chord 持续 beat 数 */
    duration: number;
    /** PRNG 实例(显式注入,不依赖任何 class state) */
    rng: Random;
}

export type ChordTextureInput = BaseInput & FamilyParams;
