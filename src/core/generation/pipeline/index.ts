// ============================================================
// runPipeline — AF2 唯一入口(2026-05-24 删 AF/MG 后)
// ============================================================
//
// 历史:本文件早期承载完整 Stage 1-5 + Conductor + MG/AF2 分流。
//        2026-05-24 删 AF/MG 路径后,本文件退化为薄壳:始终路由到
//        Af2EngineFacade.generate(options)。
//
// app_integration_rule §0 Single Pipeline 原则保持不变:
//   所有 app(AuraBar / AuraJam / PipelineMonitor)继续 import runPipeline
//   from '../../core/generation/pipeline',调用契约 0 变化。
//
// 后续清理:旧 AF pipeline / primitives / realizers / mg-engine 等文件
//   不再被 runPipeline 调用,留待后续 commit 物理删除。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext, BandRole } from '../types';
import { StyleId } from '../config/StyleFlags';
import { Af2EngineFacade } from '../af2-engine/Af2EngineFacade';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedBand?: Partial<Record<BandRole, string | null>>;
    /**
     * Per-role GM 程式号覆盖(0~127)。
     *   优先级:forcedGmPrograms > musician.gmProgramOverride > 默认
     */
    forcedGmPrograms?: Partial<Record<BandRole, number>>;
    generation?: GenerationOptions;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    return Af2EngineFacade.generate(options);
}
