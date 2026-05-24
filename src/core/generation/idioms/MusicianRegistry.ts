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
//   - assembleActiveIdiom 把 persona + PangeaInstrument deep merge 出实际 Idiom 图纸
// ============================================================

import {
    InstrumentIdiom,
    Musician,
    LeadIdiom,
    CompingIdiom,
    BandRole,
    ContourType,
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
            contourPreference: ContourType.Random,
            syncopationAssault: 0.3,
            dynamicRange: [55, 100],
            pianoPedalRatio: 1.0,
            signatureLickProb: 0.15,
            // Phase 3 — alex_piano 是 Pop / Jazz 钢琴 comping 的"定海神针"
            // 跨段保持 STYLE_ANCHOR_RECIPE 锁定的 recipe,只让 density 浮动
            isAnchor: true,
            // Phase 6a — anchor 几乎不睡(wakeK 极低)
            wakeK: 0.05,
            peakK: 0.85,
            // C1：Pop 经典 C 大调下行级进 hook（C5 → A4 → G4 → E4），1.5 拍长音收 mi
            lickPool: [
                [
                    { pitch: 72, onset: 0,   duration: 0.5, velocity: 0.85 },
                    { pitch: 69, onset: 0.5, duration: 0.5, velocity: 0.75 },
                    { pitch: 67, onset: 1.0, duration: 0.5, velocity: 0.75 },
                    { pitch: 64, onset: 1.5, duration: 1.5, velocity: 0.9  },
                ],
            ],
            // C1：Pop 中庸 topologyConfig — invert/reverse 偶现，sideSlip 小幅度（避免破坏调内级进）
            topologyConfig: {
                probInvert:    0.15,
                probReverse:   0.10,
                probExpand:    0.20,
                probSideSlip:  0.10,
                sideSlipRange: 2,
                colorBias:     0.4,
            },
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
            contourPreference: ContourType.Upward,
            syncopationAssault: 0.1,
            dynamicRange: [75, 110],
            // A1：Pop 抒情 root-fifth 半音符律动（Bill Evans 风慢 walking）
            walkPatternId: 1,  // WalkPatternId.HalfNote
            // Phase 6a — bass 中等 wake(低 K Intro/Outro 可睡,Verse 起开始走)
            wakeK: 0.30,
            peakK: 0.90,
        },
        description: 'Pop 电贝斯，正拍稳重 + 半音符 walking',
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
            contourPreference: ContourType.Upward,
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
            contourPreference: ContourType.Random,
            syncopationAssault: 0.05,  // 几乎完全正拍 — 主流流行钢琴标准
            dynamicRange: [60, 95],
            pianoPedalRatio: 1.0,
            signatureLickProb: 0.0,    // 不用 lick
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
    // 🎹 Marcus — Neo-Soul 钢琴手（高色彩 + 高 sync + 高 lickProb，D'Angelo 风）
    {
        id: 'marcus_neosoul_piano',
        name: 'Marcus',
        genre: StyleId.NeoSoul,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.9,            // 大量 9/11/13 — Neo-Soul 标志高色彩
            sparsityTendency: 0.7,     // 稀疏击点（让 groove 呼吸）
            contourPreference: ContourType.Alternating,
            syncopationAssault: 0.75,  // 高切分 — 触发 V3.8 物理求解器
            dynamicRange: [45, 95],
            pianoPedalRatio: 0.8,
            signatureLickProb: 0.25,   // 25% 概率甩 lick — Robert Glasper 风
            // C1：Neo-Soul 16 分密集切分 hook（D5 → C5 → A4 → B4 → C5），现代 R&B 标志旋律
            lickPool: [
                [
                    { pitch: 74, onset: 0,    duration: 0.25, velocity: 0.8  },
                    { pitch: 72, onset: 0.25, duration: 0.25, velocity: 0.9  },
                    { pitch: 69, onset: 0.5,  duration: 0.25, velocity: 0.7  },
                    { pitch: 71, onset: 0.75, duration: 0.25, velocity: 0.8  },
                    { pitch: 72, onset: 1.0,  duration: 1.0,  velocity: 0.85 },
                ],
            ],
            // C1：高 topologyConfig — invert/reverse/sideSlip 都拉高，每次 lick 都变形
            topologyConfig: {
                probInvert:    0.25,
                probReverse:   0.20,
                probExpand:    0.20,
                probSideSlip:  0.25,
                sideSlipRange: 3,
                colorBias:     0.7,
            },
        },
        description: 'Neo-Soul 钢琴手 — 高切分 + 高色彩 + 频繁签名 lick',
        // AF2 overrides — 激进 Neo-Soul:扩展 accomp 上探色彩位,自由越界,强 add11 物理
        af2Overrides: {
            regions: {
                melody: { lo: 60, hi: 89 },  // C4-F6,允许较高 lead(默认 hi=86)
                accomp: { lo: 48, hi: 79 },  // C3-G5,上探到 G5(neo-soul comping 拉到 high color)
            },
            escapeProbability: 0.12,      // 默认 0.05 → 0.12(更多自然越界,对应 colorBias 0.9)
            add11GateProbability: 0.85,   // 默认 0.60 → 0.85(D'Angelo 风强烈 11音物理)
            melodyAlgorithm: 'af2',        // 跨 musician 稳定性验证:NeoSoul 也 opt-in
            accompAlgorithm: 'af2',
        },
    },
    // 🎸 Maya — Slap Bass（高 sync + ghost note 风格）
    {
        id: 'maya_slap_bass',
        name: 'Maya',
        genre: StyleId.NeoSoul,
        instrumentRef: 'electric_bass',
        instrumentFamily: InstrumentFamily.Bass,
        defaultSound: 'Electric_Bass_Slap',
        personnel: {},
        role: BandRole.Bass,
        eligibleRoles: [BandRole.Bass],
        instrumentId: 2,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.3,     // 比 Frank 密集 — slap 节奏密集
            contourPreference: ContourType.Random,
            syncopationAssault: 0.7,   // 高切分 — Marcus Miller 风
            dynamicRange: [80, 115],   // 比 Frank 略响
            // A1：Latin Tumbao 8th — root/5 + 切分 next-root，配合高 sync 的 slap attack
            walkPatternId: 4,  // WalkPatternId.LatinTumbao
        },
        description: 'Slap Bass — 切分密集 + Latin Tumbao walking，Marcus Miller 风',
        // AF2 overrides — Slap 挑段:Intro/Outro 不显,Chorus/PreChorus 必弹推 groove
        af2Overrides: {
            sectionRolePreference: {
                [SectionType.Intro]: new Set<string>(),
                [SectionType.Outro]: new Set<string>(),
                [SectionType.PreChorus]: new Set<string>(['bass']),  // 必弹推 build
                [SectionType.Chorus]: new Set<string>(['bass']),     // 必弹主推
            },
        },
    },
    // 🥁 Jazz_Drummer — Brush 风（低 velocity + 高 sync ride pattern）
    {
        id: 'jazz_brush_drummer',
        name: 'Brush',
        genre: StyleId.ChillJazz,
        instrumentRef: 'drum_kit',
        instrumentFamily: InstrumentFamily.Percussion,
        defaultSound: 'Brush_Kit',
        personnel: {},
        role: BandRole.Drums,
        eligibleRoles: [BandRole.Drums],
        instrumentId: 3,
        persona: {
            colorBias: 0.0,
            sparsityTendency: 0.7,     // 比 Dave 稀疏 — 爵士 brush 留白
            contourPreference: ContourType.Upward,
            syncopationAssault: 0.5,   // swing feel
            dynamicRange: [55, 90],    // 比 Dave 弱 — brush 柔和
        },
        description: '爵士 Brush 鼓手 — 柔和低力度、swing ride、稀疏 fill',
    },
    // 🎹 Billy Bounce — Lemon Tree 风 oom-pah 钢琴手（Solo Piano 模式触发 M6 Bounce）
    {
        id: 'billy_bounce',
        name: 'Billy',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
        instrumentFamily: InstrumentFamily.Piano,
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.Accomp,
        eligibleRoles: [BandRole.MainInst, BandRole.Accomp],
        instrumentId: 0,
        persona: {
            colorBias: 0.2,            // 偏简单三和弦/7和弦
            sparsityTendency: 0.1,     // 全程不停弹（bounce 律动靠重复）
            contourPreference: ContourType.Alternating,
            syncopationAssault: 0.1,   // 基本正拍
            dynamicRange: [60, 100],
            bouncePreference: 0.8,     // V4.1：高 bounce 偏好（Solo Piano 模式优先 M6）
        },
        description: 'Lemon Tree 风 oom-pah 钢琴手 — Solo Piano 模式触发 M6 Bounce',
        // AF2 overrides — Billy 不停弹(sparsityTendency 0.1),Outro/Break 也要 accomp 存在
        af2Overrides: {
            // 标准 region(billy 不上探也不下探)
            // sectionRolePreference:Billy 在 Conductor template 默认 silent 的 sections
            // (Break/Outro)也保持 accomp 存在(bounce 律动靠不停)
            sectionRolePreference: {
                [SectionType.Break]:     new Set(['accomp']),                  // bounce 不停
                [SectionType.Breakdown]: new Set(['accomp']),
                [SectionType.Outro]:     new Set(['accomp', 'bass']),          // outro 兼 bass
                [SectionType.PreOutro]:  new Set(['accomp', 'bass']),
            },
            melodyAlgorithm: 'af2',
            accompAlgorithm: 'af2',
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
            contourPreference: ContourType.Alternating,
            syncopationAssault: 0.0, // pad 永远不切分
            dynamicRange: [40, 80],
            // Phase 3 — nina_pad 是 NeoSoul / Cinematic 编制的"定海神针"
            // Pad 天然 sustained,density 浮动主要影响 voiceCount 与 octaveLayering
            isAnchor: true,
            // Phase 6a — pad 几乎不睡(开阔感铺底);peakK 中等(高 K 触发 octaveLayering 已够)
            wakeK: 0.10,
            peakK: 0.85,
        },
        description: 'Warm Pad 氛围乐手，长音铺底',
    },
    // 2026-05-24:master cards 已删 — 老 Stage5Layering / MasterPhraseRenderer
    //   / MasterLickCompiler 已不存在,AF2 不消费 masterId / lickPool。
];

export const PANGEA_DICT: Record<string, unknown> = {};

// ------------------------------------------------------------
// Idiom 占位（V1：assembleActiveIdiom 仍是 stub，未来按 persona 派生）
// ------------------------------------------------------------

const STUB_LEAD: LeadIdiom = {
    needsBreathing: false,
    humanizeVelocity: 0.05,
    pianoPedalRatio: 1.0,
    graceNoteProbability: 0.0,
    octaveDoubling: false,
};

const STUB_COMPING: CompingIdiom = {
    strumDelay: 0.0,
    compingPatterns: [],
    compingDuration: 0.5,
    allowDrop2: false,
    textureType: 'block',
    textureProbabilities: { block: 1.0, arpeggio: 0.0, comping: 0.0 },
};

export function assembleActiveIdiom(musician: Musician, slot: BandRole): InstrumentIdiom {
    return { id: `${musician.id}_at_${slot}`, lead: { ...STUB_LEAD }, comping: { ...STUB_COMPING } };
}

// ------------------------------------------------------------
// 查询 API
// ------------------------------------------------------------

interface PRNGLike {
    nextInt(min: number, max: number): number;
    nextFloat(min: number, max: number): number;
}

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

export function getRandomMusicianByRole(
    role: BandRole,
    prng: PRNGLike,
    _allowedStyleIds?: StyleId[],
): Musician | undefined {
    const pool = getMusiciansByRole(role);
    if (pool.length === 0) return undefined;
    const idx = prng.nextInt(0, pool.length - 1);
    return pool[idx];
}

export function getRandomLeadMusician(
    _allowedStyleIds: StyleId[] | undefined,
    prng: PRNGLike,
): Musician | undefined {
    return getRandomMusicianByRole(BandRole.MainInst, prng);
}

export const DEFAULT_FALLBACK_IDIOM: InstrumentIdiom = {
    id: 'stub_fallback',
    lead: { ...STUB_LEAD },
    comping: { ...STUB_COMPING },
};
