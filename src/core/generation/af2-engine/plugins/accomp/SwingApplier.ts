// ============================================================
// SwingApplier(Z1 + Z1b 阶段)— Per-mgStyle swing 8th and
// ============================================================
//
// 原 Af2AccompGen.applySwing(2026-05-25 拆 plugin)。
//
// Z1 初版:linear 重映射所有 onset within beat — 但 family 内部很多 onset
// 已经 pre-swung(JazzCharleston 1.66 / ShuffleChop 0.66 / Triplet 0.33/0.66 /
// Bossa clave 0.5/1.5/3.5),会造成 double-swing 错位。
//
// Z1b 精确化:**只 swing 直拍 8th and 位置**(within ≈ 0.5,容差 0.05)。
// 其他位置(triplet 0.33/0.66 / 16th 0.25/0.75 / pre-swung 0.66 等)不动。
//
//   PopAnthem 8th pulse at 0.5  → 0.66 ✓(POP swing=0.5 不变,提前 return)
//   JazzCharleston at 1.66      → 1.66 不动 ✓(已 pre-swung)
//   Triplet at 0.33/0.66        → 不动 ✓(12/8 律动保 invariant)
//   Chicago_Shuffle at 0.66     → 不动 ✓(已 pre-swung)
//   Bossa clave at 0.5/1.5/3.5  → swing 到 0.66/1.66/3.66
//   16th positions(0.25/0.75) → 不动 ✓
//
// SWING_RATIO_BY_STYLE:
//   POP/RNB 0.50 — 直拍(identity 触发条件,函数提前 return)
//   JAZZ    0.66 — triplet swing
//   BLUES   0.66 — shuffle
//
// 工程:容差 0.05 让 micro-timing 4ms 滚奏不会触发(0.008 << 0.05);
//       swing 优先于 micro-timing 跑 → cluster 主位移后再加 strum delay。
// ============================================================

import type { NoteData } from '../../../types';
import type { MgStyle } from '../../../../../state/EngineSelectionStore';
import type { AccompPluginMeta } from './types';

const ACCOMP_SWING_BY_STYLE: Record<MgStyle, number> = {
    POP:   0.50,
    JAZZ:  0.66,
    BLUES: 0.66,
    RNB:   0.50,
};

const SWING_TRIGGER_TOLERANCE = 0.05;  // within ≈ 0.5 容差(避免触发 16th / triplet 位置)

export const SwingApplier: AccompPluginMeta & {
    apply(notes: ReadonlyArray<NoteData>, mgStyle: MgStyle): NoteData[];
} = {
    name: 'SwingApplier',
    version: 'v1.1 (Z1b phase)',
    prngConsumption: 'zero',
    description: 'Per-mgStyle 直拍 8th and swing(POP/RNB identity 跳过;JAZZ/BLUES 0.66 triplet);容差 0.05 避 double-swing',

    apply(notes, mgStyle) {
        const swing = ACCOMP_SWING_BY_STYLE[mgStyle] ?? 0.5;
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
