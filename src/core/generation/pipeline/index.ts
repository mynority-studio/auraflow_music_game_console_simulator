// ============================================================
// runPipeline — Phase 5 入口（Mood 系统 + Conductor + 副旋律 + 调性适配）
// ============================================================
// Pitch Space: RELATIVE（chord.root / melody.pitch / counterMelody.pitch 都是相对空间，
// Orchestrator.arrange() 是 keyOffset 唯一应用点；鼓组是绝对 GM 键位，永不加偏移）
//
// Phase 5 新增：
//   - Mood 系统：抽 mood → 调制 BPM、tonality 偏好、energy cap
//   - HarmonyCore 接收 tonality + keyOffset：小调适配 + chord.keyOffset 给 UI
//   - ToplineEngine.generateCounterMelody：副旋律
//   - ConductorPlanner.plan：段落级 silent/support 配器计划
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
import { MoodId, MoodRegistry } from '../config/MoodFlags';
import { getStyleConfig } from '../config/styles/StyleRegistry';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from '../harmony/HarmonyCore';
import { ViterbiChordSelector } from '../harmony/ViterbiChordSelector';
import { ToplineEngine } from '../melody/ToplineEngine';
import { GrooveEngine } from '../composing/GrooveEngine';
import { StructureEngine } from '../composing/StructureEngine';
import { ConductorPlanner } from './ConductorPlanner';
import { assembleActiveIdiom, getRandomLeadMusician, getRandomMusicianByPangea } from '../idioms/MusicianRegistry';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedMoodId?: MoodId;
    generation?: GenerationOptions;
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function runPipeline(options: PipelineRunOptions = {}): { track: GeneratedTrack; context: MusicContext } {
    PRNGManager.recordSnapshot('B');

    // 🌟 1. 首发主奏 (Lead Dictates Global)
    // 根据外部传入的 allowed 约束筛选合法主奏；其 genre 强制决定全曲风格。
    let allowedStyles = options.allowedStyleIds;
    if (options.forcedStyleId) allowedStyles = [options.forcedStyleId];
    const leadMusician = getRandomLeadMusician(allowedStyles, PRNGManager);

    // 💡 架构核心：主奏乐手擅长的曲风，直接强制决定当前全曲的基调！
    const styleId = leadMusician.genre;
    const style = getStyleConfig(styleId);

    // --- Mood：抽情绪 ---
    const moodIds: MoodId[] = [
        MoodId.Neutral, MoodId.Chill, MoodId.Melancholic,
        MoodId.Energetic, MoodId.Aggressive, MoodId.Euphoric,
    ];
    const moodId = options.forcedMoodId ?? moodIds[PRNGManager.nextInt(0, moodIds.length - 1)];
    const mood = MoodRegistry[moodId];

    // --- BPM：风格基准 × mood 乘数 ---
    let bpm = PRNGManager.nextInt(style.global.bpmRange[0], style.global.bpmRange[1]);
    bpm = Math.round(bpm * PRNGManager.nextFloat(mood.bpmMultiplier[0], mood.bpmMultiplier[1]));

    // --- Tonality：mood 偏好 > style 兜底 ---
    let tonality: Tonality = Tonality.Major;
    if (mood.tonalityBias && mood.tonalityBias.length > 0) {
        tonality = mood.tonalityBias[PRNGManager.nextInt(0, mood.tonalityBias.length - 1)].tonality;
    } else {
        const tonalityPool = style.global.tonalityPool;
        tonality = tonalityPool[PRNGManager.nextInt(0, tonalityPool.length - 1)].tonality;
    }

    const keyOffset = PRNGManager.nextInt(0, 11);
    const key = KEY_NAMES[keyOffset];

    // --- TimeSignature：从 style.global.timeSignaturePool 加权抽（兜底 4/4）---
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

    // --- Sections：StructureEngine 抽 form + mood.energyCap 钳制能量 ---
    const sections: SectionMetadata[] = StructureEngine.generateStructure(bpm, style, mood, timeSignature);

    // --- 🌟 虚拟乐队前置：招募入座 (Virtual Band Drafter) ---
    const orch = style.orchestration;
    const isQuietMood = mood.energyCap[1] <= 5;
    const noDrums = orch.allowDrumless && (isQuietMood || PRNGManager.nextFloat(0, 1) < 0.3);
    const noBass = noDrums && orch.allowBassless && PRNGManager.nextFloat(0, 1) < 0.8;

    // 2. 招募伴奏入座（尽量错开主伴奏乐手，让两个智能体的微操特质拉开层次）
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

    // 3. 构建供 Audio 引擎和播放器使用的 EnsembleDraft（音色名仍然必需）
    const ensemble: EnsembleDraft = {
        melodySound: leadMusician.defaultSound,
        chordSound: compingMusician.defaultSound,
        bassSound: noBass ? compingMusician.defaultSound : pickInst(orch.bassInstruments.length > 0 ? orch.bassInstruments : ['Acoustic_Bass']),
        drumSound: noDrums ? null : pickInst(orch.drumInstruments.length > 0 ? orch.drumInstruments : ['Standard_DrumKit']),
        secondaryMelodySound: null,
        counterMelodySound: null,
        roster, // 🌟 挂载花名册：Orchestrator 直接消费
    };

    // 4. 图纸融合：引擎彻底解耦，只看最终加工出来的图纸参数
    const melodyIdiom = assembleActiveIdiom(roster.lead, 'Lead');
    const counterMelodyIdiom = melodyIdiom; // 副旋律兜底（当前未启用副旋律）

    // --- Viterbi 前置双阶段和声（重构 #2）---
    // 1) 骨架和弦：HarmonyCore 用 StyleConfig 罗马数字池产出基本进行
    const basicChords: GeneratedChord[] = HarmonyCore.generateHarmonyTimeline(sections, style, tonality, keyOffset, timeSignature);

    // 2) 影子骨架：每和弦 1 个强拍锚点（root/3rd/5th 三选一），仅供 Viterbi 评分用
    const skeleton: NoteData[] = ToplineEngine.generateSkeleton(basicChords);

    // 3) Viterbi 前置：基于骨架按段重配，得 finalChords
    //    按段独立调用 reharmonize，每段传入自己的 tensionMultiplier：
    //    - 第一段 Chorus：tension=0.2（含蓄铺陈）
    //    - 末段 Chorus / Bridge：tension=1.0（开始秀操作，bVI/bIII/半音平滑全开）
    //    - 其他段：tension=0.5（中等张力）
    let finalChords: GeneratedChord[] = basicChords;
    if (style.useViterbiHarmony) {
        finalChords = reharmonizePerSection(basicChords, skeleton, tonality, sections);
    }

    // 4) 鼓组先行：作为律动权威，鼓组打完后回写 sections[].grooveDNA，让旋律消费
    const drums: NoteData[] = GrooveEngine.generateDrums(sections, mood, style, timeSignature);

    // 5) 主旋律：直接基于 finalChords 生成；ToplineEngine 读 sections[].grooveDNA 让节奏与鼓共振
    const melody: NoteData[] = ToplineEngine.generateMelody(finalChords, tonality, mood, melodyIdiom, sections, style, timeSignature);

    // 6) 副旋律：与 melody 同源（finalChords），保证两条旋律线协和度一致
    const counterMelody: NoteData[] = ToplineEngine.generateCounterMelody(finalChords, tonality, mood, counterMelodyIdiom);

    // 7) 指挥层：基于已固定的段落生成 silent/support/focus 计划
    const conductorPlan = ConductorPlanner.plan(sections);

    const track: GeneratedTrack = {
        chords: finalChords,
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
        moodId,
        style,
        conductorPlan,
        ensemble,
    };

    return { track, context };
}

// --------------------------------------------------------
// 按段独立 Viterbi 重配（Phase 3 张力门入口）
// --------------------------------------------------------
// 每段独立调用 reharmonize 而非全曲一次性，原因：
//   - tensionMultiplier 是**段落级**调制（首副歌=0.2 vs 末副歌=1.0）
//   - Viterbi 不消耗 PRNG（纯函数），分段调用不破坏全管线确定性序列
//   - reharmonize 内部按 chord.startBeat 切旋律，传入全曲 melody 安全
//
// 注意：sections 必须覆盖所有 basicChords 的时间轴；不在任何 sec 内的 chord 会丢失。
// 这是与 StructureEngine 的契约 —— 段间不能有时间间隙。
const SEC_EPS = 0.001;

function computeSectionTension(
    sec: SectionMetadata,
    sectionIdx: number,
    firstChorusIdx: number,
    lastChorusIdx: number,
    chorusCount: number,
): number {
    if (sec.name === 'Bridge') return 1.0;
    if (sec.name === 'Chorus') {
        // 末副歌（且总共有 ≥2 段 Chorus）→ tension=1.0
        if (chorusCount >= 2 && sectionIdx === lastChorusIdx) return 1.0;
        // 第一段 Chorus → tension=0.2
        if (sectionIdx === firstChorusIdx) return 0.2;
    }
    return 0.5;
}

function reharmonizePerSection(
    basicChords: GeneratedChord[],
    melody: NoteData[],
    tonality: Tonality,
    sections: SectionMetadata[],
): GeneratedChord[] {
    let firstChorusIdx = -1;
    let lastChorusIdx = -1;
    let chorusCount = 0;
    for (let i = 0; i < sections.length; i++) {
        if (sections[i].name === 'Chorus') {
            if (firstChorusIdx === -1) firstChorusIdx = i;
            lastChorusIdx = i;
            chorusCount++;
        }
    }

    const result: GeneratedChord[] = [];
    for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];

        const secChords: GeneratedChord[] = [];
        for (let c = 0; c < basicChords.length; c++) {
            const ch = basicChords[c];
            if (ch.startBeat >= sec.startBeat - SEC_EPS && ch.startBeat < sec.endBeat - SEC_EPS) {
                secChords.push(ch);
            }
        }
        if (secChords.length === 0) continue;

        const tension = computeSectionTension(sec, s, firstChorusIdx, lastChorusIdx, chorusCount);
        const reharm = ViterbiChordSelector.reharmonize(secChords, melody, tonality, tension);
        for (let i = 0; i < reharm.length; i++) result.push(reharm[i]);
    }
    return result;
}
