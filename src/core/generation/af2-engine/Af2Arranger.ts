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
import { SectionType } from '../types';
import type { SectionMetadata } from '../types';

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
    /**
     * 可选 beats(默认 ctx.meterContext.beatsPerMeasure = 4)。
     * Augmentation 用此切分 bar:e.g. ii-V 共享 1 bar → 各占 2 beats。
     */
    beats?: number;
}

// Section-aware 进行池 helpers — 各 section 类型用专门 progression
type ProgressionPool = ReadonlyArray<ReadonlyArray<Af2AbstractStep>>;

// 常用级数 builder(避免重复代码)
const I  = (type = 'maj'): Af2AbstractStep => ({ roman: 'I',  type, rootOffset: 0, scaleDegree: 1 });
const ii = (type = 'min'): Af2AbstractStep => ({ roman: 'ii', type, rootOffset: 2, scaleDegree: 2 });
const iii = (type = 'min'): Af2AbstractStep => ({ roman: 'iii', type, rootOffset: 4, scaleDegree: 3 });
const IV = (type = 'maj'): Af2AbstractStep => ({ roman: 'IV', type, rootOffset: 5, scaleDegree: 4 });
const V  = (type = 'maj'): Af2AbstractStep => ({ roman: 'V',  type, rootOffset: 7, scaleDegree: 5 });
const vi = (type = 'min'): Af2AbstractStep => ({ roman: 'vi', type, rootOffset: 9, scaleDegree: 6 });
const bVII = (type = 'maj'): Af2AbstractStep => ({ roman: 'bVII', type, rootOffset: 10, scaleDegree: 7 });

/** 默认 fallback 进行(每 sectionType 兜底,POP-flavored — 多条候选增加多样性) */
const DEFAULT_BY_SECTION: Partial<Record<SectionType, ProgressionPool>> = {
    [SectionType.Intro]: [
        [ I(), V() ],
        [ I(), vi() ],          // sad intro
        [ vi(), V() ],          // suspenseful
        [ I(), IV() ],          // church
        [ I(), iii() ],         // dreamy
    ],
    [SectionType.Verse]: [
        [ I(), V(), vi(), IV() ],          // Axis of Awesome
        [ I(), vi(), IV(), V() ],          // 50s
        [ vi(), IV(), I(), V() ],          // sad verse
        [ I(), iii(), IV(), V() ],         // ascending mediant
        [ I(), V(), IV(), V() ],           // simple loop
    ],
    [SectionType.PreChorus]: [
        [ vi(), IV(), V(), V() ],          // build
        [ IV(), V(), V(), V() ],           // V tension
        [ I(), V(), vi(), V() ],           // bounce-build
        [ ii(), IV(), V(), V() ],          // subdom build
    ],
    [SectionType.Chorus]: [
        [ I(), V(), vi(), IV() ],          // pumping
        [ vi(), IV(), I(), V() ],          // Coldplay
        [ IV(), I(), V(), vi() ],          // anthem
        [ I(), IV(), V(), IV() ],          // simple loop
        [ I(), V(), IV(), V() ],           // dance pop
    ],
    [SectionType.Bridge]: [
        [ vi(), iii(), IV(), I() ],        // modulation feel
        [ bVII(), IV(), I(), I() ],        // mixolydian borrowing
        [ ii(), V(), iii(), vi() ],        // jazzy bridge
        [ IV(), V(), iii(), vi() ],        // emo-pop
    ],
    [SectionType.BuildUp]:   [[ V(), V(), V(), V() ], [ IV(), V(), IV(), V() ]],
    [SectionType.Drop]:      [[ I(), I(), I(), I() ], [ vi(), IV(), I(), V() ]],
    [SectionType.Break]:     [[ I(), IV(), I(), I() ], [ vi(), V(), I(), I() ]],
    [SectionType.Breakdown]: [[ I(), I(), I(), I() ], [ vi(), I(), V(), I() ]],
    [SectionType.PreOutro]:  [[ vi(), V(), IV(), I() ], [ IV(), V(), I(), I() ]],
    [SectionType.Outro]: [
        [ I(), IV(), I(), I() ],
        [ vi(), V(), I(), I() ],
        [ IV(), V(), I(), I() ],           // plagal resolve
        [ I(), V(), I(), I() ],            // simple
    ],
    [SectionType.Solo_Bridge]: [
        [ ii(), V(), I(), vi() ],
        [ iii(), vi(), ii(), V() ],
    ],
};

/** Per-mgStyle 全曲 fallback(老 API,单循环 progression) */
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

// Per-mgStyle × per-sectionType 进行池(JAZZ / RNB 用更色彩化的 chord type)
const SECTION_POOLS_BY_STYLE: Record<MgStyle, Partial<Record<SectionType, ProgressionPool>>> = {
    POP: DEFAULT_BY_SECTION,
    JAZZ: {
        [SectionType.Intro]: [
            [ ii('m7'), V('7') ],
            [ iii('m7'), vi('m7') ],          // modulation hint
            [ IV('maj7'), V('7') ],
        ],
        [SectionType.Verse]: [
            [ I('maj7'), vi('m7'), ii('m7'), V('7') ],   // Anatole
            [ ii('m7'), V('7'), I('maj7'), vi('m7') ],   // turnaround start
            [ I('maj7'), iii('m7'), vi('m7'), ii('m7') ], // descending
            [ ii('m7'), V('7'), iii('m7'), vi('m7') ],   // V/vi insertion
        ],
        [SectionType.PreChorus]: [
            [ ii('m7'), V('7'), ii('m7'), V('7') ],
            [ IV('maj7'), V('7'), ii('m7'), V('7') ],    // IV-V-ii-V
            [ vi('m7'), ii('m7'), V('7'), V('7') ],      // build
        ],
        [SectionType.Chorus]: [
            [ I('maj7'), V('7'), vi('m7'), IV('maj7') ],
            [ ii('m7'), V('7'), I('maj7'), I('maj7') ],
            [ I('maj7'), vi('m7'), ii('m7'), V('7') ],   // turnaround
            [ IV('maj7'), iii('m7'), ii('m7'), V('7') ], // descending
        ],
        [SectionType.Bridge]: [
            [ iii('m7'), vi('m7'), ii('m7'), V('7') ],
            [ IV('maj7'), iii('m7'), ii('m7'), I('maj7') ], // descending stepwise
            [ vi('m7'), ii('m7'), V('7'), I('maj7') ],     // jazz cycle
        ],
        [SectionType.Outro]: [
            [ I('maj7'), I('maj7'), I('maj7'), I('maj7') ],
            [ ii('m7'), V('7'), I('maj7'), I('maj7') ],  // final cadence
        ],
        [SectionType.PreOutro]: [[ ii('m7'), V('7'), iii('m7'), vi('m7') ]],
    },
    BLUES: {
        // BLUES 通常用 12-bar 整曲,这里按 section 拆 4-bar 片段
        [SectionType.Intro]:     [[ I('7'), I('7'), I('7'), I('7') ]],
        [SectionType.Verse]:     [[ I('7'), IV('7'), I('7'), V('7') ], [ I('7'), I('7'), IV('7'), I('7') ]],
        [SectionType.PreChorus]: [[ IV('7'), IV('7'), I('7'), I('7') ]],
        [SectionType.Chorus]:    [[ V('7'), IV('7'), I('7'), V('7') ]],
        [SectionType.Outro]:     [[ I('7'), IV('7'), I('7'), I('7') ]],
    },
    RNB: {
        [SectionType.Intro]: [
            [ I('maj7'), IV('maj7') ],
            [ I('maj7'), iii('m7') ],         // dreamy
            [ IV('maj7'), I('maj7') ],
            [ vi('m7'), IV('maj7') ],         // sad intro
        ],
        [SectionType.Verse]: [
            [ I('maj7'), iii('m7'), vi('m7'), IV('maj7') ], // neo-soul 标志
            [ ii('m7'), V('7'), I('maj7'), IV('maj7') ],
            [ vi('m7'), IV('maj7'), I('maj7'), V('7') ],    // sad RnB
            [ I('maj7'), V('7'), vi('m7'), iii('m7') ],     // descending
        ],
        [SectionType.PreChorus]: [
            [ ii('m7'), V('7'), ii('m7'), V('7') ],
            [ IV('maj7'), V('7'), iii('m7'), vi('m7') ],
            [ ii('m7'), iii('m7'), IV('maj7'), V('7') ],    // build
        ],
        [SectionType.Chorus]: [
            [ I('maj7'), V('7'), vi('m7'), IV('maj7') ],
            [ vi('m7'), IV('maj7'), I('maj7'), V('7') ],
            [ I('maj7'), IV('maj7'), vi('m7'), V('7') ],    // anthem RnB
            [ IV('maj7'), V('7'), iii('m7'), vi('m7') ],    // descending
        ],
        [SectionType.Bridge]: [
            [ IV('maj7'), iii('m7'), ii('m7'), I('maj7') ],
            [ bVII('maj7'), IV('maj7'), I('maj7'), I('maj7') ], // bVII modal borrowing
            [ vi('m7'), ii('m7'), V('7'), I('maj7') ],
        ],
        [SectionType.Outro]: [
            [ I('maj7'), IV('maj7'), I('maj7'), I('maj7') ],
            [ IV('maj7'), I('maj7'), I('maj7'), I('maj7') ], // plagal
            [ vi('m7'), V('7'), I('maj7'), I('maj7') ],
        ],
        [SectionType.PreOutro]: [[ IV('maj7'), V('7'), I('maj7'), I('maj7') ]],
    },
};

/**
 * 查给定 (mgStyle, sectionType) 的进行池;缺则 fall through 到 DEFAULT_BY_SECTION,
 * 仍缺则用 [[I, IV, V, I]] 兜底。
 */
function getSectionPool(mgStyle: MgStyle, sectionType: SectionType): ProgressionPool {
    return SECTION_POOLS_BY_STYLE[mgStyle]?.[sectionType]
        ?? DEFAULT_BY_SECTION[sectionType]
        ?? [[ I(), IV(), V(), I() ]];
}

// ============================================================
// Augmentation:Modal interchange / passing chords 注入
// ============================================================
//
// 在 section-aware Arranger 产出的"骨架"上,概率注入借和弦 + ii-V 转位:
//
//   ii-V split(jazz cliche):前面是 V chord 时,split V 的 bar 为 [ii (2 beats), V (2 beats)]
//   iv borrowing(modal interchange):IV 偶尔替换为 iv(借平行小调色彩)
//
// Per-mgStyle 概率门:
//   POP   ii-V 0.10 / iv 0.05(轻度色彩)
//   JAZZ  ii-V 0.50 / iv 0.10(jazz 语言强 ii-V)
//   BLUES ii-V 0    / iv 0   (blues 用属和弦,不需 ii-V)
//   RNB   ii-V 0.30 / iv 0.20(neo-soul 多 modal interchange)
//
// Augmentation 不改全曲长度(总 beats 不变)— ii-V split 内部切 bar,iv 只换 type/roman。
// ============================================================

const II_V_INSERT_PROB: Record<MgStyle, number> = {
    POP:   0.10,
    JAZZ:  0.50,
    BLUES: 0,
    RNB:   0.30,
};

const IV_BORROW_PROB: Record<MgStyle, number> = {
    POP:   0.05,
    JAZZ:  0.10,
    BLUES: 0,
    RNB:   0.20,
};

/**
 * Modal interchange / passing chord 注入。
 *
 * 算法:
 *   遍历 progression,每 step:
 *     1. 该 step 是 V(rootOffset===7,type='maj'/'7'/'maj7'/'sus4' 等):
 *        rng.next() < ii-V prob → 把此 step split 为 [ii (2 beats), V (2 beats)]
 *     2. 该 step 是 IV(rootOffset===5,type='maj'/'maj7'):
 *        rng.next() < iv-borrow prob → 替换为 iv(type='min'/'m7',roman='iv')
 *   未触发的 step 原样保留。
 *
 * PRNG 消耗:每 step 最多 2 次(ii-V gate + iv gate),deterministic per seed。
 */
function augmentProgression(
    progression: Af2AbstractStep[],
    mgStyle: MgStyle,
    rng: Random,
): Af2AbstractStep[] {
    const iiVProb = II_V_INSERT_PROB[mgStyle];
    const ivProb = IV_BORROW_PROB[mgStyle];
    const out: Af2AbstractStep[] = [];

    for (const step of progression) {
        // Augmentation 1:ii-V split(在 V chord 上)
        if (step.rootOffset === 7 && rng.next() < iiVProb) {
            // V 的 jazz turnaround:前面 ii(rootOffset=2,m7),后面 V(原 type 不变)
            out.push({ roman: 'ii', type: 'm7', rootOffset: 2, scaleDegree: 2, beats: 2 });
            out.push({ ...step, beats: 2 });
            continue;
        }
        // Augmentation 2:iv borrowing(在 IV chord 上)
        if (step.rootOffset === 5 && (step.type === 'maj' || step.type === 'maj7')
            && rng.next() < ivProb) {
            // IV → iv(minor 借和弦,modal interchange)
            const borrowedType = step.type === 'maj7' ? 'm7' : 'min';
            out.push({ ...step, roman: 'iv', type: borrowedType });
            continue;
        }
        // 默认:原样保留(也要消耗 1 次 PRNG 保持 stream 对齐 — ii-V gate 已走过,
        // iv gate 在 rootOffset!=7 / type!=maj 时不走,统一处理)
        out.push({ ...step });
    }
    return out;
}

export const Af2Arranger = {
    /**
     * AF2 编曲师 — section-aware 抽进行 + 拼接全曲。
     *
     * 算法:
     *   1. 每 section:从 (mgStyle, sectionType) 进行池抽 1 条
     *   2. 该 section 占的 bars(从 section.startBeat / endBeat 派生)用此进行循环填充
     *   3. 拼接所有 section 的 chord 序列 → 全曲 abstractPath
     *
     * 每 section 独立抽 → 同 seed 下 Verse / Chorus / Bridge 进行不同。
     */
    arrange(
        mgStyle: MgStyle,
        sections: ReadonlyArray<SectionMetadata>,
        beatsPerMeasure: number,
        rng: Random,
    ): Af2AbstractStep[] {
        const out: Af2AbstractStep[] = [];
        for (const section of sections) {
            const sectionBeats = section.endBeat - section.startBeat;
            const sectionBars = Math.max(1, Math.round(sectionBeats / beatsPerMeasure));
            const pool = getSectionPool(mgStyle, section.sectionType);
            const chosen = rng.pick(pool as Af2AbstractStep[][]);
            for (let bar = 0; bar < sectionBars; bar++) {
                out.push({ ...chosen[bar % chosen.length] });
            }
        }
        // Modal interchange / passing chord 注入(per-mgStyle 概率门)
        return augmentProgression(out, mgStyle, rng);
    },

    /**
     * 旧 API(bars-based,单 progression 循环填全曲)。保留兼容 MVP fallback。
     */
    arrangeByBars(mgStyle: MgStyle, bars: number, rng: Random): Af2AbstractStep[] {
        const pool = AF2_PROGRESSION_POOL[mgStyle];
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
