// ============================================================
// SectionPlanner — AF2 段落骨架生成(适配 mg 12/16 小节硬约束)
// ============================================================
//
// 职责:
//   生成 SectionMetadata[],描述全曲段落分布(Intro/Verse/Chorus 等)+
//   能量曲线。
//
// 硬约束:
//   总小节数 **必须 = mg.recommendedBars**(12 BLUES / 16 其他)。
//   AF 现有的 MODERN_POP_STRUCTURES / NEO_SOUL_STRUCTURES / CHILL_JAZZ_STRUCTURES
//   都是 60+ 小节的完整歌曲架构,与 mg 不兼容 — 本模块自带 mg 专用迷你模板池。
//
// 与 mg 的关系(融合原则):
//   - SectionMetadata 仅供下游 UI 标注 / SlotRouter / SectionMapper 使用
//   - **不喂回 mg** — mg 内部已有 emotion / apex / tension 全局故事曲线,
//     不接受 AF 段落驱动
//   - 段落能量曲线由 AF 自行决定,与 mg 自身能量曲线可能不一致,这是接受的
//
// PRNG:
//   用 PRNGManager(AF 主流),从池中抽模板。1 次 PRNG 消耗。
// ============================================================

import { SectionType } from '../types';
import type { SectionMetadata } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import type { MgStyle } from '../../../state/EngineSelectionStore';

/**
 * 段落模板(自包含,不复用 AF 的 StructureTemplate 因小节数不兼容)
 */
interface Af2SectionTemplate {
    id: string;
    sections: Array<{
        name: string;
        type: SectionType;
        bars: number;
        energy: number;
    }>;
}

// ============================================================
// U 阶段(2026-05-24):完整曲式模板池(32/36/48 bar)
// ============================================================
//
// 设计原则:
//   - 完整情绪曲线:Intro(铺垫)→ Verse(起)→ PreChorus(承)→
//     Chorus(抒发)→ Verse_2(回 / 起 2)→ Chorus_2(抒发 2)→
//     Bridge(变)→ Chorus_3(高潮)→ Outro(收)
//   - 至少 2 大段落(Verse + Chorus 各 ≥ 2 次)
//   - 各模板 bars 总和必须 = totalBars
//   - energy 范围 1-10
//   - typeCounters 自动给同 type 加 _1/_2/_3 后缀(SectionPlanner.plan)
// ============================================================

/**
 * 48-bar 模板池(POP / RNB)— 完整流行歌曲架构
 * 时长:POP 96 秒 / RNB 130 秒
 */
const TEMPLATES_48BAR: Af2SectionTemplate[] = [
    {
        id: 'af2-48-pop-full',
        sections: [
            { name: 'Intro',     type: SectionType.Intro,     bars: 4, energy: 3 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 5 },
            { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 8 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 6 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 9 },
            { name: 'Bridge',    type: SectionType.Bridge,    bars: 4, energy: 7 },
            { name: 'Outro',     type: SectionType.Outro,     bars: 4, energy: 4 },
        ],
    },
    {
        id: 'af2-48-pop-double-chorus',
        sections: [
            { name: 'Intro',     type: SectionType.Intro,     bars: 4, energy: 3 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 5 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 8 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 6 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 9 },
            { name: 'Bridge',    type: SectionType.Bridge,    bars: 4, energy: 7 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 10 },
        ],
    },
    {
        id: 'af2-48-pop-no-bridge',
        sections: [
            { name: 'Intro',     type: SectionType.Intro,     bars: 4, energy: 3 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 5 },
            { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 6 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 8 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 6 },
            { name: 'PreChorus', type: SectionType.PreChorus, bars: 4, energy: 7 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 9 },
            { name: 'Outro',     type: SectionType.Outro,     bars: 4, energy: 4 },
        ],
    },
    {
        id: 'af2-48-pop-ballad',
        sections: [
            { name: 'Intro',     type: SectionType.Intro,     bars: 4, energy: 2 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 4 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 7 },
            { name: 'Verse',     type: SectionType.Verse,     bars: 8, energy: 5 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 8 },
            { name: 'Bridge',    type: SectionType.Bridge,    bars: 4, energy: 6 },
            { name: 'Chorus',    type: SectionType.Chorus,    bars: 8, energy: 9 },
        ],
    },
];

/**
 * 32-bar 模板池(JAZZ)— 标准 jazz AABA form
 * 时长:JAZZ 80 秒 / 大多 jazz standard 的 head
 */
const TEMPLATES_32BAR: Af2SectionTemplate[] = [
    {
        id: 'af2-32-jazz-aaba',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },     // A
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 6 },     // A
            { name: 'Bridge', type: SectionType.Bridge, bars: 8, energy: 7 },     // B
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },     // A return
        ],
    },
    {
        id: 'af2-32-jazz-with-chorus',
        sections: [
            { name: 'Intro',  type: SectionType.Intro,  bars: 4, energy: 3 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 },
            { name: 'Bridge', type: SectionType.Bridge, bars: 4, energy: 7 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 6, energy: 9 },
            { name: 'Outro',  type: SectionType.Outro,  bars: 2, energy: 4 },
        ],
    },
    {
        id: 'af2-32-jazz-double-verse',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 6 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 },
        ],
    },
];

/**
 * 36-bar 模板池(BLUES)— 3 × 12-bar blues form
 * 时长:BLUES 86 秒
 */
const TEMPLATES_36BAR: Af2SectionTemplate[] = [
    {
        id: 'af2-36-blues-3-loop',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 12, energy: 5 },     // 12-bar I
            { name: 'Verse',  type: SectionType.Verse,  bars: 12, energy: 7 },     // 12-bar II(solo)
            { name: 'Chorus', type: SectionType.Chorus, bars: 12, energy: 9 },     // 12-bar III(climax)
        ],
    },
    {
        id: 'af2-36-blues-intro-3-outro',
        sections: [
            { name: 'Intro',  type: SectionType.Intro,  bars: 4, energy: 3 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 12, energy: 5 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 8,  energy: 7 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8,  energy: 9 },
            { name: 'Outro',  type: SectionType.Outro,  bars: 4, energy: 4 },
        ],
    },
    {
        id: 'af2-36-blues-vcvc-bridge',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 6 },
            { name: 'Bridge', type: SectionType.Bridge, bars: 4, energy: 7 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 9 },
        ],
    },
];

function poolForBars(bars: number): Af2SectionTemplate[] {
    if (bars === 32) return TEMPLATES_32BAR;
    if (bars === 36) return TEMPLATES_36BAR;
    if (bars === 48) return TEMPLATES_48BAR;
    throw new Error(
        `SectionPlanner: unsupported totalBars=${bars}. ` +
        `Supported: 32 (JAZZ) / 36 (BLUES) / 48 (POP/RNB).`,
    );
}

export const SectionPlanner = {
    /**
     * 生成段落骨架。
     *
     * @param mgStyle  mg 风格,用于决定 bars
     * @param totalBars  来自 Af2KernelDriver.getRecommendedBars(),传入而非 import
     *                   避免循环依赖
     * @param beatsPerMeasure  默认 4(mg 当前所有 macro style 都是 4/4)
     */
    plan(
        mgStyle: MgStyle,
        totalBars: number,
        beatsPerMeasure: number = 4,
    ): SectionMetadata[] {
        const pool = poolForBars(totalBars);
        const template = pool[Math.floor(PRNGManager.next() * pool.length)];

        const sections: SectionMetadata[] = [];
        const typeCounters: number[] = new Array(12).fill(0);
        let cursor = 0;

        for (let i = 0; i < template.sections.length; i++) {
            const s = template.sections[i];
            const lengthBeats = s.bars * beatsPerMeasure;
            typeCounters[s.type] += 1;
            sections.push({
                name: `${s.name}_${typeCounters[s.type]}`,
                sectionType: s.type,
                startBeat: cursor,
                endBeat: cursor + lengthBeats,
                energyLevel: s.energy,
                chordsHint: Math.max(2, Math.floor(lengthBeats / 4)),
            });
            cursor += lengthBeats;
        }

        // 健壮性:段落 bars 总和应该 = totalBars * beatsPerMeasure
        // 不一致是模板池 bug,显式抛错避免静默错位
        const expectedBeats = totalBars * beatsPerMeasure;
        if (cursor !== expectedBeats) {
            throw new Error(
                `SectionPlanner: template '${template.id}' bars sum mismatch — ` +
                `expected ${expectedBeats} beats, got ${cursor}`,
            );
        }

        return sections;
    },
};
