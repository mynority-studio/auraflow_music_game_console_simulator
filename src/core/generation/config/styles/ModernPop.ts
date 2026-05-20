/**
 * ModernPop — 流行风格的和声配置（Phase 6 换脑后）
 *
 * Phase 6：旧版 ChordTransitionMatrix（10×10 静态字典）已彻底删除，
 * 替换为 HarmonyRulesConfig — 由 4 个变异门概率 + T-S-D 功能转移矩阵 + 变体权重驱动。
 *
 * 关键品味（功能层 + 变异门）：
 *   - 功能转移：中庸 — T→S/D 平衡、S→D 偏强、D→T 收尾偏强（基本 T-S-D-T 流向）
 *   - 变异门：极低 — tritoneSubProb=0（流行不做三全音替代）、modalInterchangeProb=0.05、
 *     secondaryDominantProb=0.1（流行偶尔的 V7/vi 戏剧化）、tensionExtensionProb=0.3
 *     （流行常上 Maj9 / Min9 抒情）
 *
 * VoiceLeading 关键品味（不变 — Phase 2.5 实现）：
 *   - 略松（commonTone 2.5 / leapPenalty 0.8）— 现代流行偏 Block Chord
 *   - parallelFifthPenalty 0.3 — 仍禁平行 5/8（Pop 不是 modal jazz）
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
// HarmonyRulesConfig — Phase 6 代数推演规则
// ============================================================
//
// functionTransitions 3×3 行优先（T=0/S=1/D=2）：
//          T   S   D
//   T    [ 2,  3,  3 ]   ← Tonic：均衡地走向 S 或 D
//   S    [ 2,  1,  4 ]   ← Subdominant：明显倾向 D（建立张力）
//   D    [ 5,  1,  1 ]   ← Dominant：强烈解决到 T
//
// 变体权重（Pop 偏好"主功能优势"）：
//   Tonic       [I=5, vi=2, iii=1]   ← I/Imaj7 主导
//   Subdominant [IV=4, ii=2]         ← IV 主导
//   Dominant    [V=5, vii°=1]        ← V 主导（vii° 稀有）
// ============================================================

export const MODERN_POP_HARMONY_RULES: HarmonyRulesConfig = {
    functionTransitions: [
        2, 3, 3,
        2, 1, 4,
        5, 1, 1,
    ],
    tonicVariantWeights:       [5, 2, 1],
    subdominantVariantWeights: [4, 2],
    dominantVariantWeights:    [5, 1],

    secondaryDominantProb: 0.10,
    tritoneSubProb:        0.00,
    modalInterchangeProb:  0.05,
    tensionExtensionProb:  0.30,

    // Cadential Hijacking — Pop 走经典 V→I 完全终止式
    cadentialPredominant: HarmonicFunction.Dominant,

    progressionSkeletons: [
        { weight: 5, roots: [0, 7, 9, 5], qualities: [ChordQuality.Major, ChordQuality.Major, ChordQuality.Minor, ChordQuality.Major] }, // I-V-vi-IV
        { weight: 3, roots: [9, 5, 0, 7], qualities: [ChordQuality.Minor, ChordQuality.Major, ChordQuality.Major, ChordQuality.Major] }  // vi-IV-I-V
    ],
};

// ============================================================
// Voice Leading Config — Pop 略松
// ============================================================

export const MODERN_POP_VOICE_LEADING: VoiceLeadingConfig = {
    voiceCount: 4,

    // Pop 不黏死内声部，但仍偏好平滑连接
    commonToneMultiplier: 2.5,
    halfStepMultiplier:   1.8,
    wholeStepMultiplier:  1.5,

    leapPenalty: 0.8,
    leapThreshold: 4,    // > 大三度视为大跳

    tendencyToneResolutionBoost: 4.0,  // 跨风格统一（音乐物理）
    parallelFifthPenalty: 0.3,         // Pop 仍禁平行 5/8

    // Voice Role × Chord Tone 表（3×5 flat）
    //              Root  Third Fifth Seventh Color
    // Bass:        1000   40    20    30     5      ← root 强锚（×100 普通 chord tone）
    // Inner:        10    40    25    40    15      ← guide tones (3rd / 7th)
    // Top:          20    15    30    15    40      ← color / 5th 厚顶
    voiceRoleScoreTable: [
        1000, 40, 20, 30,  5,
          10, 40, 25, 40, 15,
          20, 15, 30, 15, 40,
    ],

    pcDiversityFirstRepMultiplier: 0.5,   // 第一次重复减半
    pcDiversitySecondRepMultiplier: 0,    // 第二次禁忌（绝对静音）

    // 内声部工作区间：C3 ~ C5（相对空间，C=60 为主音）
    voiceRangeLo: 48,
    voiceRangeHi: 72,
};

// ============================================================
// Stage 5 配置（Phase 5 配置剥离）
//   - PERSONAS  : 4 个角色（Bass/Accomp/Lead/Drums）的演奏微操画像
//   - FRACTAL   : Lead 用 FractalStructureEngine 的概率配置
//   - GRAMMAR   : Lead 用 PCFGGrammarEngine 的规则集
//   - DRUM_GRID : DrumIdiom 16-step grid + Energy 缩放曲线
// ============================================================

// ── Personas — 索引 0=Bass / 1=Accomp / 2=Lead / 3=Drums（与 Stage5Layering ROLE_* 对齐） ──
//   Accomp 取自 Alex（Pop Piano 卡牌）：colorBias=0.4 / sparsity=0.5 / sync=0.3
//   Drums 取自 Dave（Steady Pop 卡牌）：sparsity=0.6 / sync=0.2 — 干净直拍
export const MODERN_POP_PERSONAS: MusicianPersona[] = [
    // Bass — 正拍重，少切分
    {
        colorBias: 0.0, sparsityTendency: 0.5, contourPreference: ContourType.Upward,
        syncopationAssault: 0.1, dynamicRange: [75, 110],
    },
    // Accomp — Alex
    {
        colorBias: 0.4, sparsityTendency: 0.5, contourPreference: ContourType.Random,
        syncopationAssault: 0.3, dynamicRange: [55, 100],
    },
    // Lead — 中庸 random contour；标准钢琴踏板（自然延音至下一音 / 和弦边界）
    {
        colorBias: 0.3, sparsityTendency: 0.4, contourPreference: ContourType.Random,
        syncopationAssault: 0.3, dynamicRange: [60, 110],
        pianoPedalRatio: 1.0,
        signatureLickProb: 0.15,
        lickPool: [
            [ { pitch: 72, onset: 0, duration: 0.5, velocity: 0.85 }, { pitch: 69, onset: 0.5, duration: 0.5, velocity: 0.75 }, { pitch: 67, onset: 1.0, duration: 0.5, velocity: 0.75 }, { pitch: 64, onset: 1.5, duration: 1.5, velocity: 0.9 } ]
        ],
    },
    // Drums — Dave（dynamicRange 用于 DrumIdiom 的备份记录，实际 velocity 由 DRUM_GRID 控制）
    {
        colorBias: 0.0, sparsityTendency: 0.6, contourPreference: ContourType.Upward,
        syncopationAssault: 0.2, dynamicRange: [85, 115],
    },
];

// ── Fractal — 4 分/8 分网格主导，少三连音 ──
export const MODERN_POP_FRACTAL: FractalConfig = {
    dividingProbabilities: [0.95, 0.85, 0.65, 0.35, 0.10, 0.40],
    restProbabilities:     [0.05, 0.10, 0.15, 0.25, 0.30, 0.20],
    tripletProbability: 0.05,
    minSubdivisionBeats: 0.25,
};

// ── Grammar — 8 分为主，chord tone 主导，approach 偶现 ──
//
// Phase 6 重构：terminal 不再带 pitchOffset，只标 kind（chordTone / approachTone /
//   colorTone / rest），具体 pitch 由 ToplineEngine 跟随当前和弦实例化。
//
// Phase 6.2 新增：Motif Buffer 折叠（define / recall）
//   - FORM_AABA 形式：4-beat 主歌结构，每拍 1 个 Hook 动机
//     bar 1: Define(Hook) — PRNG 抽样固化 Hook 的具体变体
//     bar 2: Recall(Hook) — 0 PRNG 复演同一动机（在下一和弦上 → Harmonic Sequence）
//     bar 3: NT(B)        — 1 拍对比块（破除单调）
//     bar 4: Recall(Hook) — 收束回主题
//   - Hook 是 1-beat 短动机（4 个变体），FORM_AABA 总长 4 beat，对齐 Fractal 常见块长
//
// 风格指纹：
//   - M = Measure phrase（顶层入口）
//   - B = Beat 级 building block（1 拍）
//   - Hook = 1-beat 折叠动机（Pop "earworm hook" 复用）
//   - chordTone 比例显著 > color/approach（流行乐"in-the-pocket"）
//   - 8 分 + 4 分主导，少 16 分（Pop 不重技术展示）
/**
 * Phase 6.3 — 升级版 Tone：可选 hint 控制音级靶向 / 方向约束。
 *
 * 使用范式（"Root + 算法展开"字典压缩）：
 *   Tone('chordTone', 0.5)                              — 走原 nearest/leap 抽样（向后兼容）
 *   Tone('chordTone', 0.5, { targetDegree: 5 })         — 强制落在和弦第 5 度（"稳跳五音"）
 *   Tone('chordTone', 0.5, { targetDegree: 3, contourDir: 1 })  — 第 3 度且强制上行
 *   Tone('chordTone', 0.5, { contourDir: -1 })          — 方向限制但 PC 不限（自由下行级进）
 *
 * hint 缺省时不挂字段（保持原 GrammarSymbol 形态 — undefined 等价 0，避免影响等值比较）。
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

const POP_GRAMMAR_RULES: GrammarRule[] = [
    // ── M：顶层入口 — Motif 折叠 vs 传统递归并行（约 1:1 权重） ──
    { lhs: 'M', rhs: [NT('FORM_AABA'), NT('M_TAIL')], weight: 6 },  // 动机折叠主路径
    { lhs: 'M', rhs: [NT('B'), NT('M')],              weight: 5 },  // 传统递归兜底
    { lhs: 'M', rhs: [NT('B')],                       weight: 2 },  // 终止
    { lhs: 'M', rhs: [Rest(0.5), NT('B'), NT('M')],   weight: 1 },  // 起音休止

    // ── M_TAIL：FORM_AABA 后续 — 继续递归或终止 ──
    { lhs: 'M_TAIL', rhs: [NT('M')], weight: 5 },
    { lhs: 'M_TAIL', rhs: [],        weight: 2 },

    // ── FORM_AABA：4-beat 主歌结构（每个 NT 出 1 拍） ──
    //   Define(Hook) 在 bar1 触发 1 次 PRNG 选定动机；后续两次 Recall 都 0 PRNG 复演。
    //   ToplineEngine 在 Recall 首音重置 cursor → 跟随当前和弦做 Harmonic Sequence。
    { lhs: 'FORM_AABA', rhs: [
        Define('Hook'),
        Recall('Hook'),
        NT('B'),
        Recall('Hook'),
    ], weight: 1 },

    // ── Hook：1-beat 动机（Phase 6.3 — 增补音级靶向变体） ──
    //   Lick_Pop_8ths — 两个 8 分 chordTone（最 Pop 的"in-the-pocket"）
    { lhs: 'Hook', rhs: [Tone('chordTone', 0.5), Tone('chordTone', 0.5)], weight: 5 },
    //   Lick_Pop_Enclosure — 16 分双 approach 半音包裹 + 8 分 chordTone（向心解决）
    { lhs: 'Hook', rhs: [
        Tone('approachTone', 0.25),
        Tone('approachTone', 0.25),
        Tone('chordTone', 0.5),
    ], weight: 3 },
    //   Lick_Pop_ColorPickup — 色彩起音 + chord 落点（抒情起句）
    { lhs: 'Hook', rhs: [Tone('colorTone', 0.5), Tone('chordTone', 0.5)], weight: 2 },
    //   Lick_Pop_Quarter — 1 拍长 chordTone（重音占位）
    { lhs: 'Hook', rhs: [Tone('chordTone', 1.0)], weight: 2 },
    //   Phase 6.3 — Lick_Pop_15Hook：1→5 大跳 hook（流行"稳跳五音"，最具辨识度的 hook 结构）
    //     无论和弦走 I/IV/V/vi，每次回放都精确落在该和弦的根+五度上 — Harmonic Sequence 的范本
    { lhs: 'Hook', rhs: [
        Tone('chordTone', 0.5, { targetDegree: 1 }),
        Tone('chordTone', 0.5, { targetDegree: 5 }),
    ], weight: 3 },
    //   Phase 6.3 — Lick_Pop_Triad：1-3-5 三连击琶音（流行开放和声起句，强制上行让轮廓清晰）
    //     在 Major 和弦上 = 真•大三和弦琶音；在 Minor 和弦上自动落小三 — degreeToInterval 算法切换
    { lhs: 'Hook', rhs: [
        Tone('chordTone', 0.33, { targetDegree: 1, contourDir: 1 }),
        Tone('chordTone', 0.33, { targetDegree: 3, contourDir: 1 }),
        Tone('chordTone', 0.34, { targetDegree: 5, contourDir: 1 }),
    ], weight: 2 },

    // ── B：1 拍内的节奏/职能型（兜底基元，未折叠） ──
    //   两个 8 分 chord（最常见）
    { lhs: 'B', rhs: [Tone('chordTone', 0.5), Tone('chordTone', 0.5)], weight: 5 },
    //   1 拍长音 chord
    { lhs: 'B', rhs: [Tone('chordTone', 1.0)],                          weight: 4 },
    //   8 分 chord + 8 分 approach（前置经过音）
    { lhs: 'B', rhs: [Tone('chordTone', 0.5), Tone('approachTone', 0.5)], weight: 2 },
    //   附点 + 16 分 approach（切分进入下个 chord）
    { lhs: 'B', rhs: [Tone('chordTone', 0.75), Tone('approachTone', 0.25)], weight: 2 },
    //   chord + approach + chord 三连击（典型 R&B 经过）
    { lhs: 'B', rhs: [Tone('chordTone', 0.5), Tone('approachTone', 0.25), Tone('chordTone', 0.25)], weight: 2 },
    //   8 分 color + 8 分 chord（色彩点缀）
    { lhs: 'B', rhs: [Tone('colorTone', 0.5), Tone('chordTone', 0.5)], weight: 1 },
    //   弱拍休止 + 8 分 chord（呼吸）
    { lhs: 'B', rhs: [Rest(0.5), Tone('chordTone', 0.5)],              weight: 1 },
];

export const MODERN_POP_GRAMMAR: GrammarConfig = {
    startSymbol: 'M',
    rules: POP_GRAMMAR_RULES,
    maxExpansions: 200,
};

// ── Drum Grid — 经典 4/4 直拍 ──
//   step 0/8 : Kick（1拍 + 3拍）
//   step 4/12: Snare（2拍 + 4拍）
//   step 偶数: Hihat（每 8 分）— 0,2,4,6,8,10,12,14
//   step 7/15: Kick syncopate 弱概率（Pop and-of-beat ghost）
function buildPopGrid(): DrumStepConfig[] {
    const g: DrumStepConfig[] = new Array(16);
    for (let i = 0; i < 16; i++) {
        g[i] = { kickProb: 0, snareProb: 0, hihatProb: 0 };
    }
    // Kick 强拍
    g[0].kickProb = 0.95;
    g[8].kickProb = 0.90;
    // Kick 弱拍 syncopate（Pop "and of 2" / "and of 4"）
    g[7].kickProb = 0.20;
    g[15].kickProb = 0.15;
    // Snare 2/4 拍
    g[4].snareProb = 0.92;
    g[12].snareProb = 0.92;
    // Hihat 8 分稳态
    const hihatSteps = [0, 2, 4, 6, 8, 10, 12, 14];
    for (let i = 0; i < hihatSteps.length; i++) {
        g[hihatSteps[i]].hihatProb = 0.80;
    }
    // 16 分弱位偶尔点缀（Pop ghost hihat）
    g[3].hihatProb = 0.25;
    g[11].hihatProb = 0.25;
    return g;
}

export const MODERN_POP_DRUM_GRID: DrumGridConfig = {
    grid: buildPopGrid(),
    // energy 1~10 → prob 缩放（低能渐入）
    energyProbScale: [0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00, 1.00],
    // energy 1~10 → velocity 缩放
    energyVelScale:  [0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00],
    snareEnergyGate: 4,                  // energy < 4 不出 Snare（Intro 渐入）
    kickVelocity:  [95, 115],            // 厚重正拍
    snareVelocity: [90, 115],
    hihatVelocity: [55, 85],             // 偏弱，让 Kick/Snare 跳出来
};

// ============================================================
// 曲式模板池（Phase 3 结构剥离）
// ============================================================

export const MODERN_POP_STRUCTURES: StructureTemplate[] = [
    { id: 'pop-standard', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 3 }, { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 }, { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 }, { name: 'Bridge', type: SectionType.Bridge, bars: 8, energy: 7 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 4 } ] },
    { id: 'pop-short', sections: [ { name: 'Intro', type: SectionType.Intro, bars: 4, energy: 3 }, { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 }, { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 4 } ] },
    // 改动 G — Verse 冷启动变体：跳过 Intro 段，主歌直接进，避免每首歌开头都是同一 mood
    { id: 'pop-cold-verse', sections: [ { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 }, { name: 'Verse', type: SectionType.Verse, bars: 8, energy: 5 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 }, { name: 'Bridge', type: SectionType.Bridge, bars: 8, energy: 7 }, { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 }, { name: 'Outro', type: SectionType.Outro, bars: 4, energy: 4 } ] }
];
