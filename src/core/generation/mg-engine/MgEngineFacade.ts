// ============================================================
// MgEngineFacade — melodygenerative 引擎入口(Phase 0 stub)
// ============================================================
//
// Phase 0 状态:
//   占位实现。runPipeline 在 EngineSelectionStore.getEngine() === 'MG' 时
//   调用 generate(),目前直接抛 NOT_IMPLEMENTED。UI 切到 MG + 点 Play 会
//   命中错误提示,这是预期 — 标志"壳已搭好,等下一阶段 copy mg 代码"。
//
// Phase 1 计划:
//   - copy ~/vibe_coding/melodygenerative/src/lib/* 到本目录(原样保留)
//   - 实现 ChordDef → GeneratedChord adapter
//   - generate() 返回 GeneratedTrack-shape:
//       { chords, melody, accompaniment (= 钢琴 RH),
//         bass: [], drums: [], atmosphere: []  (空数组,MG 无这些轨) }
//   - 下游 AbsoluteTransposer / MidiConverter / AudioEngine 零改动消费
//
// Phase 1+2 PRNG 策略:
//   mg-engine 内部保留自己的 Random 类(基于 mulberry32,字符串 fork),
//   与 auraflow PRNGManager 完全隔离。验收锚点:同 seed → MG 输出 =
//   melodygenerative-standalone 输出(听感对账)。
//
// Phase 3 才合并 PRNG(届时 mg 已成 auraflow 内核,原版概念失效)。
// 详见后续 dual-engine 路线文档(Phase 1 落地后写)。
// ============================================================

import type { GeneratedTrack, MusicContext } from '../types';
// `import type` 确保编译后无运行时引用,避免 pipeline ↔ mg-engine 循环 import
import type { PipelineRunOptions } from '../pipeline';

export interface MgGenerateResult {
    track: GeneratedTrack;
    context: MusicContext;
}

export const MgEngineFacade = {
    /**
     * Phase 0 stub:直接抛 NOT_IMPLEMENTED。
     *
     * Phase 1 实装后接收 PipelineRunOptions 子集(只消费与钢琴 solo 相关
     * 的字段:generation.seed / styleId / length 等;forcedBand /
     * forcedGmPrograms 在 MG 模式下无意义,UI 已 disable)。
     */
    generate(_options: PipelineRunOptions): MgGenerateResult {
        throw new Error(
            'MG engine not yet ported (Phase 0 stub). ' +
            'Switch back to AF in Q+H or wait for Phase 1 to copy melodygenerative code.',
        );
    },
};
