/**
 * BassWalkPatterns — LH Walking 字母语法配方库（改动 B）
 *
 * 把 ImproVisor BassPattern.applyRules 的 B/5/3/A/N/= 字母语法移植到 TS，
 * 让不同 mood × style 的 LH walking 有差异化听感（爵士四分 vs 拉丁 8th tumbao
 * vs Country boom-chick vs Dreamy pedal）。
 *
 * 与 ImproVisor 对照（doc:2455 BassPattern.applyRules）：
 *   B    → BASS：当前和弦根音
 *   5    → 第 5 度（interval=5 in ImproVisor scale lookup）
 *   3    → 第 3 度（major/minor 跟着 chord quality 决定）
 *   A    → APPROACH：下个和弦根音 ±1 半音邻
 *   N    → NEXT：下个和弦根音
 *   =    → EQUAL：重复上一个 bass pitch（节奏复读，不换音）
 *
 * 改动 F 已新增：
 *   C → 确定性 chord-tone（用 chordIndex * 31 + stepIdx * 17 hash 抽 getChordTonePCs 的 PC）
 *   S → 确定性 scale-tone（chord-tone + 2nd + 6th 池，hash 同上）
 *
 * 暂未移植（留给后续 iteration）：
 *   U/D → 强制方向（当前所有 step 走 placeBassNear 最近原则）
 *
 * 约束遵从：
 *   T-1：WalkPatternId / WalkRule 数值枚举
 *   P-1：纯数据 + frozen array，无 Map/Set
 *   D-1：零 PRNG（确定性 step 序列）
 *   C 移植：定长 steps + 整数索引，可直接转 C const array
 *
 * @author AuraFlow Tap! Piano Texture Renaissance — 改动 B
 */

/**
 * WalkRule — 单步选音规则（T-1 数值枚举）
 *
 * 数值含义与 ImproVisor ruleTypes 索引对齐（B=1, 5=5, 3=3, A=10, N=11, EQUAL=12），
 * 但不直接复用 ImproVisor 的常量（避免引入 Java 文化依赖）。
 */
export enum WalkRule {
    /** B — 根音 */
    Root        = 1,
    /** 3 — 第 3 度（依 chord quality 决定 major/minor） */
    Third       = 3,
    /** 5 — 第 5 度（perfect 5th） */
    Fifth       = 5,
    /** A — Approach：下一和弦根音 ±1 半音邻（默认下邻 -1 半音） */
    Approach    = 10,
    /** N — Next：下一和弦根音（提前切入感） */
    NextRoot    = 11,
    /** = — 重复上一个 bass pitch（节奏复读） */
    Repeat      = 12,
    /** C — Chord Tone：确定性抽 chord-tone PC（用 chordIndex+stepIdx hash） */
    ChordTone   = 13,
    /** S — Scale Tone：确定性抽 scale-tone PC（chord-tone + 2nd + 6th 色彩池） */
    ScaleTone   = 14,
}

/** 单步规则 + 时值 */
export interface WalkStep {
    rule: WalkRule;
    /** 该步占多少拍（1=quarter, 0.5=8th, 2=half, 4=whole） */
    durationBeats: number;
}

/**
 * Pattern ID（T-1 数值枚举）— 索引必须与 WALK_PATTERNS 数组一一对应。
 *
 * 命名规则：风格 + 节奏密度。索引 0 是兜底/向后兼容的"经典爵士四分"。
 */
export enum WalkPatternId {
    /** 索引 0 — 经典爵士四分：B 5 B A（4 拍循环，等价旧 renderLHWalkingTenths 默认） */
    JazzQuarter      = 0,
    /** 索引 1 — Half Note：B(2) 5(2) — Bill Evans 风慢 walking，半音符律动 */
    HalfNote         = 1,
    /** 索引 2 — Stride：B 5 B 5 — Country / Boogie / Stride 风四拍 root-5 交替（无 approach） */
    Stride           = 2,
    /** 索引 3 — Pedal：B = = = — 持续根音 4 拍，Dreamy / 抒情段适用 */
    Pedal            = 3,
    /** 索引 4 — Latin Tumbao 8th：B(.5) =(.5) 5(.5) =(.5) N(.5) =(.5) 5(.5) =(.5) — 8th 推进切分 */
    LatinTumbao      = 4,
    /** 索引 5 — Quarter+Half：B 5(2) A — root + 半音符 5 度 + approach，紧凑爵士变形 */
    QuarterHalf      = 5,
    /** 索引 6 — Bebop Walk：B C 5 A — chord-tone 插在 root/5 之间，制造爵士摇摆 */
    BebopWalk        = 6,
    /** 索引 7 — Scale Climb：B S S A — 中间两拍走 scale tone，制造上下行色彩 */
    ScaleClimb       = 7,
}

// ============================================================
// Pattern 数据表（索引 = WalkPatternId 数值）
// ============================================================

const STEPS_JAZZ_QUARTER: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,     durationBeats: 1 },
    { rule: WalkRule.Fifth,    durationBeats: 1 },
    { rule: WalkRule.Root,     durationBeats: 1 },
    { rule: WalkRule.Approach, durationBeats: 1 },
]);

const STEPS_HALF_NOTE: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,  durationBeats: 2 },
    { rule: WalkRule.Fifth, durationBeats: 2 },
]);

const STEPS_STRIDE: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,  durationBeats: 1 },
    { rule: WalkRule.Fifth, durationBeats: 1 },
    { rule: WalkRule.Root,  durationBeats: 1 },
    { rule: WalkRule.Fifth, durationBeats: 1 },
]);

const STEPS_PEDAL: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,   durationBeats: 1 },
    { rule: WalkRule.Repeat, durationBeats: 1 },
    { rule: WalkRule.Repeat, durationBeats: 1 },
    { rule: WalkRule.Repeat, durationBeats: 1 },
]);

const STEPS_LATIN_TUMBAO: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,     durationBeats: 0.5 },
    { rule: WalkRule.Repeat,   durationBeats: 0.5 },
    { rule: WalkRule.Fifth,    durationBeats: 0.5 },
    { rule: WalkRule.Repeat,   durationBeats: 0.5 },
    { rule: WalkRule.NextRoot, durationBeats: 0.5 },
    { rule: WalkRule.Repeat,   durationBeats: 0.5 },
    { rule: WalkRule.Fifth,    durationBeats: 0.5 },
    { rule: WalkRule.Repeat,   durationBeats: 0.5 },
]);

const STEPS_QUARTER_HALF: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,     durationBeats: 1 },
    { rule: WalkRule.Fifth,    durationBeats: 2 },
    { rule: WalkRule.Approach, durationBeats: 1 },
]);

const STEPS_BEBOP_WALK: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,      durationBeats: 1 },
    { rule: WalkRule.ChordTone, durationBeats: 1 },
    { rule: WalkRule.Fifth,     durationBeats: 1 },
    { rule: WalkRule.Approach,  durationBeats: 1 },
]);

const STEPS_SCALE_CLIMB: ReadonlyArray<WalkStep> = Object.freeze([
    { rule: WalkRule.Root,      durationBeats: 1 },
    { rule: WalkRule.ScaleTone, durationBeats: 1 },
    { rule: WalkRule.ScaleTone, durationBeats: 1 },
    { rule: WalkRule.Approach,  durationBeats: 1 },
]);

/** Pattern 完整描述 */
export interface WalkPattern {
    id: WalkPatternId;
    name: string;
    steps: ReadonlyArray<WalkStep>;
    /** sum(steps[].durationBeats)，校验用 */
    totalBeats: number;
}

/**
 * Pattern 索引表 — 索引 = WalkPatternId 数值。
 *
 * 消费方约定：用 `WALK_PATTERNS[id]` 直接取，零运行期查找开销。
 */
export const WALK_PATTERNS: ReadonlyArray<WalkPattern> = Object.freeze([
    Object.freeze({ id: WalkPatternId.JazzQuarter, name: 'Jazz Quarter',  steps: STEPS_JAZZ_QUARTER, totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.HalfNote,    name: 'Half Note',     steps: STEPS_HALF_NOTE,    totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.Stride,      name: 'Stride',        steps: STEPS_STRIDE,       totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.Pedal,       name: 'Pedal',         steps: STEPS_PEDAL,        totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.LatinTumbao, name: 'Latin Tumbao',  steps: STEPS_LATIN_TUMBAO, totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.QuarterHalf, name: 'Quarter+Half',  steps: STEPS_QUARTER_HALF, totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.BebopWalk,   name: 'Bebop Walk',    steps: STEPS_BEBOP_WALK,   totalBeats: 4 }),
    Object.freeze({ id: WalkPatternId.ScaleClimb,  name: 'Scale Climb',   steps: STEPS_SCALE_CLIMB,  totalBeats: 4 }),
]);

/**
 * 安全取 pattern — 索引越界回落到 JazzQuarter（最稳的兜底）。
 */
export function getWalkPattern(id: WalkPatternId): WalkPattern {
    const p = WALK_PATTERNS[id];
    return p !== undefined ? p : WALK_PATTERNS[WalkPatternId.JazzQuarter];
}
