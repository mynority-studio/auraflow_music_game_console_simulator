/**
 * GMSoundMap — defaultSound 字符串 → GM 1 程式号映射 + 同家族音色列表
 *
 * 用途（B2/B3）：
 *   1. Musician.defaultSound（'Acoustic_Grand' 等字符串）→ GM program number（0~127）
 *      → BandEngine / Orchestrator 用此映射决定 MidiConverter 走哪个 GM patch
 *   2. UI 下拉提供"同家族音色"列表：选了钢琴手 → 显示 [Grand / EP / Marimba / Vibraphone / ...]
 *
 * 数据组织：纯 const 数据，无运行期解析、无 PRNG。
 *
 * Drums (channel 9) 特殊：MIDI 标准上 channel 9 program change 被合成器解释为 kit 选择。
 * SpessaSynth + GM2 SF2 支持以 program byte 切换 kit（Standard=0 / Brush=40 / Orchestra=48 等）。
 *
 * @author AuraFlow Tap! B3 — 动态 GM program 管道
 */

import { BandRole } from '../types';

// ============================================================
// defaultSound → GM program 直查表
// ============================================================

/**
 * MUSICIAN_POOL 中 defaultSound 用过的所有字符串都要在此表里。
 * 未列出的字符串走 `defaultSoundToGm` 的 0 兜底。
 */
export const DEFAULT_SOUND_TO_GM: Record<string, number> = {
    'Acoustic_Grand':        0,
    'Bright_Acoustic':       1,
    'Electric_Grand':        2,
    'Honky_Tonk':            3,
    'EP1_Rhodes':            4,
    'EP2_Chorus':            5,
    'Harpsichord':           6,
    'Clav':                  7,
    'Celesta':               8,
    'Glockenspiel':          9,
    'Music_Box':            10,
    'Vibraphone':           11,
    'Marimba':              12,
    'Xylophone':            13,
    // Bass family (32-39)
    'Acoustic_Bass':        32,
    'Electric_Bass_Finger': 33,
    'Electric_Bass_Picked': 34,
    'Fretless_Bass':        35,
    'Electric_Bass_Slap':   36,
    'Slap_Bass_2':          37,
    'Synth_Bass_1':         38,
    'Synth_Bass_2':         39,
    // Drums (channel 9 — program 字节 = kit id)
    'Drums':                 0,  // GM Standard Kit
    'Brush_Kit':            40,  // GM2 Brush Kit
    'Room_Kit':              8,
    'Power_Kit':            16,
    'Electronic_Kit':       24,
    'Orchestra_Kit':        48,
    // Pad family (88-95)
    'New_Age_Pad':          88,
    'Warm_Pad':             89,
    'Polysynth':            90,
    'Choir_Pad':            91,
    'Bowed_Pad':            92,
    'Metallic_Pad':         93,
    'Halo_Pad':             94,
    'Sweep_Pad':            95,
};

/**
 * 兜底解析：默认 0（GM Acoustic Grand Piano），保证未知字符串不会让 MidiConverter 发负数。
 */
export function defaultSoundToGm(soundName: string | undefined): number {
    if (soundName === undefined) return 0;
    const v = DEFAULT_SOUND_TO_GM[soundName];
    return v !== undefined ? v : 0;
}

// ============================================================
// 同家族音色列表（UI 下拉用，B2 消费）
// ============================================================

export interface GMSlotOption {
    /** GM program number（0~127） */
    id: number;
    /** UI 显示名 */
    name: string;
}

/**
 * Musician.instrumentRef 字符串 → 该家族下用户可选的 GM 程式号列表。
 *
 * 设计原则：
 *   - 钢琴家族：包括 Grand / EP / 同音色块的 Music Box / Vibraphone / Marimba（音色家族近似）
 *   - 贝斯家族：GM 32-39 全部
 *   - 鼓家族：GM2 兼容的 kit id（Standard / Room / Power / Brush / Orchestra）
 *   - Pad 家族：GM 88-95 全部
 *
 * 第一项一般是 musician.defaultSound 对应的 GM，UI 默认选第一项。
 */
export const INSTRUMENT_FAMILY_MAP: Record<string, ReadonlyArray<GMSlotOption>> = {
    'grand_piano': [
        { id: 0,  name: 'Acoustic Grand' },
        { id: 1,  name: 'Bright Acoustic' },
        { id: 2,  name: 'Electric Grand' },
        { id: 3,  name: 'Honky-tonk' },
        { id: 4,  name: 'EP1 (Rhodes)' },
        { id: 5,  name: 'EP2 (Chorus)' },
        { id: 6,  name: 'Harpsichord' },
        { id: 7,  name: 'Clavinet' },
        { id: 8,  name: 'Celesta' },
        { id: 9,  name: 'Glockenspiel' },
        { id: 10, name: 'Music Box' },
        { id: 11, name: 'Vibraphone' },
        { id: 12, name: 'Marimba' },
        { id: 13, name: 'Xylophone' },
    ],
    'electric_bass': [
        { id: 32, name: 'Acoustic Bass' },
        { id: 33, name: 'Fingered Bass' },
        { id: 34, name: 'Picked Bass' },
        { id: 35, name: 'Fretless Bass' },
        { id: 36, name: 'Slap Bass 1' },
        { id: 37, name: 'Slap Bass 2' },
        { id: 38, name: 'Synth Bass 1' },
        { id: 39, name: 'Synth Bass 2' },
    ],
    'drum_kit': [
        { id: 0,  name: 'Standard Kit' },
        { id: 8,  name: 'Room Kit' },
        { id: 16, name: 'Power Kit' },
        { id: 24, name: 'Electronic Kit' },
        { id: 40, name: 'Brush Kit' },
        { id: 48, name: 'Orchestra Kit' },
    ],
    'warm_pad': [
        { id: 88, name: 'New Age Pad' },
        { id: 89, name: 'Warm Pad' },
        { id: 90, name: 'Polysynth' },
        { id: 91, name: 'Choir Pad' },
        { id: 92, name: 'Bowed Pad' },
        { id: 93, name: 'Metallic Pad' },
        { id: 94, name: 'Halo Pad' },
        { id: 95, name: 'Sweep Pad' },
    ],
};

/**
 * 取乐器家族列表；未知 instrumentRef → 空数组。
 */
export function getInstrumentFamily(instrumentRef: string | undefined): ReadonlyArray<GMSlotOption> {
    if (instrumentRef === undefined) return [];
    return INSTRUMENT_FAMILY_MAP[instrumentRef] ?? [];
}

// ============================================================
// ArrangedTrack 程式覆盖键（B3 用）
// ============================================================

/**
 * BandRole → ArrangedTrack 内对应轨道的"程式覆盖 key"。
 *
 * 设计：
 *   - MainInst   → 'melody'           （主旋律通道）
 *   - Accomp     → 'pianoRH' + 'pianoLH'（钢琴双通道共享同一 musician 同一程式）
 *   - Bass       → 'electricBass'
 *   - Drums      → 'drums'            （channel 9，program 字节 = kit id）
 *   - Atmosphere → 'atmosphere'
 *
 * Vocal 暂无 track（项目无 VocalIdiom），不映射。
 */
export type GmProgramTrackKey =
    | 'melody'
    | 'pianoRH'
    | 'pianoLH'
    | 'drums'
    | 'atmosphere'
    | 'electricBass';

/**
 * 返回 role 对应的所有 track key（accomp 返回 2 个，其他返回 1 个）。
 * 未列出的 role（Vocal）返回空数组。
 */
export function bandRoleToTrackKeys(role: BandRole): ReadonlyArray<GmProgramTrackKey> {
    switch (role) {
        case BandRole.MainInst:   return ['melody'];
        case BandRole.Accomp:     return ['pianoRH', 'pianoLH'];
        case BandRole.Bass:       return ['electricBass'];
        case BandRole.Drums:      return ['drums'];
        case BandRole.Atmosphere: return ['atmosphere'];
        default:                  return [];
    }
}
