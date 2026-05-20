// ============================================================
// PianoRealizer — 钢琴乐器具象化(Phase 3b 首个 InstrumentRealizer)
// ============================================================
//
// 当前(Phase 3b)为薄包装,内部完全委托 PianoAccompIdiom.render。
// 引入目的:
//   1. 建立 InstrumentRealizer 接口的"第一个真实实现",验证形态
//   2. 让 Stage5Layering 调用方看到的不再是 "PianoAccompIdiom"(渲染器)
//      而是 "PianoRealizer"(导演认证过的乐器具象化模块)
//   3. 给嵌入式 C 端对接一个稳定的命名 —— Phase 4 加入更多 Realizer 时
//      接入模式统一(都通过 realizers/ 入口),不需要逐个学习
//
// 行为零变化(bit-exact)—— 当前内部仅 forward 到 PianoAccompIdiom.render。
//
// 未来演进:
//   - Phase 4:HarmonyCore 产出 HarmonicSkeleton 后,PianoRealizer 内部
//     调用 VoicingProcessor.computeSATBVoicings 自行 voicing,不再依赖
//     上游的 GeneratedChord.voicing
//   - Phase 4:Realizer 暴露 prngBudget() 给 Conductor 对账
//   - Phase 4:Realizer 接受 InstrumentProfile(物理约束 + 软偏好)输入
// ============================================================

import type { NoteData } from '../ir';
import {
    PianoAccompIdiom,
    PianoAccompRenderInput,
} from '../primitives/PianoAccompIdiom';
import type { InstrumentRealizer } from './InstrumentRealizer';

export const PianoRealizer: InstrumentRealizer<PianoAccompRenderInput> = {
    realize(input: PianoAccompRenderInput): NoteData[] {
        return PianoAccompIdiom.render(input);
    },
};
