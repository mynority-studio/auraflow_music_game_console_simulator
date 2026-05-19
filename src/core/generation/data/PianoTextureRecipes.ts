/**
 * PianoTextureRecipes — 钢琴织体配方库（Sub-Phase 1）
 *
 * 把 PianoAccompIdiom 内硬编码的 GRID_BLOCK / GRID_BROKEN / GRID_STAB 升级成一张
 * 可索引的配方表，并预置 7 个新织体（PopHeartbeat / BossaClave / Montuno /
 * GospelDropFill / Funk16Stab / NeoSoulVamp / CinematicHold）供 Sub-Phase 3 的
 * MoodRouter 选择。
 *
 * 当前阶段（Sub-Phase 1）：仅作为 grid 查表使用。
 *   - BandEngine 仍按旧的 sectionType → recipe 1:1 映射（保持现有听感）
 *   - PianoAccompIdiom 用 recipe.baseGrid 替代 pickGrid(rhTexture) 内的硬编码 grid
 *
 * Sub-Phase 3（MoodRouter）会消费 rhTexture / lhTexture / coordMode / voicingSpan
 * 字段作为 mood 选 recipe 时的默认建议（bassActive 仍有覆盖权）。
 *
 * 约束遵从：
 *   T-1 数值枚举分类
 *   P-1 frozen array + 整数索引访问，无 Map/Set
 *   D-1 纯数据，零 PRNG
 *   C 移植友好：定长 baseGrid + 整数索引表
 *
 * @author AuraFlow Tap! Piano Texture Renaissance — Sub-Phase 1
 */

import { LHTexture, RHTexture, CoordMode } from './PianoTextureEnums';

/** 16-step bar 长度（4/4 拍 16 分网格） */
export const PIANO_TEXTURE_GRID_LENGTH = 16;

/**
 * 织体配方 ID（T-1 数值枚举）
 *
 * 索引必须与 PIANO_TEXTURE_RECIPES 数组一一对应。
 *
 * 前 3 个（索引 0/1/2）是**向后兼容映射**，与 PianoAccompIdiom 原 GRID_BLOCK /
 * GRID_BROKEN / GRID_STAB 严格 1:1 — Sub-Phase 1 切换默认走这三个，保证现有听感不变。
 *
 * 后 7 个（索引 3~9）是 Mood 路由备选，Sub-Phase 1 暂不被 BandEngine 选用。
 */
export enum TextureRecipeId {
    // ---- 向后兼容（与旧 RHTexture 一一映射，Sub-Phase 1 默认） ----
    /** Classic Block — 每拍头 1 击点（=旧 GRID_BLOCK） */
    Pulse4thBlock    = 0,
    /** Classic Broken — 8 分音符循环琶音（=旧 GRID_BROKEN） */
    Arpeggio8th      = 1,
    /** Classic Stab — 1 + 2.5 + 3 + 4.5 切分塞音（=旧 GRID_STAB） */
    SyncopatedStab   = 2,
    // ---- Mood 路由备选（Sub-Phase 3 才被选用） ----
    /** Pop Heartbeat — 抒情流行胸跳：1, 1&, 2.5, 3, 4.5 */
    PopHeartbeat     = 3,
    /** Bossa Nova 2-3 clave — 巴西爵士切分骨架 */
    BossaClave       = 4,
    /** Latin Montuno — 4/4 tumbao 推进感 */
    Montuno          = 5,
    /** Gospel Drop + Fill — 稀疏 block + 句尾 16 分填充 */
    GospelDropFill   = 6,
    /** Funk 16-stab — 16 分反拍密集 stab */
    Funk16Stab       = 7,
    /** Neo-Soul Vamp — 拖拍切分 vamp */
    NeoSoulVamp      = 8,
    /** Cinematic Hold — 单点齐砸 + 整和弦持续 */
    CinematicHold    = 9,
    // ---- 改动 C：voicePattern 精化织体（每 step 明确弹哪些 voice） ----
    /** Alberti Bass — 古典 5-1-3-1 分解（8 分音符循环单音） */
    AlbertiBass      = 10,
    /** Montuno Inner Climb — 拉丁内声部上下感（offbeat 中音 + onbeat 双音） */
    MontunoInner     = 11,
    /** Ragtime Upper Stab — RH 仅打中高音 voice，让 LH 出 bass */
    RagtimeUpperStab = 12,
    /** Chord Anchored Fill — 强拍砸全和弦 + 8 分反拍单音 fill（混合织体，pop ballad 钢琴风） */
    ChordAnchoredFill = 13,
}

/**
 * 单个钢琴织体配方（**可序列化的纯数据**）
 *
 * 字段约定：
 *   - baseGrid 长度恒为 PIANO_TEXTURE_GRID_LENGTH（16），由 PianoAccompIdiom 按 step 取 mod
 *   - rhTexture / lhTexture / coordMode 是**渲染建议**，BandEngine 仍可按 bassActive 等
 *     外部约束覆盖（典型：bassActive=true 强制 lhTexture=Tacit + coordMode=M4）
 *   - voicingSpan ∈ [0, 1]，> 0.6 触发 Drop-2 开放排列（PianoAccompIdiom 内已实装阈值）
 *   - swingHint ∈ [0.5, 0.67]，未设置时由 styleConfig.swingRatio 决定
 *   - voicePattern（改动 C，可选）：每 step 弹 rhVoicing 的哪些 voice index
 *     提供时完全替代 baseGrid + Block/Broken 旧逻辑，并跳过 mutator（保护经典织体结构）
 */
export interface PianoTextureRecipe {
    /** 索引 = TextureRecipeId 数值（C 移植直接做数组下标） */
    id: TextureRecipeId;
    /** 调试/UI 显示名 */
    name: string;
    /** 16-step 0/1 节奏骨架 */
    baseGrid: ReadonlyArray<number>;
    /** RH 渲染风格（Block 齐砸 / Broken 单音琶音 / Stab 短促塞音） */
    rhTexture: RHTexture;
    /** LH 默认织体（M1 模式下生效；bassActive=true 时被强制覆盖为 Tacit） */
    lhTexture: LHTexture;
    /** 推荐协作模式（bassActive=true 强制 M4；bouncePreference>0.5 + Solo 强制 M6） */
    coordMode: CoordMode;
    /** 推荐 voicing 跨度，> 0.6 触发 Drop-2 */
    voicingSpan: number;
    /** 推荐 swing 比例（覆盖 styleConfig），未设置时回落到 styleConfig.swingRatio */
    swingHint?: number;
    /**
     * 改动 C：精化织体 — 每 step 弹 rhVoicing 的哪些 voice index。
     *
     * 长度恒为 PIANO_TEXTURE_GRID_LENGTH（16）；
     *   - `null` 或 `[]` → 该 step 静音
     *   - `[0, 2]`       → 该 step 同时弹 rhVoicing[0] 和 rhVoicing[2]（双音）
     *   - `[1]`          → 该 step 单音琶音（仅 voice 1）
     *
     * voice index 越界（>= rhVoicing.length）时由渲染层 mod 兜底，不会崩溃。
     *
     * 提供时：
     *   1. 完全替代 baseGrid + rhTexture (Block/Broken/Stab) 旧逻辑
     *   2. 跳过 RhythmTopologyMutator（防止 mirror/rotate 破坏经典织体如 Alberti 5-1-3-1）
     *   3. 仍受 swing/intensity/velocity 参数影响
     *
     * 缺省时（多数 recipe）：保持现行 baseGrid + rhTexture 行为。
     */
    voicePattern?: ReadonlyArray<ReadonlyArray<number> | null>;
    /**
     * A2：RH voicing 构造模式（控制 rhVoicing 来源算法）。
     *   - 'tertian' / 缺省 → 用 HarmonyCore voicing.slice(1)（现状）
     *   - 'rootless'       → buildRootlessVoicing：删 root + 按 colorBias 加 9/11/13，含 minor 9th avoid
     *   - 'quartal'        → buildQuartalVoicing：纯 4 度叠置（modal jazz / cinematic）
     *
     * 选用 'rootless' / 'quartal' 时：
     *   - 跳过 chord.voicing.slice(1) 路径
     *   - 跳过 Drop-2（voicing 已经由构造器决定 register）
     *   - HandManager 仍生效（防 RH < LH+3）
     *   - A3a 的 applyRhListenToLhShell 不再外部调用（构造器内部已处理 listen）
     */
    voicingMode?: 'tertian' | 'rootless' | 'quartal';
}

// ============================================================
// Recipe 数据表（索引 = TextureRecipeId）
// ============================================================
//
// 节奏 step 编号（4/4 16-step bar）：
//   step:   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   beat:   1     &  e  2     &  e  3     &  e  4     &  e
//   weight: 4  0  1  0  2  0  1  0  3  0  1  0  2  0  1  0
//
// ============================================================

/** 索引 0 — Pulse4thBlock：每拍头一击点（4 击/小节，等价旧 GRID_BLOCK） */
const GRID_PULSE_4TH_BLOCK: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   1, 0, 0, 0,   1, 0, 0, 0,   1, 0, 0, 0,
]);

/** 索引 1 — Arpeggio8th：8 分音符循环（8 击/小节，等价旧 GRID_BROKEN） */
const GRID_ARPEGGIO_8TH: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,
]);

/** 索引 2 — SyncopatedStab：1 + 2.5 + 3 + 4.5（4 击/小节，等价旧 GRID_STAB） */
const GRID_SYNCOPATED_STAB: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   0, 0, 1, 0,   1, 0, 0, 0,   0, 0, 1, 0,
]);

/** 索引 3 — PopHeartbeat：1, 1.5（off）, 2.5, 3, 4.5（5 击/小节，加密 stab + 胸跳后半拍） */
const GRID_POP_HEARTBEAT: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   0, 0, 1, 0,   1, 0, 0, 0,   0, 0, 1, 0,
]);

/** 索引 4 — BossaClave (2-3)：标准 Bossa Nova clave 节奏骨架（5 击/小节） */
const GRID_BOSSA_CLAVE: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 1,   0, 0, 1, 0,   0, 1, 0, 0,   1, 0, 0, 0,
]);

/** 索引 5 — Montuno：Latin 4/4 tumbao（7 击/小节，推进感强） */
const GRID_MONTUNO: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   1, 0, 0, 1,   0, 0, 1, 0,   1, 0, 0, 0,
]);

/** 索引 6 — GospelDropFill：稀疏 block + 句尾 16 分填充（6 击/小节，前疏后密） */
const GRID_GOSPEL_DROP_FILL: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   1, 0, 0, 0,   0, 0, 0, 0,   1, 1, 1, 1,
]);

/** 索引 7 — Funk16Stab：16 分反拍密集 stab（7 击/小节） */
const GRID_FUNK_16_STAB: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 1,   0, 1, 0, 0,   1, 0, 1, 0,   0, 1, 0, 1,
]);

/** 索引 8 — NeoSoulVamp：拖拍切分 vamp（6 击/小节，半反拍重音） */
const GRID_NEO_SOUL_VAMP: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   0, 1, 1, 0,   0, 0, 1, 0,   0, 1, 0, 1,
]);

/** 索引 9 — CinematicHold：每和弦头单点齐砸（1 击/小节，靠 voicing sustain 撑） */
const GRID_CINEMATIC_HOLD: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,
]);

// ============================================================
// 改动 C — voicePattern 精化织体（每 step 明确弹哪些 voice index）
// ============================================================
//
// 配套 baseGrid 仅作为"recipe 自描述节奏轮廓"用于 UI / 调试，
// 实际渲染走 voicePattern；voicePattern[step]=null/[] 即静音。
//
// voice index 语义：rhVoicing 数组下标（0=最低非 bass voice，n-1=顶音）。
// 即使越界（>= n）也会被渲染层用 mod 兜底，不会崩溃。
// ============================================================

/**
 * 索引 10 — Alberti Bass：古典 5-1-3-1 经典分解（8 分音符循环单音）
 *
 * 18 世纪 Alberti 兄弟首创，钢琴入门曲集常见。RH 不再齐砸，而是按 top→bottom→middle→bottom
 * 顺序点单音，制造"流水"听感。LH 由 M1 Sustained Root 接管低音。
 *
 * 8 拍循环：top, _, low, _, mid, _, low, _, top, _, low, _, mid, _, low, _
 */
const GRID_ALBERTI_BASS: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,
]);
const VP_ALBERTI_BASS: ReadonlyArray<ReadonlyArray<number> | null> = Object.freeze([
    Object.freeze([2]),  null, Object.freeze([0]), null,
    Object.freeze([1]),  null, Object.freeze([0]), null,
    Object.freeze([2]),  null, Object.freeze([0]), null,
    Object.freeze([1]),  null, Object.freeze([0]), null,
]);

/**
 * 索引 11 — Montuno Inner Climb：拉丁钢琴内声部上下感
 *
 * onbeat (step 0/4/8/12) 打 low+top 双音；offbeat 中间 (step 2/6/10/14) 打 middle 单音。
 * 内声部填充制造拉丁 montuno 推进感（强弱拍交替）。
 */
const GRID_MONTUNO_INNER: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,
]);
const VP_MONTUNO_INNER: ReadonlyArray<ReadonlyArray<number> | null> = Object.freeze([
    Object.freeze([0, 2]), null, Object.freeze([1]), null,
    Object.freeze([0, 2]), null, Object.freeze([1]), null,
    Object.freeze([0, 2]), null, Object.freeze([1]), null,
    Object.freeze([0, 2]), null, Object.freeze([1]), null,
]);

/**
 * 索引 12 — Ragtime Upper Stab：RH 只打中高音，让 LH bass 全程出彩
 *
 * 每拍头 (step 0/4/8/12) 仅打 voice[1, 2]（不打 voice[0]，把低声部让给 LH）。
 * 配合 LH Pedal 或 Stride walk pattern 可还原老派 ragtime 听感。
 */
const GRID_RAGTIME_UPPER: ReadonlyArray<number> = Object.freeze([
    1, 0, 0, 0,   1, 0, 0, 0,   1, 0, 0, 0,   1, 0, 0, 0,
]);
const VP_RAGTIME_UPPER: ReadonlyArray<ReadonlyArray<number> | null> = Object.freeze([
    Object.freeze([1, 2]), null, null, null,
    Object.freeze([1, 2]), null, null, null,
    Object.freeze([1, 2]), null, null, null,
    Object.freeze([1, 2]), null, null, null,
]);

/**
 * 索引 13 — Chord Anchored Fill：强拍砸全和弦 + 8 分反拍单音 fill
 *
 * 设计目的（改动 I）：解决"切到 voicePattern 单音织体后完全没有和声伴奏感"的问题。
 *   - step 0/4/8/12（每拍头）：[0, 1, 2, 3] 全 voice 齐砸 → harmonic anchor 落实
 *   - step 2/6/10/14（8 分反拍）：[3] 单音 fill → 保留 motion 不至于呆板
 *
 * 听感：pop ballad / lyrical 钢琴的"砰-叮-砰-叮"反复，强拍是 chord 体感，
 * 反拍只是顶音点缀，整段始终能听到和声推进。voicingSpan>0.6 时 Drop-2 也照常生效。
 */
const GRID_CHORD_ANCHORED_FILL: ReadonlyArray<number> = Object.freeze([
    1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,   1, 0, 1, 0,
]);
const VP_CHORD_ANCHORED_FILL: ReadonlyArray<ReadonlyArray<number> | null> = Object.freeze([
    Object.freeze([0, 1, 2, 3]), null, Object.freeze([3]), null,
    Object.freeze([0, 1, 2, 3]), null, Object.freeze([3]), null,
    Object.freeze([0, 1, 2, 3]), null, Object.freeze([3]), null,
    Object.freeze([0, 1, 2, 3]), null, Object.freeze([3]), null,
]);

/**
 * 配方索引表 — frozen array，索引必须 === TextureRecipeId 数值。
 *
 * 消费方约定：用 `PIANO_TEXTURE_RECIPES[recipeId]` 直接取，零运行期查找开销。
 */
export const PIANO_TEXTURE_RECIPES: ReadonlyArray<PianoTextureRecipe> = Object.freeze([
    // ---- 向后兼容（Sub-Phase 1 BandEngine 默认走这三个） ----
    Object.freeze({
        id: TextureRecipeId.Pulse4thBlock,
        name: 'Pulse 4th Block',
        baseGrid: GRID_PULSE_4TH_BLOCK,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
    }),
    Object.freeze({
        id: TextureRecipeId.Arpeggio8th,
        name: 'Arpeggio 8th',
        baseGrid: GRID_ARPEGGIO_8TH,
        rhTexture: RHTexture.Broken,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.4,
    }),
    Object.freeze({
        id: TextureRecipeId.SyncopatedStab,
        name: 'Syncopated Stab',
        baseGrid: GRID_SYNCOPATED_STAB,
        rhTexture: RHTexture.Stab,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
    }),
    // ---- Mood 路由备选（Sub-Phase 3 启用） ----
    Object.freeze({
        id: TextureRecipeId.PopHeartbeat,
        name: 'Pop Heartbeat',
        baseGrid: GRID_POP_HEARTBEAT,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.55,
    }),
    Object.freeze({
        id: TextureRecipeId.BossaClave,
        name: 'Bossa Clave',
        baseGrid: GRID_BOSSA_CLAVE,
        rhTexture: RHTexture.Stab,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.65,
        swingHint: 0.55,
    }),
    Object.freeze({
        id: TextureRecipeId.Montuno,
        name: 'Montuno',
        baseGrid: GRID_MONTUNO,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
    }),
    Object.freeze({
        id: TextureRecipeId.GospelDropFill,
        name: 'Gospel Drop + Fill',
        baseGrid: GRID_GOSPEL_DROP_FILL,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.7,
    }),
    Object.freeze({
        id: TextureRecipeId.Funk16Stab,
        name: 'Funk 16 Stab',
        baseGrid: GRID_FUNK_16_STAB,
        rhTexture: RHTexture.Stab,
        lhTexture: LHTexture.Tacit,
        coordMode: CoordMode.M4_TacitWithComping,
        voicingSpan: 0.5,
        // A2：funk stab 配 rootless RH，让 9/13 撑色彩（colorBias≥0.55 时加 13）
        voicingMode: 'rootless',
    }),
    Object.freeze({
        id: TextureRecipeId.NeoSoulVamp,
        name: 'Neo-Soul Vamp',
        baseGrid: GRID_NEO_SOUL_VAMP,
        rhTexture: RHTexture.Stab,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.75,
        swingHint: 0.6,
        // A2：Neo-Soul 旗帜性 rootless voicing（D'Angelo / Robert Glasper 都常用 3+7+9+13）
        voicingMode: 'rootless',
    }),
    Object.freeze({
        id: TextureRecipeId.CinematicHold,
        name: 'Cinematic Hold',
        baseGrid: GRID_CINEMATIC_HOLD,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M5_TwoHandedVoicing,
        voicingSpan: 0.8,
    }),
    // ---- 改动 C — voicePattern 精化织体 ----
    Object.freeze({
        id: TextureRecipeId.AlbertiBass,
        name: 'Alberti Bass',
        baseGrid: GRID_ALBERTI_BASS,
        rhTexture: RHTexture.Broken,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.4,
        voicePattern: VP_ALBERTI_BASS,
    }),
    Object.freeze({
        id: TextureRecipeId.MontunoInner,
        name: 'Montuno Inner Climb',
        baseGrid: GRID_MONTUNO_INNER,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
        voicePattern: VP_MONTUNO_INNER,
    }),
    Object.freeze({
        id: TextureRecipeId.RagtimeUpperStab,
        name: 'Ragtime Upper Stab',
        baseGrid: GRID_RAGTIME_UPPER,
        rhTexture: RHTexture.Stab,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
        voicePattern: VP_RAGTIME_UPPER,
    }),
    Object.freeze({
        id: TextureRecipeId.ChordAnchoredFill,
        name: 'Chord Anchored Fill',
        baseGrid: GRID_CHORD_ANCHORED_FILL,
        rhTexture: RHTexture.Block,
        lhTexture: LHTexture.Sustained,
        coordMode: CoordMode.M1_SustainedRoot,
        voicingSpan: 0.5,
        voicePattern: VP_CHORD_ANCHORED_FILL,
    }),
]);

/**
 * 安全取 recipe — 索引越界回落到 Pulse4thBlock（最稳的兜底）。
 *
 * Sub-Phase 1 调用方：PianoAccompIdiom.render（recipeId 缺省时不调用本函数，走 legacy 路径）。
 */
export function getPianoTextureRecipe(id: TextureRecipeId): PianoTextureRecipe {
    const r = PIANO_TEXTURE_RECIPES[id];
    return r !== undefined ? r : PIANO_TEXTURE_RECIPES[TextureRecipeId.Pulse4thBlock];
}

/**
 * Legacy 适配：旧 RHTexture → 等价 TextureRecipeId。
 *
 * 仅在 PianoAccompParams.recipeId 未提供时由 PianoAccompIdiom 调用，保证现有测试
 * 和未迁移代码听感零回归。Sub-Phase 3 全面迁移后本函数仍保留作为兜底。
 */
export function legacyRhTextureToRecipe(rh: RHTexture): TextureRecipeId {
    switch (rh) {
        case RHTexture.Block:  return TextureRecipeId.Pulse4thBlock;
        case RHTexture.Broken: return TextureRecipeId.Arpeggio8th;
        case RHTexture.Stab:   return TextureRecipeId.SyncopatedStab;
        default:               return TextureRecipeId.Pulse4thBlock;
    }
}
