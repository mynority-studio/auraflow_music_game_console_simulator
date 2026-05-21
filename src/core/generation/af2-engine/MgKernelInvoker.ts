// ============================================================
// MgKernelInvoker — AF2 调用 mg.Engine 的封装层
// ============================================================
//
// 职责:
//   1. PRNG 隔离 — 用 mg 自己的 Random 类,不消耗 PRNGManager
//   2. 调 mg.Engine.generateProgressions / generateArrangement
//   3. 把 mg 的 ChordDef[] / NoteEvent[] 转换为 auraflow IR 格式
//      (GeneratedChord / NoteData,但保留 part 字段供 SlotRouter 使用)
//   4. 返回元数据(总小节数 / BPM / total beats)
//
// 与 MgEngineFacade 的关系:
//   - MgEngineFacade 是 MG 模式的入口,负责装配 MG 模式 GeneratedTrack
//     (single-piano 合并 chord+bass 等 MG-specific 行为)
//   - MgKernelInvoker 是 AF2 模式调 mg 的工具,只做"调 mg + 转 IR"
//   - Phase 1 接受两边各有一份相似的转换代码(MgEngineFacade 不动以保 MG bit-exact)
//   - Phase 后期 AF2 稳定后,可考虑 DRY 把 MgEngineFacade 改为调本模块
//
// 融合原则相关:
//   - **绝对不动 mg 算法**:invoke 透传 mg 输出,不改 pitch/onset/duration/velocity
//   - 同一 seedString 下,输出与直接调 mg.Engine 完全一致
// ============================================================

import { ChordQuality, Tonality } from '../types';
import type { GeneratedChord, NoteData } from '../types';
import { Engine, Random } from '../mg-engine/musicEngine';
import type { ChordDef, NoteEvent, GenerationConfig } from '../mg-engine/musicEngine';
import type { MgStyle } from '../../../state/EngineSelectionStore';

/**
 * mg ChordDef.type(字符串)→ auraflow ChordQuality 映射。
 * 镜像 MgEngineFacade 的映射表(2026-05-21 同步)。
 * 未覆盖项默认 Major(只影响 UI 显示,不影响音频)。
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
    'add9':    ChordQuality.Add9,
    'm9':      ChordQuality.Minor9,
    'maj9':    ChordQuality.Major9,
    '9':       ChordQuality.Dominant9,
    'sus4':    ChordQuality.Sus4,
    '7sus4':   ChordQuality.Dominant7Sus4,
    '9sus4':   ChordQuality.Dominant7Sus4,
    '7b13':    ChordQuality.Dom7Flat13,
    '13':      ChordQuality.Dominant13,
    '7#9':     ChordQuality.Dom7Sharp9,
    '7alt':    ChordQuality.Dom7Alt,
    'm11':     ChordQuality.Minor11,
    'maj13':   ChordQuality.Major13,
    '6':       ChordQuality.Major,
    '6/9':     ChordQuality.Major,
    '11':      ChordQuality.Dominant11,
    '13b9':    ChordQuality.Dom7Flat9,
    '7#11':    ChordQuality.Dom7Sharp11,
    'm9b5':    ChordQuality.HalfDiminished,
    'm7sus4':  ChordQuality.Dominant7Sus4,
};

/** mg macro StyleName → BPM(取 STYLE_DICTIONARY 各风格 tempoRange 中位数) */
const MG_STYLE_BPM: Record<MgStyle, number> = {
    POP:   110,
    JAZZ:  120,
    BLUES: 90,
    RNB:   90,
};

/** mg macro StyleName → recommendedBars(由 mg L1288 决定:BLUES=12, 其余=16) */
const MG_STYLE_BARS: Record<MgStyle, number> = {
    POP:   16,
    JAZZ:  16,
    BLUES: 12,
    RNB:   16,
};

/** mg NoteEvent.part 字段(从 musicEngine 内部类型反射) */
export type MgPart = NoteEvent['part'];

/**
 * 携带 part 字段的 NoteData。Phase 1 用于 SlotRouter 路由
 * (chord → Accomp / bass → Bass / melody → MainInst)。
 */
export interface NoteDataWithPart extends NoteData {
    part: MgPart;
}

/**
 * MgKernelInvoker 的输出。
 */
export interface MgKernelOutput {
    /** mg 算的 chord 序列(已转 GeneratedChord,RELATIVE 但等价 ABSOLUTE 因 keyOffset=0) */
    chords: GeneratedChord[];
    /** mg 算的所有音符事件(已转 NoteData,onset 升序;附 part 字段) */
    events: NoteDataWithPart[];
    /** 全曲总 beats(= chords 末尾的 endBeat) */
    totalBeats: number;
    /** 全曲小节数(由 mg style 决定:12 或 16) */
    recommendedBars: number;
    /** 全曲 BPM */
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

function noteEventToNoteDataWithPart(ev: NoteEvent): NoteDataWithPart {
    const v = ev.velocity / 127;
    return {
        pitch:    ev.noteNumber,
        onset:    ev.time,
        duration: ev.duration,
        velocity: v < 0 ? 0 : v > 1 ? 1 : v,
        part:     ev.part,
    };
}

export const MgKernelInvoker = {
    /**
     * 调用 mg 内核生成全曲。
     *
     * @param seedString  PRNG 种子字符串(AF2 应传 `af2_${auraflowSeed}`,与 MG 模式
     *                    的 `mg_*` 区分,避免用户混淆"同 seed 不同结果")
     * @param mgStyle     mg 风格(POP/JAZZ/BLUES/RNB)
     * @param key         调号字符串(默认 'C'。mg 已绝对化 MIDI,实际渲染由 keyOffset 处理)
     */
    invoke(seedString: string, mgStyle: MgStyle, key: string = 'C'): MgKernelOutput {
        const config: GenerationConfig = {
            seed: seedString,
            style: mgStyle,
            key,
            emotion: 'auto',
        };
        const engine = new Engine(new Random(seedString));

        const mgChords: ChordDef[] = engine.generateProgressions(config);
        const timeline = engine.generateArrangement(mgChords, config);
        const mgEvents: NoteEvent[] = timeline.events;

        // ChordDef[] → GeneratedChord[](累积 startBeat)
        const chords: GeneratedChord[] = [];
        let cursor = 0;
        for (let i = 0; i < mgChords.length; i++) {
            const { generated, durationBeats } = chordDefToGeneratedChord(mgChords[i], cursor);
            chords.push(generated);
            cursor += durationBeats;
        }
        const totalBeats = cursor;

        // NoteEvent[] → NoteDataWithPart[],onset 升序 + 同 onset 按 pitch 升序
        const events: NoteDataWithPart[] = mgEvents.map(noteEventToNoteDataWithPart);
        events.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);

        return {
            chords,
            events,
            totalBeats,
            recommendedBars: MG_STYLE_BARS[mgStyle],
            bpm: MG_STYLE_BPM[mgStyle],
        };
    },

    /** 暴露常量供 SectionPlanner / Af2EngineFacade 等读取(避免硬编码) */
    getRecommendedBars(mgStyle: MgStyle): number {
        return MG_STYLE_BARS[mgStyle];
    },

    getBpm(mgStyle: MgStyle): number {
        return MG_STYLE_BPM[mgStyle];
    },
};
