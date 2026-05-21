// ============================================================
// MgEngineFacade — melodygenerative 引擎入口(Phase 1 step 2 实装)
// ============================================================
//
// 职责:
//   把 mg-engine(Engine 类 + Random + STYLE_DICTIONARY)的输出包装成
//   auraflow 标准的 { track: GeneratedTrack, context: MusicContext } 形状,
//   交给 AbsoluteTransposer → MidiConverter → AudioEngine 消费,**不动音频层**。
//
// 数据流:
//   PRNGManager.getInitialSeed() (number)
//     → seedString = `mg_${seed}`
//   new Engine(new Random(seedString))                     ← mg 独立 PRNG,与 PRNGManager 隔离
//     → engine.generateProgressions({ seed, style, key })  ← ChordDef[]
//     → engine.generateArrangement(chords, config)         ← MusicTimeline { events: NoteEvent[] }
//   ChordDef[]   → GeneratedChord[] (本文件 chordDefToGeneratedChord)
//   NoteEvent[]  → 按 part 切到 melody / accompaniment / bass
//   组装成 GeneratedTrack + MusicContext 返回
//
// 设计要点:
//   - keyOffset = 0 — mg 输出已是绝对 MIDI,设为 0 后 AbsoluteTransposer
//     的 applyKeyOffset 等价 pass-through,符合 K-2(唯一加 keyOffset 点)。
//   - track.bass = [] — mg 的 bass part(原本送独立 electricBass 通道)
//     合并到 accompaniment(自动按 pitch < 48 切到 pianoLH),让所有伴奏走
//     同一架钢琴,听感对齐 mg-standalone 单 sampler 渲染。
//   - gmProgramOverrides 强制 melody/pianoLH/pianoRH 全 = 0(Grand Piano),
//     避免默认 melody=1(Bright Acoustic)导致 lead 与伴奏不同音色。
//
// PRNG 隔离(Phase 1+2):
//   mg 自带 Random 类(sin-hash + 字符串 fork)与 PRNGManager 完全无交叉。
//   验收锚点:同 seed 字符串 → mg 输出 = melodygenerative-standalone 输出。
//   Phase 3 才考虑合并 PRNG(届时 mg 已成内核,原版概念失效)。
// ============================================================

import type { GeneratedTrack, MusicContext, NoteData } from '../types';
import { ChordQuality, Tonality } from '../types';
import { StyleId } from '../config/StyleFlags';
import type { PipelineRunOptions } from '../pipeline';
import { PRNGManager } from '../../utils/PRNG';
import { EngineSelectionStore, MgStyle } from '../../../state/EngineSelectionStore';
import { Engine, Random, ChordDef, NoteEvent, GenerationConfig } from './musicEngine';

export interface MgGenerateResult {
    track: GeneratedTrack;
    context: MusicContext;
}

// mg StyleName → 一个合理 BPM(取 STYLE_DICTIONARY 各 macro 风格 tempoRange 中位数)
const MG_STYLE_BPM: Record<MgStyle, number> = {
    POP:   110,
    JAZZ:  120,
    BLUES: 90,
    RNB:   90,
};

// mg StyleName → 一个 auraflow StyleId 占位(仅供 AudioEngine.playSong 的
// styleId 参数 / context.style 占位;MG 模式下其实不消费 styleConfig 的内容,
// 但 ArrangedTrack.styleId 字段需要一个值)
const MG_STYLE_TO_AF_STYLE: Record<MgStyle, StyleId> = {
    POP:   StyleId.ModernPop,
    JAZZ:  StyleId.ChillJazz,
    BLUES: StyleId.ChillJazz,   // auraflow 无 BLUES,挂靠 Jazz
    RNB:   StyleId.NeoSoul,
};

// mg ChordDef.type(字符串)→ auraflow ChordQuality 枚举映射。
// mg CHORD_TYPES 表约 30 个 key;未覆盖项默认 Major(只影响 Q+H 显示,不影响音频)。
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
    '6':       ChordQuality.Major,           // 无对应,fallback
    '6/9':     ChordQuality.Major,
    '11':      ChordQuality.Dominant11,
    '13b9':    ChordQuality.Dom7Flat9,
    '7#11':    ChordQuality.Dom7Sharp11,
    'm9b5':    ChordQuality.HalfDiminished,
    'm7sus4':  ChordQuality.Dominant7Sus4,
};

/**
 * ChordDef → GeneratedChord
 *
 * mg.ChordDef:           auraflow.GeneratedChord:
 *   root (string)          root (relative pc) = rootMidi % 12
 *   rootMidi               quality (enum)     = MG_TYPE_TO_QUALITY[type]
 *   type (string)          numeral            = chord.roman
 *   roman (string)         startBeat          = 累积 duration 前缀和
 *   notesMidi (number[])   endBeat            = startBeat + duration
 *   duration (beats)       keyOffset          = 0(mg 已绝对化,K-2 pass-through)
 *                          voicing            = chord.notesMidi(直接用作 RELATIVE)
 */
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
        voicing: chord.notesMidi.slice(),  // 复制一份避免被下游 mutate
    };
    return { generated, durationBeats: chord.duration };
}

// 局部类型:复用 GeneratedChord 但保持文件自包含
import type { GeneratedChord } from '../types';

/**
 * NoteEvent → NoteData
 *
 * mg.NoteEvent:                auraflow.NoteData:
 *   noteNumber (0-127)            pitch     = noteNumber
 *   time (beats)                  onset     = time
 *   duration (beats)              duration  = duration
 *   velocity (0-127)              velocity  = velocity / 127   (float 0-1)
 *   part / chordSymbol / 其他    (不消费)
 */
function noteEventToNoteData(ev: NoteEvent): NoteData {
    const v = ev.velocity / 127;
    return {
        pitch:    ev.noteNumber,
        onset:    ev.time,
        duration: ev.duration,
        velocity: v < 0 ? 0 : v > 1 ? 1 : v,
    };
}

export const MgEngineFacade = {
    /**
     * 主入口:被 runPipeline 在 EngineSelectionStore.getEngine() === 'MG' 时调用。
     *
     * 不消费 options.forcedBand / forcedGmPrograms — MG 无乐手概念,UI 已 disable。
     * 不消费 options.forcedStyleId / allowedStyleIds — MG 用自己的 mgStyle(POP/JAZZ/BLUES/RNB)。
     * options.generation 暂时也不消费(mg config 字段差异较大,留 Phase 2 评估)。
     */
    generate(_options: PipelineRunOptions): MgGenerateResult {
        // -----------------------------------------------------------
        // 1. seed 派生(PRNG 隔离:不消费 PRNGManager,只读初始 seed)
        // -----------------------------------------------------------
        const auraflowSeed = PRNGManager.getInitialSeed();
        const seedString = `mg_${auraflowSeed >>> 0}`;

        // -----------------------------------------------------------
        // 2. 构造 mg GenerationConfig + Engine
        // -----------------------------------------------------------
        const mgStyle = EngineSelectionStore.getMgStyle();
        const key = 'C';  // Phase 1:固定 C(mg 内部已绝对化,移调由 keyOffset 处理 — 但本路径 keyOffset=0)
        const config: GenerationConfig = {
            seed: seedString,
            style: mgStyle,
            key,
            emotion: 'auto',
        };
        const engine = new Engine(new Random(seedString));

        // -----------------------------------------------------------
        // 3. 跑 mg 管线:Progressions → Arrangement
        // -----------------------------------------------------------
        const mgChords: ChordDef[] = engine.generateProgressions(config);
        const timeline = engine.generateArrangement(mgChords, config);
        const events: NoteEvent[] = timeline.events;

        // -----------------------------------------------------------
        // 4. ChordDef[] → GeneratedChord[](累积 startBeat)
        // -----------------------------------------------------------
        const chords: GeneratedChord[] = [];
        let cursorBeats = 0;
        for (let i = 0; i < mgChords.length; i++) {
            const { generated, durationBeats } = chordDefToGeneratedChord(mgChords[i], cursorBeats);
            chords.push(generated);
            cursorBeats += durationBeats;
        }
        const totalBeats = cursorBeats;

        // -----------------------------------------------------------
        // 5. NoteEvent[] → NoteData[],按 part 切轨
        //
        //   mg.part='melody'        → track.melody          (Lead 通道)
        //   mg.part='chord' / 'bass' → 全进 track.accompaniment
        //
        //   配合下面 track.skipHandSplit = true:
        //     AbsoluteTransposer 把整条 accompaniment 全送 pianoRH 单通道,pianoLH 留空。
        //     与 mg-standalone 的"单 Tone.Sampler 中央 pan / 统一 volume / 统一 reverb"
        //     渲染语义对齐。
        //
        //   track.bass 留空(我们不走 electricBass 通道)。
        // -----------------------------------------------------------
        const melody: NoteData[] = [];
        const accompaniment: NoteData[] = [];
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const note = noteEventToNoteData(ev);
            if (ev.part === 'melody') {
                melody.push(note);
            } else {
                // 'chord' / 'bass' 都进 accompaniment
                accompaniment.push(note);
            }
        }
        // onset 升序 + 同 onset 按 pitch 升序(下游 MidiConverter 友好)
        melody.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        accompaniment.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);

        // -----------------------------------------------------------
        // 6. SectionMetadata:整曲一段(MG 无段落概念,下游 UI 仍可读)
        // -----------------------------------------------------------
        const sections = [{
            name: 'MgSolo',
            startBeat: 0,
            endBeat: totalBeats,
            energyLevel: 5,
            // sectionType 不设(MG 模式下 Conductor / mask 等都不跑,字段无消费方)
        }];

        // -----------------------------------------------------------
        // 7. 装配 GeneratedTrack
        // -----------------------------------------------------------
        const bpm = MG_STYLE_BPM[mgStyle];
        const track: GeneratedTrack = {
            chords,
            melody,
            accompaniment,
            bass: [],           // electricBass 通道不用
            drums: [],          // MG 无鼓
            atmosphere: [],     // MG 无 pad
            sections,
            bpm,
            key,
            keyOffset: 0,       // K-2:mg 已绝对化,后续 applyKeyOffset 等价 pass-through
            tonality: Tonality.Major,
            timeSignature: [4, 4],
            blockIndex: 0,
            absoluteStartBeat: 0,
            hasIntro: false,
            // 关键:跳过 AbsoluteTransposer 的 pitch<48 LH/RH 切分,所有 accomp 走单通道。
            // 实现"mg-standalone 单 sampler 中央渲染"语义对齐。
            skipHandSplit: true,
        };

        // -----------------------------------------------------------
        // 8. MusicContext
        //
        //   gmProgramOverrides 强制 piano sound 覆盖默认 melody=1(Bright):
        //     melody / pianoLH / pianoRH 全 = 0(Grand Piano)
        //     drums / atmosphere / electricBass 不设(无音符,无影响)
        // -----------------------------------------------------------
        const afStyleId = MG_STYLE_TO_AF_STYLE[mgStyle];
        const context: MusicContext = {
            keyOffset: 0,
            tonality: Tonality.Major,
            bpm,
            timeSignature: [4, 4],
            grooveDNA: [],
            style: {
                // 最小占位 StyleConfig — 下游 AudioEngine 只读 styleId 数字字段,
                // 完整 styleConfig 由 getStyleConfig(afStyleId) 在 AF 模式提供;
                // MG 模式不消费 styleConfig 其他字段,这里只塞 id 满足类型。
                id: afStyleId,
            } as MusicContext['style'],
            gmProgramOverrides: {
                melody: 0,    // Grand Piano(覆盖默认 1=Bright Acoustic)
                pianoLH: 0,
                pianoRH: 0,
            },
        };

        return { track, context };
    },
};
