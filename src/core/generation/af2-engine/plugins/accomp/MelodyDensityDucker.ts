// ============================================================
// MelodyDensityDucker(T 阶段)— Melody-aware density ducking
// ============================================================
//
// 原 Af2AccompGen.duckByMelodyDensity(2026-05-25 拆 plugin)。
//
// 扫每个 accomp note onset,在 ±DUCK_WINDOW 内统计 melody onset 数:
//   countNear >= HIGH_DENSITY_THRESHOLD (=2) → velocity × DUCK_RATIO (0.6)
//   countNear === 0                          → velocity × FILL_BOOST (1.15)
//   1 个 melody onset(中间密度)             → 不动
//
// 听感效果(用户讨论的"频率避让" + "空隙填补"):
//   主唱长音 / 休止 → accomp 增亮(填补听觉空白)
//   主唱密集 16th   → accomp 退后(让 melody 突出)
//   产生"melody 主导 → accomp 应答"的对话感
//
// 性能:O(N_accomp × N_melody),典型 ~200 × ~100 = 20k 操作 < 5ms。
// ============================================================

import type { NoteData } from '../../../types';
import type { AccompPluginMeta } from './types';

const DUCK_WINDOW = 0.2;              // ± beat window
const HIGH_DENSITY_THRESHOLD = 2;     // melody onset 数 >= 此值 = 高密度
const DUCK_RATIO = 0.6;               // 高密度时 accomp velocity 缩放
const FILL_BOOST = 1.15;              // melody 空时 accomp velocity 增强

export const MelodyDensityDucker: AccompPluginMeta & {
    apply(
        accompNotes: ReadonlyArray<NoteData>,
        melodyNotes: ReadonlyArray<NoteData> | undefined,
    ): NoteData[];
} = {
    name: 'MelodyDensityDucker',
    version: 'v1.0 (T phase)',
    prngConsumption: 'zero',
    description: 'Melody-aware density ducking — melody 密时 accomp 让(×0.6),melody 稀时 accomp 填(×1.15)',

    apply(accompNotes, melodyNotes) {
        if (!melodyNotes || melodyNotes.length === 0) return accompNotes.slice();
        const sortedMelody = melodyNotes.slice().sort((a, b) => a.onset - b.onset);

        const out: NoteData[] = new Array(accompNotes.length);
        for (let i = 0; i < accompNotes.length; i++) {
            const note = accompNotes[i];
            let countNear = 0;
            for (const m of sortedMelody) {
                if (m.onset < note.onset - DUCK_WINDOW) continue;
                if (m.onset > note.onset + DUCK_WINDOW) break;
                countNear++;
                if (countNear >= HIGH_DENSITY_THRESHOLD) break;
            }
            if (countNear >= HIGH_DENSITY_THRESHOLD) {
                out[i] = { ...note, velocity: Math.max(0.1, note.velocity * DUCK_RATIO) };
            } else if (countNear === 0) {
                out[i] = { ...note, velocity: Math.min(1, note.velocity * FILL_BOOST) };
            } else {
                out[i] = note;
            }
        }
        return out;
    },
};
