// ============================================================
// AtmosphereRealizer — Pad / 氛围层乐器具象化(Phase 4)
// ============================================================
//
// 当前为薄包装,内部完全委托 AtmosphereRenderer.render。
//
// 与其他 Realizer 的特殊点:
//   - 输入包含 idiom: Partial<AtmosphereConfig>(从 musician.personnel.atmosphereOverrides
//     来,未提供字段走 DEFAULT_*)
//   - sustainModel = pad_envelope(自带 ADSR,跳过 ToplineEngine Pass 3 sustain 处理)
//   - 渲染时使用 chord.voicing(GeneratedChord 已带的全局 SATB voicing)
//   - PRNG 消耗:0(完全决定性)
//
// 未来演进(Phase 4+):
//   - 接受 InstrumentProfile(family=Pad,sustain_model=pad_envelope)
//   - 接受 HarmonicSkeleton 替代 GeneratedChord(届时 voicing 由 VoicingProcessor 单独算)
// ============================================================

import type { NoteData } from '../ir';
import { AtmosphereRenderer, AtmosphereRenderInput } from '../primitives/AtmosphereRenderer';
import type { InstrumentRealizer } from './InstrumentRealizer';

export const AtmosphereRealizer: InstrumentRealizer<AtmosphereRenderInput> = {
    realize(input: AtmosphereRenderInput): NoteData[] {
        return AtmosphereRenderer.render(input);
    },
};
