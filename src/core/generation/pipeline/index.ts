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
import { MgStyleStore } from '../../../state/MgStyleStore';
import { MgKeyStore } from '../../../state/MgKeyStore';
import { MgSeedStore } from '../../../state/MgSeedStore';

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
 *
 * 用户输入策略(MgSeedStore.getSuffix() 来源,跟 mg App.tsx 一致):
 *   - 含下划线 → 用户输入了完整 mg seed(如 `pop_42`)→ 原样使用
 *   - 不含下划线 → 用户只输入 suffix(如 `42` / `4f9a2b`)→ 当前 style 前缀拼上去
 */
const MG_STYLE_PREFIX: Record<string, string> = {
    POP:   'pop',
    JAZZ:  'jazz',
    BLUES: 'blues',
    RNB:   'rnb',
    LOFI:  'lofi',
};

function deriveMgSeed(suffix: string, style: string): string {
    if (suffix.includes('_')) return suffix;
    const prefix = MG_STYLE_PREFIX[style] ?? 'pop';
    return `${prefix}_${suffix}`;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    // 从 MgSeedStore 读用户输入的 raw alphanumeric seed,跟 mg App.tsx 完全
    // 对齐(支持字母数字下划线,如 `42` / `4f9a2b` / `pop_42`)。
    const seedSuffix = MgSeedStore.getSuffix();
    const mgStyle = MgStyleStore.getStyle();
    const mgKey = MgKeyStore.getKey();
    const mgSeed = deriveMgSeed(seedSuffix, mgStyle);

    const { track, context } = runMgEngine({ seed: mgSeed, style: mgStyle, key: mgKey });

    // ========================================================================
    // 2026-05-27 mg 2-Layer 分轨路由
    // ========================================================================
    // 按 mg App.tsx 的逻辑分组(line 488-489):
    //   - Melody Layer  = events.filter(part === 'melody')           → MainInst (ch1)
    //   - Harmony Layer = events.filter(part === 'chord' || 'bass')  → Accomp   (ch2)
    //
    // adapter 已经拆好 melody / accompaniment / bass 三轨,这里把 bass 合并进
    // accompaniment(mg 的 Harmony Layer 就是这两个加在一起,且 mg 自己一个
    // Salamander sampler 同时弹 — 我们等价用同一个 GM piano 在同 channel)。
    // Bass / Drums / Atmosphere 槽永远空。
    // ========================================================================
    const forcedBand = options.forcedBand ?? {};

    if (forcedBand[BandRole.MainInst] == null) {
        track.melody = [];
    }

    if (forcedBand[BandRole.Accomp] == null) {
        track.accompaniment = [];
    } else {
        // 合并 chord + bass 到 accompaniment(mg Harmony Layer)
        const harmony = [
            ...(track.accompaniment ?? []),
            ...(track.bass ?? []),
        ];
        harmony.sort((a, b) => a.onset - b.onset);
        track.accompaniment = harmony;
    }

    track.bass = undefined;
    track.drums = undefined;
    track.atmosphere = undefined;

    // GM 程式号覆盖(MidiConverter 消费)— 两通道分别覆盖
    const gm = options.forcedGmPrograms ?? {};
    context.gmProgramOverrides = {
        melody: gm[BandRole.MainInst],
        accomp: gm[BandRole.Accomp],
    };

    return { track, context };
}
