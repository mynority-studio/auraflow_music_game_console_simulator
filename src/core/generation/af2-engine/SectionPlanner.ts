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

/**
 * 16-bar 模板池(POP / JAZZ / RNB)
 * 设计原则:
 *   - 必须包含 Verse + Chorus(至少一种主体段落)
 *   - Intro / Outro 可选(短曲下省略以让 Verse/Chorus 更突出)
 *   - 各模板 bars 总和必须 = 16
 *   - energy 范围 1-10(与 AF SectionMetadata.energyLevel 一致)
 */
const TEMPLATES_16BAR: Af2SectionTemplate[] = [
    {
        id: 'af2-16-classic',
        sections: [
            { name: 'Intro',  type: SectionType.Intro,  bars: 2, energy: 3 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 6, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 6, energy: 8 },
            { name: 'Outro',  type: SectionType.Outro,  bars: 2, energy: 4 },
        ],
    },
    {
        id: 'af2-16-no-intro',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 8, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 8, energy: 8 },
        ],
    },
    {
        id: 'af2-16-vcvc',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 4, energy: 8 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 6 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 4, energy: 9 },
        ],
    },
    {
        id: 'af2-16-bridge',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 6, energy: 8 },
            { name: 'Bridge', type: SectionType.Bridge, bars: 4, energy: 7 },
            { name: 'Outro',  type: SectionType.Outro,  bars: 2, energy: 4 },
        ],
    },
];

/**
 * 12-bar 模板池(BLUES)
 * 12-bar blues 传统结构:I-IV-V 三段各 4 小节,这里用段落标签反映
 */
const TEMPLATES_12BAR: Af2SectionTemplate[] = [
    {
        id: 'af2-12-blues-aab',
        sections: [
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 5 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 6 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 4, energy: 8 },
        ],
    },
    {
        id: 'af2-12-blues-intro-vc',
        sections: [
            { name: 'Intro',  type: SectionType.Intro,  bars: 2, energy: 3 },
            { name: 'Verse',  type: SectionType.Verse,  bars: 4, energy: 5 },
            { name: 'Chorus', type: SectionType.Chorus, bars: 4, energy: 8 },
            { name: 'Outro',  type: SectionType.Outro,  bars: 2, energy: 4 },
        ],
    },
];

function poolForBars(bars: number): Af2SectionTemplate[] {
    if (bars === 12) return TEMPLATES_12BAR;
    if (bars === 16) return TEMPLATES_16BAR;
    throw new Error(
        `SectionPlanner: unsupported mg.recommendedBars=${bars}. ` +
        `Phase 1 supports only 12 (BLUES) or 16 (POP/JAZZ/RNB).`,
    );
}

export const SectionPlanner = {
    /**
     * 生成段落骨架。
     *
     * @param mgStyle  mg 风格,用于决定 bars
     * @param totalBars  来自 MgKernelInvoker.getRecommendedBars(),传入而非 import
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
