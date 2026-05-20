// ============================================================
// CONSTITUTION CHAPTER I — DO NOT BREAK
// ============================================================
//
// 本文件定义音乐生成引擎的核心 IR（Intermediate Representation）。
// 这是引擎所有模块共享的"宪法第一章"——任何模块（Composer / Casting / Phrase /
// Realizer / Reconciler / Conductor）都消费或产出这些类型的实例。
//
// 修改纪律（重要）：
//   1. 这些 interface 的字段语义一旦稳定，新增字段必须可选（?），删除字段必须
//      跨整个引擎与 C 端移植同步评估。
//   2. 单位与坐标系是合约的一部分：
//        - pitch        : MIDI 半音 [0,127]，RELATIVE（未加 keyOffset），由 Conductor 最后一步转 ABSOLUTE
//        - onset / beat : 拍（float），从段落或乐曲起点计
//        - velocity     : [0,1] float（C 端折算到 0-127）
//   3. C++/ESP32 移植直接对照本文件——字段顺序与可选性会影响 struct 布局，
//      改动前请同步 sync-to-c 流程。
//   4. 不要在本文件引入运行时依赖（仅 `import type` 子类型），以避免与
//      types.ts 形成运行时循环。
//
// 类型清单：
//   - NoteData         : 所有音符渲染的通用容器（8+ 模块消费）
//   - GeneratedChord   : 和弦元数据（6+ 模块消费）
//   - SectionMetadata  : 段落结构（5+ 模块消费）
//   - MusicContext     : 运行时上下文（贯穿全管线 + MidiConverter）
//
// 转发的"乐器无关"IR(Phase 3a 新增,详见 ./harmonic-skeleton.ts):
//   - HarmonicChord / HarmonicSkeleton / CadencePoint / TensionTone
//
// 不在本文件的"近 IR"类型（仍在 types.ts，未来视需要再升格）：
//   GeneratedTrack / ArrangedTrack / TerminalSymbol / ContourSpec / Tonality 枚举等
// ============================================================

export type {
    HarmonicChord,
    HarmonicSkeleton,
    CadencePoint,
    TensionTone,
} from './harmonic-skeleton';

import type {
    ChordQuality,
    SectionType,
    ContourSpec,
    Tonality,
    EnsembleDraft,
    StyleConfig,
    Musician,
} from '../types';

/**
 * C++ Porting Guide:
 * This interface maps directly to a C struct to avoid heap fragmentation:
 * struct NoteData {
 *   uint8_t pitch;       // 0-127
 *   uint8_t velocity;    // 0-127 (mapped from 0.0-1.0 float if needed)
 *   float onset;         // Beat position
 *   float duration;      // Beat length
 *   // Optional flags can be packed into a bitfield (uint8_t flags)
 * };
 */
export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; pitchBend?: number; pitchBendDuration?: number; fadeOutDuration?: number; isUserMotif?: boolean;
    /** Phase 6.2 observability — 由 PCFG motif define/recall 自动标记的动机身份标签。仅供 Q+H 监控面板可视化与调试，**不参与音频生成逻辑**。
     *  C 移植：const char*（指向 string intern 池）或 uint8_t enum index。可选字段，普通生成路径为 undefined。 */
    motifName?: string;
}

/**
 * 声部在和弦内的功能角色(Phase 1a 引入,Phase 1b 信息遮罩消费)。
 *
 * 用于 Conductor.computeChordMasks 按 bitmask 过滤 voice —— 例如 Intro
 * 强制 MASK_ROOT_ONLY,逐段落能量爬升解锁 Third/Fifth/Seventh/Extensions。
 *
 * **数值即 bit 偏移** — VoicingMask 用 `(mask >> role) & 1` 检测;
 * 改枚举值需同步更新 VoicingMask 常量定义。
 *
 * C 移植: enum class VoiceRole : uint8_t { ... } — 直接 reinterpret_cast。
 */
export enum VoiceRole {
    Root        = 0,
    Third       = 1,  // 3rd(major / minor / sus2 / sus4 视为 Third 槽位)
    Fifth       = 2,  // 5th(perfect / diminished / augmented)
    Seventh     = 3,  // 7th(m7 / M7 / dim7)
    Ninth       = 4,  // 9th(b9 / 9 / #9)
    Eleventh    = 5,  // 11th(11 / #11)
    Thirteenth  = 6,  // 13th(b13 / 13 / 6 占同槽位)
    Tension     = 7,  // 其他改变音 / 不在标准槽位的色彩音(b5 单独存在等)
}

/**
 * 角色标记 voicing 元素(Phase 1a)。
 *
 * 与裸 `number[]` 相比,携带 role 元数据让 Conductor 信息遮罩、
 * Reconciler 撞音裁决等下游模块按声部功能(而非按 MIDI pitch)做决策。
 *
 * C 移植:
 *   struct VoicedPitch {
 *       uint8_t pitch;       // 0-127, RELATIVE space
 *       uint8_t role;        // VoiceRole enum value
 *   };
 *   单条 voicing = VoicedPitch[max_voices](max_voices 通常 ≤ 7)。
 */
export interface VoicedPitch {
    /** MIDI pitch [0,127],RELATIVE 空间(未加 keyOffset) */
    pitch: number;
    /** 声部功能角色 */
    role: VoiceRole;
}

export interface GeneratedChord { numeral: string; root: number; quality: ChordQuality; startBeat: number; endBeat: number; keyOffset?: number; extensions?: string[]; isSignatureEnding?: boolean; bassOverride?: number;
    /** HarmonyCore 输出的声部分布 — Pitch Space: RELATIVE，升序 MIDI（AbsoluteTransposer/AudioEngine 再加 keyOffset） */
    voicing?: number[];
    /**
     * Phase 1a — 角色标记 voicing(VoicedPitch[]),与 voicing 平行,顺序一致。
     *
     * - voicing[i].pitch === voicingTagged[i].pitch(对账保证)
     * - role 来自 VoicingProcessor 构造时的语义知识(buildShellLH 知道哪个是 root / 哪个是 7th)
     * - Phase 1b VoicingMask 消费本字段做 bitmask 过滤,voicing(number[])保留作 fallback
     *
     * 可选(向后兼容):未升级的旧路径仍可只读 voicing。Phase 1b 起 Idiom 优先读 voicingTagged。
     */
    voicingTagged?: VoicedPitch[];
}

export interface SectionMetadata {
    name: string;
    startBeat: number;
    endBeat: number;
    energyLevel: number;
    grooveDNA?: number[]; // 🌟 这个极为重要：每一段将拥有自己独立的 Groove
    endingType?: 'hard_stop' | 'fade_out'; // 🌟 决定结尾的收尾方式
    localKeyOffset?: number; // 🌟 局部转调偏移量 (Local Key Offset)

    // 🌟 P2: 律动比例控制器 (Groove Ratio Controller)
    grooveRatio?: {
        foundation: number; // Bass & Kick
        comping: number;    // Piano & Guitar
        color: number;      // Synth & Strings
    };

    sectionType?: SectionType; // 🌟 数值枚举，替代 name.includes() 字符串匹配

    /** Pipeline 注入：本段期望的和弦数。
     *  MacroProgressionEngine 优先消费此值；缺省时回落到 input.chordsPerSection（默认 4）。
     *  Cadential Hijacking 需要 ≥ 2（半终止 c=chordsPer-2 / 全终止 c=chordsPer-1），
     *  Engine 内部用 Math.max(2, ...) 钳制下限。*/
    chordsHint?: number;

    /** Phrase contour hint — 缺省时 PhraseContourPlanner 按 sectionType 查表。 */
    contour?: ContourSpec;
}

export interface MusicContext {
    keyOffset: number;
    tonality: Tonality;
    bpm: number;
    timeSignature: [number, number];
    grooveDNA: number[];
    ensemble?: EnsembleDraft;
    style?: StyleConfig;
    /** 5 槽位实际就位的乐手数组（缺槽 = 不在数组里）— AbsoluteTransposer 按 role 过滤生成轨 */
    band?: Musician[];
    /**
     * B3：动态 GM 程式覆盖（0~127），由 runPipeline 根据 forcedGmPrograms + musician.gmProgramOverride + defaultSound 计算。
     * AbsoluteTransposer 透传到 ArrangedTrack.gmProgramOverrides，再由 MidiConverter 消费。
     */
    gmProgramOverrides?: {
        melody?: number;
        pianoRH?: number;
        pianoLH?: number;
        drums?: number;
        atmosphere?: number;
        electricBass?: number;
    };
}
