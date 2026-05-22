// ============================================================
// Arranger — 编曲师层接口(用户 8 层架构 #3)
// ============================================================
//
// **Option A 接口起步**:本次仅定义类型 / 接口契约,**实现层 mg 暂不拆开**
// (mg.generateProgressions 内部把 Arranger + Composer 一气呵成)。
//
// 这一步立"骨架与色彩分离"的概念边界,为后续 B/C 选项铺路:
//   - Option B:真分离 mg pipeline,在 Arranger 输出和 Composer 输入之间
//     允许 AF2 介入(加 passing chords / modal interchange / 等)
//   - Option C:AF2 写自己的 Arranger(完全替代 mg 的编曲师角色)
//
// Arranger 职责(用户 ideal):
//   决定段落骨架(已 SectionPlanner)+ 能量曲线 + 和声进行的"级数 / TSD"层
//   (不决定具体 chord quality / voicing — 那是 Composer 的事)。
// ============================================================

import type { GeneratedChord, SectionMetadata, Tonality } from '../types';
import type { Score } from './Score';

/**
 * HarmonicStep — Arranger 输出的单和弦"骨架"(无 voicing,无 specific quality)。
 *
 * 包含:
 *   - numeral:级数(如 'I' / 'V7/vi' / 'subV/V')
 *   - tsd:和声功能(T/S/D)
 *   - rootPc:根音 pitch class(0-11)
 *   - 时间窗口(startBeat / endBeat)
 *
 * 不包含:具体 chord quality(maj7 / m9 / 13 等)、voicing、bassMidi。这些
 * 是 Composer 阶段的产物。
 */
export interface HarmonicStep {
    readonly numeral: string;
    readonly tsd: 'T' | 'S' | 'D';
    readonly rootPc: number;
    readonly startBeat: number;
    readonly endBeat: number;
}

/** Harmonic skeleton — 全曲级数 + TSD 时间线 */
export interface HarmonicSkeleton {
    readonly steps: ReadonlyArray<HarmonicStep>;
}

/**
 * ArrangerOutput — Arranger 给 Composer 的完整产物。
 *
 * 包含:
 *   - sections:段落骨架(SectionPlanner 已生成)
 *   - harmonicSkeleton:和声骨架(级数 + TSD)
 *   - 全曲 meta:bpm / key / keyOffset / tonality / timeSignature
 *
 * 不包含 voicing / 具体 chord quality — 那是 Composer 阶段的输出。
 */
export interface ArrangerOutput {
    readonly sections: ReadonlyArray<SectionMetadata>;
    readonly harmonicSkeleton: HarmonicSkeleton;
    readonly bpm: number;
    readonly key: string;
    readonly keyOffset: number;
    readonly tonality: Tonality;
    readonly timeSignature: readonly [number, number];
}

/**
 * Arranger 接口 — 决定段落 + 和声进行骨架。
 *
 * Option A:本接口已声明,但具体实现层 mg.generateProgressions 仍把 Arranger
 *           + Composer 合并实现。
 * Option B+:AF2 可写自己的 Arranger 实现,在中间替换 mg 的编曲师角色。
 */
export interface Arranger {
    /** Future:接 ArrangerConfig(style / bars / emotion / etc.)*/
    arrange(): ArrangerOutput;
}

// ============================================================
// Helpers — 从 Score / GeneratedChord 抽取 ArrangerOutput 视图
// ============================================================

/**
 * Roman numeral → 'T' | 'S' | 'D' 简单分类(与 engine-utils.harmonicFunctionFromRoman
 * 同算法,但本文件作为 AF2 层不依赖 mg-engine,内联以保 dependency 单向)。
 */
function tsdFromNumeral(numeral: string): 'T' | 'S' | 'D' {
    const base = numeral.split('/')[0].replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
    if (['V', 'v', 'vii', 'VII'].includes(base) || numeral.includes('/')) return 'D';
    if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
    return 'T';
}

/** GeneratedChord → HarmonicStep 投影(丢 voicing / quality,只留骨架)*/
function chordToHarmonicStep(c: GeneratedChord): HarmonicStep {
    return {
        numeral: c.numeral,
        tsd: tsdFromNumeral(c.numeral),
        rootPc: c.root,
        startBeat: c.startBeat,
        endBeat: c.endBeat,
    };
}

/**
 * 从 Score 抽 ArrangerOutput "视图"(Option A 用,实际 Score 是 mg 一气呵成的)。
 * AF2 想观察"如果只看 Arranger 输出,是什么样"时调用。
 */
export function viewArrangerOutputFromScore(score: Score): ArrangerOutput {
    return {
        sections: score.sections,
        harmonicSkeleton: {
            steps: score.chords.map(chordToHarmonicStep),
        },
        bpm: score.bpm,
        key: score.key,
        keyOffset: score.keyOffset,
        tonality: score.tonality,
        timeSignature: score.timeSignature,
    };
}
