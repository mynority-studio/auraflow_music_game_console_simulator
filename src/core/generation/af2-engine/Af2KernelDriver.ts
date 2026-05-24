// ============================================================
// Af2KernelDriver — AF2 chord 生成入口(2026-05-24 删 mg 后保留名称兼容)
// ============================================================
//
// 历史:本模块原是"AF2 调 mg.Engine 的封装层",做 PRNG 隔离 + mg 转 IR。
//        删 mg.generateArrangement / generateProgressions / realizeProgression
//        后,本模块降级为"AF2 Arranger + AF2 Composer 调用链"。
//
// 当前职责:
//   1. PRNG 独立 stream(new Random(seedString))
//   2. Af2Arranger.arrange → abstractPath
//   3. Af2Composer.compose → ChordDef[]
//   4. ChordDef[] → GeneratedChord[](累积 startBeat)
//   5. 返回 chord IR + totalBeats / bpm 元数据
//
// events 字段保留为 NoteDataWithPart[] 兼容(永远空数组 — 所有 musicians 都
//   走 AF2-native plan() 不消费 mg events)。
//
// 命名:模块名"Af2KernelDriver"保留作历史 grep 索引,后续可改名 Af2KernelDriver。
// ============================================================

import { ChordQuality, Tonality } from '../types';
import type { GeneratedChord, NoteData, SectionMetadata } from '../types';
import { Random } from './utils/Random';
import type { ChordDef } from './types/ChordDef';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import { Af2Arranger } from './Af2Arranger';
import { Af2Composer } from './Af2Composer';
import type { BorrowSource } from './BorrowChordPlanner';
import type { SubStyle } from './SubStyleTextures';
import { noteToMidi } from './music-theory/midi';

/**
 * mg ChordDef.type(字符串)→ auraflow ChordQuality 映射。
 * Af2Composer 输出的 type 与原 mg 一致(maj / m7 / dom7 / 等)。
 */
const MG_TYPE_TO_QUALITY: Record<string, ChordQuality> = {
    'maj':     ChordQuality.Major,
    'min':     ChordQuality.Minor,
    'dim':     ChordQuality.Diminished,
    'aug':     ChordQuality.Augmented,
    'maj7':    ChordQuality.Major7,
    'm7':      ChordQuality.Minor7,
    'dom7':    ChordQuality.Dominant7,
    '7':       ChordQuality.Dominant7,
    'm7b5':    ChordQuality.HalfDiminished,
    'dim7':    ChordQuality.Diminished7,
    'sus4':    ChordQuality.Sus4,
    '7sus4':   ChordQuality.Dominant7Sus4,
    'add9':    ChordQuality.Add9,
    'm9':      ChordQuality.Minor9,
    'maj9':    ChordQuality.Major9,
    'dom9':    ChordQuality.Dominant9,
    '9':       ChordQuality.Dominant9,
    'm11':     ChordQuality.Minor11,
    'dom13':   ChordQuality.Dominant13,
    '13':      ChordQuality.Dominant13,
    'maj13':   ChordQuality.Major13,
    'maj7#11': ChordQuality.Major7Sharp11,
    '7b9':     ChordQuality.Dom7Flat9,
    '7#9':     ChordQuality.Dom7Sharp9,
    '7#11':    ChordQuality.Dom7Sharp11,
    '7b13':    ChordQuality.Dom7Flat13,
    '7alt':    ChordQuality.Dom7Alt,
    'dom11':   ChordQuality.Dominant11,
    '11':      ChordQuality.Dominant11,
};

/** Per-mgStyle 默认全曲小节数 / BPM(可被 sections 覆盖) */
export const MG_STYLE_BARS: Record<MgStyle, number> = { POP: 16, JAZZ: 16, BLUES: 12, RNB: 16 };
export const MG_STYLE_BPM: Record<MgStyle, number> = { POP: 120, JAZZ: 96, BLUES: 100, RNB: 88 };

/** Part tag(SlotRouter 用)— events 永远空,但接口保留兼容 */
export type MgPart = 'melody' | 'accomp' | 'bass' | 'drums' | 'pad';

export interface NoteDataWithPart extends NoteData {
    part: MgPart;
}

export interface MgKernelOutput {
    chords: GeneratedChord[];
    /** 永远空数组(skipArrangement 永远生效) — 接口保留兼容 SlotRouter */
    events: NoteDataWithPart[];
    totalBeats: number;
    recommendedBars: number;
    bpm: number;
}

function chordDefToGeneratedChord(
    chord: ChordDef,
    startBeat: number,
): { generated: GeneratedChord; durationBeats: number } {
    const pc = (((chord.rootMidi % 12) + 12) % 12);
    const quality = MG_TYPE_TO_QUALITY[chord.type] ?? ChordQuality.Major;
    const generated: GeneratedChord = {
        numeral: chord.roman || '',
        root: pc,
        quality,
        startBeat,
        endBeat: startBeat + chord.duration,
        keyOffset: 0,
        voicing: chord.notesMidi.slice(),
    };
    return { generated, durationBeats: chord.duration };
}

export const Af2KernelDriver = {
    /**
     * AF2 chord 生成入口(纯 AF2 内核,无 mg 依赖)。
     *
     * @param seedString  PRNG 种子字符串
     * @param mgStyle     风格(POP/JAZZ/BLUES/RNB)— 路由 Arranger / Composer 行为
     * @param key         调号(默认 'C')
     * @param sections    Optional:per-section 不同进行(传入则用 section-aware Arranger)
     */
    invoke(
        seedString: string,
        mgStyle: MgStyle,
        key: string = 'C',
        sections?: ReadonlyArray<SectionMetadata>,
        isMinor: boolean = false,
        subStyle?: SubStyle,
    ): MgKernelOutput {
        const rng = new Random(seedString);

        // L 阶段:fork 3 子 PRNG 流给 BorrowChordPlanner + TonicizationPlanner。
        //   隔离子流让 planner 触发/不触发都不影响主 rng 顺序 →
        //   同 seed 下"加 planner"vs"不加 planner"chord skeleton 一致(planner
        //   不 fire 时)。
        const borrowSourceRng = new Random(`${seedString}::borrow-source`);
        const borrowRng = new Random(`${seedString}::borrow`);
        const tonicizeRng = new Random(`${seedString}::tonicize`);
        // K3 阶段:Picardy 3rd ending(Minor only)— Major 调不消费
        const picardyRng = new Random(`${seedString}::picardy`);
        // K4 阶段:Minor parallel-major borrow(iv→IV / bVI→VI)— Major 调不消费
        const minorBorrowRng = new Random(`${seedString}::minor-borrow`);

        // 单 borrow-source per song(Rule 3 user policy)。
        //   80% Aeolian / 12% Mixolydian / 8% Phrygian
        const sourceRoll = borrowSourceRng.next();
        const borrowSource: BorrowSource =
            sourceRoll < 0.80 ? 'Aeolian'
            : sourceRoll < 0.92 ? 'Mixolydian'
            : 'Phrygian';

        // key → pc(给 TonicizationPlanner 算 absolute localTonalCenterPc)
        const songKeyRootPc = ((noteToMidi(key + '0') % 12) + 12) % 12;

        const abstractPath = sections
            ? Af2Arranger.arrange(mgStyle, sections, 4 /* beatsPerMeasure */, rng, {
                borrowRng,
                tonicizeRng,
                borrowSource,
                songKeyRootPc,
                // K2 阶段:Minor 调传 'minor/Aeolian' — BorrowChordPlanner 在
                // MODAL_HOME_MODES 里包含此值,会 short-circuit
                mode: isMinor ? 'minor/Aeolian' : 'Maj/Ionian',
                motifInterval: 4,
                isMinor,
                picardyRng,        // K3:Minor 调 Picardy 3rd ending
                minorBorrowRng,    // K4:Minor 调 iv→IV / bVI→VI borrow
                subStyle,          // P5:per-song sub-style → 进行池优先
            })
            : Af2Arranger.arrangeByBars(mgStyle, MG_STYLE_BARS[mgStyle], rng);
        // K2 阶段:Composer isMinor 影响 chord spell(B♭ 调 minor vs A# 调 major)
        const mgChords: ChordDef[] = Af2Composer.compose(abstractPath, key, isMinor, mgStyle, rng);

        // ChordDef[] → GeneratedChord[](累积 startBeat)
        const chords: GeneratedChord[] = [];
        let cursor = 0;
        for (let i = 0; i < mgChords.length; i++) {
            const { generated, durationBeats } = chordDefToGeneratedChord(mgChords[i], cursor);
            chords.push(generated);
            cursor += durationBeats;
        }

        return {
            chords,
            events: [],   // 全 AF2 musicians 都 plan() 自家生成,不消费 mg events
            totalBeats: cursor,
            recommendedBars: MG_STYLE_BARS[mgStyle],
            bpm: MG_STYLE_BPM[mgStyle],
        };
    },

    getRecommendedBars(mgStyle: MgStyle): number {
        return MG_STYLE_BARS[mgStyle];
    },

    getBpm(mgStyle: MgStyle): number {
        return MG_STYLE_BPM[mgStyle];
    },
};

// 保留 Tonality 引用避免未用 import 警告(C 端 sync 可能引)
void Tonality;
