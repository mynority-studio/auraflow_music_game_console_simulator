// ============================================================
// mgCoreV2/adapter.ts — V2 沙箱(2026-05-28)
// ============================================================
//
// V1 (mgEngine/adapter.ts) 是 byte-identical mg standalone 的参考实现,不动。
// V2 是我们后续 dimensional / MMA-kernel synthesis 实验的容器。
//
// 当前状态:Phase 0 — V2 复用 V1 musicEngine 完全相同输出(byte-identical V1)。
// console marker `[mgCoreV2]` 用于验证切换确实路由到这里。
//
// 后续 phase 计划:
//   Phase 1: 从 V1 events 出发,做后处理实验(re-voice / re-density / etc.)
//   Phase 2: parse MMA stdlib(122 .mma files)抽出 StyleVector
//   Phase 3: kernel-based synthesis 替代 V1 的 applyTexture switch
// ============================================================

import { Engine, Random, type GenerationConfig, type ChordDef, type NoteEvent, type PedalEvent } from '../mgEngine/musicEngine';
import { STYLE_DICTIONARY, type StyleName } from '../mgEngine/styleDictionary';
import {
    GeneratedTrack,
    MusicContext,
    SectionType,
    Tonality,
    ChordQuality,
} from '../types';
import { NoteData, GeneratedChord, SectionMetadata } from '../ir';

export interface MgV2RunOptions {
    seed?: string;
    style?: StyleName;
    key?: string;
}

interface PedalSegment { start: number; end: number }

function buildPedalSegments(pedalEvents: PedalEvent[] | undefined): PedalSegment[] {
    if (!pedalEvents || pedalEvents.length === 0) return [];
    const segs: PedalSegment[] = [];
    let down = false;
    let segStart = 0;
    for (let i = 0; i < pedalEvents.length; i++) {
        const pe = pedalEvents[i];
        if (pe.type === 'on' && !down) {
            segStart = pe.time;
            down = true;
        } else if (pe.type === 'off' && down) {
            segs.push({ start: segStart, end: pe.time });
            down = false;
        }
    }
    if (down) segs.push({ start: segStart, end: Number.POSITIVE_INFINITY });
    return segs;
}

function pedalEndAfter(segs: PedalSegment[], t: number): number | null {
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (t >= s.start && t < s.end) return s.end;
    }
    return null;
}

const PEDAL_MAX_RING_BEATS = 8;

function eventsToNoteData(
    events: NoteEvent[],
    part: NoteEvent['part'],
    pedalSegs: PedalSegment[],
    applyPedal: boolean,
): NoteData[] {
    const out: NoteData[] = [];
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.part !== part) continue;
        let duration = e.duration;
        if (applyPedal && pedalSegs.length > 0) {
            const pedalEnd = pedalEndAfter(pedalSegs, e.time);
            if (pedalEnd !== null) {
                const pedalDur = pedalEnd - e.time;
                duration = Math.max(duration, Math.min(pedalDur, PEDAL_MAX_RING_BEATS));
            }
        }
        out.push({
            pitch: e.noteNumber,
            onset: e.time,
            duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        });
    }
    return out;
}

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

export function runMgCoreV2(opts: MgV2RunOptions = {}): {
    track: GeneratedTrack;
    context: MusicContext;
} {
    const seed = opts.seed ?? 'pop_default';
    const style: StyleName = opts.style ?? 'POP';
    const key = opts.key ?? 'C';

    // 标记 V2 路由(便于在 console 验证切换确实生效)
    console.log(`[mgCoreV2] generate seed=${seed} style=${style} key=${key}`);

    // Phase 0:跟 V1 完全相同的引擎调用(reuse mgEngine/musicEngine.ts)
    // Phase 1+ 在这里开始变化(insert post-processing / kernel synthesis 等)
    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));
    const genChords = engine.generateProgressions(config);
    const timeline = engine.generateArrangement(genChords, config);

    const pedalSegs = buildPedalSegments(timeline.pedalEvents);

    const melody         = eventsToNoteData(timeline.events, 'melody', pedalSegs, false);
    const accompaniment  = eventsToNoteData(timeline.events, 'chord',  pedalSegs, true);
    const bass           = eventsToNoteData(timeline.events, 'bass',   pedalSegs, true);

    const profile = STYLE_DICTIONARY[style];
    const bpm = profile
        ? Math.round((profile.tempoRange[0] + profile.tempoRange[1]) / 2)
        : 100;

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
