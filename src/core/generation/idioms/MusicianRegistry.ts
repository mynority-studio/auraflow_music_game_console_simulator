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
    PersonaManifest,
    MusicianPersona,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { MASTER_MANIFESTS } from '../data/MasterPersonas';
import { compileMasterLickPool } from '../primitives/MasterLickCompiler';

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
            legatoRatio: 1.0,
            signatureLickProb: 0.15,
        },
        description: 'Pop/Jazz 通用钢琴手，双角色（主奏 + 伴奏）',
    },
    // 🎸 贝斯手 Frank — Pop/Funk 电贝斯，正拍稳重
    {
        id: 'frank_bass',
        name: 'Frank',
        genre: StyleId.ModernPop,
        instrumentRef: 'electric_bass',
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
        },
        description: 'Pop 电贝斯，正拍稳重',
    },
    // 🥁 鼓手 Dave — Pop 干净直拍
    {
        id: 'dave_drums',
        name: 'Dave',
        genre: StyleId.ModernPop,
        instrumentRef: 'drum_kit',
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
        },
        description: 'Pop 鼓手，干净直拍',
    },
    // 🎹 Chloe — Pop 直拍钢琴手（极低 sync、极简色彩，主流流行标准伴奏）
    {
        id: 'chloe_pop_piano',
        name: 'Chloe',
        genre: StyleId.ModernPop,
        instrumentRef: 'grand_piano',
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
            legatoRatio: 1.0,
            signatureLickProb: 0.0,    // 不用 lick
        },
        description: '主流 Pop 钢琴手 — 极简直拍，给主旋律留空间',
    },
    // 🎹 Marcus — Neo-Soul 钢琴手（高色彩 + 高 sync + 高 lickProb，D'Angelo 风）
    {
        id: 'marcus_neosoul_piano',
        name: 'Marcus',
        genre: StyleId.NeoSoul,
        instrumentRef: 'grand_piano',
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
            legatoRatio: 0.8,
            signatureLickProb: 0.25,   // 25% 概率甩 lick — Robert Glasper 风
        },
        description: 'Neo-Soul 钢琴手 — 高切分 + 高色彩 + 频繁签名 lick',
    },
    // 🎸 Maya — Slap Bass（高 sync + ghost note 风格）
    {
        id: 'maya_slap_bass',
        name: 'Maya',
        genre: StyleId.NeoSoul,
        instrumentRef: 'electric_bass',
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
        },
        description: 'Slap Bass — 切分密集、attack 强、Marcus Miller 风',
    },
    // 🥁 Jazz_Drummer — Brush 风（低 velocity + 高 sync ride pattern）
    {
        id: 'jazz_brush_drummer',
        name: 'Brush',
        genre: StyleId.ChillJazz,
        instrumentRef: 'drum_kit',
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
    },
    // 🌫️ 氛围乐手 Nina — Warm Pad 长音铺底
    {
        id: 'nina_pad',
        name: 'Nina',
        genre: StyleId.ModernPop,
        instrumentRef: 'warm_pad',
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
        },
        description: 'Warm Pad 氛围乐手，长音铺底',
    },
    // ============================================================
    // 🎓 大师托管卡（Flash Personas → MainInst）
    // ============================================================
    // 这些卡的 persona 携带 `masterId`，触发 Stage5Layering 的 Master Takeover 路径：
    //   整段旋律的 grammar 来源切换到 flash/personas/<id>.json 的 customRootIds
    //   （指向 COMMON_GRAMMAR_ROOTS），绕过 style 层 PCFG rules。
    //
    // 用法：
    //   forcedBand: { mainInst: 'master_bill_evans' }
    //   → BandEngine.activeMusicians 含 MainInst card
    //   → Stage5Layering 用该 card.persona 覆盖 bundle.personas[ROLE_LEAD]
    //   → renderLead 命中 masterId → MasterPhraseRenderer 渲染整段 TerminalSymbol 流
    //
    // 注：`defaultSound` 统一用 Acoustic_Grand（项目尚无管乐 GM 音色映射），
    //     未来扩展 sax/trumpet 音色时仅需改此字段。
    // ============================================================
    ...buildMasterCards(),
];

export const PANGEA_DICT: Record<string, unknown> = {};

// ============================================================
// 大师 Persona → Musician 卡 派生
// ============================================================
//
// 从 PersonaManifest（flash JSON 编译产物）派生 Musician 卡（MainInst-eligible 钢琴手）。
//
// 派生规则：
//   - colorBias:        透传 manifest.topologyConfig.colorBias（已落在 0.42~0.62 区间）
//   - sparsityTendency: 由 stats.restRatio 线性映射到 [0.3, 0.7]
//                       （CommonRoots 已含 rest token，sparsityTendency 仅作为兜底参考；
//                        Stage5 lead 路径主要由 grammar 自身决定密度）
//   - syncopationAssault: 0.6 通用 jazz；DexterGordon 例外 0.3（hard bop 强拍锚定）
//   - dynamicRange:     [60, 105] 中度 jazz lead 力度区间
//   - legatoRatio:      1.0（钢琴自然踏板）
//   - signatureLickProb:0.0（takeover 路径下整段已是大师 grammar，不再拼接额外 lick）
//   - topologyConfig:   透传 manifest.topologyConfig（B-Lick 模式或拓扑变换路径仍可消费）
//   - masterId:         透传 manifest.id（**takeover 路径的开关键**）
//
// `eligibleRoles = [MainInst]`：大师不接 Accomp，避免被 alex_piano 的 Accomp 角色挤占。
// 后续如想让大师同时承担伴奏，可加入 BandRole.Accomp。
function buildMasterCards(): Musician[] {
    const out: Musician[] = [];
    // 每位大师两张卡：takeover 主奏卡 + lick-only 偶发卡
    //   - master_<id>        : takeover（整段大师 grammar 主导）
    //   - master_<id>_licks  : lick-only（PCFG 为底色，signatureLickProb 触发时拼接大师 lick）
    for (let i = 0; i < MASTER_MANIFESTS.length; i++) {
        const m = MASTER_MANIFESTS[i];
        out.push(deriveMasterCard(m, 'takeover'));
        out.push(deriveMasterCard(m, 'lick-only'));
    }
    return out;
}

function deriveMasterCard(
    manifest: PersonaManifest,
    mode: 'takeover' | 'lick-only',
): Musician {
    const restRatio = manifest.stats?.restRatio ?? 0.1;
    // restRatio 实测 0.05~0.11 → 映射到 [0.3, 0.7]（线性）
    const sparsity = Math.min(0.7, Math.max(0.3, 0.3 + (restRatio - 0.05) * (0.4 / 0.06)));
    const isHardBop = manifest.id === 'DexterGordon';

    // lick-only 模式预编译 lickPool（一次性，模块加载时）；takeover 模式不需要
    const lickPool = mode === 'lick-only' ? compileMasterLickPool(manifest) : undefined;
    // lick-only 模式 signatureLickProb 拉高到 0.4（偶发但不稀有，让大师腔调可识别）
    // takeover 模式整段已是大师 grammar，不再拼接额外 lick → 0
    const signatureLickProb = mode === 'lick-only' ? 0.4 : 0.0;

    const persona: MusicianPersona = {
        colorBias: manifest.topologyConfig.colorBias,
        sparsityTendency: sparsity,
        contourPreference: ContourType.Random,
        syncopationAssault: isHardBop ? 0.3 : 0.6,
        dynamicRange: [60, 105],
        legatoRatio: 1.0,
        signatureLickProb,
        topologyConfig: manifest.topologyConfig,
        masterId: manifest.id,
        masterMode: mode,
        ...(lickPool !== undefined ? { lickPool } : {}),
    };

    const idSuffix = mode === 'lick-only' ? '_licks' : '';
    const nameSuffix = mode === 'lick-only' ? ' (Licks)' : '';
    const descSuffix = mode === 'lick-only'
        ? ' [Lick 模式：PCFG 风格底色 + 大师签名乐句拼接]'
        : ' [Takeover：整段大师 grammar 主导]';

    return {
        id: `master_${manifest.id.toLowerCase()}${idSuffix}`,
        name: `${manifest.name}${nameSuffix}`,
        genre: StyleId.ChillJazz,           // 6 位大师默认归属 ChillJazz；UI 可按 styleAffinity 过滤
        instrumentRef: 'grand_piano',
        defaultSound: 'Acoustic_Grand',
        personnel: {},
        role: BandRole.MainInst,
        eligibleRoles: [BandRole.MainInst],
        instrumentId: 0,
        persona,
        description: (manifest.description ?? `${manifest.name} — flash 大师 grammar`) + descSuffix,
    };
}

// ------------------------------------------------------------
// Idiom 占位（V1：assembleActiveIdiom 仍是 stub，未来按 persona 派生）
// ------------------------------------------------------------

const STUB_LEAD: LeadIdiom = {
    needsBreathing: false,
    humanizeVelocity: 0.05,
    legatoRatio: 1.0,
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
