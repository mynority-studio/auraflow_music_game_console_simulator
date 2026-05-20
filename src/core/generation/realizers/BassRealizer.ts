// ============================================================
// BassRealizer — 贝斯乐器具象化(Phase 4)
// ============================================================
//
// 当前为薄包装,内部完全委托 BassIdiom.render。形态与 PianoRealizer 一致:
//   - 输入:BassIdiomInput(chords + styleId + tonality + persona + kickAnchors)
//   - 输出:NoteData[](RELATIVE pitch)
//   - PRNG 消耗:0(贝斯当前完全决定性)
//
// 未来演进(Phase 4+):
//   - 接受 InstrumentProfile(物理约束:polyphonyMax=1 / range / walking 偏好)
//   - 接受 HarmonicSkeleton 替代 GeneratedChord[]
//   - 暴露 prngBudget() 供 Conductor 对账
// ============================================================

import type { NoteData } from '../ir';
import { BassIdiom, BassIdiomInput } from '../primitives/BassIdiom';
import type { InstrumentRealizer } from './InstrumentRealizer';

export const BassRealizer: InstrumentRealizer<BassIdiomInput> = {
    realize(input: BassIdiomInput): NoteData[] {
        return BassIdiom.render(input);
    },
};
