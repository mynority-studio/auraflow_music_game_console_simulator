import { GeneratedTrack, MusicContext, GenerationOptions } from './types';
import { StyleId } from './config/StyleFlags';
import { runPipeline } from './pipeline';

// 🌟 五阶段管道入口（2026-04-23 重构）
//
// 执行顺序：
//   Stage 1  StyleAndMoodSelector    → { styleId, moodId }
//   Stage 2  BasicParamsResolver     → timeSig → tonality → bpm → sections
//   Stage 3  HarmonicEngine          → chords + cadentialBridges（251 桥接）
//   Stage 4  ConductorPlanner        → ConductorPlan（焦点/支撑/避让/节奏中心/加花窗口）
//   Stage 5  InstrumentLayering      → melody/vocal + GlobalReview → GeneratedTrack
//
// 旧签名 generateFullSong(styleId, options) 保留兼容，内部转发到 runPipeline。
export class MelodyEngine {
    public generateFullSong(
        styleIdOrOptions?: StyleId | GenerationOptions,
        legacyOptions: GenerationOptions = {},
    ): { track: GeneratedTrack; context: MusicContext } {
        let forcedStyleId: StyleId | undefined;
        let options: GenerationOptions;

        if (typeof styleIdOrOptions === 'number') {
            forcedStyleId = styleIdOrOptions;
            options = legacyOptions;
        } else {
            options = styleIdOrOptions ?? {};
        }

        return runPipeline({
            forcedStyleId,
            generation: options,
        });
    }
}
