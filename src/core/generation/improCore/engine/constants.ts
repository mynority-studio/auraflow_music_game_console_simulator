// ============================================================
// ImproCore engine — Constants
// imp/Constants.java 的忠实移植(生成路径子集)
// ============================================================
//
// 时间轴地基:Impro-Visor 用 "slot" 计量时长。
//   BEAT  = 120 slots  (一拍)
//   WHOLE = 480 slots  (全音符 = 4 拍, 即 4/4 一小节)
//
// 与发声层的桥接:
//   MidiScheduler 用 PPQ = 480 ticks / 四分音符。
//   Impro-Visor   QUARTER = 120 slots / 四分音符。
//   ∴ ticks = slots × 4 (SLOT_TO_TICK)。干净 4 倍,无取整误差。
//
// 注:本文件先落生成路径要用的核心常量,随 Note/Terminals 移植再扩。
// ============================================================

/** 一拍的 slot 数 */
export const BEAT = 120;

/** 全音符 = 4 拍 = 4/4 一小节 */
export const WHOLE = 480;
export const HALF = WHOLE / 2;            // 240
export const QUARTER = WHOLE / 4;         // 120
export const EIGHTH = WHOLE / 8;          // 60
export const SIXTEENTH = WHOLE / 16;      // 30
export const THIRTYSECOND = WHOLE / 32;   // 15

/** 三连音相关(Constants.java) */
export const THIRD_BEAT = 40;
export const HALF_BEAT = 60;
export const SIXTH_BEAT = 20;

/** 默认 4/4 一小节的 slot 长度 */
export const MEASURE_LENGTH = WHOLE;       // 480

/** 无显式时值时的默认(Constants.DEFAULT_DURATION = BEAT/2 = 八分音符) */
export const DEFAULT_DURATION = BEAT / 2;  // 60

/** rest 的 pitch 哨兵值(MelodyPart.getPitch() 对 rest 返回 -1) */
export const REST = -1;

// ------------------------------------------------------------
// 音高
// ------------------------------------------------------------

/** 一个八度的半音数 */
export const OCTAVE = 12;

/** 中央 C 的 MIDI 值(NoteSymbol octave 0 的基准) */
export const CMIDI = 60;

// ------------------------------------------------------------
// slot ↔ MidiScheduler tick 换算
// ------------------------------------------------------------

/** ticks = slots × 4 */
export const SLOT_TO_TICK = 4;

/** Impro-Visor slot → MidiScheduler tick */
export const slotsToTicks = (slots: number): number => slots * SLOT_TO_TICK;

/** MidiScheduler tick → Impro-Visor slot */
export const ticksToSlots = (ticks: number): number => ticks / SLOT_TO_TICK;
