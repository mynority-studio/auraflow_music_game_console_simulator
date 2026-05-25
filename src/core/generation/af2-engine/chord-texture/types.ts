// ============================================================
// ChordTextureEngine 类型定义
// ============================================================
//
// POP-only(2026-05-25 大瘦身)— 11 family 覆盖 POP 全部 textureType,
// 删除所有 JAZZ/BLUES/RNB-only family 的 params interface + FamilyParams 分支。
// ============================================================

import type { ChordDef } from '../types/ChordDef';
import type { Random } from '../utils/Random';

/**
 * NoteEvent — 内部 emit 格式。chord-texture family emit 此结构,
 * adapter 转 AF2 NoteData(过滤 part='accomp' / 转 velocity 0-127 → 0-1)。
 */
export interface NoteEvent {
    noteNumber: number;      // 0-127
    time: number;            // beats from start of progression
    duration: number;        // beats
    velocity: number;        // 0-127
    part: 'melody' | 'accomp' | 'bass';
}

/** POP-only family 名(11 个) */
export type FamilyName =
    | 'Sustained'
    | 'PopAnthem'
    | 'PopBroken8th'
    | 'PureArp'
    | 'PureWalk'
    | 'PureStab'
    | 'ScratchSlap'
    | 'OstinatoLayered'
    | 'BlockLayered'
    | 'SweepProgressive'
    | 'CallAndResponse';

/** PureWalk / SweepProgressive 用的 bass 偏移名 */
export type BassOffsetName = 'root' | '5th' | '7th' | 'octave' | 'low_octave';

// ============================================================
// Family params interfaces
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

export interface PureWalkParams {
    /** beat 位置数组,如 [0, 0.5, 1, 1.5] */
    grid_points: number[];
    /** 等长于 grid_points,每点 bass 偏移名 */
    bass_offsets: BassOffsetName[];
    /** 等长于 grid_points,每点 velocity */
    velocity_sequence: number[];
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

export interface BlockLayeredParams {
    bass_velocity: number;
    /** 'block' = Block_Chord(POP-only;'sparse_off_beat' Jazz_Comping 已删) */
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

export interface CallAndResponseParams {
    /** melody 占用检测窗口:[time - back, time + forward) */
    melody_lookahead_back: number;
    melody_lookahead_forward: number;
    chord_velocity: number;
    /** 每 chord 内检查步进(0.5 = 每半拍检查) */
    chord_step: number;
    bass_velocity: number;
}

// ============================================================
// FamilyParams discriminated union(POP-only 11 family)
// ============================================================

export type FamilyParams =
    | { family: 'Sustained'; params: SustainedParams }
    | { family: 'PopAnthem'; params: PopAnthemParams }
    | { family: 'PopBroken8th'; params: PopBroken8thParams }
    | { family: 'PureArp'; params: PureArpParams }
    | { family: 'PureWalk'; params: PureWalkParams }
    | { family: 'PureStab'; params: PureStabParams }
    | { family: 'ScratchSlap'; params: ScratchSlapParams }
    | { family: 'OstinatoLayered'; params: OstinatoLayeredParams }
    | { family: 'BlockLayered'; params: BlockLayeredParams }
    | { family: 'SweepProgressive'; params: SweepProgressiveParams }
    | { family: 'CallAndResponse'; params: CallAndResponseParams };

/** Engine.apply 主输入 */
export type ChordTextureInput = FamilyParams & {
    chord: ChordDef;
    nextChord: ChordDef | null;
    startBeat: number;
    duration: number;
    rng: Random;
    /**
     * Cross-track melody events(全曲已生成的 melody)。
     * CallAndResponse 等 cross-track family 必需;其他 family 可忽略。
     */
    melodyEvents?: ReadonlyArray<NoteEvent>;
};
