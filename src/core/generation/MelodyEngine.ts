// ============================================================
// MelodyEngine — 转发到 runPipeline 的薄封装
// ============================================================
// 历史 API：generateFullSong(styleId | options) → { track, context }
// 当前 Phase 1 MVP：内部直接调用 runPipeline，让旧调用方（AuraBar 等）零改动接入新管线。
// 后续如需恢复 Stage 1~5 各自的入口，可在此扩展。
// ============================================================

import { GeneratedTrack, MusicContext, GenerationOptions } from './types';
import { StyleId } from './config/StyleFlags';
import { runPipeline } from './pipeline';

export class MelodyEngine {
    public generateFullSong(
        styleIdOrOptions?: StyleId | GenerationOptions,
        legacyOptions: GenerationOptions = {},
    ): { track: GeneratedTrack; context: MusicContext } {
        const forcedStyleId =
            typeof styleIdOrOptions === 'number' ? (styleIdOrOptions as StyleId) : undefined;
        const generation =
            typeof styleIdOrOptions === 'object' && styleIdOrOptions !== null
                ? (styleIdOrOptions as GenerationOptions)
                : legacyOptions;

        return runPipeline({ forcedStyleId, generation });
    }
}
