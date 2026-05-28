// ============================================================
// mgCoreV3/adapter.ts — Viterbi voice leading 实验(Phase 1)
// ============================================================
//
// 实验假设:V3 不用 mg 的局部 widePianoVoicing,改用全曲 Viterbi DP 求
// 总半音移动最小的 voicing 序列,听感会更平滑、专业。
//
// 流程:
//   1. mg.generateProgressions → ChordDef[](mg 进行不变)
//   2. enumerateVoicings(chord) for each → 候选集
//   3. viterbiVoiceLeading(candidates) → 最优 voicing 序列
//   4. 简单 block-chord renderer + 单根 bass(暂不引入 kernel/texture 维度)
//   5. melody pass-through from mg
//
// 跟 mg / V1 的可控差异:
//   - chord 进行、melody:**完全一致 mg V1**
//   - chord+bass voicing:V3 自家 Viterbi 决定,跟 mg widePianoVoicing 不同
//   - rhythm 极简(beat 0 全 voicing,duration 4 时 beat 2 再来一次)
//
// 听感对比聚焦:**voice leading 平滑度**单一变量。
// ============================================================

import { Engine, Random, type GenerationConfig, type ChordDef, type NoteEvent } from '../mgEngine/musicEngine';
import { STYLE_DICTIONARY, type StyleName } from '../mgEngine/styleDictionary';
import {
    GeneratedTrack,
    MusicContext,
    SectionType,
    Tonality,
    ChordQuality,
} from '../types';
import { NoteData, GeneratedChord, SectionMetadata } from '../ir';
import { enumerateVoicings, type Voicing } from './voicing';
import { viterbiVoiceLeading } from './viterbi';

export interface MgV3RunOptions {
    seed?: string;
    style?: StyleName;
    key?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

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

/** mg NoteEvent → NoteData(melody pass-through) */
function melodyEventsToData(events: NoteEvent[]): NoteData[] {
    const out: NoteData[] = [];
    for (const e of events) {
        if (e.part !== 'melody') continue;
        out.push({
            pitch: e.noteNumber,
            onset: e.time,
            duration: e.duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────
// 极简 rhythm renderer(beat 0 全 voicing,duration ≥ 4 再 beat 2 一次)
// ─────────────────────────────────────────────────────────────────

const RH_VELOCITY = 0.62;  // ~MIDI 79
const BASS_VELOCITY = 0.72;  // ~MIDI 91

function renderChordBlock(voicing: Voicing, startBeat: number, duration: number): NoteData[] {
    if (voicing.length === 0) return [];
    const events: NoteData[] = [];
    const dur = Math.min(duration * 0.95, 4);

    // Beat 0:全 voicing
    for (const m of voicing) {
        events.push({
            pitch: m,
            onset: startBeat,
            duration: dur,
            velocity: RH_VELOCITY,
        });
    }

    // duration ≥ 4:beat 2 再来一次(中拍重击,稍弱)
    if (duration >= 4) {
        const rep2Dur = Math.min((duration - 2) * 0.95, 2);
        for (const m of voicing) {
            events.push({
                pitch: m,
                onset: startBeat + 2,
                duration: rep2Dur,
                velocity: RH_VELOCITY * 0.85,
            });
        }
    }
    return events;
}

/** LH 单根音 bass(从 chord.bassMidi 出发,clamp 到 D2-D3 区) */
function renderBass(chord: ChordDef, startBeat: number, duration: number): NoteData[] {
    let bass = chord.bassMidi;
    while (bass > 50) bass -= 12;
    while (bass < 38) bass += 12;
    return [{
        pitch: bass,
        onset: startBeat,
        duration: duration * 0.95,
        velocity: BASS_VELOCITY,
    }];
}

// ─────────────────────────────────────────────────────────────────
// V3 main
// ─────────────────────────────────────────────────────────────────

export function runMgCoreV3(opts: MgV3RunOptions = {}): {
    track: GeneratedTrack;
    context: MusicContext;
} {
    const seed = opts.seed ?? 'pop_default';
    const style: StyleName = opts.style ?? 'POP';
    const key = opts.key ?? 'C';

    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));

    // 1. mg progression + arrangement(我们要 chord 列表 + melody)
    const genChords = engine.generateProgressions(config);
    const timeline = engine.generateArrangement(genChords, config);

    // 2. Melody pass-through
    const melody = melodyEventsToData(timeline.events);

    // 3. 每 chord 枚举候选 voicing
    const candidates = genChords.map(c => enumerateVoicings(c));

    // 4. Viterbi DP 求最优序列
    const result = viterbiVoiceLeading(candidates);

    // 5. 渲染 chord block + bass
    const accompaniment: NoteData[] = [];
    const bass: NoteData[] = [];
    let beatAcc = 0;
    for (let i = 0; i < genChords.length; i++) {
        const chord = genChords[i];
        const v = result.voicings[i] ?? [];
        accompaniment.push(...renderChordBlock(v, beatAcc, chord.duration));
        bass.push(...renderBass(chord, beatAcc, chord.duration));
        beatAcc += chord.duration;
    }

    // Diagnostic
    const candStats = result.candidateCounts;
    const avgCands = candStats.length > 0 ? candStats.reduce((s, n) => s + n, 0) / candStats.length : 0;
    console.log(`[mgCoreV3] seed=${seed} style=${style} key=${key} | Viterbi:totalCost=${result.totalCost.toFixed(1)} avgCandidates=${avgCands.toFixed(1)} bars=${genChords.length} | events: mel=${melody.length} chord=${accompaniment.length} bass=${bass.length}`);
    console.log(`[mgCoreV3] voicings: ${result.voicings.map((v, i) => `${genChords[i].roman}=[${v.join(',')}]`).join(' | ')}`);

    // 6. 拼 GeneratedTrack
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
