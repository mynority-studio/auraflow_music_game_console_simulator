// ============================================================
// DrumRealizer — 鼓乐器具象化(Phase 4)
// ============================================================
//
// 当前为薄包装,内部完全委托 DrumIdiom.render。
//
// 与其他 Realizer 的特殊点:
//   - 不消费 chord / voicing —— 鼓是 pitch-blind,只看 sections + grid 配置
//   - PRNG 消耗显著:每 step ×3 gate + 条件 ×velocity(D-5 关键节点)
//   - Pitch 属于"第三空间"(GM Drum Map),Conductor 不加 keyOffset(K-8)
//
// 未来演进(Phase 4+):
//   - 暴露 prngBudget() 供 Conductor 对账(关键 — 鼓 PRNG 消耗对整曲序列影响大)
//   - 接受 InstrumentProfile(family=Percussion,标记 keyOffset 豁免)
// ============================================================

import type { NoteData } from '../ir';
import { DrumIdiom, DrumIdiomInput } from '../primitives/DrumIdiom';
import type { InstrumentRealizer } from './InstrumentRealizer';

export const DrumRealizer: InstrumentRealizer<DrumIdiomInput> = {
    realize(input: DrumIdiomInput): NoteData[] {
        return DrumIdiom.render(input);
    },
};
