// ============================================================
// mgEngine/adapter.ts — melodygenerative → 我们的 IR
// ============================================================
//
// 把 mg 的 Engine.generateArrangement 输出(NoteEvent[]/ChordDef[])桥接成
// runPipeline 期待的 { track: GeneratedTrack, context: MusicContext }。
//
// mg 输入:string seed + style + key + emotion
// mg 输出:MusicTimeline.events(NoteEvent[],含 part: melody/chord/bass)
//          + ChordDef[](和弦 metadata)
//
// 我们的输出:GeneratedTrack(melody/accompaniment/chords/bpm/key/...)
//             + MusicContext(keyOffset/bpm/timeSignature/tonality)
//
// 简化规则(MVP):
//   - keyOffset = 0,所有 NoteData.pitch 保持 mg 的 absolute MIDI
//     (AbsoluteTransposer 加 0 = no-op,直接进 MidiConverter)
//   - velocity 127 scale → [0,1] float
//   - chords[] 给最小 stub(只够 UI 显示,不参与发声路由)
//   - 段落只填一个 Verse 全曲覆盖(够 PipelineMonitor 渲染)
// ============================================================

import { Engine, Random, type GenerationConfig, type ChordDef, type NoteEvent } from './musicEngine';
import { STYLE_DICTIONARY, type StyleName } from './styleDictionary';
import {
    GeneratedTrack,
    MusicContext,
    SectionType,
    Tonality,
    ChordQuality,
} from '../types';
import { NoteData, GeneratedChord, SectionMetadata } from '../ir';

export interface MgRunOptions {
    /** seed 字符串(mg 原生格式)。默认 'pop_default' */
    seed?: string;
    /** mg 风格,默认 POP */
    style?: StyleName;
    /** 调,默认 'C' */
    key?: string;
}

/**
 * 把 mg NoteEvent[] 中某个 part 提取出来,转成 NoteData[]。
 *   - velocity 0-127 → [0,1] float
 *   - pitch 透传(absolute MIDI;我们的 keyOffset 设 0)
 */
function eventsToNoteData(events: NoteEvent[], part: NoteEvent['part']): NoteData[] {
    const out: NoteData[] = [];
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.part !== part) continue;
        out.push({
            pitch: e.noteNumber,
            onset: e.time,
            duration: e.duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        });
    }
    return out;
}

/**
 * mg ChordDef 字符串 type 粗略映射到我们的 ChordQuality enum。
 * 不命中的视为 Major(只影响 UI 显示)。
 */
function mapChordQuality(type: string): ChordQuality {
    const t = type.toLowerCase();
    if (t.includes('maj7')) return ChordQuality.Major7;
    if (t.includes('m7b5')) return ChordQuality.HalfDiminished;
    if (t.includes('dim7')) return ChordQuality.Diminished7;
    if (t.includes('dim'))  return ChordQuality.Diminished;
    if (t.includes('aug'))  return ChordQuality.Augmented;
    if (t.includes('sus4')) return ChordQuality.Sus4;
    if (t.includes('m9'))   return ChordQuality.Minor9;
    if (t.includes('m7'))   return ChordQuality.Minor7;
    if (t.includes('m'))    return ChordQuality.Minor;
    if (t.includes('9'))    return ChordQuality.Dominant9;
    if (t.includes('7'))    return ChordQuality.Dominant7;
    return ChordQuality.Major;
}

/**
 * 把 mg ChordDef[] 转成 GeneratedChord[](最小够 UI 显示)。
 * startBeat/endBeat 用 duration 累加得到。
 */
function chordsToGeneratedChords(chords: ChordDef[]): GeneratedChord[] {
    const out: GeneratedChord[] = [];
    let t = 0;
    for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        const startBeat = t;
        const endBeat = t + c.duration;
        t = endBeat;
        out.push({
            numeral: c.roman,
            root: ((c.rootMidi % 12) + 12) % 12,
            quality: mapChordQuality(c.type),
            startBeat,
            endBeat,
            voicing: c.notesMidi.slice().sort((a, b) => a - b),
        });
    }
    return out;
}

/**
 * 主入口 — 跑 mg 一遍,转出我们的 IR。
 *
 * 注意:caller(runPipeline)负责按 forcedBand 决定是否保留 melody / accompaniment。
 * 本函数不剪枝,完整返回。
 */
export function runMgEngine(opts: MgRunOptions = {}): {
    track: GeneratedTrack;
    context: MusicContext;
} {
    const seed = opts.seed ?? 'pop_default';
    const style: StyleName = opts.style ?? 'POP';
    const key = opts.key ?? 'C';

    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));
    const genChords = engine.generateProgressions(config);
    const timeline = engine.generateArrangement(genChords, config);

    const melody = eventsToNoteData(timeline.events, 'melody');
    const accompaniment = eventsToNoteData(timeline.events, 'chord');
    const bass = eventsToNoteData(timeline.events, 'bass');

    const profile = STYLE_DICTIONARY[style];
    const bpm = profile
        ? Math.round((profile.tempoRange[0] + profile.tempoRange[1]) / 2)
        : 100;

    // 段落 stub:整曲覆盖,sectionType=Verse,energy=5
    const totalBeats = genChords.reduce((s, c) => s + c.duration, 0);
    const section: SectionMetadata = {
        name: 'Verse',
        startBeat: 0,
        endBeat: totalBeats,
        energyLevel: 5,
        sectionType: SectionType.Verse,
    };

    const track: GeneratedTrack = {
        chords: chordsToGeneratedChords(genChords),
        melody,
        accompaniment,
        bass: bass.length > 0 ? bass : undefined,
        bpm,
        key,
        keyOffset: 0,
        tonality: Tonality.Major,
        timeSignature: [4, 4],
        sections: [section],
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: false,
    };

    const context: MusicContext = {
        keyOffset: 0,
        tonality: Tonality.Major,
        bpm,
        timeSignature: [4, 4],
        grooveDNA: [],
    };

    return { track, context };
}
