// ==========================================
// 📄 /src/core/generation/harmony/ShadowSkeletonGenerator.ts
// 🌟 PR #2: Phase 1 — 影子骨架生成器
//
// 申克分析法的 Background：先定 T-S-D 功能走向，不定具体和弦色彩。
//
// 输入：sections (SectionMetadata[]) + timeSignature
// 输出：ShadowSlot[] 全曲连续数组，槽位 startBeat 严格按段落顺序递增
//
// 槽位粒度：**每小节一个**（PR #2 最小可听版）
//   未来 PR #3 升级到动态粒度
//
// 模板：按 SectionType 分桶，4 小节模板循环复用（>4 小节段落用 floor(bars/4) 次完整 + 余数用前若干）
//   每个 SectionType 配 2~4 个模板，PRNG 选择
//
// 算法：
//   1. 遍历 sections
//   2. 对每个段落，按 sectionType 选模板（PRNG 决定）
//   3. 把模板 [(function, root)] 按拍位展开成 ShadowSlot[]
//   4. 段落首拍标记 isStrong=true
//
// PRNG 消耗：每段 1 次（选模板）+ N 次（变奏，PR #2 暂不做）
// ==========================================

import { PRNGManager } from '../../utils/PRNG';
import { SectionMetadata, ShadowSlot, ShadowFunction, SectionType } from '../types';

const T = ShadowFunction.Tonic;
const S = ShadowFunction.Subdominant;
const D = ShadowFunction.Dominant;

/**
 * 模板单元：[function, suggestedRootPc]
 * suggestedRootPc 是主调相对（0=I, 5=IV, 7=V ...）
 */
type TemplateSlot = readonly [ShadowFunction, number];

/**
 * 4 小节模板（4 个槽位）。
 * 每个数组元素就是"一个 4 小节单元"，长段落会循环复用。
 */
type Template4Bar = readonly TemplateSlot[];

/**
 * Verse 模板池（叙事性，T 多 S 少 D 弱）
 */
const VERSE_TEMPLATES: Template4Bar[] = [
    // I - vi - IV - V (50s 经典)
    [[T, 0], [T, 9], [S, 5], [D, 7]],
    // I - V - vi - IV (Pop 万能)
    [[T, 0], [D, 7], [T, 9], [S, 5]],
    // I - IV - I - V (民谣式)
    [[T, 0], [S, 5], [T, 0], [D, 7]],
    // vi - IV - I - V (悲伤起步)
    [[T, 9], [S, 5], [T, 0], [D, 7]],
];

/**
 * Chorus 模板池（爆发性，T-S-D 强对比）
 */
const CHORUS_TEMPLATES: Template4Bar[] = [
    // I - V - vi - IV (Axis 和弦)
    [[T, 0], [D, 7], [T, 9], [S, 5]],
    // I - IV - V - I (经典释放)
    [[T, 0], [S, 5], [D, 7], [T, 0]],
    // vi - IV - I - V (倒装释放)
    [[T, 9], [S, 5], [T, 0], [D, 7]],
    // I - vi - ii - V (爵士流行)
    [[T, 0], [T, 9], [S, 2], [D, 7]],
];

/**
 * 兜底模板（其他 SectionType 用）
 */
const DEFAULT_TEMPLATES: Template4Bar[] = [
    [[T, 0], [S, 5], [T, 0], [D, 7]],
    [[T, 0], [D, 7], [T, 0], [S, 5]],
];

/**
 * 选模板池：根据 SectionType 返回对应的模板列表。
 */
function getTemplatePool(sectionType?: SectionType): Template4Bar[] {
    if (sectionType === SectionType.Verse) return VERSE_TEMPLATES;
    if (sectionType === SectionType.Chorus) return CHORUS_TEMPLATES;
    if (sectionType === SectionType.PreChorus) return CHORUS_TEMPLATES; // 暂时复用
    if (sectionType === SectionType.Bridge) return VERSE_TEMPLATES;     // 暂时复用
    return DEFAULT_TEMPLATES;
}

/**
 * 主入口：把 sections[] 展开成全曲 ShadowSlot[]。
 *
 * @param sections 全曲段落数组
 * @param timeSignature [拍数/小节, 拍长]
 * @returns ShadowSlot[] —— 长度 = 全曲总小节数（每小节一个槽位）
 */
export function generateShadowSkeleton(
    sections: SectionMetadata[],
    timeSignature: [number, number],
): ShadowSlot[] {
    const beatsPerBar = timeSignature[0];
    const slots: ShadowSlot[] = [];

    for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const sectionBars = Math.max(1, Math.round((sec.endBeat - sec.startBeat) / beatsPerBar));

        // 选模板（PRNG 消耗 1 次 / 段）
        const pool = getTemplatePool(sec.sectionType);
        const tplIndex = PRNGManager.nextInt(0, pool.length - 1);
        const template = pool[tplIndex];

        // 展开模板：长段落循环复用 4 小节模板
        for (let bar = 0; bar < sectionBars; bar++) {
            const slotInTemplate = bar % template.length;
            const [func, rootPc] = template[slotInTemplate];

            const startBeat = sec.startBeat + bar * beatsPerBar;
            const endBeat = startBeat + beatsPerBar;
            const isStrong = bar % 2 === 0; // 每两小节有一个强位（PR #3 可改）

            slots.push({
                function: func,
                suggestedRootPc: rootPc,
                startBeat,
                endBeat,
                isStrong,
            });
        }
    }

    return slots;
}
