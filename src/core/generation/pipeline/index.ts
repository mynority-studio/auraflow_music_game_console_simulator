/**
 * runPipeline — 生成管线统一入口（Phase 3 实装版）
 *
 * 当前实装范围：
 *   Stage 1  selectStyle           PRNG ×1   — 从 allowedStyleIds 池抽
 *   Stage 2  resolveBasicParams    PRNG ×1   — 抽 BPM（固定 tonality=Major, keyOffset=0）
 *   Stage 3  HarmonyCore.generate  PRNG ×~80 — 真和声推演 + voicing
 *   Stage 4  (skip — 等 Phase 3.5 接 ConductorPlanner)
 *   Stage 5  layerInstruments      PRNG ×~N  — Bass(0) + AccompInst + Lead 三轨
 *
 * 输出契约：
 *   - track.chords[i].voicing       — RELATIVE 空间 voicing
 *   - track.bass / accompaniment    — RELATIVE 空间 NoteData[]（Phase 3 新增）
 *   - track.melody                  — RELATIVE 空间 NoteData[]（Phase 3 新增）
 *   - context 携带 bpm / tonality / keyOffset / style，供平台层消费
 *
 * 仍尊重的形参约束：
 *   allowedStyleIds / forcedStyleId / forcedBand / generation
 *
 * PRNG 快照点（D-5）：
 *   stateB（Stage 1 入口） / stateC（HarmonyCore 之前） / stateD（Stage 5 入口）
 */

import {
    GeneratedTrack, GenerationOptions, MusicContext,
    RoleType, Tonality, SectionMetadata, SectionType,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { getStyleHarmonyBundle } from '../config/styles';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from './HarmonyCore';
import { layerInstruments } from './Stage5Layering';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedBand?: Partial<Record<RoleType, string | null>>;
    generation?: GenerationOptions;
}

export function runPipeline(
    options: PipelineRunOptions = {},
): { track: GeneratedTrack; context: MusicContext } {
    PRNGManager.recordSnapshot('B');

    // -----------------------------------------------------------
    // Stage 1：选风格（PRNG ×1）
    // -----------------------------------------------------------
    const pool = options.forcedStyleId !== undefined
        ? [options.forcedStyleId]
        : (options.allowedStyleIds && options.allowedStyleIds.length > 0
            ? options.allowedStyleIds
            : [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]);
    const styleId = pool[Math.floor(PRNGManager.next() * pool.length)];
    const style = getStyleConfig(styleId);
    const bundle = getStyleHarmonyBundle(styleId);

    // -----------------------------------------------------------
    // Stage 2：基本参数（PRNG ×1 — BPM；其他暂硬编码）
    // -----------------------------------------------------------
    const tonality = Tonality.Major;
    const keyOffset = 0;  // 暂固定 C — 接 Stage 2 完整版后由 PRNG 抽
    const keyName = KEY_NAMES[keyOffset];
    const timeSignature: [number, number] = [4, 4];

    const [bpmLo, bpmHi] = bundle.bpmRange;
    const bpm = Math.floor(PRNGManager.nextFloat(bpmLo, bpmHi + 0.999));

    // 段落骨架（占位 — Phase 2.6 真正接 StructureEngine 时替换）：
    //   Intro 16 → Verse 16 → Chorus 16 → Outro 16  共 64 拍
    const sections: SectionMetadata[] = [
        { name: 'Intro_1',  sectionType: SectionType.Intro,  startBeat: 0,  endBeat: 16, energyLevel: 3 },
        { name: 'Verse_1',  sectionType: SectionType.Verse,  startBeat: 16, endBeat: 32, energyLevel: 5 },
        { name: 'Chorus_1', sectionType: SectionType.Chorus, startBeat: 32, endBeat: 48, energyLevel: 7 },
        { name: 'Outro_1',  sectionType: SectionType.Outro,  startBeat: 48, endBeat: 64, energyLevel: 4 },
    ];

    PRNGManager.recordSnapshot('C');

    // -----------------------------------------------------------
    // Stage 3：HarmonyCore（PRNG ×~80）
    // -----------------------------------------------------------
    const harmony = HarmonyCore.generate({
        sections,
        tonality,
        harmonyRules: bundle.harmonyRules,
        voiceLeadingConfig: bundle.voiceLeading,
        chordsPerSection: 4,
    });

    // voicings 平行索引嵌回 chord.voicing — 下游 AudioEngine / Stage 5 直接读
    for (let i = 0; i < harmony.chords.length && i < harmony.voicings.length; i++) {
        harmony.chords[i].voicing = harmony.voicings[i];
        harmony.chords[i].keyOffset = keyOffset;
    }

    PRNGManager.recordSnapshot('D');

    // -----------------------------------------------------------
    // Stage 5：layerInstruments — Bass(0) + AccompInst + Lead 三轨
    // -----------------------------------------------------------
    const stage5 = layerInstruments({
        chords: harmony.chords,
        sections,
        styleId,
        tonality,
    });

    const track: GeneratedTrack = {
        chords: harmony.chords,
        melody: stage5.melody,
        accompaniment: stage5.accompaniment,
        bass: stage5.bass,
        // K-8: drums 是 GM Drum Map 物理键位（第三空间），全程透传不加 keyOffset
        drums: stage5.drums,
        sections,
        bpm,
        key: keyName,
        keyOffset,
        tonality,
        timeSignature,
        blockIndex: 0,
        absoluteStartBeat: 0,
        hasIntro: true,
    };

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature,
        grooveDNA: [],
        style,
    };

    return { track, context };
}
