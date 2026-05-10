// ============================================================
// 🚧 STUB — Persona / Musician 卡牌池占位
// ============================================================
//
// 历史功能：
//   - MUSICIAN_POOL：4 个参考 Persona（Alex/Dave/Marcus/Nina），
//     按 RoleType × StyleId × instrumentId × MusicianPersona 字段定义。
//   - assembleActiveIdiom(musician, slot)：把 Persona 派生成 LeadIdiom + CompingIdiom
//     图纸供 TextureMapper / ToplineEngine 消费。
//   - getRandomLeadMusician / getRandomMusicianByRole / getMusicianById / getMusiciansByRole：
//     PRNG 驱动的招募与按角色查询，被 runPipeline 与 PipelineMonitor BandSelection 消费。
//
// 重构期占位行为：
//   - 池为空。getMusiciansByRole 永远返回 []，UI BandSelection 下拉里只剩 "🎲 Random"。
//   - assembleActiveIdiom 返回空白 Lead+Comping 图纸（占位生成器消费不到，但保签名）。
//   - getRandomLeadMusician 返回 undefined（旧实现里返回 Musician 必定有值，新引擎招募策略
//     需要在重构时重新设计——此处用 undefined 让占位 runPipeline 走 fallback 路径）。
//
// 重构方向：
//   新引擎应：① 重新填入 personas/ 子目录；② 决定 Persona → Idiom 的派生策略
//   （或直接消费 Persona）；③ 给 runPipeline 提供"按风格招募完整 5 槽位乐队"的方法。
// ============================================================

import {
    InstrumentIdiom,
    Musician,
    BandSlot,
    LeadIdiom,
    CompingIdiom,
    RoleType,
} from '../types';
import { StyleId } from '../config/StyleFlags';

export const MUSICIAN_POOL: Musician[] = [];

export const PANGEA_DICT: Record<string, unknown> = {};

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

export function assembleActiveIdiom(musician: Musician, slot: BandSlot): InstrumentIdiom {
    return { id: `${musician.id}_at_${slot}`, lead: { ...STUB_LEAD }, comping: { ...STUB_COMPING } };
}

interface PRNGLike {
    nextInt(min: number, max: number): number;
    nextFloat(min: number, max: number): number;
}

export function getRandomLeadMusician(
    _allowedStyleIds: StyleId[] | undefined,
    _prng: PRNGLike,
): Musician | undefined {
    return undefined;
}

export function getRandomMusicianByRole(
    _role: RoleType,
    _prng: PRNGLike,
    _allowedStyleIds?: StyleId[],
): Musician | undefined {
    return undefined;
}

export function getMusiciansByRole(_role: RoleType): Musician[] {
    return [];
}

export function getMusicianById(_id: string): Musician | undefined {
    return undefined;
}

export const DEFAULT_FALLBACK_IDIOM: InstrumentIdiom = {
    id: 'stub_fallback',
    lead: { ...STUB_LEAD },
    comping: { ...STUB_COMPING },
};
