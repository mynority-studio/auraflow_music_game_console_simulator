// ============================================================
// 🚧 STUB — 生成管道入口占位
// ============================================================
//
// 历史功能：
//   generateFullSong(styleId | options) → { track, context }
//   作为 runPipeline 的薄封装，承载旧版 App 层（AuraBar / AuraJam / 老 AuraRadio）
//   的兼容入口签名。
//
// 重构期占位行为：
//   保持类与方法签名，转发到占位版 runPipeline，返回空骨架曲目。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext } from './types';
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
