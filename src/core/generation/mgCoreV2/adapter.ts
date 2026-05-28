// ============================================================
// mgCoreV2/adapter.ts — Phase 3 kernel synthesis 接管 harmony
// ============================================================
//
// V2 第三阶段:
//   - 复用 mg 的 progression generation(harmony 进行 / mode / voicing
//     都用 mg 算出来,不重做)
//   - 复用 mg 的 melody events(主旋律 pass-through)
//   - **替换 chord + bass 渲染**:不再用 mg 的 50 个 applyTexture switch,
//     改成 4-axis StyleVector → 6-kernel 合成器
//
// A/B 听感对比:V1 vs V2 现在差异**只在 harmony(chord + bass)**,melody
// 完全相同,适合听感聚焦评估"维度合成思路"是否成立。
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
import { STYLE_VECTORS } from './styleVector';
import { pickKernelsForBar, type KernelContext } from './kernels';

export interface MgV2RunOptions {
    seed?: string;
    style?: StyleName;
    key?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers(从 mgEngine/adapter.ts 复用 / 简化)
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

/** mg NoteEvent → 我们的 NoteData(velocity 127→[0,1],pitch 透传 absolute) */
function noteEventToData(events: NoteEvent[], filterPart: NoteEvent['part']): NoteData[] {
    const out: NoteData[] = [];
    for (const e of events) {
        if (e.part !== filterPart) continue;
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
// V2 main
// ─────────────────────────────────────────────────────────────────

export function runMgCoreV2(opts: MgV2RunOptions = {}): {
    track: GeneratedTrack;
    context: MusicContext;
} {
    const seed = opts.seed ?? 'pop_default';
    const style: StyleName = opts.style ?? 'POP';
    const key = opts.key ?? 'C';

    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));

    // 1. mg progression + arrangement(我们要 melody 和 chord 列表)
    const genChords = engine.generateProgressions(config);
    const timeline = engine.generateArrangement(genChords, config);

    // 2. Melody pass-through(V1/V2 melody 完全一致)
    const melody = noteEventToData(timeline.events, 'melody');

    // 3. **替换 chord + bass**:多 kernel recipe + phrase 变奏(Phase 3.H)
    //    每 bar 按 phrase position(0=起首/3=末)切换 base / base+embellish / base+fill
    const vector = STYLE_VECTORS[style];
    const totalBars = genChords.length;

    const kernelEvents: NoteEvent[] = [];
    let beatAcc = 0;
    const recipeLog: string[] = [];  // 记录每 bar 用了什么 recipe(调试用)
    for (let i = 0; i < genChords.length; i++) {
        const chord = genChords[i];
        const kernels = pickKernelsForBar(style, i, totalBars);
        const ctx: KernelContext = {
            startBeat: beatAcc,
            duration: chord.duration,
            vector,
            barIndex: i,
            totalBars,
        };
        for (const kernel of kernels) {
            kernelEvents.push(...kernel(chord, ctx));
        }
        recipeLog.push(`bar${i}=${kernels.map(k => k.name).join('+')}`);
        beatAcc += chord.duration;
    }

    const accompaniment: NoteData[] = kernelEvents
        .filter(e => e.part === 'chord')
        .map(e => ({
            pitch: e.noteNumber,
            onset: e.time,
            duration: e.duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        }));

    const bass: NoteData[] = kernelEvents
        .filter(e => e.part === 'bass')
        .map(e => ({
            pitch: e.noteNumber,
            onset: e.time,
            duration: e.duration,
            velocity: Math.max(0, Math.min(1, e.velocity / 127)),
        }));

    // Diagnostic — 输出每 bar 用的 kernel 组合,验证 phrase 变奏
    console.log(`[mgCoreV2] seed=${seed} style=${style} key=${key} | vector=${JSON.stringify(vector)} | events: mel=${melody.length} chord=${accompaniment.length} bass=${bass.length}`);
    console.log(`[mgCoreV2] bar recipes: ${recipeLog.join(' | ')}`);

    // 4. 拼 GeneratedTrack
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
