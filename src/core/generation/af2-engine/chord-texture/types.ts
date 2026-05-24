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

/** N 阶段移植 family 名(MVP 8 个,其余留 N5)*/
export type FamilyName =
    | 'Sustained'
    | 'PopAnthem'
    | 'PopBroken8th'
    | 'JazzCharleston'
    | 'Bossa'
    | 'BoogieWalk'
    | 'GhostStab'
    | 'PureArp';

/** PureWalk / WalkingBass 用的 bass 偏移名(N5 移植时全用,此处声明备用) */
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
// FamilyParams discriminated union
// ============================================================

export type FamilyParams =
    | { family: 'Sustained'; params: SustainedParams }
    | { family: 'PopAnthem'; params: PopAnthemParams }
    | { family: 'PopBroken8th'; params: PopBroken8thParams }
    | { family: 'JazzCharleston'; params: JazzCharlestonParams }
    | { family: 'Bossa'; params: BossaParams }
    | { family: 'BoogieWalk'; params: BoogieWalkParams }
    | { family: 'GhostStab'; params: GhostStabParams }
    | { family: 'PureArp'; params: PureArpParams };

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
