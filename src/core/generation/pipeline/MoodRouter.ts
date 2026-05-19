/**
 * MoodRouter — 钢琴织体情绪路由器（Sub-Phase 3）
 *
 * 把 (styleId, tonality, bpm, sectionType, energyLevel, persona) 6 元组映射到
 * 8 个情绪桶 (MoodId)，再由 mood 决定：
 *   1. 选哪个 TextureRecipe（baseGrid + 推荐 rhTexture）
 *   2. 用哪条 4-bar phrase 算子链
 *
 * 设计哲学：
 *   - 纯函数 + 优先级查表（D-1 零 PRNG）
 *   - 第一个匹配的规则赢，无歧义
 *   - 兜底永远落到 Neutral（≡ Sub-Phase 2 通用剧本）
 *   - 不感知乐器细节（不知道钢琴是 Solo 还是 Ensemble，bassActive 由调用方处理）
 *
 * 与 Sub-Phase 2 的衔接：
 *   - PianoAccompIdiom 调用 buildOperatorChain(params.mood, barInPhrase)
 *     替换 getUniversalPhraseChain()
 *   - params.mood 缺省时 PianoAccompIdiom 仍回落到通用剧本（向后兼容）
 *
 * 约束遵从：
 *   T-1：MoodId 数值枚举，不用字符串
 *   T-3：纯类型 + readonly array，无 any
 *   P-1：mood → chain 用二维 frozen array 索引，无 Map/Set
 *   D-1：零 PRNG
 *   C 移植：MoodId × barInPhrase 是 8 × 4 = 32 个固定算子链，可直接转 const array
 *
 * @author AuraFlow Tap! Piano Texture Renaissance — Sub-Phase 3
 */

import { StyleId } from '../config/StyleFlags';
import {
    Tonality, SectionType, MusicianPersona,
} from '../types';
import { TextureRecipeId } from '../data/PianoTextureRecipes';
import { WalkPatternId } from '../data/BassWalkPatterns';
import {
    RhythmTopologyOp, TopologyOpKind,
    OP_ROTATE, OP_MIRROR, OP_DENSIFY, OP_DECIMATE,
    OP_VOICING_INVERT, OP_VOICING_OPEN,
} from '../primitives/RhythmTopologyMutator';

// ============================================================
// MoodId 枚举（T-1 数值）
// ============================================================

export enum MoodId {
    WarmIntimate  = 0,  // 抒情温暖（major + 慢）
    Melancholy    = 1,  // 忧伤（minor + 慢）
    UrgentTension = 2,  // 紧张推进（高 bpm + PreChorus/BuildUp）
    Triumphant    = 3,  // 高潮释放（Chorus/Drop + 高能量 + major）
    Groovy        = 4,  // 律动摇摆（NeoSoul/ChillJazz + 高 sync）
    Dreamy        = 5,  // 飘渺（Intro/Bridge + 高 sparsity）
    Dramatic      = 6,  // 戏剧张力（minor + 高能量）
    Neutral       = 7,  // 兜底（== Sub-Phase 2 通用剧本）
}

export const MoodCount = 8;

export const MoodName: ReadonlyArray<string> = Object.freeze([
    'WarmIntimate', 'Melancholy', 'UrgentTension', 'Triumphant',
    'Groovy', 'Dreamy', 'Dramatic', 'Neutral',
]);

// ============================================================
// pickMood — (context) → MoodId
// ============================================================

export interface MoodPickContext {
    styleId: StyleId;
    tonality: Tonality;
    bpm: number;
    sectionType: SectionType | undefined;
    energyLevel: number;
    persona: MusicianPersona;
}

// 调式阵营：用 bitmask 决定 "亮 / 暗"
// MAJOR_LIKE：Major / Major_Pentatonic / Lydian / Mixolydian
// MINOR_LIKE：剩下的（Minor / Minor_Pentatonic / Blues / Dorian / Melodic_Minor / Harmonic_Minor / Phrygian）
const TONALITY_MAJOR_LIKE_MASK =
    (1 << Tonality.Major) |
    (1 << Tonality.Major_Pentatonic) |
    (1 << Tonality.Lydian) |
    (1 << Tonality.Mixolydian);

function isMajorLike(tonality: Tonality): boolean {
    return (TONALITY_MAJOR_LIKE_MASK & (1 << tonality)) !== 0;
}

function isLushSection(s: SectionType | undefined): boolean {
    return s === SectionType.Intro
        || s === SectionType.Bridge
        || s === SectionType.Outro
        || s === SectionType.PreOutro
        || s === SectionType.Solo_Bridge;
}

function isPeakSection(s: SectionType | undefined): boolean {
    return s === SectionType.Chorus || s === SectionType.Drop;
}

function isBuildSection(s: SectionType | undefined): boolean {
    return s === SectionType.PreChorus || s === SectionType.BuildUp;
}

/**
 * 优先级 mood 决策表 — 第一个匹配的规则赢。
 *
 * 设计原则：sectionType 是**主轴**，其他维度（bpm/tonality/persona）做精修。
 *   - Intro 段单独路由（改动 G）：按 tonality/bpm/style/persona 派分
 *     Melancholy/WarmIntimate/Groovy，兜底 Dreamy；避免每首歌开头都退化为同一 mood
 *   - 其余 Lush 段（Bridge/Outro/PreOutro/Solo_Bridge）仍必落 Dreamy（mid-song 漂浮锚点）
 *   - Build 段（PreChorus/BuildUp）必落 UrgentTension
 *   - Peak 段（Chorus/Drop）按 tonality/style 派分 Triumphant/Dramatic/Groovy
 *   - Verse 按 bpm/tonality/style 派分 Groovy/Melancholy/WarmIntimate/Neutral
 *
 * 这保证同一首歌内不同段落的 mood 一定有差异（lush vs peak vs verse），
 * 而同 sectionType 段落（如多个 Verse）会保持一致 mood，符合音乐直觉。
 *
 * Intro 路由（改动 G）：
 *   - 暗调 + colorBias>0.5             → Melancholy （minor 浓色 intro）
 *   - 亮调 + bpm<90                    → WarmIntimate（慢 major 温柔 intro）
 *   - (NeoSoul|ChillJazz) + sync>0.4   → Groovy      （爵士/灵魂 sync intro）
 *   - 否则                             → Dreamy      （兜底"漂浮 intro"）
 */
export function pickMood(ctx: MoodPickContext): MoodId {
    const major = isMajorLike(ctx.tonality);

    // 改动 G — Intro 单独路由，吃 tonality/bpm/persona/style，避免开头千篇一律
    if (ctx.sectionType === SectionType.Intro) {
        if (!major && ctx.persona.colorBias > 0.5) return MoodId.Melancholy;
        if (major && ctx.bpm < 90) return MoodId.WarmIntimate;
        if ((ctx.styleId === StyleId.NeoSoul || ctx.styleId === StyleId.ChillJazz)
            && ctx.persona.syncopationAssault > 0.4) {
            return MoodId.Groovy;
        }
        return MoodId.Dreamy;
    }

    if (isLushSection(ctx.sectionType)) {
        return MoodId.Dreamy;
    }
    if (isBuildSection(ctx.sectionType)) {
        return MoodId.UrgentTension;
    }
    if (isPeakSection(ctx.sectionType)) {
        if (major && ctx.energyLevel >= 7) return MoodId.Triumphant;
        if (!major && ctx.energyLevel >= 6) return MoodId.Dramatic;
        if ((ctx.styleId === StyleId.NeoSoul || ctx.styleId === StyleId.ChillJazz)
            && ctx.persona.syncopationAssault > 0.4) {
            return MoodId.Groovy;
        }
        // Peak 段兜底（亮调低能量）→ WarmIntimate 表达温和高潮
        return major ? MoodId.WarmIntimate : MoodId.Melancholy;
    }
    // ---- 剩下：Verse 及其他未分类段（Break/Breakdown 等已被 ConductorMask 静音，这里走兜底）----
    if ((ctx.styleId === StyleId.NeoSoul || ctx.styleId === StyleId.ChillJazz)
        && ctx.persona.syncopationAssault > 0.4) {
        return MoodId.Groovy;
    }
    if (!major && ctx.bpm < 100) {
        return MoodId.Melancholy;
    }
    if (major && ctx.bpm < 90) {
        return MoodId.WarmIntimate;
    }
    return MoodId.Neutral;
}

// ============================================================
// moodToRecipe — (mood, styleId) → TextureRecipeId
// ============================================================
//
// 二维表：MOOD_RECIPE[mood][styleId] = TextureRecipeId
//
// 同 mood 在不同 style 下选不同 recipe（让 mood 在风格内有进一步差异化）。
//
// 行索引 = MoodId，列索引 = StyleId（ModernPop=0 / ChillJazz=1 / NeoSoul=2）。
// 缺省风格回落到 ModernPop 列。

// 改动 D：把 3 个 cell 切到 voicePattern 精化 recipe（Alberti / Montuno），让现有
// mood 路由直接产出"古典分解"和"拉丁推进"的真织体，而不是泛用 Block/Arpeggio。
//   - WarmIntimate × ModernPop → AlbertiBass   （流行抒情段古典流水分解，慢 bpm 触发）
//   - Melancholy   × ChillJazz → AlbertiBass   （暗调 + bpm<100 触发；比 Arpeggio8th 更经典）
//   - Groovy       × NeoSoul   → MontunoInner  （NeoSoul groove 拉丁内声部推进；需高 sync persona）
// Ragtime Upper Stab 不进默认路由 — 它的"右手让位 LH"设计需要 LH 真出 bass，
// 但 bassActive=true 时 BandEngine 强制 LH=Tacit，听感会变成稀薄高音 stab。留作
// Solo Piano + 特殊 mood 桶后续触发。
//
// 改动 G — Dreamy 三列差异化：原 [CinematicHold × 3] 让所有风格 Intro/Bridge/Outro 都
// 退化成"单击和弦"，是用户反映"每首歌开头都一样"的根因之一。现按风格分化。
//
// 改动 I — 撤掉所有纯单音 recipe 路由：原 G/D 改动把 5 个 cell 切到 AlbertiBass /
// Arpeggio8th，但这两个 recipe 的 RH 只弹 1 个 voice 循环，整段听感是"单音节奏"，
// 完全没有和声柱体感。用户反映"伴奏全是分解琶音，没和声"。
//
// 新策略：保留路由"差异化"的初衷，但全部切到 chord-style recipe（每拍头都有 chord
// stack）。AlbertiBass / Arpeggio8th 留在代码内供手写 params 使用，不进默认路由。
//
//   - WarmIntimate × ModernPop : AlbertiBass    → ChordAnchoredFill（chord 锚 + 8 分 fill）
//   - Melancholy   × ModernPop : Arpeggio8th    → ChordAnchoredFill（同上，pop ballad 听感）
//   - Melancholy   × ChillJazz : AlbertiBass    → ChordAnchoredFill（爵士抒情仍要 harmonic 柱）
//   - Dreamy       × ModernPop : Arpeggio8th    → ChordAnchoredFill（漂浮但保留和声）
//   - Dreamy       × ChillJazz : AlbertiBass    → SyncopatedStab    （爵士 syncopated chord stab）
//   - Groovy       × NeoSoul   → MontunoInner   （voicePattern 多 voice，保留拉丁推进）
const MOOD_RECIPE: ReadonlyArray<ReadonlyArray<TextureRecipeId>> = Object.freeze([
    // [ModernPop,                       ChillJazz,                        NeoSoul]
    /* WarmIntimate  */ Object.freeze([TextureRecipeId.ChordAnchoredFill, TextureRecipeId.BossaClave,       TextureRecipeId.PopHeartbeat]),
    /* Melancholy    */ Object.freeze([TextureRecipeId.ChordAnchoredFill, TextureRecipeId.ChordAnchoredFill, TextureRecipeId.CinematicHold]),
    /* UrgentTension */ Object.freeze([TextureRecipeId.Montuno,           TextureRecipeId.Funk16Stab,       TextureRecipeId.Funk16Stab]),
    /* Triumphant    */ Object.freeze([TextureRecipeId.PopHeartbeat,      TextureRecipeId.PopHeartbeat,     TextureRecipeId.GospelDropFill]),
    /* Groovy        */ Object.freeze([TextureRecipeId.BossaClave,        TextureRecipeId.BossaClave,       TextureRecipeId.MontunoInner]),
    /* Dreamy        */ Object.freeze([TextureRecipeId.ChordAnchoredFill, TextureRecipeId.SyncopatedStab,   TextureRecipeId.NeoSoulVamp]),
    /* Dramatic      */ Object.freeze([TextureRecipeId.Montuno,           TextureRecipeId.NeoSoulVamp,      TextureRecipeId.NeoSoulVamp]),
    /* Neutral       */ Object.freeze([TextureRecipeId.Pulse4thBlock,     TextureRecipeId.SyncopatedStab,   TextureRecipeId.SyncopatedStab]),
]);

export function moodToRecipe(mood: MoodId, styleId: StyleId): TextureRecipeId {
    const row = MOOD_RECIPE[mood] ?? MOOD_RECIPE[MoodId.Neutral];
    const cell = row[styleId];
    return cell !== undefined ? cell : row[StyleId.ModernPop];
}

// ============================================================
// pickWalkPattern — (mood, styleId) → WalkPatternId
// ============================================================
//
// 改动 B：LH Walking 也走 mood × style 路由，让 Solo Piano 模式下不同情绪的
// walking line 听感差异化（Dreamy pedal / Groovy 8th tumbao / Triumphant stride）。
//
// 注意：本表仅在 BandEngine 路由 lhTexture=WalkingTenths 时被调用（Solo Piano 模式
// + groove section + 非 Bounce）。否则不影响渲染。
//
// 行索引 = MoodId，列索引 = StyleId。缺省回落到 JazzQuarter（等价旧硬编码序列）。

// 改动 F：把 ChillJazz Groovy 切到 BebopWalk（B C 5 A），让 'C' chord-tone 规则
// 在 Solo Piano + ChillJazz + 高 sync persona 场景实际触发；Dramatic ChillJazz 切到
// ScaleClimb（B S S A），让 'S' scale-tone 在暗调高能量段触发。
const MOOD_WALK_PATTERN: ReadonlyArray<ReadonlyArray<WalkPatternId>> = Object.freeze([
    // [ModernPop,                       ChillJazz,                       NeoSoul]
    /* WarmIntimate  */ Object.freeze([WalkPatternId.HalfNote,       WalkPatternId.HalfNote,       WalkPatternId.HalfNote]),
    /* Melancholy    */ Object.freeze([WalkPatternId.HalfNote,       WalkPatternId.QuarterHalf,    WalkPatternId.HalfNote]),
    /* UrgentTension */ Object.freeze([WalkPatternId.Stride,         WalkPatternId.JazzQuarter,    WalkPatternId.LatinTumbao]),
    /* Triumphant    */ Object.freeze([WalkPatternId.Stride,         WalkPatternId.Stride,         WalkPatternId.Stride]),
    /* Groovy        */ Object.freeze([WalkPatternId.LatinTumbao,    WalkPatternId.BebopWalk,      WalkPatternId.LatinTumbao]),
    /* Dreamy        */ Object.freeze([WalkPatternId.Pedal,          WalkPatternId.Pedal,          WalkPatternId.Pedal]),
    /* Dramatic      */ Object.freeze([WalkPatternId.QuarterHalf,    WalkPatternId.ScaleClimb,     WalkPatternId.LatinTumbao]),
    /* Neutral       */ Object.freeze([WalkPatternId.JazzQuarter,    WalkPatternId.JazzQuarter,    WalkPatternId.JazzQuarter]),
]);

export function pickWalkPattern(mood: MoodId, styleId: StyleId): WalkPatternId {
    const row = MOOD_WALK_PATTERN[mood] ?? MOOD_WALK_PATTERN[MoodId.Neutral];
    const cell = row[styleId];
    return cell !== undefined ? cell : row[StyleId.ModernPop];
}

// ============================================================
// buildOperatorChain — (mood, barInPhrase) → RhythmTopologyOp[]
// ============================================================
//
// 二维表：MOOD_PHRASE_CHAIN[mood][barInPhrase] = readonly chain
//
// 每 mood 4 个 chain（4-bar phrase 内 bar 0/1/2/3）。
//
// 设计原则：
//   - bar 0 永远是 [] — 锚点，phrase 重置
//   - bar 1 / 2 / 3 按 mood 的"叙事节奏"递进
//   - 暗 / 慢 mood 多用 voicing 算子（色彩变化）+ decimate（更稀疏）
//   - 亮 / 快 mood 多用 densify + rotate（增密 + 推拍）
//   - 都不引入跨小节击点丢失（避免破坏和弦换音感）

const OP_INVERT: RhythmTopologyOp = Object.freeze({ kind: OP_VOICING_INVERT as TopologyOpKind });
const OP_OPEN: RhythmTopologyOp   = Object.freeze({ kind: OP_VOICING_OPEN as TopologyOpKind });
const OP_MIRROR_OP: RhythmTopologyOp = Object.freeze({ kind: OP_MIRROR as TopologyOpKind });
const OP_DENSIFY_2: RhythmTopologyOp = Object.freeze({ kind: OP_DENSIFY as TopologyOpKind, arg: 2 });
const OP_DENSIFY_1: RhythmTopologyOp = Object.freeze({ kind: OP_DENSIFY as TopologyOpKind, arg: 1 });
const OP_DENSIFY_0: RhythmTopologyOp = Object.freeze({ kind: OP_DENSIFY as TopologyOpKind, arg: 0 });
const OP_DECIMATE_1: RhythmTopologyOp = Object.freeze({ kind: OP_DECIMATE as TopologyOpKind, arg: 1 });
const OP_ROTATE_NEG1: RhythmTopologyOp = Object.freeze({ kind: OP_ROTATE as TopologyOpKind, arg: -1 });

const EMPTY: ReadonlyArray<RhythmTopologyOp> = Object.freeze([]);

const MOOD_PHRASE_CHAIN: ReadonlyArray<ReadonlyArray<ReadonlyArray<RhythmTopologyOp>>> = Object.freeze([
    // ---- WarmIntimate ----  voicing 主导，节奏极少改
    Object.freeze([
        EMPTY,                                  // bar 0
        Object.freeze([OP_INVERT]),             // bar 1
        EMPTY,                                  // bar 2
        Object.freeze([OP_OPEN]),               // bar 3
    ]),
    // ---- Melancholy ----  减稀 + voicing 紧凑（更萧瑟）
    Object.freeze([
        EMPTY,
        EMPTY,
        Object.freeze([OP_DECIMATE_1]),
        Object.freeze([OP_INVERT]),
    ]),
    // ---- UrgentTension ----  逐小节加密，bar 3 拉满
    Object.freeze([
        EMPTY,
        Object.freeze([OP_DENSIFY_2]),
        Object.freeze([OP_DENSIFY_1]),
        Object.freeze([OP_DENSIFY_0, OP_OPEN]),
    ]),
    // ---- Triumphant ----  voicing 开放 + 强位补满
    Object.freeze([
        EMPTY,
        Object.freeze([OP_DENSIFY_2]),
        Object.freeze([OP_OPEN]),
        Object.freeze([OP_DENSIFY_1, OP_OPEN]),
    ]),
    // ---- Groovy ----  mirror + rotate(-1)，offbeat 玩味
    Object.freeze([
        EMPTY,
        Object.freeze([OP_INVERT]),
        Object.freeze([OP_MIRROR_OP]),
        Object.freeze([OP_DENSIFY_1, OP_ROTATE_NEG1]),
    ]),
    // ---- Dreamy ----  voicing 主导，节奏几乎不动
    Object.freeze([
        EMPTY,
        EMPTY,
        Object.freeze([OP_INVERT]),
        Object.freeze([OP_OPEN]),
    ]),
    // ---- Dramatic ----  mirror + 开放，制造戏剧反差
    Object.freeze([
        EMPTY,
        Object.freeze([OP_DENSIFY_2]),
        Object.freeze([OP_MIRROR_OP]),
        Object.freeze([OP_DENSIFY_1, OP_OPEN]),
    ]),
    // ---- Neutral ----  = Sub-Phase 2 通用剧本
    Object.freeze([
        EMPTY,
        Object.freeze([OP_INVERT]),
        Object.freeze([OP_DENSIFY_2]),
        Object.freeze([OP_DENSIFY_1, OP_OPEN]),
    ]),
]);

/**
 * 取 mood 在 4-bar phrase 内 barInPhrase 位置的算子链。
 *
 * @param mood MoodId（兜底 Neutral）
 * @param barInPhrase 0~3（自动模 4）
 */
export function buildOperatorChain(
    mood: MoodId,
    barInPhrase: number,
): ReadonlyArray<RhythmTopologyOp> {
    const row = MOOD_PHRASE_CHAIN[mood] ?? MOOD_PHRASE_CHAIN[MoodId.Neutral];
    const idx = ((barInPhrase | 0) % 4 + 4) % 4;
    return row[idx];
}
