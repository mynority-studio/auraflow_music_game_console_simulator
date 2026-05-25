// ============================================================
// BandSelectionStore — 全局 committed band 选择共享存储
// ============================================================
//
// 设计动机:
//   Q+H Band Selection UI(PipelineMonitor 内)与 AuraBar TapArea 双击触发的
//   EndlessRadioManager 是两条独立生成路径。用户在 Q+H 里 Apply 的乐队信息
//   需要被两边都消费。
//
// 现状:
//   - PipelineMonitor.playSeed 经 bandSelectionRef.current → runPipeline
//   - EndlessRadioManager.triggerGeneration 经 MelodyEngine.generateFullSong
//     → runPipeline(**不传 forcedBand**)
//
// 本 store 提供模块级 singleton committed 状态,两条路径都读它。
//
// 设计要点:
//   - **只存 committed**(不存 pending UI 编辑)— 单一职责
//   - PipelineMonitor 点 Apply 时调 setBand()
//   - EndlessRadioManager 在 triggerGeneration 时调 getBand() / getInstruments()
//   - 跨组件 / 跨 app 切换持久(模块级 singleton 天然如此)
//   - 不做 React 订阅 — AuraBar 在触发时读快照即可
//
// 不要做的事:
//   - 不要把 pending UI 状态放进来(会污染 committed 语义)
//   - 不要做"自动同步"(避免 React 状态与 store 双向死循环)
//   - 不要在这里做 deep clone(调用方负责传 deep-cloned 对象)
// ============================================================

import { BandRole } from '../core/generation/types';

export type BandSelection = Partial<Record<BandRole, string | null>>;
export type InstrumentSelection = Partial<Record<BandRole, number>>;

/**
 * 默认 band(fresh load 时):5 槽预填合理 musicians,保证 AF2 模式开盒即响。
 * 之前 Phase A 改 "empty 槽 = 无声" 后,如果 store 是 {} 会全静音 → 必须给默认。
 * 用户点 BandSelection Apply 会 setBand() 覆盖这份默认。
 */
const DEFAULT_BAND: BandSelection = {
    [BandRole.MainInst]:   'alex_piano',
    [BandRole.Accomp]:     'chloe_pop_piano',
    // 2026-05-25 切"钢琴独奏"模式:删 bass musician,HandPartitioner LH 替代 bass
    // 恢复多乐手时改回 'frank_bass'(MusicianRegistry 注释也要恢复)
    [BandRole.Bass]:       null,
    [BandRole.Drums]:      'dave_drums',
    [BandRole.Atmosphere]: 'nina_pad',
};

let _band: BandSelection = { ...DEFAULT_BAND };
let _instruments: InstrumentSelection = {};

export const BandSelectionStore = {
    /**
     * 取当前 committed band(对应 PipelineRunOptions.forcedBand)。
     * 返回引用 — 调用方不要修改,要修改请走 setBand()。
     */
    getBand(): BandSelection {
        return _band;
    },

    /**
     * 取当前 committed instrument(对应 PipelineRunOptions.forcedGmPrograms)。
     */
    getInstruments(): InstrumentSelection {
        return _instruments;
    },

    /**
     * 设置 committed band + instruments(PipelineMonitor 点 Apply 时调用)。
     *
     * 内部 shallow copy 防止 caller 后续 mutate 影响 store。
     */
    setBand(band: BandSelection, instruments: InstrumentSelection): void {
        _band = { ...band };
        _instruments = { ...instruments };
    },
};
