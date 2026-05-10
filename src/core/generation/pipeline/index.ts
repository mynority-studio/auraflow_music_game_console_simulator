// ============================================================
// runPipeline — 主奏定调 + 直线流水（无 Mood / 无 ConductorPlan / 无 Viterbi）
// ============================================================
// Pitch Space: RELATIVE
//   chord.root / melody.pitch / counterMelody.pitch 都是相对空间
//   Orchestrator.arrange() 是 keyOffset 唯一应用点；鼓组是绝对 GM 键位永不加偏移
//
// 流程：
//   1) Lead Dictates Global：根据 allowedStyleIds 抽 Lead 乐手，其 genre 强制成为全曲 styleId
//   2) BPM / Tonality / KeyOffset / TimeSignature：按 styleConfig 内置池抽
//   3) Sections：StructureEngine 抽曲式装配段落（baseEnergy 直透，无 mood 钳制）
//   4) Band：招募 comping 乐手；不允许 noBass 时主奏兜底坐 Comping
//   5) HarmonyCore：罗马数字池 + 子小节解析 + 高能段抢拍 → chords
//   6) GrooveEngine：鼓组先行（律动权威），回写 sec.grooveDNA
//   7) ToplineEngine：melody（消费 grooveDNA） + counterMelody
//   8) ensemble + roster 写入 context，供 Orchestrator 消费图纸
// ============================================================

import {
    GeneratedTrack,
    MusicContext,
    GenerationOptions,
    SectionMetadata,
    NoteData,
    GeneratedChord,
    Tonality,
    EnsembleDraft,
    BandRoster,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/styles/StyleRegistry';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from '../harmony/HarmonyCore';
import { ToplineEngine } from '../melody/ToplineEngine';
import { GrooveEngine } from '../composing/GrooveEngine';
import { StructureEngine } from '../composing/StructureEngine';
import { assembleActiveIdiom, getRandomLeadMusician, getRandomMusicianByPangea } from '../idioms/MusicianRegistry';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    generation?: GenerationOptions;
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function runPipeline(options: PipelineRunOptions = {}): { track: GeneratedTrack; context: MusicContext } {
    PRNGManager.recordSnapshot('B');

    // 🌟 1. 首发主奏（Lead Dictates Global）
    let allowedStyles = options.allowedStyleIds;
    if (options.forcedStyleId) allowedStyles = [options.forcedStyleId];
    const leadMusician = getRandomLeadMusician(allowedStyles, PRNGManager);

    const styleId = leadMusician.genre;
    const style = getStyleConfig(styleId);

    // --- BPM：直接从 styleConfig 抽 ---
    const bpm = PRNGManager.nextInt(style.global.bpmRange[0], style.global.bpmRange[1]);

    // --- Tonality：style.tonalityPool 加权抽 ---
    let tonality: Tonality = Tonality.Major;
    const tonalityPool = style.global.tonalityPool;
    if (tonalityPool && tonalityPool.length > 0) {
        let total = 0;
        for (let i = 0; i < tonalityPool.length; i++) total += tonalityPool[i].weight;
        if (total > 0) {
            let r = PRNGManager.nextFloat(0, total);
            for (let i = 0; i < tonalityPool.length; i++) {
                r -= tonalityPool[i].weight;
                if (r <= 0) { tonality = tonalityPool[i].tonality; break; }
            }
        }
    }

    const keyOffset = PRNGManager.nextInt(0, 11);
    const key = KEY_NAMES[keyOffset];

    // --- TimeSignature：style.timeSignaturePool 加权抽（兜底 4/4）---
    let timeSignature: [number, number] = [4, 4];
    const tsPool = style.global.timeSignaturePool;
    if (tsPool && tsPool.length > 0) {
        let tsTotal = 0;
        for (let i = 0; i < tsPool.length; i++) tsTotal += tsPool[i].weight;
        if (tsTotal > 0) {
            let r = PRNGManager.nextFloat(0, tsTotal);
            for (let i = 0; i < tsPool.length; i++) {
                r -= tsPool[i].weight;
                if (r <= 0) { timeSignature = tsPool[i].signature; break; }
            }
        }
    }

    // --- Sections：StructureEngine 抽曲式（无 mood 钳制）---
    const sections: SectionMetadata[] = StructureEngine.generateStructure(bpm, style, timeSignature);

    // --- 🌟 虚拟乐队招募 ---
    const orch = style.orchestration;
    const noDrums = orch.allowDrumless && PRNGManager.nextFloat(0, 1) < 0.3;
    const noBass = noDrums && orch.allowBassless && PRNGManager.nextFloat(0, 1) < 0.8;

    let compingMusician = getRandomMusicianByPangea('Base', PRNGManager);
    if (!noBass && leadMusician.id === compingMusician.id) {
        let attempts = 0;
        while (leadMusician.id === compingMusician.id && attempts < 5) {
            compingMusician = getRandomMusicianByPangea('Base', PRNGManager);
            attempts++;
        }
    }

    // 💡 神来之笔：无贝斯独奏模式下，主奏强行包揽伴奏位，心智统一！
    if (noBass) {
        compingMusician = leadMusician;
    }

    const roster: BandRoster = {
        lead: leadMusician,
        comping: compingMusician,
    };

    const pickInst = (pool: string[]): string => pool && pool.length > 0 ? pool[PRNGManager.nextInt(0, pool.length - 1)] : 'Acoustic_Grand';

    const ensemble: EnsembleDraft = {
        melodySound: leadMusician.defaultSound,
        chordSound: compingMusician.defaultSound,
        bassSound: noBass ? compingMusician.defaultSound : pickInst(orch.bassInstruments.length > 0 ? orch.bassInstruments : ['Acoustic_Bass']),
        drumSound: noDrums ? null : pickInst(orch.drumInstruments.length > 0 ? orch.drumInstruments : ['Standard_DrumKit']),
        secondaryMelodySound: null,
        counterMelodySound: null,
        roster,
    };

    // 图纸装配（Pangea 基底 + Personnel 特质）
    const melodyIdiom = assembleActiveIdiom(roster.lead, 'Lead');
    const counterMelodyIdiom = melodyIdiom; // 副旋律兜底（暂未启用独立副旋律乐手）

    // --- 和声：HarmonyCore 罗马数字池 + 子小节解析 + 高能段抢拍 ---
    const chords: GeneratedChord[] = HarmonyCore.generateHarmonyTimeline(sections, style, tonality, keyOffset, timeSignature);

    // --- 鼓组先行（律动权威）→ 回写 sec.grooveDNA ---
    const drums: NoteData[] = GrooveEngine.generateDrums(sections, style, timeSignature);

    // --- 主旋律：消费 sec.grooveDNA ---
    const melody: NoteData[] = ToplineEngine.generateMelody(chords, tonality, melodyIdiom, sections, style, timeSignature);

    // --- 副旋律：与 melody 同源 chords ---
    const counterMelody: NoteData[] = ToplineEngine.generateCounterMelody(chords, tonality, counterMelodyIdiom);

    const track: GeneratedTrack = {
        chords,
        melody,
        counterMelody,
        drums,
        sections,
        bpm,
        key,
        keyOffset,
        tonality,
        timeSignature,
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: true,
        preSelectedPalette: ensemble,
    };

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature,
        grooveDNA: [],
        style,
        ensemble,
    };

    return { track, context };
}
