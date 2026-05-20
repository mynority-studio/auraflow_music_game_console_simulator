// ============================================================
// InstrumentRealizer — 乐器具象化接口(Phase 3b 引入)
// ============================================================
//
// "乐器是前置决策,不是后置渲染" —— 每个 InstrumentRealizer 是一个乐器的
// 具象化模块,把 HarmonicSkeleton + BandPlan + IdiomMode 翻译成乐器特有的
// NoteData[](按物理约束 / idiomatic writing 渲染)。
//
// Phase 3b 仅落地 PianoRealizer 雏形(薄包装,委托 PianoAccompIdiom)。
// Phase 4 会逐步加入 BassRealizer / DrumRealizer / AtmosphereRealizer。
//
// 设计原则:
//   1. 输入类型由各 Realizer 自定义(TInput) —— 不同乐器关心不同维度
//      (钢琴:chords + voicing + texture params;鼓:section + density;
//       贝斯:chords + walking pattern;Pad:chords + envelope)
//      统一硬塞一个通用 RealizerInput 是过度抽象,会变上帝对象。
//   2. 输出统一为 NoteData[](RELATIVE pitch) —— Conductor 最后一步加 keyOffset。
//   3. Realizer 应该是无状态纯函数(D-1)。Phase 4 会加 prngBudget 字段
//      作为契约,Conductor 前置对账。
//   4. Realizer 不感知"全曲编制" —— 它只看自己分到的部分。跨乐器协调
//      (撞音/声部交叉)归 Phase 5 Reconciler。
//
// 当前(Phase 3b)接口最小:仅 realize 方法。等 PianoRealizer 验证可行
// 且第二个 Realizer(贝斯)接入后,再统一扩 profile / prngBudget 字段。
// ============================================================

import type { NoteData } from '../ir';

export interface InstrumentRealizer<TInput> {
    /**
     * 把乐器特定输入翻译为 NoteData[](RELATIVE pitch)。
     * 必须是纯函数 —— 同一 input 必然产同一 output(D-5 可重放)。
     */
    realize(input: TInput): NoteData[];
}
