// ============================================================
// ChordTextureEngine 类型定义(Phase 2b.1)
// ============================================================
//
// 9 子族 + 各自 params interface,组成 discriminated union FamilyParams。
// 主入口 ChordTextureInput = BaseInput & FamilyParams。
//
// 设计参考:af2-engine/CHORD_TEXTURE_ENGINE.md §3 / §4。
// ============================================================

import type { ChordDef, NoteEvent, Random } from '../../../mg-engine/musicEngine';

export type FamilyName =
    // Phase 2b.1 — 9 子族
    | 'Sustained'
    | 'PureWalk'
    | 'WalkingBass'
    | 'Bossa'
    | 'Hemiola'
    | 'PureStab'
    | 'GhostStab'
    | 'ScratchSlap'
    | 'ShuffleChop'
    // Phase 2b.3 — 14 新子族
    | 'PopAnthem'
    | 'PopBroken8th'
    | 'JazzCharleston'
    | 'PureArp'
    | 'OstinatoLayered'
    | 'Triplet'
    | 'Roll'
    | 'BlockLayered'
    | 'SweepProgressive'
    | 'GrooveDelay'
    | 'SpecialVoicing'
    | 'DoubleStopTremolo'
    | 'BoogieWalk'
    | 'AnticipatedBlock'
    // Phase 2c — cross-track(需要 melodyEvents)
    | 'CallAndResponse';

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
// Phase 2b.3 新增 14 子族
// ============================================================

// ----- 族 C: 8th Pulse -----

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

// ----- 族 D: 16th Dense -----

export interface PureArpParams {
    /** cyclic = Broken_Chord / cyclic_two_octave = Arpeggio_Flow / cyclic_octave_flip = Arp_Seq / sin_envelope_skip_strong = Pop_Piano_Arp_16ths */
    pattern: 'cyclic' | 'cyclic_two_octave' | 'cyclic_octave_flip' | 'sin_envelope_skip_strong';
    /** 16th = 0.25 / 8th = 0.5 */
    grid_step: number;
    note_duration: number;
    velocity_base: number;
    bass_source: 'bM' | 'bMLow';
}

export interface OstinatoLayeredParams {
    grid_step: 0.25;
    top_velocity: number;
    /** 每 N step 强调一次(每 4 step = 强拍) */
    accent_step_mod: number;
    accent_boost: number;
    bass_source: 'bM' | 'bMLow';
    has_lower_layer: boolean;
    lower_velocity?: number;
}

export interface TripletParams {
    /** triplet 3 个位置的 velocity:[start, mid, late] */
    triplet_velocities: [number, number, number];
    triplet_duration: number;
    bass_source: 'bM' | 'bMLow';
    /** true = Blues_Slow_12_8_Arp(blues triplet 序列,有 fallback);false = RnB_Gospel(cM 循环) */
    blues_pitches: boolean;
}

export interface RollParams {
    /** roll 延迟 ms(0.04 默认) */
    roll_delay: number;
    /** roll 起始 velocity(idx=0) */
    roll_chord_velocity_start: number;
    /** roll 每 voice velocity 递增 */
    roll_chord_velocity_step: number;
    /** roll 在哪些 beat 出现(如 [0, 2]) */
    roll_at_beats: number[];
    /** syncopated bass hit 时间(2.75)— null = 无 */
    syncopated_bass_at: number | null;
}

// ----- 族 F: Layered Sweep -----

export interface BlockLayeredParams {
    bass_velocity: number;
    /** 'block' = Block_Chord(chord 在 beat 0 全击,可能再 beat 2)/
     *  'sparse_off_beat' = Jazz_Comping(chord 在 1.5/3.0 稀疏 stab) */
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
    /** drop_2 = 去 cM 顶音(rootless 风) */
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

// ----- 族 G: Quality-Aware -----

export interface BoogieWalkParams {
    /** 是否每 4 step 发 chord(Blues_Boogie_Woogie=yes / Blues_Shuffle_Bass=no) */
    emit_chord_every_4_steps: boolean;
    /** 长短音交替(Blues_Shuffle_Bass=true,长 0.4 / 短 0.2 交替) */
    long_short_pattern: boolean;
    bass_velocity: number;
    chord_velocity: number;
}

// ----- 族 H: Anticipated -----

export interface AnticipatedBlockParams {
    /** 提前偏移(负数,如 -0.34 triplet 3) */
    anticipation_offset: number;
    chord_velocity: number;
    chord_duration: number;
    bass_velocity: number;
}

// ----- 族 X: Cross-Track(Phase 2c)-----

export interface CallAndResponseParams {
    /** melody 占用检测窗口:[time - back, time + forward) */
    melody_lookahead_back: number;
    melody_lookahead_forward: number;
    chord_velocity: number;
    /** 每 chord 检查步进(0.5 = 每半拍检查) */
    chord_step: number;
    bass_velocity: number;
}

// ============================================================
// Discriminated union — FamilyParams
// ============================================================
//
// 通过 family 字段判别,TypeScript 自动 narrow params 类型。
// ============================================================

export type FamilyParams =
    // Phase 2b.1
    | { family: 'Sustained';         params: SustainedParams }
    | { family: 'PureWalk';          params: PureWalkParams }
    | { family: 'WalkingBass';       params: WalkingBassParams }
    | { family: 'Bossa';             params: BossaParams }
    | { family: 'Hemiola';           params: HemiolaParams }
    | { family: 'PureStab';          params: PureStabParams }
    | { family: 'GhostStab';         params: GhostStabParams }
    | { family: 'ScratchSlap';       params: ScratchSlapParams }
    | { family: 'ShuffleChop';       params: ShuffleChopParams }
    // Phase 2b.3
    | { family: 'PopAnthem';         params: PopAnthemParams }
    | { family: 'PopBroken8th';      params: PopBroken8thParams }
    | { family: 'JazzCharleston';    params: JazzCharlestonParams }
    | { family: 'PureArp';           params: PureArpParams }
    | { family: 'OstinatoLayered';   params: OstinatoLayeredParams }
    | { family: 'Triplet';           params: TripletParams }
    | { family: 'Roll';              params: RollParams }
    | { family: 'BlockLayered';      params: BlockLayeredParams }
    | { family: 'SweepProgressive';  params: SweepProgressiveParams }
    | { family: 'GrooveDelay';       params: GrooveDelayParams }
    | { family: 'SpecialVoicing';    params: SpecialVoicingParams }
    | { family: 'DoubleStopTremolo'; params: DoubleStopTremoloParams }
    | { family: 'BoogieWalk';        params: BoogieWalkParams }
    | { family: 'AnticipatedBlock';  params: AnticipatedBlockParams }
    // Phase 2c
    | { family: 'CallAndResponse';   params: CallAndResponseParams };

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
    /**
     * Phase 2c — cross-track 数据(全曲已生成的 melody events)。
     * Call_And_Response 等 cross-track family 必需。其他 family 可忽略。
     */
    melodyEvents?: NoteEvent[];
}

export type ChordTextureInput = BaseInput & FamilyParams;
