// ============================================================
// 🚧 STUB — 生成流水线占位（原五阶段被完全删除，等待重构）
// ============================================================
//
// 历史功能：
//   Stage 1 selectStyleAndMood → Stage 2 resolveBasicParams → Stage 3 generateHarmony
//   → Stage 4 planConductor → Stage 5 layerInstruments → { track, context }
//   消费 PRNG、风格池、Persona 池、和声引擎、织体映射等子系统。
//
// 重构期占位行为：
//   - 仍尊重 allowedStyleIds / forcedStyleId / forcedBand 的形参约束（保编译）
//   - 仅消费 1 次 PRNG 抽风格，不再消费下游 PRNG（避免 ACVE 快照点错位的假象）
//   - 返回最小空骨架 GeneratedTrack + MusicContext，所有数组为空
//
// 重构方向：
//   新引擎重新填入五阶段。请保持 PRNG 消耗顺序与本占位一致（先抽 styleId）以便
//   黄金种子录制能从此处稳定起步。
// ============================================================

import {
    GeneratedTrack,
    GenerationOptions,
    MusicContext,
    RoleType,
    Tonality,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { PRNGManager } from '../../utils/PRNG';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    /**
     * 5 槽位 BandSelection（PipelineMonitor）显式注入：
     *   Partial<Record<RoleType, string | null>>
     */
    forcedBand?: Partial<Record<RoleType, string | null>>;
    generation?: GenerationOptions;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    PRNGManager.recordSnapshot('B');

    const pool = options.forcedStyleId !== undefined
        ? [options.forcedStyleId]
        : (options.allowedStyleIds && options.allowedStyleIds.length > 0
            ? options.allowedStyleIds
            : [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]);
    const styleId = pool[Math.floor(PRNGManager.next() * pool.length)];
    const style = getStyleConfig(styleId);

    const track: GeneratedTrack = {
        chords: [],
        melody: [],
        sections: [],
        bpm: 120,
        key: 'C',
        keyOffset: 0,
        tonality: Tonality.Major,
        timeSignature: [4, 4],
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: false,
    };

    const context: MusicContext = {
        keyOffset: 0,
        tonality: Tonality.Major,
        bpm: 120,
        timeSignature: [4, 4],
        grooveDNA: [],
        style,
    };

    return { track, context };
}
