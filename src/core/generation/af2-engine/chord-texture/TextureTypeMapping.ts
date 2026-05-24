// ============================================================
// TextureTypeMapping — textureType 字符串 → family + params
// ============================================================
//
// N + N5 阶段覆盖 23 family(38 textureType,1 个 CallAndResponse 留 N6)。
// 未映射的 textureType 由 ChordTextureEngine 退化到 'Single_Root'。
//
// 来源:mg/src/lib/chord-texture/TextureTypeMapping.ts(38 textureType
// 完整 mapping)
// ============================================================

import type { FamilyParams } from './types';

export const TEXTURE_MAPPING: Record<string, FamilyParams> = {
    // ============================================================
    // Sustained(2 个)
    // ============================================================
    'Single_Root': {
        family: 'Sustained',
        params: { bass_octave_double: false, velocity: 0.8 },
    },
    'Root_Octave': {
        family: 'Sustained',
        params: { bass_octave_double: true, velocity: 0.85 },
    },

    // ============================================================
    // PureWalk(5 个)— 根音模式行走
    // ============================================================
    'Root_5_8': {
        family: 'PureWalk',
        params: {
            grid_points: [0, 0.5, 1],
            bass_offsets: ['root', '5th', 'octave'],
            velocity_sequence: [0.8, 0.7, 0.7],
        },
    },
    'Root_7_5_8': {
        family: 'PureWalk',
        params: {
            grid_points: [0, 0.5, 1, 1.5],
            bass_offsets: ['root', '7th', '5th', 'octave'],
            velocity_sequence: [0.8, 0.65, 0.65, 0.7],
        },
    },
    'Root_5_7_5': {
        family: 'PureWalk',
        params: {
            grid_points: [0, 0.5, 1, 1.5],
            bass_offsets: ['root', '5th', '7th', '5th'],
            velocity_sequence: [0.8, 0.6, 0.6, 0.6],
        },
    },
    'Root_Fifth_Bass': {
        family: 'PureWalk',
        params: {
            grid_points: [0, 1],
            bass_offsets: ['root', '5th'],
            velocity_sequence: [0.8, 0.8],
        },
    },
    'Root_Octave_Pulse': {
        family: 'PureWalk',
        params: {
            grid_points: [0, 0.5],
            bass_offsets: ['low_octave', 'root'],
            velocity_sequence: [0.8, 0.8],
        },
    },

    // ============================================================
    // WalkingBass(1 个)
    // ============================================================
    'Jazz_Walking_Bass': {
        family: 'WalkingBass',
        params: {
            middle_pick: 'random_chord_tone',
            approach_enabled: true,
            approach_half_step_ratio: 0.6,
        },
    },

    // ============================================================
    // Bossa(2 个)
    // ============================================================
    'Bossa_Piano_Arp': {
        family: 'Bossa',
        params: {
            clave_points: [0.5, 1.5, 2.0, 3.5],
            bass_layer: 'fixed_2bar_cycle',
            chord_velocity: 0.7,
        },
    },
    'Bossa_Clave_Comping': {
        family: 'Bossa',
        params: {
            clave_points: [0, 0.75, 1.5, 2.5, 3.25],
            bass_layer: 'simple',
            chord_velocity: 0.7,
        },
    },

    // ============================================================
    // Hemiola(1 个)
    // ============================================================
    'Jazz_Waltz_Hemiola': {
        family: 'Hemiola',
        params: {
            hemiola_points: [0, 1.5, 3.0],
            velocity: 0.6,
        },
    },

    // ============================================================
    // PureStab(4 个)
    // ============================================================
    'Stabs': {
        family: 'PureStab',
        params: {
            stab_positions: [0.25, 0.75, 1.25, 1.75],
            stab_duration: 0.1,
            bass_at_zero: true,
            velocity: 0.8,
        },
    },
    'Syncopated_Stabs': {
        family: 'PureStab',
        params: {
            stab_positions: [0, 1.5],
            stab_duration: 1.0,
            bass_at_zero: true,
            velocity: 0.8,
        },
    },
    'Block_Chord_Staccato': {
        family: 'PureStab',
        params: {
            stab_positions: [0, 1.0, 1.5],
            stab_duration: 0.1,
            bass_at_zero: true,
            velocity: 0.8,
        },
    },
    'RnB_16th_Funk_Stabs': {
        family: 'PureStab',
        params: {
            stab_positions: [0.25, 0.75, 1.75, 2.25, 3.25],
            stab_duration: 0.15,
            bass_at_zero: true,
            velocity: 0.8,
        },
    },

    // ============================================================
    // GhostStab(2 个)
    // ============================================================
    'Blues_Stabs': {
        family: 'GhostStab',
        params: {
            main_stab_period: 2,
            syncopate_probability: 0.2,
            ghost_probability: 0.7,
            ghost_offset: 0.66,
        },
    },
    'RnB_Neo_Soul_Stab': {
        family: 'GhostStab',
        params: {
            main_stab_period: 1,
            syncopate_probability: 0.45,
            ghost_probability: 0.55,
            ghost_offset: 0.5,
        },
    },

    // ============================================================
    // ScratchSlap(2 个)
    // ============================================================
    'Funk_Guitar_Scratch': {
        family: 'ScratchSlap',
        params: {
            pattern_kind: 'offbeat_skip_strong',
            points: [],
            short_duration: 0.1,
        },
    },
    'Slap_Bass_Line': {
        family: 'ScratchSlap',
        params: {
            pattern_kind: 'slap_anchor_points',
            points: [0, 0.75, 1.5, 2.25],
            short_duration: 0.15,
        },
    },

    // ============================================================
    // ShuffleChop(2 个)
    // ============================================================
    'Blues_Chicago_Shuffle': {
        family: 'ShuffleChop',
        params: {
            shuffle_offset: 0.66,
            grace_lead_ms: null,
            chop_duration: 0.5,
            velocity: 0.7,
        },
    },
    'Blues_Slow_Chops': {
        family: 'ShuffleChop',
        params: {
            shuffle_offset: 0,
            grace_lead_ms: -0.05,
            chop_duration: 0.5,
            velocity: 0.85,
        },
    },

    // ============================================================
    // 族 C 8th Pulse(3 个 — PopAnthem / PopBroken8th / JazzCharleston)
    // ============================================================
    'Pop_Anthem_Pulse': {
        family: 'PopAnthem',
        params: { chord_velocity_even: 0.75, chord_velocity_odd: 0.55, bass_octave_low: true },
    },
    'Pop_Broken_8ths_Sync': {
        family: 'PopBroken8th',
        params: { velocity_low: 0.55, velocity_high: 0.65 },
    },
    'Jazz_Charleston_Comp': {
        family: 'JazzCharleston',
        params: {
            chord_first_velocity: 0.75,
            chord_charleston_velocity: 0.65,
            charleston_time: 1.66,
            bass_octave_low: true,
        },
    },

    // ============================================================
    // 族 D 16th Dense(PureArp 4 个 + OstinatoLayered 2 + Triplet 2 + Roll 1)
    // ============================================================
    'Broken_Chord': {
        family: 'PureArp',
        params: { pattern: 'cyclic', grid_step: 0.5, note_duration: 0.5, velocity_base: 0.5, bass_source: 'bM' },
    },
    'Arpeggio_Flow': {
        family: 'PureArp',
        params: { pattern: 'cyclic_two_octave', grid_step: 0.25, note_duration: 0.25, velocity_base: 0.5, bass_source: 'bMLow' },
    },
    'Arp_Seq': {
        family: 'PureArp',
        params: { pattern: 'cyclic_octave_flip', grid_step: 0.25, note_duration: 0.2, velocity_base: 0.6, bass_source: 'bMLow' },
    },
    'Pop_Piano_Arp_16ths': {
        family: 'PureArp',
        params: { pattern: 'sin_envelope_skip_strong', grid_step: 0.25, note_duration: 0.4, velocity_base: 0.5, bass_source: 'bMLow' },
    },
    'Ostinato_16s': {
        family: 'OstinatoLayered',
        params: { grid_step: 0.25, top_velocity: 0.5, accent_step_mod: 4, accent_boost: 0.2, bass_source: 'bM', has_lower_layer: false },
    },
    'Pop_Ostinato_Rock': {
        family: 'OstinatoLayered',
        params: { grid_step: 0.25, top_velocity: 0.6, accent_step_mod: 4, accent_boost: 0.15, bass_source: 'bMLow', has_lower_layer: true, lower_velocity: 0.5 },
    },
    'RnB_Gospel_Triplets': {
        family: 'Triplet',
        params: { triplet_velocities: [0.65, 0.55, 0.5], triplet_duration: 0.35, bass_source: 'bM', blues_pitches: false },
    },
    'Blues_Slow_12_8_Arp': {
        family: 'Triplet',
        params: { triplet_velocities: [0.7, 0.6, 0.6], triplet_duration: 0.3, bass_source: 'bMLow', blues_pitches: true },
    },
    'RnB_Neo_Soul_Roll': {
        family: 'Roll',
        params: {
            roll_delay: 0.04,
            roll_chord_velocity_start: 0.55,
            roll_chord_velocity_step: 0.05,
            roll_at_beats: [0, 2],
            syncopated_bass_at: 2.75,
        },
    },

    // ============================================================
    // 族 F Layered Sweep(BlockLayered 2 + SweepProgressive 2 +
    //                     GrooveDelay 1 + SpecialVoicing 1 + DoubleStopTremolo 1)
    // ============================================================
    'Block_Chord': {
        family: 'BlockLayered',
        params: { bass_velocity: 0.85, chord_pattern: 'block' },
    },
    'Jazz_Comping': {
        family: 'BlockLayered',
        params: { bass_velocity: 0.8, chord_pattern: 'sparse_off_beat' },
    },
    'Pop_Ballad_158_Sweep': {
        family: 'SweepProgressive',
        params: {
            bass_layers: [
                { time: 0,   duration_mode: 'to_end', offset: 'low_octave',  velocity: 0.8 },
                { time: 0.5, duration_mode: 'to_end', offset: 'rootLow_5th', velocity: 0.65 },
                { time: 1.0, duration_mode: 'to_end', offset: 'root',        velocity: 0.6 },
            ],
            chord_late_pattern: 'sustained_pad',
            chord_late_start: 1.5,
            chord_late_velocity: 0.6,
        },
    },
    // N5 修正:RnB_Classic_Soul_Arp mg 原版是 SweepProgressive(N 阶段误 map 到 PureArp)
    'RnB_Classic_Soul_Arp': {
        family: 'SweepProgressive',
        params: {
            bass_layers: [
                { time: 0,   duration_mode: 'to_end', offset: 'low_octave', velocity: 0.8 },
                { time: 1.0, duration_mode: 'to_end', offset: '5th',        velocity: 0.6 },
            ],
            chord_late_pattern: 'reverse_arp_descend',
            chord_late_start: 2.0,
            chord_late_velocity: 0.6,
        },
    },
    'RnB_Laid_Back_Groove': {
        family: 'GrooveDelay',
        params: {
            bass_velocity: 0.8,
            chord_delay: 0.12,
            chord_at: [0, 1.5, 2.5],
            chord_duration: 0.75,
            chord_velocity: 0.7,
        },
    },
    'Jazz_Drop_2_Comp': {
        family: 'SpecialVoicing',
        params: {
            voicing_strategy: 'drop_2',
            comp_times: [0.66, 1.5, 2.66],
            velocity_base: 0.5,
            velocity_random_range: 0.2,
            chord_duration: 0.25,
            bass_velocity: 0.8,
        },
    },
    'Blues_Tremolo_Comp': {
        family: 'DoubleStopTremolo',
        params: {
            bottom_velocity: 0.75,
            top_velocity: 0.65,
            top_duration: 0.15,
            bottom_duration: 0.5,
            bass_velocity: 0.85,
        },
    },

    // ============================================================
    // 族 G Quality-Aware(BoogieWalk 2 个)
    // ============================================================
    'Blues_Boogie_Woogie': {
        family: 'BoogieWalk',
        params: {
            emit_chord_every_4_steps: true,
            long_short_pattern: false,
            bass_velocity: 0.85,
            chord_velocity: 0.7,
        },
    },
    'Blues_Shuffle_Bass': {
        family: 'BoogieWalk',
        params: {
            emit_chord_every_4_steps: false,
            long_short_pattern: true,
            bass_velocity: 0.8,
            chord_velocity: 0.0,
        },
    },

    // ============================================================
    // 族 H Anticipated(AnticipatedBlock 1 个)
    // ============================================================
    'Jazz_Red_Garland_Block': {
        family: 'AnticipatedBlock',
        params: {
            anticipation_offset: -0.34,
            chord_velocity: 0.4,
            chord_duration: 0.3,
            bass_velocity: 0.75,
        },
    },

    // ============================================================
    // 族 X Cross-Track(N6 阶段 — CallAndResponse 1 个)
    // ============================================================
    'Call_And_Response': {
        family: 'CallAndResponse',
        params: {
            melody_lookahead_back: 0.1,
            melody_lookahead_forward: 0.3,
            chord_velocity: 0.6,
            chord_step: 0.5,
            bass_velocity: 0.8,
        },
    },
};
