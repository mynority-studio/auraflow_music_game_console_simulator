// ============================================================
// TextureTypeMapping — mg textureType → ChordTextureEngine family + params
// ============================================================
//
// Phase 2b.1 覆盖 20 个 textureType / 38 个总数(53%)。
// 未覆盖的 18 个 textureType:applyByTextureType 返回 null,调用方 fallback 到
// mg.applyTexture。
//
// 参考:af2-engine/CHORD_TEXTURE_ENGINE.md §5。
// ============================================================

import type { FamilyParams } from './types';

export const TEXTURE_MAPPING: Record<string, FamilyParams> = {
    // === Sustained(2 个)===
    'Single_Root': {
        family: 'Sustained',
        params: { bass_octave_double: false, velocity: 0.8 },
    },
    'Root_Octave': {
        family: 'Sustained',
        params: { bass_octave_double: true, velocity: 0.85 },
    },

    // === PureWalk(5 个)===
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

    // === WalkingBass(1 个)===
    'Jazz_Walking_Bass': {
        family: 'WalkingBass',
        params: {
            middle_pick: 'random_chord_tone',
            approach_enabled: true,
            approach_half_step_ratio: 0.6,
        },
    },

    // === Bossa(2 个)===
    'Bossa_Piano_Arp': {
        family: 'Bossa',
        params: {
            clave_points: [0.5, 1.5, 2.0, 3.5],
            bass_layer: 'fixed_2bar_cycle',
            chord_velocity: 0.65,
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

    // === Hemiola(1 个)===
    'Jazz_Waltz_Hemiola': {
        family: 'Hemiola',
        params: {
            hemiola_points: [0, 1.5, 3.0],
            velocity: 0.6,
        },
    },

    // === PureStab(4 个)===
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

    // === GhostStab(1 个)===
    'Blues_Stabs': {
        family: 'GhostStab',
        params: {
            main_stab_period: 2,
            syncopate_probability: 0.2,
            ghost_probability: 0.7,
            ghost_offset: 0.66,
        },
    },

    // === ScratchSlap(2 个)===
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

    // === ShuffleChop(2 个)===
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
};

/**
 * 查 textureType 是否在 ChordTextureEngine 覆盖范围。
 * 未覆盖的:调用方 fallback 到 mg.applyTexture(渐进迁移策略)
 */
export function hasMapping(textureType: string): boolean {
    return textureType in TEXTURE_MAPPING;
}
