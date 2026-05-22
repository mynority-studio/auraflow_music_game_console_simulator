// ============================================================
// Af2Arranger — AF2 自有编曲师(Option C MVP)
// ============================================================
//
// 用户 8 层架构 #3 "编曲师"层 AF2 实装。本 Arranger 决定:
//   - 全曲和声进行(级数 Roman + chord type + rootOffset)
//
// 与 mg 关系:
//   - **不调 mg.generateProgressions / mg.generateProgression** — AF2 自有进行池
//   - 输出 abstractPath 喂给 mg.realizeProgression(Composer 仍委托 mg 做 voicing)
//   - mg.generateArrangement 继续用 AF2-arranged chords 做 melody/accomp/bass
//
// 当前(MVP)进行池:per-mgStyle 1-2 条标志性 4-chord(POP/JAZZ/RNB)或
// 12-bar(BLUES)progression,扩展到 recommendedBars(POP/JAZZ/RNB=16,BLUES=12)。
// 用 rng.pick 抽选(deterministic per seed)。
//
// 未来扩展:
//   - 进行池扩到 5-10 条 per mgStyle(用户音乐性补充)
//   - per-section 不同进行(Verse vs Chorus 不同 chord 走向)
//   - Modal interchange 注入(bVII / iv 等借和弦)
//   - 与 musician 卡的 sectionRolePreference 协同(主奏喜欢的进行风格)
// ============================================================

import type { Random } from '../mg-engine/musicEngine';
import type { MgStyle } from '../../../state/EngineSelectionStore';

/**
 * AF2 抽象进行步(mg.realizeProgression 输入兼容形式)。
 *
 * - roman:级数显示串('I' / 'V7' / 'ii7')
 * - type:chord type(mg 词汇 — 'maj' / 'min' / 'maj7' / 'm7' / '7' 等)
 * - rootOffset:相对调根的半音 offset(0=I / 2=ii / 4=iii / 5=IV / 7=V / 9=vi / 11=vii)
 * - scaleDegree:可选 1-7 级数(给 mg 的 mode-aware filter 用)
 */
export interface Af2AbstractStep {
    roman: string;
    type: string;
    rootOffset: number;
    scaleDegree?: number;
}

/** Per-mgStyle 进行池(MVP — 每 style 1-2 条) */
const AF2_PROGRESSION_POOL: Record<MgStyle, ReadonlyArray<ReadonlyArray<Af2AbstractStep>>> = {
    POP: [
        // I-V-vi-IV (Axis of Awesome,流行最常见)
        [
            { roman: 'I',  type: 'maj', rootOffset: 0, scaleDegree: 1 },
            { roman: 'V',  type: 'maj', rootOffset: 7, scaleDegree: 5 },
            { roman: 'vi', type: 'min', rootOffset: 9, scaleDegree: 6 },
            { roman: 'IV', type: 'maj', rootOffset: 5, scaleDegree: 4 },
        ],
        // I-vi-IV-V (50s progression)
        [
            { roman: 'I',  type: 'maj', rootOffset: 0, scaleDegree: 1 },
            { roman: 'vi', type: 'min', rootOffset: 9, scaleDegree: 6 },
            { roman: 'IV', type: 'maj', rootOffset: 5, scaleDegree: 4 },
            { roman: 'V',  type: 'maj', rootOffset: 7, scaleDegree: 5 },
        ],
    ],
    JAZZ: [
        // ii7-V7-Imaj7-vim7(jazz 标准 turnaround)
        [
            { roman: 'ii7',   type: 'm7',   rootOffset: 2, scaleDegree: 2 },
            { roman: 'V7',    type: '7',    rootOffset: 7, scaleDegree: 5 },
            { roman: 'Imaj7', type: 'maj7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'vim7',  type: 'm7',   rootOffset: 9, scaleDegree: 6 },
        ],
        // Imaj7-vim7-iim7-V7(Anatole)
        [
            { roman: 'Imaj7', type: 'maj7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'vim7',  type: 'm7',   rootOffset: 9, scaleDegree: 6 },
            { roman: 'iim7',  type: 'm7',   rootOffset: 2, scaleDegree: 2 },
            { roman: 'V7',    type: '7',    rootOffset: 7, scaleDegree: 5 },
        ],
    ],
    BLUES: [
        // 12-bar blues 经典
        [
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'IV7', type: '7', rootOffset: 5, scaleDegree: 4 },
            { roman: 'IV7', type: '7', rootOffset: 5, scaleDegree: 4 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'V7',  type: '7', rootOffset: 7, scaleDegree: 5 },
            { roman: 'IV7', type: '7', rootOffset: 5, scaleDegree: 4 },
            { roman: 'I7',  type: '7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'V7',  type: '7', rootOffset: 7, scaleDegree: 5 },
        ],
    ],
    RNB: [
        // Imaj7-iiim7-vim7-IVmaj7(neo-soul 标志)
        [
            { roman: 'Imaj7',  type: 'maj7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'iiim7',  type: 'm7',   rootOffset: 4, scaleDegree: 3 },
            { roman: 'vim7',   type: 'm7',   rootOffset: 9, scaleDegree: 6 },
            { roman: 'IVmaj7', type: 'maj7', rootOffset: 5, scaleDegree: 4 },
        ],
        // ii7-V7-Imaj7-IVmaj7(R&B common)
        [
            { roman: 'iim7',   type: 'm7',   rootOffset: 2, scaleDegree: 2 },
            { roman: 'V7',     type: '7',    rootOffset: 7, scaleDegree: 5 },
            { roman: 'Imaj7',  type: 'maj7', rootOffset: 0, scaleDegree: 1 },
            { roman: 'IVmaj7', type: 'maj7', rootOffset: 5, scaleDegree: 4 },
        ],
    ],
};

export const Af2Arranger = {
    /**
     * AF2 编曲师 — 抽进行 + 展开到 bars 长度。
     *
     * MVP 算法:
     *   1. 从 pool 抽 1 条 progression(rng.pick deterministic)
     *   2. 长度短于 bars → 循环填充
     *   3. 长度等于 bars(BLUES 12 = recommended 12)→ 直接用
     */
    arrange(mgStyle: MgStyle, bars: number, rng: Random): Af2AbstractStep[] {
        const pool = AF2_PROGRESSION_POOL[mgStyle];
        if (!pool || pool.length === 0) {
            // Fallback:I-IV-V-I 极简
            return Array.from({ length: bars }, (_, i) => {
                const presets: Af2AbstractStep[] = [
                    { roman: 'I',  type: 'maj', rootOffset: 0, scaleDegree: 1 },
                    { roman: 'IV', type: 'maj', rootOffset: 5, scaleDegree: 4 },
                    { roman: 'V',  type: 'maj', rootOffset: 7, scaleDegree: 5 },
                    { roman: 'I',  type: 'maj', rootOffset: 0, scaleDegree: 1 },
                ];
                return { ...presets[i % presets.length] };
            });
        }
        const chosen = rng.pick(pool as Af2AbstractStep[][]);
        const out: Af2AbstractStep[] = [];
        for (let i = 0; i < bars; i++) {
            out.push({ ...chosen[i % chosen.length] });
        }
        return out;
    },
};
