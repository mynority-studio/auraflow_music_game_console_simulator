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

import { ChordQuality, ContourType, MusicianPersona, NoteData, SectionType, StructureTemplate } from '../../types';
import { FractalConfig } from '../../primitives/FractalStructureEngine';
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


// ============================================================
// Voice Leading Config — Jazz 黏 + 允许部分平行
// ============================================================


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
