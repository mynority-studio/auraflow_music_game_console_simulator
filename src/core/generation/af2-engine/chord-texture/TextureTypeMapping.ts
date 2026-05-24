// ============================================================
// TextureTypeMapping — textureType 字符串 → family + params(N 阶段)
// ============================================================
//
// N 阶段移植覆盖 8 family(MVP),对应 ~14 个 textureType。
// 未覆盖的 textureType 由 ChordTextureEngine 退化到 Sustained。
//
// 参考:mg/src/lib/chord-texture/TextureTypeMapping.ts(38 textureType)
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

    // === Bossa(2 个)===
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

    // === GhostStab(1 个,RnB / Blues 共用)===
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
            main_stab_period: 1,                 // 更密集
            syncopate_probability: 0.45,         // neo-soul 高切分
            ghost_probability: 0.55,
            ghost_offset: 0.5,
        },
    },

    // === PopAnthem(1 个)===
    'Pop_Anthem_Pulse': {
        family: 'PopAnthem',
        params: { chord_velocity_even: 0.75, chord_velocity_odd: 0.55, bass_octave_low: true },
    },

    // === PopBroken8th(1 个)===
    'Pop_Broken_8ths_Sync': {
        family: 'PopBroken8th',
        params: { velocity_low: 0.55, velocity_high: 0.65 },
    },

    // === JazzCharleston(1 个)===
    'Jazz_Charleston_Comp': {
        family: 'JazzCharleston',
        params: {
            chord_first_velocity: 0.75,
            chord_charleston_velocity: 0.65,
            charleston_time: 1.66,
            bass_octave_low: true,
        },
    },

    // === PureArp(4 个,RNB / POP arp 共用)===
    'Broken_Chord': {
        family: 'PureArp',
        params: { pattern: 'cyclic', grid_step: 0.5, note_duration: 0.45, velocity_base: 0.6, bass_source: 'bM' },
    },
    'Arpeggio_Flow': {
        family: 'PureArp',
        params: { pattern: 'cyclic_two_octave', grid_step: 0.5, note_duration: 0.45, velocity_base: 0.6, bass_source: 'bM' },
    },
    'Pop_Piano_Arp_16ths': {
        family: 'PureArp',
        params: { pattern: 'sin_envelope_skip_strong', grid_step: 0.25, note_duration: 0.23, velocity_base: 0.55, bass_source: 'bM' },
    },
    'RnB_Classic_Soul_Arp': {
        family: 'PureArp',
        params: { pattern: 'cyclic_octave_flip', grid_step: 0.25, note_duration: 0.23, velocity_base: 0.55, bass_source: 'bM' },
    },

    // === BoogieWalk(1 个)===
    'Blues_Boogie_Woogie': {
        family: 'BoogieWalk',
        params: {
            emit_chord_every_4_steps: true,
            long_short_pattern: false,
            bass_velocity: 0.85,
            chord_velocity: 0.65,
        },
    },
};
