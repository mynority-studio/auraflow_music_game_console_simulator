// ============================================================
// MgChordAdapter — mg ChordDef / NoteEvent → auraflow IR 转换(Phase 1 Step 3+4 合做)
// ============================================================
//
// 出处:mg_engine_integration_plan.md §4.4 Phase 2 新建 adapter(本批提前到 Phase 1
// Step 3 做最简版 — Phase 1 验收需要 track.chords + track.melody 等基础字段不为空)。
//
// 两个核心函数:
//   chordDefToGeneratedChord(cd, accumulatedStartBeat) → GeneratedChord
//   noteEventToNoteData(ev) → NoteData
//   chordDefsToGeneratedChords(chords) → GeneratedChord[](批量,自动累积 startBeat)
//   noteEventsToNoteData(events) → NoteData[]
//
// Phase 1 范围(最简版):
//   - chord type 字符串 → ChordQuality enum 模糊映射(覆盖主要类型,未知 fallback Major7)
//   - chord.notes(string MIDI 名)→ voicing(number MIDI)解析
//   - NoteEvent.velocity(0-127)→ NoteData.velocity(0-1 float)
//   - NoteEvent.origin('motif'/'develop'/'return')→ NoteOrigin enum
//   - ChordDef.bassMidi → bassOverride(若与 root pc 不一致)
//
// Phase 2 待精化(本批不做):
//   - 复杂 chord type 完整映射(7#9 / 13b9 / m7b5 等)
//   - 7alt 等 mg 特殊类型映射到 auraflow Dom7Alt
//   - voicingTagged(VoicedPitch[] with role)派生
//   - effectiveFunc / tensionState / virtualExtensions 透传
//
// 零 PRNG(纯转换函数)。仅依赖 mg-engine/* + auraflow types.ts + ir/。
// ============================================================

import {
    GeneratedChord,
    NoteData,
    ChordQuality,
} from '../types';
import { NoteOrigin } from '../ir';
import type { ChordDef, NoteEvent } from '../mg-engine/musicEngine';

// ============================================================
// 字符串 → PC 映射(支持 sharp / flat / 双重升降)
// ============================================================

const NOTE_TO_PC: { [name: string]: number } = {
    'C': 0,  'B#': 0,  'Dbb': 0,
    'C#': 1, 'Db': 1,
    'D': 2,  'C##': 2, 'Ebb': 2,
    'D#': 3, 'Eb': 3,  'Fbb': 3,
    'E': 4,  'D##': 4, 'Fb': 4,
    'F': 5,  'E#': 5,  'Gbb': 5,
    'F#': 6, 'Gb': 6,
    'G': 7,  'F##': 7, 'Abb': 7,
    'G#': 8, 'Ab': 8,
    'A': 9,  'G##': 9, 'Bbb': 9,
    'A#': 10, 'Bb': 10, 'Cbb': 10,
    'B': 11, 'A##': 11, 'Cb': 11,
};

/**
 * 解析音名字符串('C' / 'F#' / 'Bb' 等)→ pitch class [0, 11]
 * 失败返回 0(C)兜底,记录 console.warn 用于排查 mg 输出异常。
 */
function parseNoteName(name: string): number {
    const pc = NOTE_TO_PC[name];
    if (pc === undefined) {
        // eslint-disable-next-line no-console
        console.warn(`MgChordAdapter: unknown note name "${name}", falling back to C`);
        return 0;
    }
    return pc;
}

/**
 * 解析 MIDI 音名('C4' / 'F#5' / 'Bb3' 等)→ MIDI number [0, 127]
 *
 * 算法:
 *   1. 从末尾扫数字部分(octave)
 *   2. 前面是 pitch class 字符串
 *   3. MIDI = (octave + 1) * 12 + pc
 *   - mg 用 standard MIDI:C4 = 60(与 auraflow 一致)
 */
function parseMidiNoteName(name: string): number {
    // 末尾连续的负号 / 数字即 octave
    let i = name.length - 1;
    while (i > 0 && (name[i] === '-' || (name[i] >= '0' && name[i] <= '9'))) i--;
    const pcStr = name.slice(0, i + 1);
    const octaveStr = name.slice(i + 1);
    if (octaveStr.length === 0) {
        // 无 octave 后缀 → 当 C4 octave 默认
        return parseNoteName(pcStr) + 60;
    }
    const octave = parseInt(octaveStr, 10);
    if (!Number.isFinite(octave)) {
        // eslint-disable-next-line no-console
        console.warn(`MgChordAdapter: cannot parse octave "${octaveStr}" from "${name}"`);
        return parseNoteName(pcStr) + 60;
    }
    return (octave + 1) * 12 + parseNoteName(pcStr);
}

// ============================================================
// chord type 字符串 → ChordQuality 映射
// ============================================================
//
// mg 用 styleDictionary 内的字符串字面量('maj7' / 'm9' / '7alt' 等)。
// auraflow ChordQuality 是 25 个 enum 值(Batch 5 扩到 Major13 / Dom7Alt 等)。
//
// 映射策略:精确匹配优先,fallback 到最近似 enum。未知类型 fallback Major7。
//
// 本表覆盖 mg styleDictionary 实际出现的 chord type(grep 验证过)。

const CHORD_TYPE_TO_QUALITY: { [type: string]: ChordQuality } = {
    // 三和弦
    '':         ChordQuality.Major,        // 空字符串 = 大三和弦(mg 常用)
    'maj':      ChordQuality.Major,
    'min':      ChordQuality.Minor,
    'm':        ChordQuality.Minor,
    'dim':      ChordQuality.Diminished,
    'aug':      ChordQuality.Augmented,
    'sus4':     ChordQuality.Sus4,
    'sus2':     ChordQuality.Sus4,         // 简化:sus2 暂归 Sus4(实际 sus2 没有专门 enum)

    // 七和弦
    'maj7':     ChordQuality.Major7,
    'm7':       ChordQuality.Minor7,
    'mMaj7':    ChordQuality.Major7,       // 罕见,简化兜底
    '7':        ChordQuality.Dominant7,
    'dom7':     ChordQuality.Dominant7,
    'dim7':     ChordQuality.Diminished7,
    'm7b5':     ChordQuality.HalfDiminished,
    '7sus4':    ChordQuality.Dominant7Sus4,

    // 6 和弦(无 Sixth enum,简化)
    '6':        ChordQuality.Major,
    '6/9':      ChordQuality.Add9,
    'add9':     ChordQuality.Add9,

    // 9 和弦
    'maj9':     ChordQuality.Major9,
    'm9':       ChordQuality.Minor9,
    '9':        ChordQuality.Dominant9,
    '9sus4':    ChordQuality.Dominant7Sus4, // 简化:没有专门 9sus4
    'm9b5':     ChordQuality.HalfDiminished, // 简化
    'm7sus4':   ChordQuality.Dominant7Sus4, // 简化

    // 11 和弦
    '11':       ChordQuality.Dominant11,
    'm11':      ChordQuality.Minor11,

    // 13 和弦
    '13':       ChordQuality.Dominant13,
    'maj13':    ChordQuality.Major13,
    '13b9':     ChordQuality.Dom7Flat9,     // 简化:13b9 主要 b9 色彩

    // Maj7#11 / Lydian color
    'maj7#11':  ChordQuality.Major7Sharp11,
    'maj9#11':  ChordQuality.Major7Sharp11, // 简化:同 #11 enum

    // Altered dominant family
    '7b9':      ChordQuality.Dom7Flat9,
    '7#9':      ChordQuality.Dom7Sharp9,
    '7#11':     ChordQuality.Dom7Sharp11,
    '7b13':     ChordQuality.Dom7Flat13,
    '7alt':     ChordQuality.Dom7Alt,
    '7#5':      ChordQuality.Dom7Sharp11,   // 简化:#5 主要 altered 色彩
    '7b5':      ChordQuality.Dom7Sharp11,   // 简化
};

/**
 * mg chord.type 字符串 → ChordQuality enum。
 * 未知类型 fallback Major7 + console.warn。
 */
function chordTypeToQuality(type: string): ChordQuality {
    const quality = CHORD_TYPE_TO_QUALITY[type];
    if (quality !== undefined) return quality;
    // eslint-disable-next-line no-console
    console.warn(`MgChordAdapter: unknown chord type "${type}", falling back to Major7`);
    return ChordQuality.Major7;
}

// ============================================================
// origin 字符串 → NoteOrigin enum
// ============================================================

function originStringToEnum(origin: string | undefined): NoteOrigin {
    if (origin === 'motif') return NoteOrigin.Motif;
    if (origin === 'return') return NoteOrigin.Return;
    return NoteOrigin.Develop;
}

// ============================================================
// 主转换函数
// ============================================================

/**
 * 单条 mg ChordDef → auraflow GeneratedChord。
 *
 * @param cd                  mg ChordDef
 * @param startBeat           当前 chord 在整曲中的起始拍(调用方累积)
 * @returns                   GeneratedChord(含 voicing / 可选 bassOverride / keyOffset 留 caller 填)
 */
export function chordDefToGeneratedChord(cd: ChordDef, startBeat: number): GeneratedChord {
    const rootPc = parseNoteName(cd.root);
    const quality = chordTypeToQuality(cd.type);
    const endBeat = startBeat + cd.duration;

    // 解析 voicing:cd.notes 是 MIDI 音名字符串(如 'C4' 'E4')
    const voicing: number[] = [];
    for (let i = 0; i < cd.notes.length; i++) {
        voicing.push(parseMidiNoteName(cd.notes[i]));
    }

    // bassOverride:cd.bassMidi 与 root pc 不一致时设置(转位 / slash chord)
    const bassPc = ((cd.bassMidi % 12) + 12) % 12;
    const isInversion = bassPc !== rootPc;

    const result: GeneratedChord = {
        numeral: cd.roman,
        root: rootPc,
        quality,
        startBeat,
        endBeat,
        voicing,
    };
    if (isInversion) result.bassOverride = bassPc;
    return result;
}

/**
 * mg ChordDef[] → auraflow GeneratedChord[](批量,自动累积 startBeat)。
 *
 * @param chords     mg ChordDef[]
 * @param startBeat  整段起始拍(默认 0)
 */
export function chordDefsToGeneratedChords(
    chords: ChordDef[],
    startBeat: number = 0,
): GeneratedChord[] {
    const out: GeneratedChord[] = [];
    let cursor = startBeat;
    for (let i = 0; i < chords.length; i++) {
        const gc = chordDefToGeneratedChord(chords[i], cursor);
        out.push(gc);
        cursor = gc.endBeat;
    }
    return out;
}

/**
 * 单条 mg NoteEvent → auraflow NoteData。
 *
 * velocity 转换:mg 0-127 整数 → auraflow 0-1 float(velocity / 127)
 * origin 透传:string → NoteOrigin enum
 *
 * 暂不映射的 mg 字段(Phase 2 视需扩展):
 *   - pitchOffset / pitchEnvelope(微分音 / glide)
 *   - chordSymbol(UI hint)
 *   - part('melody' / 'chord' / 'bass')— 调用方按 part 拆轨后转换
 */
export function noteEventToNoteData(ev: NoteEvent): NoteData {
    const velocity = Math.max(0, Math.min(1, ev.velocity / 127));
    const result: NoteData = {
        pitch: ev.noteNumber,
        onset: ev.time,
        duration: ev.duration,
        velocity,
        origin: originStringToEnum(ev.origin),
    };
    return result;
}

/**
 * 批量 mg NoteEvent[] → auraflow NoteData[]。
 */
export function noteEventsToNoteData(events: NoteEvent[]): NoteData[] {
    const out: NoteData[] = new Array(events.length);
    for (let i = 0; i < events.length; i++) {
        out[i] = noteEventToNoteData(events[i]);
    }
    return out;
}
