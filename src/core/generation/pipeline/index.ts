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
import { MgStyleStore } from '../../../state/MgStyleStore';

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
 * mg 期待 string seed,格式 `${stylePrefix}_${suffix}`。stylePrefix 必须跟当前
 * MgStyle 一致(否则 mg 端 PREFIX_TO_STYLE 解析后样式不匹配)。
 */
const MG_STYLE_PREFIX: Record<string, string> = {
    POP:   'pop',
    JAZZ:  'jazz',
    BLUES: 'blues',
    RNB:   'rnb',
    LOFI:  'lofi',
};

function deriveMgSeed(numericSeed: number, style: string): string {
    const prefix = MG_STYLE_PREFIX[style] ?? 'pop';
    return `${prefix}_${numericSeed}`;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    // 取当前 PRNG 状态对应的 seed 字符串(PipelineMonitor 在 playSeed 前会
    // PRNGManager.setSeed(N),这里读回 N 喂给 mg)。
    const numericSeed = PRNGManager.getInitialSeed();
    const mgStyle = MgStyleStore.getStyle();
    const mgSeed = deriveMgSeed(numericSeed, mgStyle);

    const { track, context } = runMgEngine({ seed: mgSeed, style: mgStyle, key: 'C' });

    // ========================================================================
    // 2026-05-27 单轨调试模式
    // ========================================================================
    // 用户怀疑 multi-channel 路由是听感"chord 第二个开始没了"的根因。把 mg 完整
    // 输出(melody + chord + bass)合并按 onset 升序塞进 MainInst 单轨,
    // 绕开通道 2/3 的 SF2 加载 / 通道隔离问题。
    //
    // Accomp / Bass / Drums / Atmosphere 槽全空(MusicianRegistry 已限制
    // alex_piano.eligibleRoles=[MainInst])。
    // ========================================================================
    const forcedBand = options.forcedBand ?? {};
    if (forcedBand[BandRole.MainInst] == null) {
        // MainInst 槽空 → 整曲不出声
        track.melody = [];
    } else {
        const merged = [
            ...(track.melody ?? []),
            ...(track.accompaniment ?? []),
            ...(track.bass ?? []),
        ];
        merged.sort((a, b) => a.onset - b.onset);
        track.melody = merged;
    }
    track.accompaniment = undefined;
    track.bass = undefined;
    track.drums = undefined;
    track.atmosphere = undefined;

    // GM 程式号覆盖(MidiConverter 消费)— 单轨调试只用 melody 通道
    const gm = options.forcedGmPrograms ?? {};
    context.gmProgramOverrides = {
        melody: gm[BandRole.MainInst],
    };

    return { track, context };
}
