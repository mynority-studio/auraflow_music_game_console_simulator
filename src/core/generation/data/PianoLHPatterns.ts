// ============================================================
// PianoLHPatterns — 钢琴左手专属习语库
// ============================================================
//
// 出处:melodygenerative basslineRules.ts 的 BASS_PATTERN_RULES(stride /
// boogie / dilla 等),但**针对钢琴 LH 做了重新设计** — 钢琴左手的演奏语汇
// 跟电贝斯不同:
//   - 钢琴可单音 + 双音 + 横跨多八度
//   - 钢琴 LH 历史习语成型(古典 Alberti / 摇摆 Stride / 蓝调 Boogie),
//     比"walking quarter"更具体
//
// 与 BassWalkPatterns 的区别:
//   - BassWalkPatterns 是"贝斯走法"(WalkRule 字母语法 B/5/3/A/N/C/S)—
//     给电贝斯单声部线条用,Solo Piano 临时复用
//   - PianoLHPatterns 是"钢琴 LH 习语"(固定 step grid + 多音支持)—
//     真正的钢琴左手语汇
//
// 5 个初始 pattern(覆盖 Solo Piano 的主要场景):
//
//   1. Alberti       — 古典 1-5-3-5 八分循环(每 step 0.5 拍单音)
//   2. Stride        — 摇摆/ragtime LH:重拍 low root + 反拍 mid chord-shell
//   3. BoogieEighth  — 蓝调 1-3-5-6-b7-6-5-3 八分滚动(Otis Spann / Mose Allison)
//   4. OpenTenthArp  — 古典慢乐章:root 低八度 + 5 度 + 10 度(M3 上一八度),稀疏
//   5. PedalPoint    — 持续低音 root,极简(适合 dreamy / ambient)
//
// 消费方(Batch 1 暂不接,Batch 4 接 PianoAccompIdiom):
//   - PianoAccompIdiom.renderLHPianoPattern(Batch 4 新增渲染函数)
//   - CastingEngine 在 Solo Piano + 特定 mood 路由到 pianoLhPatternId
//
// 默认 roster 含 frank_bass(bassActive=true)→ Solo Piano 路径不触发 →
// golden-seed bit-exact(本批数据 + 渲染对默认配置零影响)。
//
// 零 PRNG(完全确定性 grid)。
// 依赖:types.ts(ChordQuality / CHORD_INTERVALS / CHORD_SCALE_INTERVALS)。
//
// Cross-sync:依赖 ChordQuality enum 数值(§1.4 已涵盖)。
// ============================================================

import { ChordQuality, CHORD_INTERVALS, CHORD_SCALE_INTERVALS } from '../types';

// ============================================================
// 数值枚举
// ============================================================

/** 5 个初始 pattern,索引必须与 PIANO_LH_PATTERNS 数组对应 */
export enum PianoLHPatternId {
    Alberti       = 0,
    Stride        = 1,
    BoogieEighth  = 2,
    OpenTenthArp  = 3,
    PedalPoint    = 4,
}

export const PianoLHPatternCount = 5;

export const PianoLHPatternName: ReadonlyArray<string> = Object.freeze([
    'Alberti', 'Stride', 'BoogieEighth', 'OpenTenthArp', 'PedalPoint',
]);

/**
 * 音级符号 — 描述 LH pattern step 想弹的"chord 内某个音"。
 *
 * 不直接用 interval 数字,因为同一个"3 度"在 major / minor / dim chord 上
 * 是不同 interval(4 / 3 / 3)。render 函数根据 chord.quality 查 CHORD_INTERVALS
 * / CHORD_SCALE_INTERVALS 自动 resolve。
 */
export enum LHTone {
    /** 和弦根音 */
    Root         = 0,
    /** 和弦三音(major chord = M3,minor chord = m3,自适应) */
    ChordThird   = 1,
    /** 和弦五音(P5;dim 是 b5;aug 是 #5) */
    ChordFifth   = 2,
    /** 和弦七音(b7 / M7,按 chord type;无 7 音时退回 Root) */
    ChordSeventh = 3,
    /** 和弦 scale 的二度音(查 CHORD_SCALE_INTERVALS) */
    ScaleSecond  = 4,
    /** 和弦 scale 的六度音(适合 blues / boogie 的 6) */
    ScaleSixth   = 5,
    /** 强制 b7(忽略 chord quality,blues / boogie 风) */
    ForceFlat7   = 6,
}

// ============================================================
// 接口
// ============================================================

/**
 * 单 step 的 LH 演奏单元。
 *
 * - tones 数组 — 空表示该 step 不发声;单元素表示单音;多元素表示同时齐砸(stride 反拍)
 * - octaveShift 半音偏移:-12 = 低八度,0 = 同八度,+12 = 高一八度(大十度位置)
 * - duration 拍单位(0.5 = 八分音符,1.0 = 四分音符,2.0 = 二分音符)
 * - velocityScale [0..1] — 乘到 params.velocityRange 上
 */
export interface PianoLHStep {
    tones: ReadonlyArray<LHTone>;
    octaveShift: number;
    duration: number;
    velocityScale: number;
}

export interface PianoLHPattern {
    id: PianoLHPatternId;
    name: string;
    /**
     * 16-step grid(对应 4/4 一小节,每 step = 16 分音符)。
     * null 表示该 step 静音 / 等待上个击点 sustain 过来。
     */
    steps: ReadonlyArray<PianoLHStep | null>;
}

// ============================================================
// 5 个 pattern 定义
// ============================================================
//
// step 编号(4/4 16-step):
//   step:   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   beat:   1     &  e  2     &  e  3     &  e  4     &  e
//

const STEP_REST: PianoLHStep | null = null;

// 内联工具:简化 step 构造
const single = (tone: LHTone, oct: number, dur: number, vel: number): PianoLHStep =>
    Object.freeze({ tones: Object.freeze([tone]), octaveShift: oct, duration: dur, velocityScale: vel });
const multi = (tones: ReadonlyArray<LHTone>, oct: number, dur: number, vel: number): PianoLHStep =>
    Object.freeze({ tones: Object.freeze(tones.slice()), octaveShift: oct, duration: dur, velocityScale: vel });

/**
 * 1. Alberti — 古典 1-5-3-5 循环(每 step 0.5 拍单音)
 *
 * 18 世纪 Alberti 兄弟首创,Mozart / Haydn 钢琴奏鸣曲常见。LH 在低八度循环
 * 弹四个音(根-五-三-五),给 RH 旋律留出干净空间。
 */
const PATTERN_ALBERTI: ReadonlyArray<PianoLHStep | null> = Object.freeze([
    single(LHTone.Root,       -12, 0.5, 0.85),  // step 0
    STEP_REST,                                   // step 1
    single(LHTone.ChordFifth, -12, 0.5, 0.7),   // step 2
    STEP_REST,                                   // step 3
    single(LHTone.ChordThird, -12, 0.5, 0.7),   // step 4
    STEP_REST,                                   // step 5
    single(LHTone.ChordFifth, -12, 0.5, 0.7),   // step 6
    STEP_REST,                                   // step 7
    single(LHTone.Root,       -12, 0.5, 0.8),   // step 8
    STEP_REST,                                   // step 9
    single(LHTone.ChordFifth, -12, 0.5, 0.7),   // step 10
    STEP_REST,                                   // step 11
    single(LHTone.ChordThird, -12, 0.5, 0.7),   // step 12
    STEP_REST,                                   // step 13
    single(LHTone.ChordFifth, -12, 0.5, 0.7),   // step 14
    STEP_REST,                                   // step 15
]);

/**
 * 2. Stride — 摇摆/ragtime LH:重拍 low root + 反拍 mid chord-shell
 *
 * James P. Johnson / Fats Waller / Art Tatum 时代的钢琴 LH。重拍跳到低八度
 * 弹根音(或五音),反拍跳回中音区弹 [3, 5] 双音"chord-stab"。需要一双"飞翔的左手"。
 *
 * 在 stride pattern 里:
 *   - step 0/8(每小节 beat 1/3):root 低八度单音
 *   - step 4/12(beat 2/4):fifth 低八度单音(也可 root 变化)
 *   - step 2/6/10/14(反拍):chord-shell [3, 5] 同八度双音
 */
const PATTERN_STRIDE: ReadonlyArray<PianoLHStep | null> = Object.freeze([
    single(LHTone.Root,        -12, 0.5, 0.95),                              // step 0
    STEP_REST,                                                                // step 1
    multi([LHTone.ChordThird, LHTone.ChordFifth], 0, 0.5, 0.75),             // step 2
    STEP_REST,                                                                // step 3
    single(LHTone.ChordFifth,  -12, 0.5, 0.85),                              // step 4
    STEP_REST,                                                                // step 5
    multi([LHTone.ChordThird, LHTone.ChordFifth], 0, 0.5, 0.75),             // step 6
    STEP_REST,                                                                // step 7
    single(LHTone.Root,        -12, 0.5, 0.95),                              // step 8
    STEP_REST,                                                                // step 9
    multi([LHTone.ChordThird, LHTone.ChordFifth], 0, 0.5, 0.75),             // step 10
    STEP_REST,                                                                // step 11
    single(LHTone.ChordFifth,  -12, 0.5, 0.85),                              // step 12
    STEP_REST,                                                                // step 13
    multi([LHTone.ChordThird, LHTone.ChordFifth], 0, 0.5, 0.75),             // step 14
    STEP_REST,                                                                // step 15
]);

/**
 * 3. BoogieEighth — 蓝调 1-3-5-6-b7-6-5-3 八分滚动
 *
 * Otis Spann / Mose Allison / Memphis Slim 时代的 boogie woogie LH。八分音符
 * 连续滚动,音程级序 1→3→5→6→b7→6→5→3 在低八度循环。6 / b7 是 chord-scale
 * 内的音(对 dom7 = M6 + b7;对 maj 三和弦 = M6 + ScaleFlat7 强制蓝调味)。
 */
const PATTERN_BOOGIE_EIGHTH: ReadonlyArray<PianoLHStep | null> = Object.freeze([
    single(LHTone.Root,        -12, 0.5, 0.9),   // step 0
    STEP_REST,                                    // step 1
    single(LHTone.ChordThird,  -12, 0.5, 0.78),  // step 2
    STEP_REST,                                    // step 3
    single(LHTone.ChordFifth,  -12, 0.5, 0.85),  // step 4
    STEP_REST,                                    // step 5
    single(LHTone.ScaleSixth,  -12, 0.5, 0.78),  // step 6
    STEP_REST,                                    // step 7
    single(LHTone.ForceFlat7,  -12, 0.5, 0.85),  // step 8
    STEP_REST,                                    // step 9
    single(LHTone.ScaleSixth,  -12, 0.5, 0.78),  // step 10
    STEP_REST,                                    // step 11
    single(LHTone.ChordFifth,  -12, 0.5, 0.85),  // step 12
    STEP_REST,                                    // step 13
    single(LHTone.ChordThird,  -12, 0.5, 0.78),  // step 14
    STEP_REST,                                    // step 15
]);

/**
 * 4. OpenTenthArp — 古典慢乐章左手开放琶音
 *
 * Beethoven / Chopin 慢板乐章常见 LH:稀疏的 root + 5 + 10(= M3 上一八度)。
 * 跨度极大(大十度),给 RH 留足空间。节奏不强,适合 lush 段落。
 *
 *   step 0  (beat 1):    root 低八度
 *   step 6  (beat 2.5):  fifth 同八度
 *   step 12 (beat 4):    chord-third 上一八度(= 10 度位置)
 */
const PATTERN_OPEN_TENTH: ReadonlyArray<PianoLHStep | null> = Object.freeze([
    single(LHTone.Root,        -12, 1.5, 0.9),   // step 0,sustain 1.5 拍
    STEP_REST, STEP_REST, STEP_REST,              // step 1-3
    STEP_REST, STEP_REST,                         // step 4-5
    single(LHTone.ChordFifth,    0, 1.5, 0.72),  // step 6,sustain 1.5 拍
    STEP_REST, STEP_REST, STEP_REST,              // step 7-9
    STEP_REST, STEP_REST,                         // step 10-11
    single(LHTone.ChordThird,   12, 1.0, 0.68),  // step 12,上八度(10 度位置)
    STEP_REST, STEP_REST, STEP_REST,              // step 13-15
]);

/**
 * 5. PedalPoint — 持续低音根音(整 bar 一击)
 *
 * 极简,适合 dreamy / ambient 段。root 低八度持续 4 拍。RH 自由发挥。
 */
const PATTERN_PEDAL_POINT: ReadonlyArray<PianoLHStep | null> = Object.freeze([
    single(LHTone.Root, -12, 4.0, 0.85),  // step 0,sustain 整 bar
    STEP_REST, STEP_REST, STEP_REST,       // step 1-3
    STEP_REST, STEP_REST, STEP_REST, STEP_REST,  // step 4-7
    STEP_REST, STEP_REST, STEP_REST, STEP_REST,  // step 8-11
    STEP_REST, STEP_REST, STEP_REST, STEP_REST,  // step 12-15
]);

// ============================================================
// 主表
// ============================================================

/** 索引 = PianoLHPatternId 数值,顺序锁定(C 移植直接做下标) */
export const PIANO_LH_PATTERNS: ReadonlyArray<PianoLHPattern> = Object.freeze([
    Object.freeze({ id: PianoLHPatternId.Alberti,      name: 'Alberti',       steps: PATTERN_ALBERTI }),
    Object.freeze({ id: PianoLHPatternId.Stride,       name: 'Stride',        steps: PATTERN_STRIDE }),
    Object.freeze({ id: PianoLHPatternId.BoogieEighth, name: 'BoogieEighth',  steps: PATTERN_BOOGIE_EIGHTH }),
    Object.freeze({ id: PianoLHPatternId.OpenTenthArp, name: 'OpenTenthArp',  steps: PATTERN_OPEN_TENTH }),
    Object.freeze({ id: PianoLHPatternId.PedalPoint,   name: 'PedalPoint',    steps: PATTERN_PEDAL_POINT }),
]);

/** 安全取 pattern — 越界回落 PedalPoint(最低风险默认) */
export function getPianoLHPattern(id: PianoLHPatternId): PianoLHPattern {
    const p = PIANO_LH_PATTERNS[id];
    return p !== undefined ? p : PIANO_LH_PATTERNS[PianoLHPatternId.PedalPoint];
}

// ============================================================
// LHTone → interval(相对 chord root)解析
// ============================================================

/**
 * 给定 chord.quality + LHTone,返回对应 interval 半音数(相对 chord root)。
 *
 * 解析规则:
 *   Root:         0
 *   ChordThird:   CHORD_INTERVALS[quality][1](注:CHORD_INTERVALS 的第二个元素一定是三度)
 *   ChordFifth:   CHORD_INTERVALS[quality][2](第三个元素是五度)
 *   ChordSeventh: CHORD_INTERVALS[quality][3](第四个元素是七度;若 chord 无 7 → fallback Root)
 *   ScaleSecond:  CHORD_SCALE_INTERVALS[quality][1]
 *   ScaleSixth:   CHORD_SCALE_INTERVALS[quality][5]
 *   ForceFlat7:   恒 10(忽略 chord quality)
 *
 * 找不到对应表项时(不应该发生)返回 0(root)兜底。
 */
export function resolveLHToneInterval(quality: ChordQuality, tone: LHTone): number {
    const chordIvs = CHORD_INTERVALS[quality];
    const scaleIvs = CHORD_SCALE_INTERVALS[quality];

    switch (tone) {
        case LHTone.Root:
            return 0;
        case LHTone.ChordThird:
            return chordIvs !== undefined && chordIvs.length > 1 ? chordIvs[1] : 4;
        case LHTone.ChordFifth:
            return chordIvs !== undefined && chordIvs.length > 2 ? chordIvs[2] : 7;
        case LHTone.ChordSeventh: {
            if (chordIvs !== undefined && chordIvs.length > 3) return chordIvs[3];
            return 0;  // 无 7 音 → fallback root
        }
        case LHTone.ScaleSecond:
            return scaleIvs !== undefined && scaleIvs.length > 1 ? scaleIvs[1] : 2;
        case LHTone.ScaleSixth:
            return scaleIvs !== undefined && scaleIvs.length > 5 ? scaleIvs[5] : 9;
        case LHTone.ForceFlat7:
            return 10;
        default:
            return 0;
    }
}
