// ==========================================
// 📄 /src/core/generation/harmony/HarmonyPipeline.ts
// 🌟 PR #2: 双阶段和声管线总入口
//
// 串联 Phase 1 → Phase 2 → Phase 3 → GeneratedChord[] 转换，
// 输出与 HarmonyEngine.generateHarmonyTimeline 完全兼容的数组。
//
// Pipeline:
//   sections + tonality
//      ↓ Phase 1: ShadowSkeletonGenerator
//   ShadowSlot[]  (T/S/D + suggestedRoot)
//      ↓ Phase 2: SkeletonMelodyGenerator
//   anchor[]      (pc 主调相对)
//      ↓ Phase 3: ViterbiChordSelector (per-section)
//   ChordCandidate[]
//      ↓ 转换：pitchClass → numeral, quality enum → string
//   GeneratedChord[]  ← 喂回 MelodyEngine
//
// Per-section Viterbi：每个段落独立跑 Viterbi，避免全局 N > MAX_N 的问题
// 段落间 voice leading 通过传递 prevChord 保持
// ==========================================

import { PRNGManager } from '../../utils/PRNG';
import {
    SectionMetadata,
    GeneratedChord,
    Tonality,
    ShadowSlot,
} from '../types';

import { generateShadowSkeleton } from './ShadowSkeletonGenerator';
import { generateSkeletonMelody } from './SkeletonMelodyGenerator';
import {
    selectChords,
    ChordCandidate,
    MAX_N,
} from './ViterbiChordSelector';
import { getCandidatePool } from './CandidatePool';
import { pitchClassToNumeral } from './ChordNumeral';
import { ChordQualityName } from '../types';

/**
 * 把单个 ChordCandidate 转换为 GeneratedChord（带时间戳）。
 * Pitch Space: RELATIVE — chord.root 是相对 pc，keyOffset 由 Orchestrator.applyOffset() 末尾施加。
 */
function candidateToChord(
    cand: ChordCandidate,
    startBeat: number,
    endBeat: number,
    tonality: Tonality,
): GeneratedChord {
    return {
        numeral: pitchClassToNumeral(cand.rootPc, cand.quality, tonality),
        root: cand.rootPc,
        // GeneratedChord.quality 是字符串 union，用 ChordQualityName 反查
        quality: ChordQualityName[cand.quality] as GeneratedChord['quality'],
        startBeat,
        endBeat,
        // keyOffset 留空，由下游 Orchestrator.applyOffset() 处理（K-2 合规）
    };
}

/**
 * 把同一段落内的影子槽位切分成 ≤ MAX_N 的 chunks，
 * 防止一个段落超过 Viterbi DP 表的容量上限。
 *
 * 实践中 PR #2 每个槽位 = 一小节，8 小节 chunk = 8 个槽位，远低于 MAX_N=32。
 */
function chunkSlotsByMaxN(slots: ShadowSlot[]): ShadowSlot[][] {
    if (slots.length <= MAX_N) return [slots];
    const chunks: ShadowSlot[][] = [];
    for (let i = 0; i < slots.length; i += MAX_N) {
        chunks.push(slots.slice(i, i + MAX_N));
    }
    return chunks;
}

interface PipelineOutput {
    shadow: ShadowSlot[];
    anchors: number[];
    chords: GeneratedChord[];
}

/**
 * 内部实现：单次 PRNG 消耗，返回完整中间产物。
 * generateHarmonyViaPipeline 和 generateHarmonyViaPipelineWithDebug 都基于此。
 */
function _runPipeline(
    sections: SectionMetadata[],
    tonality: Tonality,
    timeSignature: [number, number],
): PipelineOutput {
    // ── Phase 1: 影子骨架 ──
    const shadow = generateShadowSkeleton(sections, timeSignature);

    // ── Phase 2: 骨架旋律 ──
    const anchors = generateSkeletonMelody(shadow, tonality);

    // ── Phase 3: Viterbi（per-section，保持段落感）──
    const pool = getCandidatePool(tonality);
    const chords: GeneratedChord[] = [];
    let prevChord: ChordCandidate | null = null;

    // 按段落切分 shadow（找出每段在 shadow 数组中的起止 index）
    let cursor = 0;
    for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        // 找到本段对应的 shadow 槽位（按 startBeat 范围）
        const sectionStart = cursor;
        let sectionEnd = sectionStart;
        while (sectionEnd < shadow.length && shadow[sectionEnd].startBeat < sec.endBeat - 1e-6) {
            sectionEnd++;
        }
        if (sectionEnd === sectionStart) continue; // 空段落

        const sectionSlots = shadow.slice(sectionStart, sectionEnd);
        const sectionAnchors = anchors.slice(sectionStart, sectionEnd);

        // 防御：超长段落切片
        const slotChunks = chunkSlotsByMaxN(sectionSlots);
        const anchorChunks: number[][] = [];
        let chunkOffset = 0;
        for (const c of slotChunks) {
            anchorChunks.push(sectionAnchors.slice(chunkOffset, chunkOffset + c.length));
            chunkOffset += c.length;
        }

        // 跑 Viterbi（每个 chunk 一次）
        for (let ci = 0; ci < slotChunks.length; ci++) {
            const chunkSlots = slotChunks[ci];
            const chunkAnchors = anchorChunks[ci];

            const result = selectChords({
                anchors: chunkAnchors,
                pool,
                initialPrev: prevChord,
            });

            // 把 ChordCandidate 转换为 GeneratedChord，时间戳来自 shadow slot
            for (let i = 0; i < result.selection.length; i++) {
                const cand = result.selection[i];
                const slot = chunkSlots[i];
                chords.push(candidateToChord(cand, slot.startBeat, slot.endBeat, tonality));
            }

            // 更新段落间 voice leading 锚点
            if (result.selection.length > 0) {
                prevChord = result.selection[result.selection.length - 1];
            }
        }

        cursor = sectionEnd;
    }

    // ── PR #3 修订：不再合并相邻同和弦 ──
    // 旧版（PR #2）会调用 mergeAdjacentSameChords 把"连续 4 个 iii7"合成一个长和弦，
    // 但 ToplineEngine 隐式依赖"chord 切换频率 = 旋律节奏锚点"（Hyrum's Law）。
    // 合并后旋律失去呼吸点，开始 noodling，听感变碎。
    // 保留每小节一个 chord 的颗粒度，让 ToplineEngine 的 slot 划分自动恢复对齐。
    return { shadow, anchors, chords };
}

/**
 * 主入口：替代 HarmonyEngine.generateHarmonyTimeline，输出 GeneratedChord[]
 *
 * @param sections    全曲段落
 * @param tonality    调式（PR #2 仅 Major 走最优分支，其他回退到 Major 候选池）
 * @param timeSignature [拍数/小节, 拍长]
 * @returns GeneratedChord[] 全曲连续，按 startBeat 升序
 */
export function generateHarmonyViaPipeline(
    sections: SectionMetadata[],
    tonality: Tonality,
    timeSignature: [number, number],
): GeneratedChord[] {
    return _runPipeline(sections, tonality, timeSignature).chords;
}

// PR #3: mergeAdjacentSameChords 已被废弃（破坏 ToplineEngine 节奏锚点的隐式依赖）
// 函数体保留为 _legacy 以备将来某种"压缩输出"场景需要，但管线不再调用它

/**
 * 调试用：单次 PRNG 消耗，返回完整中间产物。
 * 决定论安全 —— 与 generateHarmonyViaPipeline 共用 _runPipeline。
 */
export function generateHarmonyViaPipelineWithDebug(
    sections: SectionMetadata[],
    tonality: Tonality,
    timeSignature: [number, number],
): PipelineOutput {
    return _runPipeline(sections, tonality, timeSignature);
}
