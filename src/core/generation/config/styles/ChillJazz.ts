/**
 * ChillJazz — 爵士风格的和声配置（Phase 6 换脑后）
 *
 * Phase 6：旧版 _ChillJazzHarmony 字典（11×11 静态矩阵）已彻底删除。
 * 新版用 HarmonyRulesConfig 直接刻画爵士的两大风格指纹：
 *
 *   1. **ii-V-I 引擎**：functionTransitions 把 S→D 拉到极高（6），让 Subdominant
 *      几乎必然解决到 Dominant；Dominant → Tonic 保持极强（5）。子权重让 ii 主导
 *      Subdominant 槽（[IV=2, ii=5]）— 真正的 ii-V-I 链条由此自然涌现。
 *   2. **极高变异概率**：tritoneSubProb=0.30（subV 三全音替代）+
 *      secondaryDominantProb=0.40（次属链）+ tensionExtensionProb=0.80（9 和弦本能）
 *      → Imaj7 几乎不会"裸"出现，V7 频繁被 bII7 替换，整个进行的色彩极强。
 *
 * VoiceLeading 关键品味（不变 — Phase 2.5 实现）：
 *   - commonTone 3.0 — Jazz 内声部黏死
 *   - leapPenalty 1.0（不惩罚）— Jazz rootless voicing 经常有 4 度跳
 *   - parallelFifthPenalty 0.7 — modal jazz / quartal voicing 允许部分平行
 */

import { VoiceLeadingConfig } from '../../pipeline/HarmonyCore';
import { HarmonyRulesConfig, HarmonicFunction } from '../../pipeline/MacroProgressionEngine';
import { ChordQuality, ContourType, MusicianPersona, NoteData, SectionType, StructureTemplate } from '../../types';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
import {
    GrammarConfig, GrammarRule, GrammarSymbol, TerminalKind, TerminalSymbol,
} from '../../primitives/PCFGGrammarEngine';
import { DrumGridConfig, DrumStepConfig } from '../../primitives/DrumIdiom';

// ============================================================
// HarmonyRulesConfig — ii-V-I 引擎 + 高变异色彩
// ============================================================
//
// functionTransitions 3×3 行优先（T=0/S=1/D=2）：
//          T   S   D
//   T    [ 1,  4,  2 ]   ← Tonic：偏向 S（启动 ii-V-I 链）
//   S    [ 1,  1,  6 ]   ← Subdominant：极强解决到 D（ii-V 核心）
//   D    [ 5,  1,  1 ]   ← Dominant：强解决到 T
//
// 变体权重：
//   Tonic       [I=3, vi=2, iii=2]      ← 三选项均衡（爵士不抗拒 vi/iii 中介）
//   Subdominant [IV=2, ii=5]            ← ii 主导（爵士的预属心脏）
//   Dominant    [V=5, vii°=2]           ← V 主导
//
// 变异门：极高（爵士的色彩本能）
// ============================================================

export const CHILL_JAZZ_HARMONY_RULES: HarmonyRulesConfig = {
    functionTransitions: [
        1, 4, 2,
        1, 1, 6,
        5, 1, 1,
    ],
    tonicVariantWeights:       [3, 2, 2],
    subdominantVariantWeights: [2, 5],
    dominantVariantWeights:    [5, 2],

    secondaryDominantProb: 0.40,
    tritoneSubProb:        0.30,
    modalInterchangeProb:  0.20,
    tensionExtensionProb:  0.80,

    // Cadential Hijacking — Jazz 走 ii-V-I（Dominant 半终止）
    cadentialPredominant: HarmonicFunction.Dominant,

    progressionSkeletons: [
        { weight: 5, roots: [2, 7, 0, 9], qualities: [ChordQuality.Minor7, ChordQuality.Dominant7, ChordQuality.Major7, ChordQuality.Minor7] } // ii-V-I-vi
    ],
};

// ============================================================
// Voice Leading Config — Jazz 黏 + 允许部分平行
// ============================================================

export const CHILL_JAZZ_VOICE_LEADING: VoiceLeadingConfig = {
    voiceCount: 4,

    // 内声部黏死 — 经典爵士钢琴 comping 美学
    commonToneMultiplier: 3.0,
    halfStepMultiplier:   2.0,
    wholeStepMultiplier:  1.3,

    // Jazz 不惩罚大跳 — rootless voicing / quartal stacking 经常有 4~5 度跳
    leapPenalty: 1.0,
    leapThreshold: 4,

    tendencyToneResolutionBoost: 4.0,

    // 0.7（比 Pop 的 0.3 宽松）— modal jazz / quartal 允许部分平行
    parallelFifthPenalty: 0.7,

    // Voice Role × Chord Tone 表 — Jazz 极度色彩偏好（Inner 7th-heavy，Top color 60）
    //              Root  Third Fifth Seventh Color
    // Bass:        1000   30    15    40     5      ← root 锚定；3rd / 7th 可入选（rootless）
    // Inner:        10    45    15    50    30      ← guide tones (3rd / 7th) + color
    // Top:          10    20    20    25    60      ← color 极重（9/11/13 经典爵士顶音）
    voiceRoleScoreTable: [
        1000, 30, 15, 40,  5,
          10, 45, 15, 50, 30,
          10, 20, 20, 25, 60,
    ],

    pcDiversityFirstRepMultiplier: 0.5,
    pcDiversitySecondRepMultiplier: 0,

    voiceRangeLo: 48,
    voiceRangeHi: 72,
};

// ============================================================
// Stage 5 配置（Phase 5 配置剥离）
// ============================================================

// ── Personas ─── Accomp 取自 Nina（Chill Jazz Piano 卡牌）：colorBias=0.8 / sparsity=0.65
export const CHILL_JAZZ_PERSONAS: MusicianPersona[] = [
    // Bass — Walking Bass 风格倾向（仍由 Bass 渲染策略决定具体形态）
    {
        colorBias: 0.0, sparsityTendency: 0.6, contourPreference: ContourType.Upward,
        syncopationAssault: 0.2, dynamicRange: [65, 95],
    },
    // Accomp — Nina（轻触爵士）
    {
        colorBias: 0.8, sparsityTendency: 0.65, contourPreference: ContourType.Alternating,
        syncopationAssault: 0.5, dynamicRange: [40, 85],
    },
    // Lead — alternating contour，色彩中等；偏 lush 踏板（过踏被和弦边界硬钳，实际上限即 chord_end）
    {
        colorBias: 0.5, sparsityTendency: 0.5, contourPreference: ContourType.Alternating,
        syncopationAssault: 0.5, dynamicRange: [50, 100],
        pianoPedalRatio: 1.2,
        signatureLickProb: 0.25,
        lickPool: [
            [ { pitch: 64, onset: 0, duration: 0.5, velocity: 0.8 }, { pitch: 61, onset: 0.5, duration: 0.5, velocity: 0.7 }, { pitch: 67, onset: 1.0, duration: 0.5, velocity: 0.8 }, { pitch: 60, onset: 1.5, duration: 1.5, velocity: 0.9 } ]
        ],
    },
    // Drums — 爵士打击 brush/ride 感（dynamicRange 仅参考，实际由 DRUM_GRID 控制）
    {
        colorBias: 0.0, sparsityTendency: 0.75, contourPreference: ContourType.Upward,
        syncopationAssault: 0.4, dynamicRange: [50, 85],
    },
];

// ── Fractal — 三连音偏明显（swing 感），rest 多（呼吸） ──
export const CHILL_JAZZ_FRACTAL: FractalConfig = {
    dividingProbabilities: [0.90, 0.80, 0.55, 0.45, 0.15, 0.45],
    restProbabilities:     [0.10, 0.15, 0.20, 0.30, 0.35, 0.25],
    tripletProbability: 0.25,
    minSubdivisionBeats: 0.25,
};

// ── Grammar — 三连音 + 重色彩 + 长保持音（爵士独白美学） ──
//
// Phase 6 重构：terminal 改为抽象 kind，pitch 由 ToplineEngine 跟随和弦实例化。
//
// Phase 6.2 新增：从 Parker / Davis grammar 折叠提炼的两套动机
//   1. FORM_CALL_RESP（Call-Response 折叠，主路径）：
//      Define(JazzLick) → Recall(JazzLick) → NT(JazzResp) → Recall(JazzLick)
//      4-beat AABA 微结构，A 段是 1-beat bebop / 三连音动机，B 段（答句）每次新抽样。
//      Recall 触发 Harmonic Sequence — 同一律动跟随 ii-V-I 链条游走。
//   2. FORM_COOL（Davis 冷爵士留白）：
//      Define(CoolHead) → Recall(CoolHead) — 4-beat 长保持 + 长呼吸的双倍模仿。
//
// 风格指纹：
//   - 三连音（1/3 拍）显著存在 — 爵士 swing 的核心律动
//   - colorTone 权重 ≈ chordTone（9/11/13 是爵士色彩本体）
//   - 长保持音（2 拍）穿插 — 爵士独奏的呼吸
//   - approach 走 ii-V 链时关键
//   - Motif 折叠让 bebop lick 像 Parker 的"recurring quote"那样在新和弦上再现
const TRIPLET = 1 / 3;  // 三连音 8 分（理论值；浮点比较走 EPSILON）

/**
 * Phase 6.3 — 升级版 Tone（与 ModernPop.ts 保持签名一致）：可选 hint 控制音级靶向 / 方向约束。
 *
 * 爵士场景常用：
 *   Tone('chordTone', TRIPLET, { targetDegree: 3 })   — 直接落在和弦三度（"guide tone")
 *   Tone('chordTone', TRIPLET, { targetDegree: 7 })   — 落在七度（爵士 voicing 的灵魂）
 *   Tone('colorTone', TRIPLET, { targetDegree: 9 })   — 落在 9 度张力音
 */
function Tone(
    kind: TerminalKind, duration: number,
    opts?: { targetDegree?: number; contourDir?: 1 | -1 },
): GrammarSymbol {
    const t: TerminalSymbol = { type: 'terminal', kind, duration };
    if (opts !== undefined) {
        if (opts.targetDegree !== undefined) t.targetDegree = opts.targetDegree;
        if (opts.contourDir !== undefined) t.contourDir = opts.contourDir;
    }
    return t;
}
function Rest(duration: number): GrammarSymbol {
    return { type: 'terminal', kind: 'rest', duration };
}
function NT(name: string): GrammarSymbol {
    return { type: 'nonterminal', name };
}
function Define(name: string): GrammarSymbol {
    return { type: 'nonterminal', name, action: 'define' };
}
function Recall(name: string): GrammarSymbol {
    return { type: 'nonterminal', name, action: 'recall' };
}

const JAZZ_GRAMMAR_RULES: GrammarRule[] = [
    // ── M：顶层入口 — Motif 折叠两路径 + 传统兜底 ──
    { lhs: 'M', rhs: [NT('FORM_CALL_RESP'), NT('M_TAIL')], weight: 5 },  // Parker bebop fold
    { lhs: 'M', rhs: [NT('FORM_COOL'),       NT('M_TAIL')], weight: 3 },  // Davis cool fold
    { lhs: 'M', rhs: [NT('B'), NT('M')],                   weight: 4 },  // 传统兜底
    { lhs: 'M', rhs: [NT('B')],                            weight: 2 },
    { lhs: 'M', rhs: [Rest(0.5), NT('B'), NT('M')],        weight: 2 },
    { lhs: 'M', rhs: [Rest(1.0), NT('B'), NT('M')],        weight: 1 },

    // ── M_TAIL：FORM 后续递归 / 终止 ──
    { lhs: 'M_TAIL', rhs: [NT('M')], weight: 5 },
    { lhs: 'M_TAIL', rhs: [],        weight: 2 },

    // ── FORM_CALL_RESP：Parker bebop Call-Response（4-beat AABA） ──
    //   每拍 1 个动机；Define 1 PRNG，两次 Recall 0 PRNG，JazzResp 重新抽样。
    { lhs: 'FORM_CALL_RESP', rhs: [
        Define('JazzLick'),
        Recall('JazzLick'),
        NT('JazzResp'),
        Recall('JazzLick'),
    ], weight: 1 },

    // ── FORM_COOL：Davis 冷爵士长保持折叠（4+4 beat） ──
    //   单一 4-beat 长动机定义 + 一次 Recall — 留白美学直接双倍重复
    { lhs: 'FORM_COOL', rhs: [
        Define('CoolHead'),
        Recall('CoolHead'),
    ], weight: 1 },

    // ── JazzLick：1-beat bebop 动机（Phase 6.3 — 增补 rootless guide-tone arpeggio） ──
    //   Lick_Bebop_Frag — bebop 8 分对答（chord → approach 半音下行）
    { lhs: 'JazzLick', rhs: [Tone('chordTone', 0.5), Tone('approachTone', 0.5)], weight: 3 },
    //   Lick_Jazz_Triplet — chord-color-chord 三连音 swing 核心
    { lhs: 'JazzLick', rhs: [
        Tone('chordTone',   TRIPLET),
        Tone('colorTone',   TRIPLET),
        Tone('chordTone',   TRIPLET),
    ], weight: 4 },
    //   Lick_Bebop_Enclosure — chord-approach-chord 三连音半音包裹
    { lhs: 'JazzLick', rhs: [
        Tone('chordTone',     TRIPLET),
        Tone('approachTone',  TRIPLET),
        Tone('chordTone',     TRIPLET),
    ], weight: 3 },
    //   Lick_Jazz_ColorCall — 1 拍色彩长保持（9/11/13 张力）
    { lhs: 'JazzLick', rhs: [Tone('colorTone', 1.0)], weight: 2 },
    //   Phase 6.3 — Lick_Jazz_Arp379：3-7-9 rootless 上行琶音
    //     爵士钢琴 rootless voicing 的旋律化版本 — 跳过根音直接展示 guide tones (3rd / 7th) + 9th tension。
    //     在 ii-V-I 链条上，每个和弦都精确展开为各自的 3-7-9 — 这是 Bill Evans / Herbie Hancock
    //     的 voicing 哲学映射到 melody。Major7 上 = 3/7/9（大三、大七、自然九）；
    //     Minor7 上自动切换为小三、小七、自然九（degreeToInterval 算法适配 quality）。
    { lhs: 'JazzLick', rhs: [
        Tone('chordTone', TRIPLET, { targetDegree: 3 }),
        Tone('chordTone', TRIPLET, { targetDegree: 7, contourDir: 1 }),
        Tone('colorTone', TRIPLET, { targetDegree: 9, contourDir: 1 }),
    ], weight: 3 },

    // ── JazzResp：1-beat 答句（不缓存，每次新抽样 — Call-Response 的"R"） ──
    { lhs: 'JazzResp', rhs: [
        Tone('approachTone', TRIPLET),
        Tone('chordTone',    TRIPLET),
        Tone('colorTone',    TRIPLET),
    ], weight: 3 },
    { lhs: 'JazzResp', rhs: [Tone('colorTone', 0.5), Tone('chordTone', 0.5)], weight: 2 },
    { lhs: 'JazzResp', rhs: [Tone('chordTone', 1.0)],                          weight: 2 },
    { lhs: 'JazzResp', rhs: [Tone('approachTone', 0.5), Tone('chordTone', 0.5)], weight: 1 },

    // ── CoolHead：4-beat 冷爵士长呼吸动机（Davis 美学） ──
    //   Lick_Cool_Space — 2 拍 chord 长保持 + 2 拍留白
    { lhs: 'CoolHead', rhs: [Tone('chordTone', 2.0), Rest(2.0)], weight: 2 },
    //   Lick_Cool_Color — 长 color + 短呼吸 + 长 chord（Davis "Kind of Blue"风）
    { lhs: 'CoolHead', rhs: [
        Tone('colorTone', 1.5),
        Rest(0.5),
        Tone('chordTone', 2.0),
    ], weight: 1 },

    // ── B：1 拍内的节奏/职能型（兜底基元，未折叠 — 爵士特色：三连音 + 重 color） ──
    //   1 拍长音 chord（独白美学）
    { lhs: 'B', rhs: [Tone('chordTone', 1.0)], weight: 3 },
    //   1 拍长音 color（9/11/13 持续色彩）
    { lhs: 'B', rhs: [Tone('colorTone', 1.0)], weight: 3 },
    //   2 拍长保持音
    { lhs: 'B', rhs: [Tone('chordTone', 2.0)], weight: 1 },
    { lhs: 'B', rhs: [Tone('colorTone', 2.0)], weight: 1 },
    //   两个 8 分（chord + color）— 经典爵士两音对答
    { lhs: 'B', rhs: [Tone('chordTone', 0.5), Tone('colorTone', 0.5)], weight: 3 },
    { lhs: 'B', rhs: [Tone('colorTone', 0.5), Tone('chordTone', 0.5)], weight: 3 },
    //   三连音 chord-color-chord（swing 律动）
    { lhs: 'B', rhs: [Tone('chordTone', TRIPLET), Tone('colorTone', TRIPLET), Tone('chordTone', TRIPLET)], weight: 4 },
    //   三连音 chord-approach-chord（bebop 经过）
    { lhs: 'B', rhs: [Tone('chordTone', TRIPLET), Tone('approachTone', TRIPLET), Tone('chordTone', TRIPLET)], weight: 3 },
    //   8 分 approach + 8 分 chord（向心力进入）
    { lhs: 'B', rhs: [Tone('approachTone', 0.5), Tone('chordTone', 0.5)], weight: 2 },
    //   附点长 + 16 分 approach（拖拽切分）
    { lhs: 'B', rhs: [Tone('colorTone', 0.75), Tone('approachTone', 0.25)], weight: 1 },
];

export const CHILL_JAZZ_GRAMMAR: GrammarConfig = {
    startSymbol: 'M',
    rules: JAZZ_GRAMMAR_RULES,
    maxExpansions: 200,
};

// ── Drum Grid — 爵士直拍 + ride pattern + brush snare（用 closed hihat 模拟 ride）──
//   Kick 主要落在 1/3 拍但 velocity 偏低（feathered kick — 爵士经典）
//   Snare 2/4 反拍但 velocity 偏低（brush rim）
//   Hihat 模拟 ride pattern: 8 分稳态 + 反拍重音感（用概率非 velocity 实现）
function buildJazzGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(16);
    for (let i = 0; i < 16; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    g[0].kickProb = 0.85;
    g[8].kickProb = 0.80;
    // 偶尔的 walking-bass-style kick at 2/4
    g[4].kickProb = 0.10;
    g[12].kickProb = 0.10;
    // Snare 2/4 brush
    g[4].snareProb = 0.78;
    g[12].snareProb = 0.78;
    // Hihat/Ride 8 分稳态（jazz: ride 是骨架）
    for (let i = 0; i < 16; i += 2) {
        g[i].hihatProb = 0.85;
    }
    // 反拍 ride 略密（模拟 ride bell skip note）
    g[6].hihatProb = 0.45;
    g[14].hihatProb = 0.45;
    return g;
}

export const CHILL_JAZZ_DRUM_GRID: DrumGridConfig = {
    grid: buildJazzGrid(),
    energyProbScale: [0.55, 0.65, 0.75, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.65, 0.70, 0.75, 0.82, 0.88, 0.92, 0.96, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [60, 85],           // feathered kick — 远低于 Pop
    snareVelocity: [50, 80],           // brush 触感
    hihatVelocity: [55, 90],           // ride cymbal 力度差异
};

// ============================================================
// 曲式模板池（Phase 3 结构剥离）
// ============================================================

export const CHILL_JAZZ_STRUCTURES: StructureTemplate[] = [
    { id: 'jazz-aaba', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 4 }, { name: 'Verse_A1', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Verse_A2', type: SectionType.Verse, bars: 8, energy: 6 }, { name: 'Bridge_B', type: SectionType.Bridge, bars: 8, energy: 7 }, { name: 'Verse_A3', type: SectionType.Verse, bars: 8, energy: 6 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 3 } ] },
    { id: 'jazz-abac', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 4 }, { name: 'Verse_A1', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Verse_A2', type: SectionType.Verse, bars: 8, energy: 6 }, { name: 'Verse_A3', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Chorus_C', type: SectionType.Chorus, bars: 8, energy: 7 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 3 } ] },
    // 改动 G — Rubato 冷启动变体：跳过 Intro，主题直接陈述（爵士标准曲常见的"head-in"开场）
    { id: 'jazz-rubato-head', sections: [ { name: 'Verse_A1', type: SectionType.Verse, bars: 8, energy: 4 }, { name: 'Verse_A2', type: SectionType.Verse, bars: 8, energy: 6 }, { name: 'Bridge_B', type: SectionType.Bridge, bars: 8, energy: 7 }, { name: 'Verse_A3', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 3 } ] }
];
