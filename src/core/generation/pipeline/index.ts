// ============================================================
// runPipeline — stub(2026-05-27 wipe music engines)
// ============================================================
//
// 所有音乐生成引擎(af2-engine / improCore algorithms / harmony)已物理删除。
// 本文件保留 PipelineRunOptions 契约签名,供 App 层(PipelineMonitor /
// EndlessRadioManager / JamSessionManager)的 import 继续编译通过;
// 调用 runPipeline 会 throw,等新引擎接管。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext, BandRole } from '../types';
import { StyleId } from '../config/StyleFlags';

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
    _options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    void _options;
    throw new Error(
        '[runPipeline] music generation engine not implemented — '
        + 'all engines wiped on 2026-05-27. Implement new engine and route here.',
    );
}
