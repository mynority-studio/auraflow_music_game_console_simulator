/**
 * runPipeline — 生成管线统一入口（Phase 3 实装版）
 *
 * 当前实装范围：
 *   Stage 1  selectStyle           PRNG ×1   — 从 allowedStyleIds 池抽
 *   Stage 2  resolveBasicParams    PRNG ×4   — tonality / keyOffset / BPM / formTemplate 抽样
 *                                              段落由 FORM_POOLS[styleId] 模板实例化，
 *                                              每段 chordsHint = lengthBeats / STYLE_BEATS_PER_CHORD[styleId]
 *   Stage 3  HarmonyCore.generate  PRNG ×~M  — 真和声推演 + voicing（M 随模板段数变化）
 *   Stage 4  (skip — 等 Step 2 抽 StructureEngine 时把 FORM_POOLS 搬到 StyleConfig)
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
    RoleType, Tonality, SectionMetadata, SectionType, SectionTypeName,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { getStyleHarmonyBundle } from '../config/styles';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from './HarmonyCore';
import { layerInstruments } from './Stage5Layering';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// ============================================================
// Step 1B — 风格驱动的曲式模板池（Form Templates）
// ============================================================
//
// 设计：StyleId → 多个 FormTemplate → PRNG 抽一个 → 实例化为 SectionMetadata[]
//
// 单位：bars（小节）。实例化时乘 timeSignature[0] 得 beats，
//       再除以 STYLE_BEATS_PER_CHORD[styleId] 算出 chordsHint 注入 SectionMetadata。
//
// 设计约束（请保持）：
//   1. 模板中所有 section.bars 必须满足 bars * timeSig[0] >= 2 * beatsPerChord
//      （Cadential Hijacking 需要至少 2 个和弦位）
//   2. bars * timeSig[0] 必须是 beatsPerChord 的整数倍，
//      否则 RhythmMutator 的 "grid % stepsPerBar === 0" 契约会失败
//
// Step 2 计划：把 FORM_POOLS 搬到 StyleConfig.global.structureTemplates，
//              本文件改为调 StructureEngine.pick(style)，pipeline 回归薄调度器。

interface FormSection {
    type: SectionType;
    bars: number;       // 段落小节数
    energy: number;     // 1-10 — 喂给 DrumIdiom 决定密度 / snare gate
}
interface FormTemplate {
    id: string;         // 调试标识
    sections: FormSection[];
}

/** 每个 style 的"和弦走多快"：Pop/Jazz 每小节换一次，NeoSoul 两小节才换（深 vamp）*/
const STYLE_BEATS_PER_CHORD: Record<StyleId, number> = {
    [StyleId.ModernPop]: 4,
    [StyleId.ChillJazz]: 4,
    [StyleId.NeoSoul]:   8,
};

const FORM_POOLS: Record<StyleId, FormTemplate[]> = {
    [StyleId.ModernPop]: [
        // 标准 Pop：I → V → PC → C → V → PC → C → Br → C → O
        // 64 bars = 256 beats @ 110 BPM ≈ 2:20
        { id: 'pop-standard', sections: [
            { type: SectionType.Intro,     bars: 4, energy: 3 },
            { type: SectionType.Verse,     bars: 8, energy: 5 },
            { type: SectionType.PreChorus, bars: 4, energy: 6 },
            { type: SectionType.Chorus,    bars: 8, energy: 8 },
            { type: SectionType.Verse,     bars: 8, energy: 5 },
            { type: SectionType.PreChorus, bars: 4, energy: 6 },
            { type: SectionType.Chorus,    bars: 8, energy: 8 },
            { type: SectionType.Bridge,    bars: 8, energy: 7 },
            { type: SectionType.Chorus,    bars: 8, energy: 9 },  // 最后一遍推到 9
            { type: SectionType.Outro,     bars: 4, energy: 4 },
        ]},
        // 短版：无 Bridge，V-C-V-C 收尾
        // 40 bars = 160 beats @ 110 BPM ≈ 1:27
        { id: 'pop-short', sections: [
            { type: SectionType.Intro,  bars: 4, energy: 3 },
            { type: SectionType.Verse,  bars: 8, energy: 5 },
            { type: SectionType.Chorus, bars: 8, energy: 8 },
            { type: SectionType.Verse,  bars: 8, energy: 5 },
            { type: SectionType.Chorus, bars: 8, energy: 9 },
            { type: SectionType.Outro,  bars: 4, energy: 4 },
        ]},
    ],
    [StyleId.ChillJazz]: [
        // AABA — Verse=A, Bridge=B
        // 44 bars = 176 beats @ 100 BPM ≈ 1:46
        { id: 'jazz-aaba', sections: [
            { type: SectionType.Intro,  bars: 4, energy: 4 },
            { type: SectionType.Verse,  bars: 8, energy: 5 },  // A1
            { type: SectionType.Verse,  bars: 8, energy: 6 },  // A2（能量微推）
            { type: SectionType.Bridge, bars: 8, energy: 7 },  // B
            { type: SectionType.Verse,  bars: 8, energy: 6 },  // A3
            { type: SectionType.Outro,  bars: 4, energy: 3 },
        ]},
        // ABAC — Verse=A, Chorus=C；A 再现后用 C 替代第二个 A 作为对比尾段
        // 40 bars = 160 beats @ 100 BPM ≈ 1:36
        { id: 'jazz-abac', sections: [
            { type: SectionType.Intro,  bars: 4, energy: 4 },
            { type: SectionType.Verse,  bars: 8, energy: 5 },  // A
            { type: SectionType.Verse,  bars: 8, energy: 6 },  // A 变奏
            { type: SectionType.Verse,  bars: 8, energy: 5 },  // A 再现
            { type: SectionType.Chorus, bars: 8, energy: 7 },  // C
            { type: SectionType.Outro,  bars: 4, energy: 3 },
        ]},
    ],
    [StyleId.NeoSoul]: [
        // NeoSoul Groove：长 Verse + 短 PreChorus + 长 Chorus
        // 60 bars = 240 beats @ 85 BPM ≈ 2:50
        { id: 'neosoul-groove', sections: [
            { type: SectionType.Intro,     bars: 4,  energy: 4 },
            { type: SectionType.Verse,     bars: 16, energy: 5 },
            { type: SectionType.PreChorus, bars: 4,  energy: 6 },
            { type: SectionType.Chorus,    bars: 12, energy: 8 },
            { type: SectionType.Bridge,    bars: 8,  energy: 7 },
            { type: SectionType.Chorus,    bars: 12, energy: 9 },
            { type: SectionType.Outro,     bars: 4,  energy: 4 },
        ]},
        // Vamp Heavy：Breakdown 中段抽空 Accomp，留 bass+drums 深坑
        // 68 bars = 272 beats @ 85 BPM ≈ 3:12
        { id: 'neosoul-vamp-heavy', sections: [
            { type: SectionType.Intro,     bars: 4,  energy: 3 },
            { type: SectionType.Verse,     bars: 16, energy: 5 },
            { type: SectionType.Verse,     bars: 16, energy: 6 },
            { type: SectionType.Breakdown, bars: 8,  energy: 4 },  // bass + drums only
            { type: SectionType.Chorus,    bars: 16, energy: 8 },
            { type: SectionType.Outro,     bars: 8,  energy: 3 },
        ]},
    ],
};

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
    // Stage 2：基本参数（PRNG ×4 — tonality / keyOffset / BPM / formTemplate）
    // -----------------------------------------------------------
    // 调性池：覆盖 Major / Minor / Dorian / Mixolydian / Minor_Pentatonic
    const TONALITY_POOL: Tonality[] = [
        Tonality.Major,
        Tonality.Minor,
        Tonality.Dorian,
        Tonality.Mixolydian,
        Tonality.Minor_Pentatonic,
    ];
    const tonality = TONALITY_POOL[Math.floor(PRNGManager.next() * TONALITY_POOL.length)];

    // 调号 0~11 等概率
    const keyOffset = Math.floor(PRNGManager.next() * 12);
    const keyName = KEY_NAMES[keyOffset];
    const timeSignature: [number, number] = [4, 4];

    const [bpmLo, bpmHi] = bundle.bpmRange;
    const bpm = Math.floor(PRNGManager.nextFloat(bpmLo, bpmHi + 0.999));

    // 段落骨架：风格驱动的曲式模板 — PRNG 抽一个模板，再实例化为 SectionMetadata[]
    // 同类型段加序号区分（Verse_1 / Verse_2 / Chorus_1 / Chorus_2 ...）。
    // chordsHint 按 STYLE_BEATS_PER_CHORD[styleId] 算出注入，MacroProgressionEngine 消费。
    const formPool = FORM_POOLS[styleId];
    const template = formPool[Math.floor(PRNGManager.next() * formPool.length)];
    const beatsPerChord = STYLE_BEATS_PER_CHORD[styleId];

    const sections: SectionMetadata[] = [];
    const typeCounters: number[] = new Array(12).fill(0);  // SectionType 枚举 12 个值
    let cursor = 0;
    for (let i = 0; i < template.sections.length; i++) {
        const s = template.sections[i];
        const lengthBeats = s.bars * timeSignature[0];
        typeCounters[s.type] += 1;
        sections.push({
            name: `${SectionTypeName[s.type]}_${typeCounters[s.type]}`,
            sectionType: s.type,
            startBeat: cursor,
            endBeat: cursor + lengthBeats,
            energyLevel: s.energy,
            chordsHint: Math.max(2, Math.floor(lengthBeats / beatsPerChord)),
        });
        cursor += lengthBeats;
    }

    PRNGManager.recordSnapshot('C');

    // -----------------------------------------------------------
    // Stage 3：HarmonyCore（PRNG ×~M，M = 6 × Σ chordsHint，随模板段数变化）
    // -----------------------------------------------------------
    const harmony = HarmonyCore.generate({
        sections,
        tonality,
        harmonyRules: bundle.harmonyRules,
        voiceLeadingConfig: bundle.voiceLeading,
        // chordsPerSection 全局值不再设置 — 每个 section.chordsHint 接管。
        // Engine 内部仍保留 chordsPerSection 参数作为兜底，便于未来调试或回退。
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
