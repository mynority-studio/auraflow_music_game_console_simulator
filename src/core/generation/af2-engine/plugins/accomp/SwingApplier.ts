// ============================================================
// SwingApplier(POP-only,直拍 identity)
// ============================================================
//
// POP/RNB 直拍 swing=0.50 → identity 触发条件,函数提前 return。
// JAZZ/BLUES 已退役(其曾用 0.66 triplet swing)。
//
// 本 POP-only flat 化后,本 plugin 实际是 no-op,但保留以保 chain 结构
// (Af2AccompGen 仍按 chain 调用)。未来若需 POP 内部某 sub-style 加 swing,
// 可改 ACCOMP_SWING_POP 常量。
// ============================================================

import type { NoteData } from '../../../types';
import type { AccompPluginMeta } from './types';

const ACCOMP_SWING_POP: number = 0.50;

const SWING_TRIGGER_TOLERANCE = 0.05;  // within ≈ 0.5 容差(避免触发 16th / triplet 位置)

export const SwingApplier: AccompPluginMeta & {
    apply(notes: ReadonlyArray<NoteData>): NoteData[];
} = {
    name: 'SwingApplier',
    version: 'v1.2 (POP-only flat)',
    prngConsumption: 'zero',
    description: 'POP 直拍 8th(identity 跳过);JAZZ/BLUES 已退役',

    apply(notes) {
        const swing = ACCOMP_SWING_POP;
        if (Math.abs(swing - 0.5) < 1e-6) return notes.slice();  // 直拍无变化

        const out: NoteData[] = new Array(notes.length);
        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            const beatBase = Math.floor(n.onset);
            const within = n.onset - beatBase;
            if (Math.abs(within - 0.5) < SWING_TRIGGER_TOLERANCE) {
                out[i] = { ...n, onset: beatBase + swing };
            } else {
                out[i] = n;
            }
        }
        return out;
    },
};
