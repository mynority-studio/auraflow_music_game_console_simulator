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

import { ChordQuality, ContourType, MusicianPersona, NoteData, SectionType, StructureTemplate } from '../../types';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
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


// ============================================================
// Voice Leading Config — Pop 略松
// ============================================================


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
