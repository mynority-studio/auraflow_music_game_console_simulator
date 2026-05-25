// ============================================================
// TextureTypeMapping — textureType 字符串 → family + params
// ============================================================
//
// POP-only(2026-05-25 大瘦身)— 删除所有 JAZZ/BLUES/RNB textureTypes
// (共 21 个),保留 23 个 POP / 通用 textureType。
//
// 未映射的 textureType 由 ChordTextureEngine 退化到 'Single_Root'。
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
    // PureStab(3 个)— 通用 stab pattern
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

    // ============================================================
    // ScratchSlap(2 个)— POP-funk 风
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
    // 族 C 8th Pulse(2 个 POP)
    // ============================================================
    'Pop_Anthem_Pulse': {
        family: 'PopAnthem',
        params: { chord_velocity_even: 0.75, chord_velocity_odd: 0.55, bass_octave_low: true },
    },
    'Pop_Broken_8ths_Sync': {
        family: 'PopBroken8th',
        params: { velocity_low: 0.55, velocity_high: 0.65 },
    },

    // ============================================================
    // 族 D 16th Dense(PureArp 4 个 + OstinatoLayered 2 个)
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

    // ============================================================
    // 族 F Layered Sweep(BlockLayered 1 + SweepProgressive 1)
    // ============================================================
    'Block_Chord': {
        family: 'BlockLayered',
        params: { bass_velocity: 0.85, chord_pattern: 'block' },
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

    // ============================================================
    // 族 X Cross-Track(CallAndResponse 1 个 — melody-aware comping)
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
