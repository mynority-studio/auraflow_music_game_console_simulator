// ============================================================
// Af2Arranger — AF2 自有编曲师(POP-only)
// ============================================================
//
// 用户 8 层架构 #3 "编曲师"层。本 Arranger 决定:
//   - 全曲和声进行(级数 Roman + chord type + rootOffset)
//
// POP-only flat 化(2026-05-25):JAZZ / BLUES / RNB 进行池全部删除。
// ============================================================

import type { Random } from './utils/Random';
import { SectionType } from '../types';
import type { SectionMetadata } from '../types';
import type { BorrowSource } from './BorrowChordPlanner';
import { SUB_STYLE_PROGRESSIONS } from './SubStyleProgressions';
import type { SubStyle } from './SubStyleTextures';
import { DEFAULT_PROGRESSION_PLANNERS } from './plugins/arranger';
import type { ProgressionPlannerContext } from './plugins/arranger';

/**
 * 5-way classification of chromatic / non-diatonic chords —
 * Berklee Contemporary Harmony. Set by L 阶段 BorrowChordPlanner /
 * TonicizationPlanner;UI / future melody scoring may consume。
 */
export type BorrowedSource =
    | 'secondary_dominant'
    | 'secondary_ii_v'
    | 'backdoor_dominant'
    | 'modal_interchange'
    | 'chromatic_color';

/**
 * AF2 抽象进行步。
 */
export interface Af2AbstractStep {
    roman: string;
    type: string;
    rootOffset: number;
    scaleDegree?: number;
    beats?: number;
    localTonalCenterPc?: number;
    forcedScale?: string;
    lockType?: boolean;
    borrowedFrom?: string;
    effectiveFunc?: 'T' | 'S' | 'D';
    borrowedSource?: BorrowedSource;
    mustResolve?: boolean;
    tonicizationPlacement?: 'light' | 'approach' | 'iiv_split' | 'full_2bar';
}

// Section-aware 进行池 helpers — 各 section 类型用专门 progression
type ProgressionPool = ReadonlyArray<ReadonlyArray<Af2AbstractStep>>;

// 常用级数 builder(Major 调式)
const I  = (type = 'maj'): Af2AbstractStep => ({ roman: 'I',  type, rootOffset: 0, scaleDegree: 1 });
const ii = (type = 'min'): Af2AbstractStep => ({ roman: 'ii', type, rootOffset: 2, scaleDegree: 2 });
const iii = (type = 'min'): Af2AbstractStep => ({ roman: 'iii', type, rootOffset: 4, scaleDegree: 3 });
const IV = (type = 'maj'): Af2AbstractStep => ({ roman: 'IV', type, rootOffset: 5, scaleDegree: 4 });
const V  = (type = 'maj'): Af2AbstractStep => ({ roman: 'V',  type, rootOffset: 7, scaleDegree: 5 });
const vi = (type = 'min'): Af2AbstractStep => ({ roman: 'vi', type, rootOffset: 9, scaleDegree: 6 });
const bVII = (type = 'maj'): Af2AbstractStep => ({ roman: 'bVII', type, rootOffset: 10, scaleDegree: 7 });

// Minor 调级数 builder(自然小调/和声小调混合)
const i    = (type = 'min'): Af2AbstractStep => ({ roman: 'i',    type, rootOffset: 0, scaleDegree: 1 });
const ii_d = (type = 'm7b5'): Af2AbstractStep => ({ roman: 'ii°', type, rootOffset: 2, scaleDegree: 2 });
const bIII = (type = 'maj'): Af2AbstractStep => ({ roman: 'bIII', type, rootOffset: 3, scaleDegree: 3 });
const iv   = (type = 'min'): Af2AbstractStep => ({ roman: 'iv',   type, rootOffset: 5, scaleDegree: 4 });
const vmin = (type = 'min'): Af2AbstractStep => ({ roman: 'v',    type, rootOffset: 7, scaleDegree: 5 });
const bVI  = (type = 'maj'): Af2AbstractStep => ({ roman: 'bVI',  type, rootOffset: 8, scaleDegree: 6 });

/** POP fallback 进行(每 sectionType 兜底,多条候选) */
const DEFAULT_BY_SECTION: Partial<Record<SectionType, ProgressionPool>> = {
    [SectionType.Intro]: [
        [ I(), V() ],
        [ I(), vi() ],
        [ vi(), V() ],
        [ I(), IV() ],
        [ I(), iii() ],
    ],
    [SectionType.Verse]: [
        [ I(), V(), vi(), IV() ],
        [ I(), vi(), IV(), V() ],
        [ vi(), IV(), I(), V() ],
        [ I(), iii(), IV(), V() ],
        [ I(), V(), IV(), V() ],
    ],
    [SectionType.PreChorus]: [
        [ vi(), IV(), V(), V() ],
        [ IV(), V(), V(), V() ],
        [ I(), V(), vi(), V() ],
        [ ii(), IV(), V(), V() ],
    ],
    [SectionType.Chorus]: [
        [ I(), V(), vi(), IV() ],
        [ vi(), IV(), I(), V() ],
        [ IV(), I(), V(), vi() ],
        [ I(), IV(), V(), IV() ],
        [ I(), V(), IV(), V() ],
    ],
    [SectionType.Bridge]: [
        [ vi(), iii(), IV(), I() ],
        [ bVII(), IV(), I(), I() ],
        [ ii(), V(), iii(), vi() ],
        [ IV(), V(), iii(), vi() ],
    ],
    [SectionType.BuildUp]:   [[ V(), V(), V(), V() ], [ IV(), V(), IV(), V() ]],
    [SectionType.Drop]:      [[ I(), I(), I(), I() ], [ vi(), IV(), I(), V() ]],
    [SectionType.Break]:     [[ I(), IV(), I(), I() ], [ vi(), V(), I(), I() ]],
    [SectionType.Breakdown]: [[ I(), I(), I(), I() ], [ vi(), I(), V(), I() ]],
    [SectionType.PreOutro]:  [[ vi(), V(), IV(), I() ], [ IV(), V(), I(), I() ]],
    [SectionType.Outro]: [
        [ I(), IV(), I(), I() ],
        [ vi(), V(), I(), I() ],
        [ IV(), V(), I(), I() ],
        [ I(), V(), I(), I() ],
    ],
    [SectionType.Solo_Bridge]: [
        [ ii(), V(), I(), vi() ],
        [ iii(), vi(), ii(), V() ],
    ],
};

/** POP-only 全曲 fallback(老 API,单循环 progression) */
const AF2_PROGRESSION_POOL: ReadonlyArray<ReadonlyArray<Af2AbstractStep>> = [
    // I-V-vi-IV (Axis of Awesome)
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
];

// POP-only per-sectionType 进行池(Major)— flat 化前是 SECTION_POOLS_BY_STYLE.POP
const SECTION_POOLS: Partial<Record<SectionType, ProgressionPool>> = DEFAULT_BY_SECTION;

// Minor 调 fallback 进行池
const DEFAULT_BY_SECTION_MINOR: Partial<Record<SectionType, ProgressionPool>> = {
    [SectionType.Intro]: [
        [ i(), V() ],
        [ i(), bVII() ],
        [ i(), iv() ],
        [ i(), bVI() ],
    ],
    [SectionType.Verse]: [
        [ i(), bVI(), bIII(), bVII() ],
        [ i(), bVII(), bVI(), V() ],
        [ i(), iv(), bVI(), V() ],
        [ i(), bVII(), iv(), V() ],
        [ i(), V(), iv(), bVII() ],
    ],
    [SectionType.PreChorus]: [
        [ iv(), V(), V(), V() ],
        [ bVI(), V(), V(), V() ],
        [ ii_d(), V(), V(), V() ],
        [ iv(), bVII(), V(), V() ],
    ],
    [SectionType.Chorus]: [
        [ i(), bVI(), bIII(), bVII() ],
        [ i(), V(), bVI(), iv() ],
        [ bVI(), bVII(), i(), i() ],
        [ i(), bVII(), bVI(), bVII() ],
        [ iv(), V(), i(), bVI() ],
    ],
    [SectionType.Bridge]: [
        [ bIII(), bVII(), iv(), i() ],
        [ iv(), bIII(), bVI(), V() ],
        [ bVI(), bVII(), bIII(), V() ],
        [ i(), vmin(), iv(), bVII() ],
    ],
    [SectionType.BuildUp]: [[ V(), V(), V(), V() ], [ iv(), V(), iv(), V() ]],
    [SectionType.Drop]: [[ i(), i(), i(), i() ], [ i(), bVI(), i(), V() ]],
    [SectionType.Break]: [[ i(), iv(), i(), i() ], [ bVI(), V(), i(), i() ]],
    [SectionType.Breakdown]: [[ i(), i(), i(), i() ], [ i(), bVII(), i(), i() ]],
    [SectionType.PreOutro]: [[ iv(), V(), i(), i() ], [ bVI(), V(), i(), i() ]],
    [SectionType.Outro]: [
        [ i(), iv(), i(), i() ],
        [ bVI(), V(), i(), i() ],
        [ iv(), V(), i(), i() ],
        [ i(), bVII(), i(), i() ],
    ],
    [SectionType.Solo_Bridge]: [
        [ ii_d(), V(), i(), bVI() ],
        [ bIII(), bVI(), ii_d(), V() ],
    ],
};

// POP-only per-sectionType Minor 进行池 — flat 化前是 SECTION_POOLS_BY_STYLE_MINOR.POP
const SECTION_POOLS_MINOR: Partial<Record<SectionType, ProgressionPool>> = DEFAULT_BY_SECTION_MINOR;

/**
 * 查给定 (sectionType, isMinor, subStyle) 的进行池(POP-only)。
 */
function getSectionPool(
    sectionType: SectionType,
    isMinor: boolean = false,
    subStyle?: SubStyle,
): ProgressionPool {
    if (subStyle) {
        const subStylePools = SUB_STYLE_PROGRESSIONS[subStyle];
        const pool = isMinor ? subStylePools?.Minor : subStylePools?.Major;
        if (pool && pool.length > 0) return pool;
    }
    if (isMinor) {
        return SECTION_POOLS_MINOR[sectionType]
            ?? DEFAULT_BY_SECTION_MINOR[sectionType]
            ?? [[ i(), iv(), V(), i() ]];
    }
    return SECTION_POOLS[sectionType]
        ?? DEFAULT_BY_SECTION[sectionType]
        ?? [[ I(), IV(), V(), I() ]];
}

// ============================================================
// L+K3+K4+L 阶段:ProgressionPlanner plugin chain(POP-only)
// ============================================================
//
// 4 Planner:BorrowChord / Picardy / MinorBorrow / Tonicization。
// 顺序敏感(详见 plugins/arranger/types.ts §)。
// ============================================================

export interface ArrangePlannerOptions {
    borrowRng: Random;
    tonicizeRng: Random;
    borrowSource: BorrowSource;
    songKeyRootPc: number;
    mode?: string;
    motifInterval?: number;
    isMinor?: boolean;
    picardyRng?: Random;
    minorBorrowRng?: Random;
    subStyle?: SubStyle;
}

export const Af2Arranger = {
    arrange(
        sections: ReadonlyArray<SectionMetadata>,
        beatsPerMeasure: number,
        rng: Random,
        plannerOptions?: ArrangePlannerOptions,
    ): Af2AbstractStep[] {
        let out: Af2AbstractStep[] = [];
        const isMinor = plannerOptions?.isMinor ?? false;
        const subStyle = plannerOptions?.subStyle;
        for (const section of sections) {
            const sectionBeats = section.endBeat - section.startBeat;
            const sectionBars = Math.max(1, Math.round(sectionBeats / beatsPerMeasure));
            const pool = getSectionPool(section.sectionType, isMinor, subStyle);
            const chosen = rng.pick(pool as Af2AbstractStep[][]);
            for (let bar = 0; bar < sectionBars; bar++) {
                out.push({ ...chosen[bar % chosen.length] });
            }
        }
        if (plannerOptions) {
            const ctx: ProgressionPlannerContext = {
                motifInterval: plannerOptions.motifInterval ?? 4,
                beatsPerMeasure,
                songKeyRootPc: plannerOptions.songKeyRootPc,
                mode: plannerOptions.mode ?? 'Maj/Ionian',
                isMinor,
                borrowSource: plannerOptions.borrowSource,
                borrowRng: plannerOptions.borrowRng,
                tonicizeRng: plannerOptions.tonicizeRng,
                picardyRng: plannerOptions.picardyRng,
                minorBorrowRng: plannerOptions.minorBorrowRng,
            };
            for (const plugin of DEFAULT_PROGRESSION_PLANNERS) {
                if (plugin.shouldApply(ctx)) {
                    out = plugin.apply(out, ctx);
                }
            }
        }
        return out;
    },

    /**
     * 旧 API(bars-based,单 progression 循环填全曲)— POP-only。
     */
    arrangeByBars(bars: number, rng: Random): Af2AbstractStep[] {
        const pool = AF2_PROGRESSION_POOL;
        if (!pool || pool.length === 0) {
            return Array.from({ length: bars }, (_, i) => {
                const presets: Af2AbstractStep[] = [I(), IV(), V(), I()];
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
