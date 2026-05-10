// ============================================================
// MusicianRegistry — 虚拟乐队的"盘古字典 + 乐手卡牌池 + 图纸装配厂"
// ============================================================
// IoC 解耦：Core Generator 只认 InstrumentIdiom（图纸），不认乐器/曲风名。
//
//   PANGEA_DICT      物理底线（无曲风/无个性偏见，钢琴的"机械参数"）
//   MUSICIAN_POOL    乐手智能体卡牌池（基底 + 擅长曲风 + 个人微操特质）
//   assembleActiveIdiom()  Pangea 基底 + Personnel 特质 → 最终图纸
//   getRandomLeadMusician()  根据 allowedStyleIds 抽 Lead；其 genre 强制定调全曲
//   getRandomMusicianByPangea()  根据基底类型抽伴奏乐手
//
// Pitch Space: N/A（本模块不直接产生 pitch，仅装配演奏参数）
// ============================================================

import { InstrumentIdiom, PangeaInstrument, Musician, BandSlot, LeadIdiom, CompingIdiom } from '../types';
import { StyleId } from '../config/StyleFlags';

// 结构化 PRNG 接口：避免与 PRNG 类的具体导出耦合，调用方传 PRNGManager 单例即可。
interface PRNGLike { nextInt(min: number, max: number): number; }

// ============================================================
// 📖 第一部分：Pangea Dictionary（盘古乐器基底字典）
// 定义物理底线：没有任何曲风与个性偏见
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
            textureProbabilities: { block: 0.8, arpeggio: 0.1, comping: 0.1 },
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
// 🎭 第二部分：Musician Profile（乐手灵魂卡牌池）
// 每张卡 = 自带乐器基底 + 擅长曲风 + 个人微操特质
// ============================================================
export const MUSICIAN_POOL: Musician[] = [
    {
        id: 'Haruki_ACG_Keys',
        name: 'Haruki (ACG Virtuoso)',
        genre: StyleId.AcgLightMusic,
        instrumentRef: 'Base_Acoustic_Piano',
        defaultSound: 'Acoustic_Grand',
        personnel: {
            leadOverrides: { humanizeVelocity: 0.1, legatoRatio: 1.15, graceNoteProbability: 0.65, octaveDoubling: true },
            compingOverrides: {
                strumDelay: 0.0,
                textureType: 'mixed',
                textureProbabilities: { block: 0.05, arpeggio: 0.8, comping: 0.15 },
                compingPatterns: [[0, 0.5, 1.5, 2.5, 3.0], [0, 1.5, 2.5]],
                arpeggioPatterns: [[0, 1, 2, 3, 2, 1, 0, 1], [0, 1, 2, null, 3, 2, 1, null], [0, 2, 3, 1, 2, 3, 1, 2]],
                compingDuration: 0.5,
            },
        },
    },
    {
        id: 'Duke_Pop_Keys',
        name: 'Duke (Pop Keyboardist)',
        genre: StyleId.AcgLightMusic,
        instrumentRef: 'Base_Acoustic_Piano',
        defaultSound: 'Acoustic_Grand',
        personnel: {
            leadOverrides: { humanizeVelocity: 0.1, legatoRatio: 1.1, graceNoteProbability: 0.35, octaveDoubling: true },
            compingOverrides: {
                textureType: 'mixed',
                textureProbabilities: { block: 0.2, arpeggio: 0.6, comping: 0.2 },
                compingPatterns: [[0, 1.5, 2.5], [0, 2.0], [0.5, 1.5, 2.5, 3.5]],
                arpeggioPatterns: [[0, 1, 2, 3, null, 2, 1, null], [0, null, 1, 2, 3, 2, 1, null], [0, 1, 2, 3, 0, 1, 2, 3]],
                compingDuration: 0.4,
            },
        },
    },
    {
        id: 'Marcus_RnB_EP',
        name: 'Marcus (Groovy EP)',
        genre: StyleId.AcgLightMusic,
        instrumentRef: 'Base_Electric_Piano',
        defaultSound: 'Electric_Piano_1',
        personnel: {
            leadOverrides: { humanizeVelocity: 0.15, legatoRatio: 0.9, graceNoteProbability: 0.2, octaveDoubling: false },
            compingOverrides: {
                textureType: 'mixed',
                textureProbabilities: { block: 0.3, arpeggio: 0.1, comping: 0.6 },
                compingPatterns: [[0.5, 1.5, 2.5, 3.5], [0, 0.5, 2.0, 2.5], [0, 1.5, 2.5]],
                arpeggioPatterns: [[0, 1, 2, 1, null, null, null, null]],
                compingDuration: 0.3,
            },
        },
    },
];

// ============================================================
// ⚙️ 第三部分：Deep Merge Assembler（合并图纸）
// Pangea 基底 + Personnel 特质 → 最终 InstrumentIdiom 图纸
// ============================================================
export function assembleActiveIdiom(musician: Musician, slot: BandSlot): InstrumentIdiom {
    const pangea = PANGEA_DICT[musician.instrumentRef];
    if (!pangea) throw new Error(`Pangea base not found: ${musician.instrumentRef}`);
    const traits = musician.personnel;

    const lead: LeadIdiom = { ...pangea.baseLead, ...(traits.leadOverrides || {}) };
    const comping: CompingIdiom = { ...pangea.baseComping, ...(traits.compingOverrides || {}) };

    // 数组与嵌套对象需要显式深拷贝，避免上层污染基底
    if (traits.compingOverrides?.compingPatterns) comping.compingPatterns = [...traits.compingOverrides.compingPatterns];
    if (traits.compingOverrides?.arpeggioPatterns) comping.arpeggioPatterns = [...traits.compingOverrides.arpeggioPatterns];
    if (traits.compingOverrides?.textureProbabilities) comping.textureProbabilities = { ...traits.compingOverrides.textureProbabilities };

    return { id: `${musician.id}_at_${slot}`, lead, comping };
}

// ============================================================
// 🃏 第四部分：抽卡工具（确定性 PRNG 驱动）
// ============================================================

/**
 * 根据允许的曲风池抽 Lead 乐手。
 * Lead 乐手的 genre 将强制成为整首歌的全局 styleId（"主奏定调"）。
 */
export function getRandomLeadMusician(allowedStyleIds: StyleId[] | undefined, prng: PRNGLike): Musician {
    let candidates = MUSICIAN_POOL;
    if (allowedStyleIds && allowedStyleIds.length > 0) {
        candidates = candidates.filter(m => allowedStyleIds.includes(m.genre));
    }
    if (candidates.length === 0) candidates = MUSICIAN_POOL;
    return candidates[prng.nextInt(0, candidates.length - 1)];
}

/**
 * 按 Pangea 基底关键字抽伴奏乐手（如 'Base' 抓所有）。
 */
export function getRandomMusicianByPangea(pangeaKeyword: string, prng: PRNGLike): Musician {
    const candidates = MUSICIAN_POOL.filter(m => m.instrumentRef.toLowerCase().includes(pangeaKeyword.toLowerCase()));
    if (candidates.length === 0) return MUSICIAN_POOL[0];
    return candidates[prng.nextInt(0, candidates.length - 1)];
}

// ============================================================
// 🪨 兜底图纸 — TextureMapper 默认参数兼容
// ============================================================
// TextureMapper 的 chordIdiom 形参原本默认值为 AcousticPianoIdiom。
// 删掉旧 IdiomRegistry 后用此常量保持原算法签名不变（仅改 import 路径）。
// 等价于"默认 Pop 钢琴乐手坐 Comping 槽"的合并图纸。
export const DEFAULT_FALLBACK_IDIOM: InstrumentIdiom = assembleActiveIdiom(MUSICIAN_POOL[1], 'Comping');
