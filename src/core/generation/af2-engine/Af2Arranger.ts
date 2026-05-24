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

import type { Random } from './utils/Random';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import { SectionType } from '../types';
import type { SectionMetadata } from '../types';
import { planBorrowedChords, type BorrowSource } from './BorrowChordPlanner';
import { planTonicization } from './TonicizationPlanner';

/**
 * 5-way classification of chromatic / non-diatonic chords —
 * Berklee Contemporary Harmony. Set by L 阶段 BorrowChordPlanner /
 * TonicizationPlanner;UI / future melody scoring may consume。
 *
 *   secondary_dominant — V/X (lone secondary dom)
 *   secondary_ii_v    — ii/X + V/X chain
 *   backdoor_dominant — bVII7 functioning as D toward T (not Mixolydian color)
 *   modal_interchange — borrowed for color, mustResolve = false
 *   chromatic_color   — chromatic passing chord, no specific category
 */
export type BorrowedSource =
    | 'secondary_dominant'
    | 'secondary_ii_v'
    | 'backdoor_dominant'
    | 'modal_interchange'
    | 'chromatic_color';

/**
 * AF2 抽象进行步。
 *
 * 必填:
 * - roman:级数显示串('I' / 'V7' / 'ii7')
 * - type:chord type('maj' / 'min' / 'maj7' / 'm7' / '7' 等)
 * - rootOffset:相对调根的半音 offset(0=I / 2=ii / 4=iii / 5=IV / 7=V / 9=vi)
 *
 * 可选:
 * - scaleDegree:1-7 级数(给 mode-aware filter 用)
 * - beats:bar 内 beats(默认 = beatsPerMeasure = 4)。Tonicization 切分时设半 bar
 *
 * L 阶段 Planner 注入字段(都可选):
 * - localTonalCenterPc:临时局部调中心 PC(secondary dominant 指向 X)
 * - forcedScale:scale 强制(Tonicization 标 'Mixolydian' / 'Phrygian Dominant')
 * - lockType:Planner 已锁定 type,Composer Divisi 不要再改
 * - borrowedFrom:借调诊断标签('iv (parallel minor)' / 'bVII7 (backdoor)' 等)
 * - effectiveFunc:Planner 强制 TSD 功能(Rule A2 bVII7 = D)
 * - borrowedSource:Berklee 5-way 分类
 * - mustResolve:tension 必须解决(V/X / ii/X / bVII7 = true)
 * - tonicizationPlacement:Tonicization 形式(light / approach / iiv_split / full_2bar)
 */
export interface Af2AbstractStep {
    roman: string;
    type: string;
    rootOffset: number;
    scaleDegree?: number;
    beats?: number;
    // L 阶段 Planner 注入字段
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

// 常用级数 builder(Major 调式;大小写遵循 Major-key roman 习惯)
const I  = (type = 'maj'): Af2AbstractStep => ({ roman: 'I',  type, rootOffset: 0, scaleDegree: 1 });
const ii = (type = 'min'): Af2AbstractStep => ({ roman: 'ii', type, rootOffset: 2, scaleDegree: 2 });
const iii = (type = 'min'): Af2AbstractStep => ({ roman: 'iii', type, rootOffset: 4, scaleDegree: 3 });
const IV = (type = 'maj'): Af2AbstractStep => ({ roman: 'IV', type, rootOffset: 5, scaleDegree: 4 });
const V  = (type = 'maj'): Af2AbstractStep => ({ roman: 'V',  type, rootOffset: 7, scaleDegree: 5 });
const vi = (type = 'min'): Af2AbstractStep => ({ roman: 'vi', type, rootOffset: 9, scaleDegree: 6 });
const bVII = (type = 'maj'): Af2AbstractStep => ({ roman: 'bVII', type, rootOffset: 10, scaleDegree: 7 });

// K2 阶段:Minor 调级数 builder(自然小调/和声小调混合)
//   i / iv / v 用 minor;V 复用 major(harmonic-minor dominant,V → i 强解决)
//   bIII / bVI / bVII 用 major(Aeolian 自然小调 borrowed-from-relative-major)
//   ii° 用 m7b5(Aeolian 真正的 pre-dom);TonicizationPlanner 会 forbid 它作为 target
const i    = (type = 'min'): Af2AbstractStep => ({ roman: 'i',    type, rootOffset: 0, scaleDegree: 1 });
const ii_d = (type = 'm7b5'): Af2AbstractStep => ({ roman: 'ii°', type, rootOffset: 2, scaleDegree: 2 });
const bIII = (type = 'maj'): Af2AbstractStep => ({ roman: 'bIII', type, rootOffset: 3, scaleDegree: 3 });
const iv   = (type = 'min'): Af2AbstractStep => ({ roman: 'iv',   type, rootOffset: 5, scaleDegree: 4 });
const vmin = (type = 'min'): Af2AbstractStep => ({ roman: 'v',    type, rootOffset: 7, scaleDegree: 5 });
const bVI  = (type = 'maj'): Af2AbstractStep => ({ roman: 'bVI',  type, rootOffset: 8, scaleDegree: 6 });

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

// ============================================================
// K2 阶段:Minor 调进行池
// ============================================================
//
// 自然小调 / 和声小调混用。V(harmonic)做主导属和弦(V → i 强解决感),
// v(natural)偶尔出现作为 modal flavor。bIII / bVI / bVII 是 Aeolian 标志。
//
// 注意:BorrowChordPlanner 在 Minor 时 short-circuit(rule 池是 Major-designed)。
// 所以 Minor 调 borrow 不会被 planner 加工 — 池里直接写需要的进行。
//
// TonicizationPlanner 仍跑 — 它自动 minor-aware(ii_dim m7b5 + 7b9 V/X 配 Phrygian Dominant)。
// ============================================================

const DEFAULT_BY_SECTION_MINOR: Partial<Record<SectionType, ProgressionPool>> = {
    [SectionType.Intro]: [
        [ i(), V() ],                       // tonic→dom 经典
        [ i(), bVII() ],                    // Aeolian opening
        [ i(), iv() ],                      // modal
        [ i(), bVI() ],                     // sad / cinematic
    ],
    [SectionType.Verse]: [
        [ i(), bVI(), bIII(), bVII() ],     // Royal Road minor(Pop 标志)
        [ i(), bVII(), bVI(), V() ],        // Andalusian descent
        [ i(), iv(), bVI(), V() ],          // sad minor classic
        [ i(), bVII(), iv(), V() ],         // 4-chord minor
        [ i(), V(), iv(), bVII() ],         // modal 反向
    ],
    [SectionType.PreChorus]: [
        [ iv(), V(), V(), V() ],            // build to V
        [ bVI(), V(), V(), V() ],           // cinematic build
        [ ii_d(), V(), V(), V() ],          // minor ii-V build
        [ iv(), bVII(), V(), V() ],         // step-up
    ],
    [SectionType.Chorus]: [
        [ i(), bVI(), bIII(), bVII() ],     // Royal Road(再现)
        [ i(), V(), bVI(), iv() ],          // V-bVI deceptive
        [ bVI(), bVII(), i(), i() ],        // bVI-bVII-i lift
        [ i(), bVII(), bVI(), bVII() ],     // 4-chord loop
        [ iv(), V(), i(), bVI() ],          // emotional
    ],
    [SectionType.Bridge]: [
        [ bIII(), bVII(), iv(), i() ],      // modal cycle
        [ iv(), bIII(), bVI(), V() ],       // descending stepwise
        [ bVI(), bVII(), bIII(), V() ],     // rock minor bridge
        [ i(), vmin(), iv(), bVII() ],      // modal v(自然小调)
    ],
    [SectionType.BuildUp]: [[ V(), V(), V(), V() ], [ iv(), V(), iv(), V() ]],
    [SectionType.Drop]: [[ i(), i(), i(), i() ], [ i(), bVI(), i(), V() ]],
    [SectionType.Break]: [[ i(), iv(), i(), i() ], [ bVI(), V(), i(), i() ]],
    [SectionType.Breakdown]: [[ i(), i(), i(), i() ], [ i(), bVII(), i(), i() ]],
    [SectionType.PreOutro]: [[ iv(), V(), i(), i() ], [ bVI(), V(), i(), i() ]],
    [SectionType.Outro]: [
        [ i(), iv(), i(), i() ],            // plagal close
        [ bVI(), V(), i(), i() ],           // dramatic
        [ iv(), V(), i(), i() ],            // V-i close
        [ i(), bVII(), i(), i() ],          // modal close
    ],
    [SectionType.Solo_Bridge]: [
        [ ii_d(), V(), i(), bVI() ],
        [ bIII(), bVI(), ii_d(), V() ],
    ],
};

// Per-mgStyle Minor 池(JAZZ/RNB 用更色彩化 chord type)
const SECTION_POOLS_BY_STYLE_MINOR: Record<MgStyle, Partial<Record<SectionType, ProgressionPool>>> = {
    POP: DEFAULT_BY_SECTION_MINOR,
    JAZZ: {
        [SectionType.Intro]: [
            [ ii_d('m7b5'), V('7b9') ],
            [ i('m7'), V('7b9') ],
            [ iv('m7'), V('7b9') ],
        ],
        [SectionType.Verse]: [
            [ i('m7'), iv('m7'), V('7b9'), i('m7') ],          // jazz minor cycle
            [ i('m7'), bVI('maj7'), bIII('maj7'), bVII('7') ], // modal jazz
            [ ii_d('m7b5'), V('7b9'), i('m7'), iv('m7') ],     // ii-V-i extended
            [ i('m7'), V('7b9'), bVI('maj7'), V('7b9') ],      // cliche jazz
        ],
        [SectionType.PreChorus]: [
            [ ii_d('m7b5'), V('7b9'), ii_d('m7b5'), V('7b9') ],
            [ iv('m7'), V('7b9'), iv('m7'), V('7b9') ],
            [ bVI('maj7'), V('7b9'), bVI('maj7'), V('7b9') ],
        ],
        [SectionType.Chorus]: [
            [ i('m9'), V('7b9'), bVI('maj9'), bVII('7') ],
            [ i('m7'), bIII('maj7'), iv('m7'), V('7b9') ],
            [ ii_d('m7b5'), V('7b9'), i('m9'), i('m9') ],
            [ iv('m9'), bVII('7'), bIII('maj9'), bVI('maj9') ],
        ],
        [SectionType.Bridge]: [
            [ bIII('maj9'), bVI('maj9'), ii_d('m7b5'), V('7b9') ],
            [ iv('m9'), bVII('7'), bIII('maj9'), bVI('maj9') ],
            [ bVI('maj9'), V('7b9'), i('m9'), iv('m9') ],
        ],
        [SectionType.Outro]: [
            [ i('m7'), i('m7'), i('m7'), i('m7') ],
            [ ii_d('m7b5'), V('7b9'), i('m7'), i('m7') ],
        ],
        [SectionType.PreOutro]: [[ ii_d('m7b5'), V('7b9'), iv('m7'), bVII('7') ]],
    },
    BLUES: {
        // Minor blues(12-bar 经典:i7 i7 i7 i7 iv7 iv7 i7 i7 V7 iv7 i7 V7)
        [SectionType.Intro]:     [[ i('m7'), i('m7'), i('m7'), i('m7') ]],
        [SectionType.Verse]:     [[ i('m7'), iv('m7'), i('m7'), V('7') ], [ i('m7'), i('m7'), iv('m7'), i('m7') ]],
        [SectionType.PreChorus]: [[ iv('m7'), iv('m7'), i('m7'), i('m7') ]],
        [SectionType.Chorus]:    [[ V('7'), iv('m7'), i('m7'), V('7') ]],
        [SectionType.Outro]:     [[ i('m7'), iv('m7'), i('m7'), i('m7') ]],
    },
    RNB: {
        [SectionType.Intro]: [
            [ i('m9'), bIII('maj9') ],
            [ iv('m9'), i('m9') ],
            [ bVI('maj9'), bIII('maj9') ],
            [ i('m7'), V('7sus4') ],          // D'Angelo opening
        ],
        [SectionType.Verse]: [
            [ i('m9'), bIII('maj9'), bVI('maj9'), bVII('7') ],    // Stevie modal
            [ i('m7'), iv('m7'), bVII('7'), bIII('maj7') ],       // R&B classic
            [ iv('m9'), V('7sus4'), i('m9'), bVI('maj9') ],       // D'Angelo ballad
            [ i('m9'), bVII('7'), bVI('maj9'), V('7') ],          // descending
        ],
        [SectionType.PreChorus]: [
            [ ii_d('m7b5'), V('7sus4'), ii_d('m7b5'), V('7sus4') ],
            [ iv('m9'), V('7sus4'), iv('m9'), V('7sus4') ],
            [ bVI('maj9'), V('7'), bVI('maj9'), V('7') ],
        ],
        [SectionType.Chorus]: [
            [ i('m9'), V('7'), bVI('maj9'), iv('m9') ],
            [ bVII('7'), bVI('maj9'), V('7'), i('m9') ],
            [ i('m9'), bIII('maj9'), bVI('maj9'), iv('m9') ],
            [ iv('m9'), bVII('7'), bIII('maj9'), bVI('maj9') ],
        ],
        [SectionType.Bridge]: [
            [ bVI('maj9'), bIII('maj9'), bVII('7'), i('m9') ],
            [ iv('m9'), V('7'), bVI('maj9'), i('m9') ],
            [ bIII('maj9'), bVI('maj9'), iv('m9'), V('7sus4') ],
        ],
        [SectionType.Outro]: [
            [ iv('m9'), V('7'), i('m9'), i('m9') ],
            [ bVI('maj9'), bVII('7'), i('m9'), i('m9') ],
            [ i('m9'), iv('m9'), i('m9'), i('m9') ],
        ],
        [SectionType.PreOutro]: [[ iv('m9'), V('7'), bVI('maj9'), i('m9') ]],
    },
};

/**
 * 查给定 (mgStyle, sectionType, isMinor) 的进行池;
 * Minor 调走 *_MINOR 池,Major 走原池。
 * 缺则 fall through 到 DEFAULT_*,仍缺则用 i-iv-V-i / I-IV-V-I 兜底。
 */
function getSectionPool(
    mgStyle: MgStyle,
    sectionType: SectionType,
    isMinor: boolean = false,
): ProgressionPool {
    if (isMinor) {
        return SECTION_POOLS_BY_STYLE_MINOR[mgStyle]?.[sectionType]
            ?? DEFAULT_BY_SECTION_MINOR[sectionType]
            ?? [[ i(), iv(), V(), i() ]];
    }
    return SECTION_POOLS_BY_STYLE[mgStyle]?.[sectionType]
        ?? DEFAULT_BY_SECTION[sectionType]
        ?? [[ I(), IV(), V(), I() ]];
}

// ============================================================
// L 阶段(2026-05-24):Modal interchange + Tonicization 双 pass
// ============================================================
//
// 替换原 augmentProgression(简化 3 分支)→ 接 mg 移植的 2 planner:
//
//   BorrowChordPlanner:7 rule × 3 source 锁定 × 5 道防呆(603 行)
//     POP 0.45 / JAZZ 0.35 / RNB 0.55 / BLUES 0,per-song max 3/4/5/0 次
//
//   TonicizationPlanner:4 placement × per-target mult × chain cooldown(505 行)
//     POP 0.30 / JAZZ 0.65 / RNB 0.40 / BLUES 0,per-song max 2/4/3/0 次
//
// 顺序:raw skeleton → borrow → tonicize → output
// (borrow 先,因为 tonicize 看 borrow 输出决定是否 approach borrowed target)
// ============================================================

/**
 * L 阶段 planner 配置 — 由 KernelDriver / Facade 注入。
 * 未传则不跑 planner(向后兼容 arrangeByBars / 老 callsite)。
 */
export interface ArrangePlannerOptions {
    /** PRNG 子流(`${seed}::borrow`) */
    borrowRng: Random;
    /** PRNG 子流(`${seed}::tonicize`) */
    tonicizeRng: Random;
    /** Per-song 单 borrow-source(由 caller `${seed}::borrow-source` forked 抽)*/
    borrowSource: BorrowSource;
    /** 曲调 key root pc (0..11) — Tonicization 用 */
    songKeyRootPc: number;
    /** 调式名(modal-home-mode skip 用),默认 'Maj/Ionian' */
    mode?: string;
    /** Phrase 长度(bars),默认 4 — phrase-role classification 用 */
    motifInterval?: number;
    /** K2 阶段:是否 Minor 调(走 Minor 进行池)。默认 false */
    isMinor?: boolean;
}

export const Af2Arranger = {
    /**
     * AF2 编曲师 — section-aware 抽进行 + 拼接 + (可选)borrow + tonicize。
     *
     * 算法:
     *   1. 每 section:从 (mgStyle, sectionType) 进行池抽 1 条
     *   2. 该 section 占的 bars(从 section.startBeat / endBeat 派生)用此进行循环填充
     *   3. 拼接所有 section 的 chord 序列 → 全曲 abstractPath
     *   4. (L 阶段)若 plannerOptions 传入:借和弦 planner → 二级属 planner 双 pass
     *
     * 每 section 独立抽 → 同 seed 下 Verse / Chorus / Bridge 进行不同。
     */
    arrange(
        mgStyle: MgStyle,
        sections: ReadonlyArray<SectionMetadata>,
        beatsPerMeasure: number,
        rng: Random,
        plannerOptions?: ArrangePlannerOptions,
    ): Af2AbstractStep[] {
        let out: Af2AbstractStep[] = [];
        const isMinor = plannerOptions?.isMinor ?? false;
        for (const section of sections) {
            const sectionBeats = section.endBeat - section.startBeat;
            const sectionBars = Math.max(1, Math.round(sectionBeats / beatsPerMeasure));
            const pool = getSectionPool(mgStyle, section.sectionType, isMinor);
            const chosen = rng.pick(pool as Af2AbstractStep[][]);
            for (let bar = 0; bar < sectionBars; bar++) {
                out.push({ ...chosen[bar % chosen.length] });
            }
        }
        // L 阶段:接 mg 移植的 2 planner
        if (plannerOptions) {
            const { borrowRng, tonicizeRng, borrowSource, songKeyRootPc } = plannerOptions;
            const motifInterval = plannerOptions.motifInterval ?? 4;
            const mode = plannerOptions.mode ?? 'Maj/Ionian';
            // Pass 1:Modal Interchange(7 rule × 3 source × 5 防呆)
            out = planBorrowedChords({
                skeleton: out,
                style: mgStyle,
                motifInterval,
                random: borrowRng,
                beatsPerMeasure,
                mode,
                borrowSource,
            });
            // Pass 2:Tonicization(4 placement × target mult × cooldown)
            out = planTonicization({
                skeleton: out,
                style: mgStyle,
                motifInterval,
                random: tonicizeRng,
                beatsPerMeasure,
                songKeyRootPc,
            });
        }
        return out;
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
