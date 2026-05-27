// ============================================================
// runPipeline — mgEngine 接管(2026-05-27)
// ============================================================
//
// 当前架构(极简):
//   - 唯一引擎 = mgEngine(钢琴独奏:melody + chord + bass 三轨)
//   - 乐手系统精简为 1 钢琴手,五槽 4 个常为空,只用 MainInst + Accomp
//   - MainInst 槽消费 mg melody;Accomp 槽消费 mg chord
//   - 槽 = null → 对应轨被剪枝,不出声
//
// 调用方契约保持与历史一致:
//   App / PipelineMonitor import runPipeline 不改;
//   返回 { track, context } 仍是 RELATIVE 空间,AudioEngine.playSong 接管。
// ============================================================

import { GeneratedTrack, GenerationOptions, MusicContext, BandRole } from '../types';
import { StyleId } from '../config/StyleFlags';
import { runMgEngine } from '../mgEngine/adapter';
import { PRNGManager } from '../../utils/PRNG';

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

/**
 * mg 期待 string seed。我们 PRNGManager 用数字 seed,这里直接 String() 转。
 */
function deriveMgSeed(numericSeed: number): string {
    return `pop_${numericSeed}`;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    // 取当前 PRNG 状态对应的 seed 字符串(PipelineMonitor 在 playSeed 前会
    // PRNGManager.setSeed(N),这里读回 N 喂给 mg)。
    const numericSeed = PRNGManager.getInitialSeed();
    const mgSeed = deriveMgSeed(numericSeed);

    const { track, context } = runMgEngine({ seed: mgSeed, style: 'POP', key: 'C' });

    // 槽位剪枝:槽 = null 或 undefined → 对应轨清空。
    // (forcedBand 字段缺省时视为 null —— PipelineMonitor 已强制写全 5 槽)
    const forcedBand = options.forcedBand ?? {};
    if (forcedBand[BandRole.MainInst] == null) {
        track.melody = [];
    }
    if (forcedBand[BandRole.Accomp] == null) {
        track.accompaniment = [];
    }
    // 其他槽:bass / drums / atmosphere — mg 不生成 drums/atmosphere,bass 槽
    // 默认就剪掉(我们这次只用钢琴手两槽)。
    track.bass = undefined;
    track.drums = undefined;
    track.atmosphere = undefined;

    // GM 程式号覆盖(MidiConverter 消费)
    const gm = options.forcedGmPrograms ?? {};
    context.gmProgramOverrides = {
        melody: gm[BandRole.MainInst],
        accomp: gm[BandRole.Accomp],
    };

    return { track, context };
}
