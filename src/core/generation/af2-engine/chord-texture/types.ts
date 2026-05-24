// ============================================================
// ChordTextureEngine 类型定义(N 阶段移植,2026-05-24)
// ============================================================
//
// 从 mg/src/lib/chord-texture/types.ts 移植。先做 8 family MVP,其余 19 family
// 留 N5 commit。
//
// 设计参考:af2-engine/CHORD_TEXTURE_ENGINE.md(若仍存),mg 注释。
// ============================================================

import type { ChordDef } from '../types/ChordDef';
import type { NoteData } from '../../types';
import type { Random } from '../utils/Random';

/**
 * NoteEvent — mg 内部 emit 格式。chord-texture family emit 此结构,
 * adapter 转 AF2 NoteData(过滤 part='accomp' / 转 velocity 0-127 → 0-1)。
 */
export interface NoteEvent {
    noteNumber: number;      // 0-127
    time: number;            // beats from start of progression
    duration: number;        // beats
    velocity: number;        // 0-127
    part: 'melody' | 'accomp' | 'bass';
}

/** N+N5 阶段 family 名(23 个,CallAndResponse 留 N6 cross-track 设计)*/
export type FamilyName =
    // N 阶段(8)
    | 'Sustained'
    | 'PopAnthem'
    | 'PopBroken8th'
    | 'JazzCharleston'
    | 'Bossa'
    | 'BoogieWalk'
    | 'GhostStab'
    | 'PureArp'
    // N5 阶段(15)
    | 'PureWalk'
    | 'WalkingBass'
    | 'Hemiola'
    | 'PureStab'
    | 'ScratchSlap'
    | 'ShuffleChop'
    | 'OstinatoLayered'
    | 'Triplet'
    | 'Roll'
    | 'BlockLayered'
    | 'SweepProgressive'
    | 'GrooveDelay'
    | 'SpecialVoicing'
    | 'DoubleStopTremolo'
    | 'AnticipatedBlock';

/** PureWalk / SweepProgressive 用的 bass 偏移名 */
export type BassOffsetName = 'root' | '5th' | '7th' | 'octave' | 'low_octave';

// ============================================================
// 各 family params interface(MVP 8 个)
// ============================================================

export interface SustainedParams {
    /** true = Root_Octave(发 [bMLow, bM]),false = Single_Root(只 bM) */
    bass_octave_double: boolean;
    velocity: number;
}

export interface PopAnthemParams {
    /** 偶数 step velocity(强拍) */
    chord_velocity_even: number;
    /** 奇数 step velocity(弱拍) */
    chord_velocity_odd: number;
    bass_octave_low: boolean;
}

export interface PopBroken8thParams {
    velocity_low: number;
    velocity_high: number;
}

export interface JazzCharlestonParams {
    chord_first_velocity: number;
    chord_charleston_velocity: number;
    /** "and of 2" 在 swing 中的时间(通常 1.66) */
    charleston_time: number;
    bass_octave_low: boolean;
}

export interface BossaParams {
    /** clave 时间点,如 [0, 0.75, 1.5, 2.5, 3.25] */
    clave_points: number[];
    /** bass 形态 */
    bass_layer: 'fixed_2bar_cycle' | 'simple';
    chord_velocity: number;
}

export interface BoogieWalkParams {
    /** 是否每 4 step 发一次 chord(Blues_Boogie_Woogie:true / Blues_Shuffle_Bass:false) */
    emit_chord_every_4_steps: boolean;
    /** bass 长短交替(Shuffle_Bass) */
    long_short_pattern: boolean;
    bass_velocity: number;
    chord_velocity: number;
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

export interface PureArpParams {
    /**
     * cyclic = Broken_Chord / cyclic_two_octave = Arpeggio_Flow
     * cyclic_octave_flip = Arp_Seq / sin_envelope_skip_strong = Pop_Piano_Arp_16ths
     */
    pattern: 'cyclic' | 'cyclic_two_octave' | 'cyclic_octave_flip' | 'sin_envelope_skip_strong';
    /** 16th = 0.25 / 8th = 0.5 */
    grid_step: number;
    note_duration: number;
    velocity_base: number;
    bass_source: 'bM' | 'bMLow';
}

// ============================================================
// N5 阶段 family params(15 个)
// ============================================================

export interface PureWalkParams {
    /** beat 位置数组,如 [0, 0.5, 1, 1.5] */
    grid_points: number[];
    /** 等长于 grid_points,每点 bass 偏移名 */
    bass_offsets: BassOffsetName[];
    /** 等长于 grid_points,每点 velocity */
    velocity_sequence: number[];
}

export interface WalkingBassParams {
    /** 中间拍 chord tone 选取方式 */
    middle_pick: 'random_chord_tone' | 'scale_pick';
    /** 末拍 chromatic approach 启用 */
    approach_enabled: boolean;
    /** approach 半步 vs 全步概率(0.6 = 60% 半步) */
    approach_half_step_ratio: number;
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

export interface ScratchSlapParams {
    /** offbeat_skip_strong(funk scratch)/ slap_anchor_points(slap bass) */
    pattern_kind: 'offbeat_skip_strong' | 'slap_anchor_points';
    /** slap_anchor_points 模式下用的点位 */
    points: number[];
    short_duration: number;
}

export interface ShuffleChopParams {
    /** shuffle 偏移(0.66 = Chicago shuffle / 0 = 直拍) */
    shuffle_offset: number;
    /** grace 前导(负数;null = 无 grace) */
    grace_lead_ms: number | null;
    chop_duration: number;
    velocity: number;
}

export interface OstinatoLayeredParams {
    grid_step: 0.25;
    top_velocity: number;
    /** 每 N step 强调一次 */
    accent_step_mod: number;
    accent_boost: number;
    bass_source: 'bM' | 'bMLow';
    has_lower_layer: boolean;
    lower_velocity?: number;
}

export interface TripletParams {
    /** triplet 3 个位置 velocity:[start, mid, late] */
    triplet_velocities: [number, number, number];
    triplet_duration: number;
    bass_source: 'bM' | 'bMLow';
    /** true = Blues_Slow_12_8_Arp(blues 4 音序列);false = RnB_Gospel(cM 循环) */
    blues_pitches: boolean;
}

export interface RollParams {
    /** roll 延迟 ms(0.04 默认) */
    roll_delay: number;
    /** roll 起始 velocity(idx=0) */
    roll_chord_velocity_start: number;
    /** roll 每 voice velocity 递增 */
    roll_chord_velocity_step: number;
    /** roll 在哪些 beat 出现 */
    roll_at_beats: number[];
    /** syncopated bass hit 时间(null = 无) */
    syncopated_bass_at: number | null;
}

export interface BlockLayeredParams {
    bass_velocity: number;
    /** 'block' = Block_Chord / 'sparse_off_beat' = Jazz_Comping */
    chord_pattern: 'block' | 'sparse_off_beat';
}

export interface SweepProgressiveParams {
    /** bass 多层时序点 */
    bass_layers: Array<{
        time: number;
        duration_mode: 'to_end' | 'fixed';
        duration?: number;
        offset: 'root' | '5th' | 'low_octave' | 'rootLow_5th';
        velocity: number;
    }>;
    /** chord 后期形态 */
    chord_late_pattern: 'sustained_pad' | 'reverse_arp_descend';
    chord_late_start: number;
    chord_late_velocity: number;
}

export interface GrooveDelayParams {
    bass_velocity: number;
    chord_delay: number;
    chord_at: number[];
    chord_duration: number;
    chord_velocity: number;
}

export interface SpecialVoicingParams {
    /** drop_2 = 去 cM 顶音(Bill Evans rootless 风) */
    voicing_strategy: 'drop_2';
    comp_times: number[];
    velocity_base: number;
    velocity_random_range: number;
    chord_duration: number;
    bass_velocity: number;
}

export interface DoubleStopTremoloParams {
    /** bottom = cM[0] velocity */
    bottom_velocity: number;
    /** top tremolo velocity */
    top_velocity: number;
    /** top tremolo duration */
    top_duration: number;
    /** bottom duration */
    bottom_duration: number;
    bass_velocity: number;
}

export interface AnticipatedBlockParams {
    /** 提前偏移(负数,如 -0.34 triplet 3) */
    anticipation_offset: number;
    chord_velocity: number;
    chord_duration: number;
    bass_velocity: number;
}

// ============================================================
// FamilyParams discriminated union(N + N5 = 23 family)
// ============================================================

export type FamilyParams =
    // N(8)
    | { family: 'Sustained'; params: SustainedParams }
    | { family: 'PopAnthem'; params: PopAnthemParams }
    | { family: 'PopBroken8th'; params: PopBroken8thParams }
    | { family: 'JazzCharleston'; params: JazzCharlestonParams }
    | { family: 'Bossa'; params: BossaParams }
    | { family: 'BoogieWalk'; params: BoogieWalkParams }
    | { family: 'GhostStab'; params: GhostStabParams }
    | { family: 'PureArp'; params: PureArpParams }
    // N5(15)
    | { family: 'PureWalk'; params: PureWalkParams }
    | { family: 'WalkingBass'; params: WalkingBassParams }
    | { family: 'Hemiola'; params: HemiolaParams }
    | { family: 'PureStab'; params: PureStabParams }
    | { family: 'ScratchSlap'; params: ScratchSlapParams }
    | { family: 'ShuffleChop'; params: ShuffleChopParams }
    | { family: 'OstinatoLayered'; params: OstinatoLayeredParams }
    | { family: 'Triplet'; params: TripletParams }
    | { family: 'Roll'; params: RollParams }
    | { family: 'BlockLayered'; params: BlockLayeredParams }
    | { family: 'SweepProgressive'; params: SweepProgressiveParams }
    | { family: 'GrooveDelay'; params: GrooveDelayParams }
    | { family: 'SpecialVoicing'; params: SpecialVoicingParams }
    | { family: 'DoubleStopTremolo'; params: DoubleStopTremoloParams }
    | { family: 'AnticipatedBlock'; params: AnticipatedBlockParams };

/** Engine.apply 主输入 */
export type ChordTextureInput = FamilyParams & {
    chord: ChordDef;
    nextChord: ChordDef | null;
    startBeat: number;
    duration: number;
    rng: Random;
};

// Re-export NoteData for convenience
export type { NoteData };
