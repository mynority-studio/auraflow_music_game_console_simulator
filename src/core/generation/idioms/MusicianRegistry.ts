// ============================================================
// MusicianRegistry — 参考架构移植后：4 个 Persona × StyleId 数值索引
// ============================================================
// 数据来源：ALL_SOURCE_CODE.md 的 4 个 MusicianProfile
//   - Alex (Pop Piano)        → ModernPop / GrandPiano / colorBias=0.4
//   - Dave (Steady Pop Drums) → ModernPop / DrumKit    / sparsity=0.6
//   - Marcus (Neo-Soul Keys)  → NeoSoul   / EPiano     / colorBias=0.9 sparsity=0.8 sync=0.9
//   - Nina (Chill Jazz Piano) → ChillJazz / GrandPiano / colorBias=0.8 sparsity=0.65
//
// 兼容层：本工程 TextureMapper 仍通过 InstrumentIdiom (lead+comping) 接受图纸，
//   personnel 字段从 Persona 综合派生（compingPatterns / arpeggioPatterns 等）。
//   这保证 Phase 2 不破坏 TextureMapper；Phase 3 移植 BaseAccompIdiom 后可以
//   直接消费 Persona，把派生逻辑下线。
// ============================================================

import {
    InstrumentIdiom, PangeaInstrument, Musician, BandSlot, LeadIdiom, CompingIdiom,
    MusicianPersona, MusicianProfile, RoleType, ContourType, PersonnelTraits,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { AlexPopPiano } from './personas/AlexPopPiano';
import { DaveSteadyPopDrums } from './personas/DavePopDrums';
import { MarcusNeoSoulKeys } from './personas/MarcusNeoSoulKeys';
import { NinaChillJazzPiano } from './personas/NinaChillJazzPiano';

interface PRNGLike { nextInt(min: number, max: number): number; }

// ============================================================
// Persona → CompingIdiom / LeadIdiom 派生（兼容 TextureMapper）
// ============================================================

function synthesizeLead(persona: MusicianPersona): LeadIdiom {
    const dynamicSpread = (persona.dynamicRange[1] - persona.dynamicRange[0]) / 127;
    return {
        needsBreathing: false,  // 钢琴/EP/鼓不需要换气
        humanizeVelocity: 0.05 + dynamicSpread * 0.1,            // 0.05~0.15
        legatoRatio: 1.0 - persona.sparsityTendency * 0.15,      // sparser → 略短
        graceNoteProbability: 0.05 + (persona.signatureLickProb ?? 0) * 0.5,
        octaveDoubling: persona.colorBias > 0.7,                 // 高色彩偏好叠 8 度
    };
}

function synthesizeComping(persona: MusicianPersona): CompingIdiom {
    const sync = persona.syncopationAssault;
    const sparse = persona.sparsityTendency;
    const color = persona.colorBias;

    // 切分越强，pattern 越偏后拍/反拍
    const compingPatterns: number[][] = sync > 0.7
        ? [[0.5, 1.5, 2.5, 3.5], [0, 0.5, 2.0, 2.5], [0.75, 1.5, 2.75, 3.5]]
        : sync > 0.4
            ? [[0, 1.5, 2.5], [0, 2.0], [0.5, 1.5, 2.5, 3.5]]
            : [[0, 2.0], [0, 1.5, 2.5]];

    // 色彩越高，琶音越复杂
    const arpeggioPatterns: (number | null)[][] = color > 0.7
        ? [[0, 1, 2, 3, 2, 1, 0, 1], [0, 1, 2, null, 3, 2, 1, null], [0, 2, 3, 1, 2, 3, 1, 2]]
        : color > 0.4
            ? [[0, 1, 2, 3, null, 2, 1, null], [0, 1, 2, 3, 0, 1, 2, 3]]
            : [[0, 1, 2, 1, null, null, null, null]];

    // 织体概率：sparse → comping 多，dense → block 多，color 高 → arpeggio 多
    const tBlock = Math.max(0.05, 1 - sparse - color * 0.3);
    const tArp = color * 0.6 + (1 - sync) * 0.1;
    const tComping = sparse * 0.5 + sync * 0.3;
    const tSum = tBlock + tArp + tComping || 1;

    return {
        strumDelay: 0.005 + (1 - color) * 0.01,                    // 古典越正越无延迟
        compingPatterns,
        arpeggioPatterns,
        compingDuration: 0.25 + (1 - sparse) * 0.3,                // 0.25~0.55
        allowDrop2: color > 0.6,
        textureType: 'mixed',
        textureProbabilities: {
            block:    tBlock / tSum,
            arpeggio: tArp / tSum,
            comping:  tComping / tSum,
        },
    };
}

function profileToPersonnel(persona: MusicianPersona): PersonnelTraits {
    return {
        leadOverrides: synthesizeLead(persona),
        compingOverrides: synthesizeComping(persona),
    };
}

// ============================================================
// 默认 GM 音色映射（instrumentId → defaultSound 名称）
// ============================================================
const DEFAULT_SOUND_BY_INSTRUMENT_ID: Record<number, string> = {
    0: 'Acoustic_Grand',
    1: 'Electric_Piano_1',
    2: 'Electric_Bass_finger',
    3: 'Standard_DrumKit',
};

// ============================================================
// Pangea 字典（兼容老 assembleActiveIdiom 走过的合并路径，保留作为兜底基底）
// ============================================================
export const PANGEA_DICT: Record<string, PangeaInstrument> = {
    'Base_Acoustic_Piano': {
        id: 'Base_Acoustic_Piano',
        baseLead: { needsBreathing: false, humanizeVelocity: 0.05, legatoRatio: 1.0, graceNoteProbability: 0.1, octaveDoubling: false },
        baseComping: {
            strumDelay: 0.01,
            compingPatterns: [[0, 2.0], [0, 1.5, 2.5]],
            arpeggioPatterns: [[0, 1, 2, 3, 2, 1, 0, 1]],
            compingDuration: 0.5,
            allowDrop2: true,
            textureType: 'mixed',
            textureProbabilities: { block: 0.6, arpeggio: 0.2, comping: 0.2 },
        },
    },
    'Base_Electric_Piano': {
        id: 'Base_Electric_Piano',
        baseLead: { needsBreathing: false, humanizeVelocity: 0.08, legatoRatio: 0.95, graceNoteProbability: 0.05, octaveDoubling: false },
        baseComping: {
            strumDelay: 0.0,
            compingPatterns: [[0, 1.5, 2.5]],
            compingDuration: 0.3,
            allowDrop2: true,
            textureType: 'comping',
            textureProbabilities: { block: 0.2, arpeggio: 0.1, comping: 0.7 },
        },
    },
};

// ============================================================
// MUSICIAN_POOL — 4 个参考 Persona 转换为本工程 Musician 形状
// ============================================================
function profileToMusician(profile: MusicianProfile): Musician {
    const instrumentRef = profile.instrumentId === 1 ? 'Base_Electric_Piano' : 'Base_Acoustic_Piano';
    const defaultSound = DEFAULT_SOUND_BY_INSTRUMENT_ID[profile.instrumentId] ?? 'Acoustic_Grand';
    return {
        id: profile.id,
        name: profile.name,
        genre: profile.styleId,
        instrumentRef,
        defaultSound,
        personnel: profileToPersonnel(profile.persona),
        // 参考架构字段
        role: profile.role,
        instrumentId: profile.instrumentId,
        persona: profile.persona,
        description: profile.description,
    };
}

export const MUSICIAN_POOL: Musician[] = [
    profileToMusician(AlexPopPiano),
    profileToMusician(DaveSteadyPopDrums),
    profileToMusician(MarcusNeoSoulKeys),
    profileToMusician(NinaChillJazzPiano),
];

// ============================================================
// assembleActiveIdiom — Pangea 基底 + Persona 派生 → 最终 InstrumentIdiom 图纸
// ============================================================
export function assembleActiveIdiom(musician: Musician, slot: BandSlot): InstrumentIdiom {
    // 优先用 Persona 直接派生（参考架构路径）
    const lead: LeadIdiom = synthesizeLead(musician.persona);
    const comping: CompingIdiom = synthesizeComping(musician.persona);
    return { id: `${musician.id}_at_${slot}`, lead, comping };
}

// ============================================================
// 抽卡工具（确定性 PRNG 驱动）
// ============================================================

/** Lead 乐手抽卡：其 genre 强制成为全曲 styleId */
export function getRandomLeadMusician(allowedStyleIds: StyleId[] | undefined, prng: PRNGLike): Musician {
    let candidates = MUSICIAN_POOL.filter(m => m.role === RoleType.AccompInst);
    if (allowedStyleIds && allowedStyleIds.length > 0) {
        candidates = candidates.filter(m => allowedStyleIds.includes(m.genre));
    }
    if (candidates.length === 0) candidates = MUSICIAN_POOL;
    return candidates[prng.nextInt(0, candidates.length - 1)];
}

/** 按 Pangea 基底关键字抽伴奏（兼容老调用：'Base' 抓所有钢琴类乐手） */
export function getRandomMusicianByPangea(pangeaKeyword: string, prng: PRNGLike): Musician {
    const candidates = MUSICIAN_POOL.filter(m => m.instrumentRef.toLowerCase().includes(pangeaKeyword.toLowerCase()));
    if (candidates.length === 0) return MUSICIAN_POOL[0];
    return candidates[prng.nextInt(0, candidates.length - 1)];
}

/** 按 RoleType 筛选乐手（PipelineMonitor BandSelection 使用） */
export function getMusiciansByRole(role: RoleType): Musician[] {
    return MUSICIAN_POOL.filter(m => m.role === role);
}

/** 按 ID 查找单个乐手 */
export function getMusicianById(id: string): Musician | undefined {
    return MUSICIAN_POOL.find(m => m.id === id);
}

// ============================================================
// 兜底图纸：Orchestrator 缺花名册时使用 Alex 的 Comping 图纸
// ============================================================
export const DEFAULT_FALLBACK_IDIOM: InstrumentIdiom = assembleActiveIdiom(MUSICIAN_POOL[0], 'Comping');

// 静默引用 PANGEA_DICT，避免被树摇移除（Phase 3 BaseAccompIdiom 移植后真正消费）
void PANGEA_DICT;
