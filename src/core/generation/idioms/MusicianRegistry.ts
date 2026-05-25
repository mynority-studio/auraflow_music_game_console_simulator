// ============================================================
// MusicianRegistry — MVP 4 卡牌池
// ============================================================
//
// 4 个 MVP 卡牌（V1：每角色各 1 张，固定 4 人乐队）：
//   - alex_piano   (Piano, eligible MainInst + Accomp)  — 双角色钢琴手
//   - frank_bass   (Electric Bass, eligible Bass)        — 正拍稳重电贝斯
//   - dave_drums   (Drum Kit, eligible Drums)            — Pop 干净直拍
//   - nina_pad     (Warm Pad, eligible Atmosphere)       — 长音铺底氛围
//
// 后续 V2 扩展方向：
//   - 每角色多张卡牌（Alex/Chloe/Marcus 三选一钢琴手）
//   - 按 styleAffinity 做"乐手 × 风格"匹配度评分
// ============================================================

import {
    Musician,
    BandRole,
    InstrumentFamily,
    MusicianPersona,
    SectionType,
} from '../types';
import { StyleId } from '../config/StyleFlags';
// MASTER_MANIFESTS 已删(2026-05-24)
// MasterLickCompiler 已删(2026-05-24 大清理)— lickPool 在 AF2 路径未消费,
// 仍保留 master cards 但 lickPool = undefined。

// ------------------------------------------------------------
// 4 卡牌池
// ------------------------------------------------------------

export const MUSICIAN_POOL: Musician[] = [
    // 🎹 钢琴手 Alex — Pop/Jazz 通用，可承担 MainInst（旋律）+ Accomp（伴奏）双角色
    {
        id: 'alex_piano',
        name: 'Alex',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.4,
            sparsityTendency: 0.5,
            syncopationAssault: 0.3,
            dynamicRange: [55, 100],
            // Phase 3 — alex_piano 是 Pop / Jazz 钢琴 comping 的"定海神针"
            // 跨段保持 STYLE_ANCHOR_RECIPE 锁定的 recipe,只让 density 浮动
            // Phase 6a — anchor 几乎不睡(wakeK 极低)
            wakeK: 0.05,
            peakK: 0.85,
        },
        description: 'Pop/Jazz 通用钢琴手，双角色（主奏 + 伴奏）',
        // AF2 overrides — alex 作"通用对照"opt-in melody+accomp 全 AF2 算法,
        // 验证 v1.1 跨 musician 稳定性。marcus 留对照(纯 mg)
        af2Overrides: {
            melodyAlgorithm: 'af2',
            accompAlgorithm: 'af2',
        },
    },
    // 🎸 贝斯手 Frank — Pop/Funk 电贝斯，正拍稳重
    {
        id: 'frank_bass',
        name: 'Frank',
        genre: StyleId.ModernPop,
        instrumentRef: 'electric_bass',
        instrumentFamily: InstrumentFamily.Bass,
        defaultSound: 'Electric_Bass_Finger',
        personnel: {},
        role: BandRole.Bass,
        eligibleRoles: [BandRole.Bass],
        instrumentId: 2,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.5,
            syncopationAssault: 0.1,
            dynamicRange: [75, 110],
            // B4(2026-05-24):移除 walkPatternId 让 mgStyle 默认生效
            //   - mgStyle=POP   → HalfNote(同原始 Pop 抒情 root-fifth,听感不变)
            //   - mgStyle=JAZZ  → BebopWalk(swing 0.66)
            //   - mgStyle=BLUES → Stride
            //   - mgStyle=RNB   → QuarterHalf
            // 如需固定某 musician 走某 walking 不管 mgStyle,在此处填 walkPatternId override。
            // Phase 6a — bass 中等 wake(低 K Intro/Outro 可睡,Verse 起开始走)
            wakeK: 0.30,
            peakK: 0.90,
        },
        description: 'Pop/Jazz/Blues/RNB 通用电贝斯,walking 跟 mgStyle 走',
        // AF2 overrides — Pop sub-bass 标准:Intro 不进,Outro 撤(经典 Pop 编曲)
        af2Overrides: {
            sectionRolePreference: {
                [SectionType.Intro]: new Set<string>(),   // Pop bass 不在 Intro 进
                [SectionType.Outro]: new Set<string>(),   // Outro 淡出
            },
        },
    },
    // 🥁 鼓手 Dave — Pop 干净直拍
    {
        id: 'dave_drums',
        name: 'Dave',
        genre: StyleId.ModernPop,
        instrumentRef: 'drum_kit',
        instrumentFamily: InstrumentFamily.Percussion,
        defaultSound: 'Drums',
        personnel: {},
        role: BandRole.Drums,
        eligibleRoles: [BandRole.Drums],
        instrumentId: 3,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.6,
            syncopationAssault: 0.2,
            dynamicRange: [85, 115],
            // Phase 4 — Apex Predator 演示:鼓组 BuildUp/Chorus 峰值 K > 0.80 时
            // 触发 ducking,Accomp + Atmosphere velocity ×= 0.6,让出空间给鼓
            isApex: true,
            // Phase 6a — 鼓在低 K(Intro/Outro)睡眠;peakK=1.0 永不饱和(apex 主导)
            wakeK: 0.25,
            peakK: 1.00,
        },
        description: 'Pop 鼓手，干净直拍',
    },
    // 🎹 Chloe — Pop 直拍钢琴手（极低 sync、极简色彩，主流流行标准伴奏）
    {
        id: 'chloe_pop_piano',
        name: 'Chloe',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.15,           // 极少 9/11/13 — 三和弦 + 偶尔 7 为主
            sparsityTendency: 0.4,
            syncopationAssault: 0.05,  // 几乎完全正拍 — 主流流行钢琴标准
            dynamicRange: [60, 95],
        },
        description: '主流 Pop 钢琴手 — 极简直拍，给主旋律留空间',
        // AF2 overrides — 保守 Pop:严守主区,极少越界,不太用 add11 物理
        af2Overrides: {
            regions: {
                accomp: { lo: 50, hi: 67 },  // D3-G4,中区保守(默认 [48, 71] 更窄)
            },
            escapeProbability: 0.02,      // 默认 0.05 → 0.02(几乎完全 clamp)
            add11GateProbability: 0.30,   // 默认 0.60 → 0.30(Pop 不太用 11音物理)
            melodyAlgorithm: 'af2',        // MVP testbed:opt-in AF2 自家 melody 算法
            accompAlgorithm: 'af2',        // accomp 也 opt-in(配套测试 Block/Arp/Stab patterns)
        },
    },
    // 🌫️ 氛围乐手 Nina — Warm Pad 长音铺底
    {
        id: 'nina_pad',
        name: 'Nina',
        genre: StyleId.ModernPop,
        instrumentRef: 'warm_pad',
        instrumentFamily: InstrumentFamily.Pad,
        defaultSound: 'Warm_Pad',
        personnel: {
            atmosphereOverrides: {
                attackSoftness: 0.7,
                releaseRatio: 1.1,
                voiceCount: 4,
                velocityRange: [40, 75],
                crossfade: true,
                octaveLayering: false,
            },
        },
        role: BandRole.Atmosphere,
        eligibleRoles: [BandRole.Atmosphere],
        instrumentId: 4,
        persona: {
            colorBias: 0.5,
            sparsityTendency: 0.9,   // 极稀疏（pad 每小节最多 1~2 击点）
            syncopationAssault: 0.0, // pad 永远不切分
            dynamicRange: [40, 80],
            // Phase 3 — nina_pad 是 NeoSoul / Cinematic 编制的"定海神针"
            // Pad 天然 sustained,density 浮动主要影响 voiceCount 与 octaveLayering
            // Phase 6a — pad 几乎不睡(开阔感铺底);peakK 中等(高 K 触发 octaveLayering 已够)
            wakeK: 0.10,
            peakK: 0.85,
        },
        description: 'Warm Pad 氛围乐手，长音铺底',
    },
    // 2026-05-24:master cards 已删 — 老 Stage5Layering / MasterPhraseRenderer
    //   / MasterLickCompiler 已不存在,AF2 不消费 masterId / lickPool。

    // ============================================================
    // X 阶段(2026-05-25):6 个新 musician card variants(共 11 卡)
    // 让 band 抽签 multi-style 多样化,各 mgStyle 都有 idiomatic musician
    // ============================================================

    // 🎹 Marcus — Neo-Soul 钢琴(D'Angelo 风,大量 11/13 物理 + 切分)
    {
        id: 'marcus_neosoul_piano',
        name: 'Marcus',
        genre: StyleId.NeoSoul,
        instrumentRef: 'electric_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Electric_Piano_1',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.85,           // 大量 9/11/13 色彩 — neo-soul 标志
            sparsityTendency: 0.55,
            syncopationAssault: 0.75,  // D'Angelo 高切分
            dynamicRange: [50, 95],
            wakeK: 0.15,
            peakK: 0.90,
        },
        description: 'Neo-Soul 钢琴(Electric Piano,11/13 色彩物理强,D\'Angelo 切分)',
        af2Overrides: {
            regions: {
                accomp: { lo: 55, hi: 76 },  // G3-E5,中高区 neo-soul 常用
            },
            escapeProbability: 0.10,
            add11GateProbability: 0.80,   // neo-soul 大量 11音 hand physics
            melodyAlgorithm: 'af2',
            accompAlgorithm: 'af2',
        },
    },

    // 🎹 Billy — Jazz 钢琴(Bill Evans 风,rootless comping + altered tensions)
    {
        id: 'billy_jazz_piano',
        name: 'Billy',
        genre: StyleId.ChillJazz,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.7,            // jazz altered tensions(7alt/13b9)多
            sparsityTendency: 0.65,    // comping 稀疏(Bill Evans rootless)
            syncopationAssault: 0.55,  // swing comping
            dynamicRange: [50, 95],
            wakeK: 0.20,
            peakK: 0.85,
        },
        description: 'Jazz 钢琴(Bill Evans 风,rootless comping,altered tensions)',
        af2Overrides: {
            regions: {
                accomp: { lo: 48, hi: 72 },  // C3-C5,jazz 中区
            },
            escapeProbability: 0.08,
            add11GateProbability: 0.55,
            melodyAlgorithm: 'af2',
            accompAlgorithm: 'af2',
        },
    },

    // 🎸 Maya — Funk / RnB Slap Bass(LatinTumbao 固定,sync 高)
    {
        id: 'maya_slap_bass',
        name: 'Maya',
        genre: StyleId.NeoSoul,
        instrumentRef: 'slap_bass',
        instrumentFamily: InstrumentFamily.Bass,
        defaultSound: 'Slap_Bass_1',
        personnel: {},
        role: BandRole.Bass,
        eligibleRoles: [BandRole.Bass],
        instrumentId: 2,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.3,
            syncopationAssault: 0.65,
            dynamicRange: [85, 118],
            walkPatternId: 4,           // LatinTumbao(funk 律动,固定 override mgStyle)
            wakeK: 0.35,
            peakK: 0.95,
        },
        description: 'Funk/RnB Slap Bass(LatinTumbao 律动,sync 高,Intro/Outro 撤)',
        af2Overrides: {
            sectionRolePreference: {
                [SectionType.Intro]: new Set<string>(),   // Slap 不在 Intro 进
                [SectionType.Outro]: new Set<string>(),   // Outro 淡出
            },
        },
    },

    // 🥁 Jazz Brush — Jazz brush drumming(swing accent,sparsity 高)
    {
        id: 'jazz_brush_drummer',
        name: 'Jazz Brush',
        genre: StyleId.ChillJazz,
        instrumentRef: 'drum_kit',
        instrumentFamily: InstrumentFamily.Percussion,
        defaultSound: 'Drums',
        personnel: {},
        role: BandRole.Drums,
        eligibleRoles: [BandRole.Drums],
        instrumentId: 3,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.75,    // brush 稀疏
            syncopationAssault: 0.45,  // swing accent
            dynamicRange: [50, 90],    // brush 力度弱
            // isApex 不设(jazz drums 衬托,不主导 ducking)
            wakeK: 0.30,
            peakK: 0.85,
        },
        description: 'Jazz brush drumming,swing accent,衬托非主导',
    },

    // 🌫️ Dark Pad — Cinematic 暗色(更稀疏更慢 attack)
    {
        id: 'dark_pad',
        name: 'Dark Pad',
        genre: StyleId.ChillJazz,
        instrumentRef: 'warm_pad',
        instrumentFamily: InstrumentFamily.Pad,
        defaultSound: 'Pad_5_Bowed',
        personnel: {
            atmosphereOverrides: {
                attackSoftness: 0.9,      // 超慢 fade(0.45 beat preRoll)
                releaseRatio: 1.3,        // 尾巴拖 30%
                voiceCount: 3,            // 更少 voice
                velocityRange: [30, 60],  // 偏弱
                crossfade: true,
                octaveLayering: true,     // 低 octave 加厚(cinematic)
            },
        },
        role: BandRole.Atmosphere,
        eligibleRoles: [BandRole.Atmosphere],
        instrumentId: 4,
        persona: {
            colorBias: 0.3,           // 暗色 — 少色彩
            sparsityTendency: 0.95,   // 极稀疏
            syncopationAssault: 0.0,
            dynamicRange: [30, 60],
            wakeK: 0.10,
            peakK: 0.75,              // 低 peak — 不爆发
        },
        description: 'Dark cinematic pad(暗色长音,bowed,octaveLayering 加厚)',
    },

    // 🌫️ Bright Choir Pad — 神圣亮 choir(更多 voice,colorBias 高)
    {
        id: 'bright_choir_pad',
        name: 'Bright Choir',
        genre: StyleId.NeoSoul,
        instrumentRef: 'choir',
        instrumentFamily: InstrumentFamily.Pad,
        defaultSound: 'Choir_Aahs',
        personnel: {
            atmosphereOverrides: {
                attackSoftness: 0.5,      // 中等 fade
                releaseRatio: 1.05,
                voiceCount: 5,            // 更多 voice(神圣感)
                velocityRange: [50, 90],  // 亮一些
                crossfade: true,
                octaveLayering: false,
            },
        },
        role: BandRole.Atmosphere,
        eligibleRoles: [BandRole.Atmosphere],
        instrumentId: 4,
        persona: {
            colorBias: 0.8,           // 大量色彩(maj9 / m9 etc.)
            sparsityTendency: 0.80,   // 稍密(比 nina_pad 0.9 略密)
            syncopationAssault: 0.0,
            dynamicRange: [50, 90],
            wakeK: 0.10,
            peakK: 0.90,              // peak 高 — gospel 感强
        },
        description: 'Bright choir pad(神圣亮色,voiceCount 5,colorBias 0.8)',
    },
];

// ------------------------------------------------------------
// 查询 API
// ------------------------------------------------------------

export function getMusicianById(id: string): Musician | undefined {
    for (let i = 0; i < MUSICIAN_POOL.length; i++) {
        if (MUSICIAN_POOL[i].id === id) return MUSICIAN_POOL[i];
    }
    return undefined;
}

/**
 * 按职能查询 — 走 eligibleRoles（不是单一 role）。
 * 钢琴手会同时出现在 getMusiciansByRole(MainInst) 和 getMusiciansByRole(Accomp) 的结果中。
 */
export function getMusiciansByRole(role: BandRole): Musician[] {
    const out: Musician[] = [];
    for (let i = 0; i < MUSICIAN_POOL.length; i++) {
        const m = MUSICIAN_POOL[i];
        for (let r = 0; r < m.eligibleRoles.length; r++) {
            if (m.eligibleRoles[r] === role) {
                out.push(m);
                break;
            }
        }
    }
    return out;
}

