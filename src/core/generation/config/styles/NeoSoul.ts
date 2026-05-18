/**
 * NeoSoul — Neo-Soul 风格的和声配置（Phase 6 换脑后）
 *
 * Phase 6：旧版与 ModernPop 共用 _SharedHarmony 字典已删除。NeoSoul 通过独立
 * HarmonyRulesConfig 表达自己的两大风格指纹：
 *
 *   1. **欺骗解决偏好（D→S）**：Neo-Soul 不爱"乖乖" D→T 解决，反而频繁停在
 *      Subdominant 上吊住听感（"Just the Two of Us" 之类）。functionTransitions
 *      的 D 行：[D→T=3, D→S=3, D→D=2] — D→S 与 D→T 等权，非典型阻碍解决频出。
 *   2. **极高 Modal Interchange + Tension**：modalInterchangeProb=0.30
 *      （借调和弦是 Neo-Soul 灵魂）+ tensionExtensionProb=0.90（9/11 几乎必上）
 *      → 即便基底进行简单，色彩也极浓郁。
 *
 * VoiceLeading 关键品味（不变 — Phase 2.5 实现）：
 *   - commonTone 2.8（介于 Pop 2.5 与 Jazz 3.0 之间）— EPiano comping 顺滑
 *   - Top voice Color 列 50 高分 — 让 9/11/13 顶音常驻
 */

import { VoiceLeadingConfig } from '../../pipeline/HarmonyCore';
import { HarmonyRulesConfig, HarmonicFunction } from '../../pipeline/MacroProgressionEngine';
import { ChordQuality, ContourType, MusicianPersona, NoteData, SectionType, StructureTemplate } from '../../types';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
import {
    GrammarConfig, GrammarRule, GrammarSymbol, TerminalKind,
} from '../../primitives/PCFGGrammarEngine';
import { DrumGridConfig, DrumStepConfig } from '../../primitives/DrumIdiom';

// ============================================================
// HarmonyRulesConfig — Neo-Soul "deceptive + colorful" 风格
// ============================================================
//
// functionTransitions 3×3 行优先（T=0/S=1/D=2）：
//          T   S   D
//   T    [ 2,  3,  2 ]   ← Tonic：偏 S（铺色彩）
//   S    [ 2,  1,  4 ]   ← Subdominant：明显倾向 D
//   D    [ 3,  3,  2 ]   ← Dominant：D→T 与 D→S 等权（阻碍解决频出！）
//
// 变体权重（NeoSoul "扩展和弦堆叠"美学）：
//   Tonic       [I=4, vi=4, iii=1]      ← I 与 vi 等权（"Imaj7-vi7"循环是 NeoSoul 招牌）
//   Subdominant [IV=2, ii=4]            ← ii 偏多（更黏稠的 m7 色彩）
//   Dominant    [V=5, vii°=1]
//
// 变异门：极高 tension + 高 modal interchange
// ============================================================

export const NEO_SOUL_HARMONY_RULES: HarmonyRulesConfig = {
    functionTransitions: [
        2, 3, 2,
        2, 1, 4,
        3, 3, 2,
    ],
    tonicVariantWeights:       [4, 4, 1],
    subdominantVariantWeights: [2, 4],
    dominantVariantWeights:    [5, 1],

    secondaryDominantProb: 0.20,
    tritoneSubProb:        0.10,
    modalInterchangeProb:  0.30,
    tensionExtensionProb:  0.90,

    // Cadential Hijacking — NeoSoul 偏好 plagal/IV→I 蓝调归属感（Subdominant 半终止）
    cadentialPredominant: HarmonicFunction.Subdominant,

    progressionSkeletons: [
        { weight: 5, roots: [5, 4, 9, 0], qualities: [ChordQuality.Major7, ChordQuality.Dominant7, ChordQuality.Minor7, ChordQuality.Dominant7] }, // IV-III7-vi-I7
        { weight: 3, roots: [2, 7, 0, 9], qualities: [ChordQuality.Minor7, ChordQuality.Dominant7, ChordQuality.Major7, ChordQuality.Minor7] }
    ],
};

// ============================================================
// Voice Leading Config — NeoSoul 略黏 + 高 tension
// ============================================================

export const NEO_SOUL_VOICE_LEADING: VoiceLeadingConfig = {
    voiceCount: 4,

    // 比 Pop 黏一些，比 Classical 松一些 — 内声部 EPiano comping 要顺滑
    commonToneMultiplier: 2.8,
    halfStepMultiplier:   1.9,
    wholeStepMultiplier:  1.5,

    leapPenalty: 0.7,
    leapThreshold: 4,

    tendencyToneResolutionBoost: 4.0,
    parallelFifthPenalty: 0.3,

    // Voice Role × Chord Tone 表 — NeoSoul 偏色彩（Color 列权重整体抬高）
    //              Root  Third Fifth Seventh Color
    // Bass:        1000   35    20    30     5      ← root 强锚
    // Inner:        10    35    20    45    25      ← 7th heavy + 中等 color
    // Top:          15    20    25    20    50      ← color heavy（9/11/13 频出）
    voiceRoleScoreTable: [
        1000, 35, 20, 30,  5,
          10, 35, 20, 45, 25,
          15, 20, 25, 20, 50,
    ],

    pcDiversityFirstRepMultiplier: 0.5,
    pcDiversitySecondRepMultiplier: 0,

    voiceRangeLo: 48,
    voiceRangeHi: 72,
};

// ============================================================
// Stage 5 配置（Phase 5 配置剥离）
// ============================================================

// ── Personas ─── Accomp 取自 Marcus（Neo-Soul Keys）：colorBias=0.9 / sparsity=0.8 / sync=0.9
export const NEO_SOUL_PERSONAS: MusicianPersona[] = [
    // Bass — Neo-Soul slap/finger bass，切分偏多
    {
        colorBias: 0.0, sparsityTendency: 0.7, contourPreference: ContourType.Upward,
        syncopationAssault: 0.3, dynamicRange: [70, 100],
    },
    // Accomp — Marcus（极稀疏 + 重切分 + 高色彩）
    {
        colorBias: 0.9, sparsityTendency: 0.8, contourPreference: ContourType.Alternating,
        syncopationAssault: 0.7, dynamicRange: [40, 90],
    },
    // Lead — random contour，dynamic 跨度大；偏 staccato（Rhodes attack-then-die 感，70% 踏板量）
    {
        colorBias: 0.4, sparsityTendency: 0.5, contourPreference: ContourType.Random,
        syncopationAssault: 0.6, dynamicRange: [55, 105],
        legatoRatio: 0.7,
        signatureLickProb: 0.2,
        lickPool: [
            [ { pitch: 74, onset: 0, duration: 0.25, velocity: 0.8 }, { pitch: 72, onset: 0.25, duration: 0.25, velocity: 0.9 }, { pitch: 69, onset: 0.5, duration: 0.25, velocity: 0.7 }, { pitch: 71, onset: 0.75, duration: 0.25, velocity: 0.8 }, { pitch: 72, onset: 1.0, duration: 1.0, velocity: 0.85 } ]
        ],
    },
    // Drums — Neo-Soul "drunk" feel：拍位略飘 + ghost note
    {
        colorBias: 0.0, sparsityTendency: 0.55, contourPreference: ContourType.Upward,
        syncopationAssault: 0.6, dynamicRange: [70, 110],
    },
];

// ── Fractal — 16 分密集，rest 略多（切分） ──
export const NEO_SOUL_FRACTAL: FractalConfig = {
    dividingProbabilities: [0.95, 0.90, 0.70, 0.55, 0.25, 0.50],
    restProbabilities:     [0.05, 0.10, 0.20, 0.30, 0.35, 0.25],
    tripletProbability: 0.10,
    minSubdivisionBeats: 0.25,
};

// ── Grammar — 16 分 approach→chord 链 + 色彩音密集 ──
//
// Phase 6 重构：terminal 改为抽象 kind，pitch 由 ToplineEngine 跟随和弦实例化。
//
// Phase 6.2.1 新增：Neo-Soul 两套独立 Motif 折叠
//   1. FORM_NEO_POCKET（Dilla 切分碎步折叠）：
//      Define(NeoPocket) → Recall → NT(B) → Recall — 4-beat AABA，每拍 1 个 1-beat 动机
//      Pocket 动机大量使用 16 分 + 弱位休止 + ghost approach → chord，模进时产生 Dilla 律动复刻
//   2. FORM_NEO_HANG（色彩悬停折叠）：
//      Define(NeoHang) → Recall — 4-beat 双倍长保持，每个 2-beat 动机是
//      "短趋近 + 长色彩"，在新和弦上重复产生粘稠的 7th-9th-11th 悬停感
//
// 风格指纹：
//   - 16 分音符密集 — Neo-Soul "切分海" 美学
//   - approach→chord 16 分链条（Dilla feel "ghosting into the chord"）
//   - colorTone 高频出现（9/11/13 是 R&B 色彩本体）
//   - approachDownProb 拉到 0.75（下方半音 chromatic 主导 — Soul 经典走法）
//   - Motif 折叠让 Pocket / Color 在和声游走中被反复"复刻"
function Tone(kind: TerminalKind, duration: number): GrammarSymbol {
    return { type: 'terminal', kind, duration };
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

const NEOSOUL_GRAMMAR_RULES: GrammarRule[] = [
    // ── M：顶层入口 — Pocket / Hang 双折叠 + 传统兜底 ──
    //   折叠路径权重 4+3=7，传统路径 5+2+2+1=10，折叠概率 ≈ 41%（与设计目标一致）
    { lhs: 'M', rhs: [NT('FORM_NEO_POCKET'), NT('M_TAIL')], weight: 4 },  // Dilla 切分折叠
    { lhs: 'M', rhs: [NT('FORM_NEO_HANG'),   NT('M_TAIL')], weight: 3 },  // 色彩悬停折叠
    { lhs: 'M', rhs: [NT('B'), NT('M')],                    weight: 5 },  // 传统递归兜底
    { lhs: 'M', rhs: [NT('B')],                             weight: 2 },
    { lhs: 'M', rhs: [Rest(0.25), NT('B'), NT('M')],        weight: 2 },  // 16 分起音休止
    { lhs: 'M', rhs: [Rest(0.5),  NT('B'), NT('M')],        weight: 1 },

    // ── M_TAIL：FORM 后续 — 继续递归或终止 ──
    { lhs: 'M_TAIL', rhs: [NT('M')], weight: 5 },
    { lhs: 'M_TAIL', rhs: [],        weight: 2 },

    // ── FORM_NEO_POCKET：Dilla pocket 折叠（4-beat AABA，每拍 1-beat 动机） ──
    { lhs: 'FORM_NEO_POCKET', rhs: [
        Define('NeoPocket'),
        Recall('NeoPocket'),
        NT('B'),
        Recall('NeoPocket'),
    ], weight: 1 },

    // ── FORM_NEO_HANG：色彩悬停折叠（4 beat，2-beat 动机 × 2） ──
    { lhs: 'FORM_NEO_HANG', rhs: [
        Define('NeoHang'),
        Recall('NeoHang'),
    ], weight: 1 },

    // ── NeoPocket：1-beat 切分碎步动机（3 个 Dilla 风骨变体） ──
    //   Lick_Neo_Pocket_Ghost — 弱位 ghost approach → chord（"和-2"切分）
    { lhs: 'NeoPocket', rhs: [
        Rest(0.25), Tone('approachTone', 0.25), Tone('chordTone', 0.5),
    ], weight: 4 },
    //   Lick_Neo_Pocket_Stutter — 16 分 chord-rest-approach-chord（口袋律动结巴）
    { lhs: 'NeoPocket', rhs: [
        Tone('chordTone', 0.25), Rest(0.25),
        Tone('approachTone', 0.25), Tone('chordTone', 0.25),
    ], weight: 3 },
    //   Lick_Neo_Pocket_Pivot — 16 分 rest-chord-approach-color（避开重拍的 4-step pivot）
    { lhs: 'NeoPocket', rhs: [
        Rest(0.25), Tone('chordTone', 0.25),
        Tone('approachTone', 0.25), Tone('colorTone', 0.25),
    ], weight: 3 },

    // ── NeoHang：2-beat 色彩悬停动机（2 个变体） ──
    //   Lick_Neo_Color_Hang — approach 16 分 + 极长 color（7th-9th-11th 粘稠悬停）
    { lhs: 'NeoHang', rhs: [
        Tone('approachTone', 0.25), Tone('colorTone', 1.75),
    ], weight: 3 },
    //   Lick_Neo_Color_Pickup — 16 分起音休止 + 16 分 approach + 1.5 拍 color
    { lhs: 'NeoHang', rhs: [
        Rest(0.25), Tone('approachTone', 0.25), Tone('colorTone', 1.5),
    ], weight: 2 },

    // ── B — 1 拍内的兜底基元（Neo-Soul 切分美学：16 分链条主导） ──
    //   16 分 approach→chord 链条（4 个 16 分填满 1 拍）— Dilla feel
    { lhs: 'B', rhs: [
        Tone('approachTone', 0.25), Tone('chordTone', 0.25),
        Tone('approachTone', 0.25), Tone('chordTone', 0.25),
    ], weight: 4 },
    //   3 个 16 分 + 8 分（前半拍切碎，后半拍长）
    { lhs: 'B', rhs: [
        Tone('chordTone', 0.25), Tone('approachTone', 0.25),
        Tone('chordTone', 0.25), Tone('colorTone', 0.25),
    ], weight: 3 },
    //   8 分 color + 16 分 approach + 16 分 chord（重切分进入）
    { lhs: 'B', rhs: [
        Tone('colorTone', 0.5), Tone('approachTone', 0.25), Tone('chordTone', 0.25),
    ], weight: 3 },
    //   两个 8 分 chord-color
    { lhs: 'B', rhs: [Tone('chordTone', 0.5), Tone('colorTone', 0.5)], weight: 3 },
    { lhs: 'B', rhs: [Tone('colorTone', 0.5), Tone('chordTone', 0.5)], weight: 2 },
    //   1 拍长音 color（9/11/13 持续）
    { lhs: 'B', rhs: [Tone('colorTone', 1.0)], weight: 2 },
    //   1 拍长音 chord（呼吸）
    { lhs: 'B', rhs: [Tone('chordTone', 1.0)], weight: 2 },
    //   起音休止 + 后半拍切分（Dilla pocket）
    { lhs: 'B', rhs: [Rest(0.5), Tone('approachTone', 0.25), Tone('chordTone', 0.25)], weight: 2 },
    //   附点 chord + 16 分 approach
    { lhs: 'B', rhs: [Tone('chordTone', 0.75), Tone('approachTone', 0.25)], weight: 1 },
];

export const NEO_SOUL_GRAMMAR: GrammarConfig = {
    startSymbol: 'M',
    rules: NEOSOUL_GRAMMAR_RULES,
    maxExpansions: 300,
};

// ── Drum Grid — Neo-Soul "drunk" pocket: Kick syncopate + ghost snare + busy hihat ──
//   Kick: step 0 强 + step 6 / 10 syncopate（"and of 2" / "and of 3" Dilla-feel）
//   Snare: 2/4 标准 + 16 分弱位 ghost
//   Hihat: 16 分稳态 + 偶尔双击
function buildNeoSoulGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(16);
    for (let i = 0; i < 16; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    // Kick
    g[0].kickProb = 0.92;
    g[6].kickProb = 0.55;     // "and of 2" pocket
    g[10].kickProb = 0.50;    // "and of 3" pocket
    g[8].kickProb = 0.30;     // 弱化 3 拍（让 syncopate 主导）
    g[14].kickProb = 0.20;
    // Snare 2/4
    g[4].snareProb = 0.90;
    g[12].snareProb = 0.90;
    // Ghost snare（Neo-Soul 灵魂：弱位 16 分鬼音）
    g[3].snareProb = 0.30;
    g[7].snareProb = 0.25;
    g[11].snareProb = 0.30;
    g[15].snareProb = 0.20;
    // Hihat 16 分稳态
    for (let i = 0; i < 16; i++) {
        g[i].hihatProb = 0.65;
    }
    // 偶数 step 略强（重拍稳态）
    g[0].hihatProb = 0.85;
    g[4].hihatProb = 0.85;
    g[8].hihatProb = 0.85;
    g[12].hihatProb = 0.85;
    return g;
}

export const NEO_SOUL_DRUM_GRID: DrumGridConfig = {
    grid: buildNeoSoulGrid(),
    energyProbScale: [0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00, 1.00],
    energyVelScale:  [0.70, 0.75, 0.82, 0.88, 0.92, 0.96, 1.00, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,
    kickVelocity:  [85, 110],
    snareVelocity: [60, 105],            // 跨度大 → ghost 弱 + 反拍重
    hihatVelocity: [45, 80],
};

// ============================================================
// 曲式模板池（Phase 3 结构剥离）
// ============================================================

export const NEO_SOUL_STRUCTURES: StructureTemplate[] = [
    { id: 'neosoul-groove', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 4 }, { name: 'Verse', type: SectionType.Verse, bars: 16, energy: 5 }, { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 }, { name: 'Chorus', type: SectionType.Chorus, bars: 12, energy: 8 }, { name: 'Bridge', type: SectionType.Bridge, bars: 8, energy: 7 }, { name: 'Chorus', type: SectionType.Chorus, bars: 12, energy: 9 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 4 } ] },
    { id: 'neosoul-vamp-heavy', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 3 }, { name: 'Verse_1', type: SectionType.Verse, bars: 16, energy: 5 }, { name: 'Verse_2', type: SectionType.Verse, bars: 16, energy: 6 }, { name: 'Breakdown', type: SectionType.Breakdown, bars: 8, energy: 4 }, { name: 'Chorus', type: SectionType.Chorus, bars: 16, energy: 8 }, { name: 'Outro', type: SectionType.Outro, bars: 8, energy: 3 } ] }
];
