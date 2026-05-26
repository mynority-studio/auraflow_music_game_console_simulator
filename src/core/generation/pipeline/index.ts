// ============================================================
// runPipeline — 单一入口(2026-05-26 Step 6.4 合并 AF2+ImproCore 后)
// ============================================================
//
// 历史:
//   2026-05-24:删 AF/MG → AF2 唯一内核
//   2026-05-25:加 ImproCore Facade,EngineSelectionStore 切换 AF2 / Impro 两套
//   2026-05-26:Step 6.4 — ImproCore 算法装进 AF2 framework(adapter),
//              ImproEngineFacade 删除,EngineSelectionStore 退化(单引擎)
//
// 现状:始终路由 Af2EngineFacade.generate(内部 PianoIdiom 调 ImproCore adapter)。
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
