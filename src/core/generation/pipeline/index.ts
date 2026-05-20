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
 *   Stage 5  conduct      PRNG ×~N  — Bass(0) + AccompInst + Lead 三轨
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
    GeneratedTrack, GenerationOptions, MusicContext, NoteData,
    BandRole, BandRoster, Tonality, SectionMetadata, SectionType, SectionTypeName,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { getStyleHarmonyBundle } from '../config/styles';
import { PRNGManager } from '../../utils/PRNG';
import { HarmonyCore } from './HarmonyCore';
import { conduct } from './Conductor';
import { CastingEngine } from './CastingEngine';
import { PassingChordEngine } from './PassingChordEngine';
import { getMusicianById } from '../idioms/MusicianRegistry';
import { bandRoleToTrackKeys, GmProgramTrackKey } from '../data/GMSoundMap';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedBand?: Partial<Record<BandRole, string | null>>;
    /**
     * B3：UI 端 per-role GM 程式号覆盖（0~127）。
     *   优先级：forcedGmPrograms > musician.gmProgramOverride > (无,走 MidiConverter 文件级默认)
     * 写进 context.gmProgramOverrides → Orchestrator 透传 → MidiConverter 消费。
     */
    forcedGmPrograms?: Partial<Record<BandRole, number>>;
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
    // 🌟 修复跑调1：全局调性绑定大调关系，防全局音阶跑偏
    const TONALITY_POOL: Tonality[] = [
        Tonality.Major,
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
    // chordsHint 按 bundle.beatsPerChord 算出注入，MacroProgressionEngine 消费。
    const formPool = bundle.structureTemplates;
    const template = formPool[Math.floor(PRNGManager.next() * formPool.length)];
    const beatsPerChord = bundle.beatsPerChord;

    const sections: SectionMetadata[] = [];
    const typeCounters: number[] = new Array(12).fill(0);  // SectionType 枚举 12 个值
    let cursor = 0;
    for (let i = 0; i < template.sections.length; i++) {
        const s = template.sections[i];
        const lengthBeats = s.bars * timeSignature[0];
        typeCounters[s.type!] += 1;
        sections.push({
            name: `${SectionTypeName[s.type!]}_${typeCounters[s.type!]}`,
            sectionType: s.type!,
            startBeat: cursor,
            endBeat: cursor + lengthBeats,
            energyLevel: s.energy,
            chordsHint: Math.max(2, Math.floor(lengthBeats / beatsPerChord)),
        });
        cursor += lengthBeats;
    }

    // ============================================================
    // 能量断崖缓冲 (Energy Cliff Buffer)
    // 若下一段能量较本段暴涨 (>= 4)，强制将当前段转为 BuildUp。
    // 联动 Stage5 的 ConductorMask (切除主旋律) 与 DrumIdiom (滚奏加花)。
    // ============================================================
    for (let i = 0; i < sections.length - 1; i++) {
        const currentEnergy = sections[i].energyLevel;
        const nextEnergy = sections[i + 1].energyLevel;
        if (nextEnergy - currentEnergy >= 4) {
            sections[i].sectionType = SectionType.BuildUp;
        }
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
        // V4.2c — 注入风格进行池（70% 概率走 pool 路径 + 跳过 4 道变异门）
        progressionPool: style.harmony,
        // chordsPerSection 全局值不再设置 — 每个 section.chordsHint 接管。
    });

    // voicings 平行索引嵌回 chord.voicing — 下游 AudioEngine / Stage 5 直接读
    for (let i = 0; i < harmony.chords.length && i < harmony.voicings.length; i++) {
        harmony.chords[i].voicing = harmony.voicings[i];
        harmony.chords[i].keyOffset = keyOffset;
    }

    // -----------------------------------------------------------
    // Stage 3.5：PassingChordEngine — 在 phrase boundary 插入经过和弦
    //   与 MacroProgression 4 道变异门互补（替换 vs 插入）
    //   新和弦无 voicing —— 下游 voicer 用 root + quality 即兴展开
    // -----------------------------------------------------------
    const passingProb = style.passingChordProb ?? 0.3;
    const chromaticProb = style.chromaticPassingProb ?? 0.3;
    if (passingProb > 0) {
        harmony.chords = PassingChordEngine.insert({
            chords: harmony.chords,
            tonality,
            keyOffset,
            passingChordProb: passingProb,
            chromaticPassingProb: chromaticProb,
        });
        // 新插入的 passing chord 缺 voicing —— 用 chord-tone 临时填充（让 Stage5 渲染可继续）
        for (let i = 0; i < harmony.chords.length; i++) {
            if (!harmony.chords[i].voicing || harmony.chords[i].voicing!.length === 0) {
                harmony.chords[i].voicing = HarmonyCore.computeFallbackVoicing(harmony.chords[i]);
                harmony.chords[i].keyOffset = keyOffset;
            }
        }
    }

    PRNGManager.recordSnapshot('D');

    // -----------------------------------------------------------
    // Stage 4.5:CastingEngine — 编曲决策(PRNG ×0)
    //   消费 roster + sections + styleId,输出 BandPlan(每段每职能演奏决策矩阵)。
    //   V1:固定 4 人乐队(alex_piano / frank_bass / dave_drums / nina_pad),
    //       不处理 forcedBand / 双钢琴 / 角色升降。
    // -----------------------------------------------------------
    const roster: BandRoster = buildDefaultRoster(options.forcedBand);
    const bandPlan = CastingEngine.plan({
        roster,
        sections,
        styleId,
        tonality,
        timeSignature,
        swingRatio: style.swingRatio,  // V5.2 从 styleConfig 透传
        bpm,                            // Sub-Phase 3：MoodRouter 决策维度
    });

    // -----------------------------------------------------------
    // Stage 5：conduct — Bass + AccompInst + Lead + Atmosphere 四轨（drums 单独）
    // -----------------------------------------------------------
    const stage5 = conduct({
        chords: harmony.chords,
        sections,
        styleId,
        tonality,
        timeSignature,
        userMotif: options.generation?.processedUserMotif as NoteData[] | undefined,
        bandPlan,
    });

    const track: GeneratedTrack = {
        chords: harmony.chords,
        melody: stage5.melody,
        accompaniment: stage5.accompaniment,
        bass: stage5.bass,
        // K-8: drums 是 GM Drum Map 物理键位（第三空间），全程透传不加 keyOffset
        drums: stage5.drums,
        atmosphere: stage5.atmosphere,
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

    // -----------------------------------------------------------
    // B3：构造 gmProgramOverrides — 仅在"显式"选择时写入
    //
    //   写入条件（任一命中即写）：
    //     1. forcedGmPrograms[role] 提供（UI 显式选 instrument）  → 优先级最高
    //     2. roster[role].gmProgramOverride 提供（musician card 内置 override）
    //
    //   **不写入** 条件：
    //     - 用户什么都没选 + musician 也没设 gmProgramOverride
    //       → trackKey 不出现在 overrides → MidiConverter 走 GM_PROGRAM_* 文件级默认
    //       → 保 V5.x melody=1(Bright) / pianoRH=0(Grand) 等"lead vs comping 音色对比"行为零回归
    //
    //   设计原因：默认 GM_PROGRAM_MELODY=1(Bright Acoustic) vs GM_PROGRAM_PIANO_RH=0(Grand)
    //   是 MidiConverter 内的"双钢琴音色分离"策略；如果一律从 musician.defaultSound 推导,
    //   同一张 alex_piano 卡会让两个通道都变成 0(Grand)，损失辨识度。
    //
    //   defaultSound → GM 的映射仅在 B2 UI 下拉构造"family options"时使用,不在此处自动推导。
    // -----------------------------------------------------------
    const gmProgramOverrides: MusicContext['gmProgramOverrides'] = {};
    const rosterByRole: { [r in BandRole]?: typeof roster.mainInst } = {
        [BandRole.MainInst]:   roster.mainInst,
        [BandRole.Accomp]:     roster.accomp,
        [BandRole.Bass]:       roster.bass,
        [BandRole.Drums]:      roster.drums,
        [BandRole.Atmosphere]: roster.atmosphere,
    };
    const ROLES_TO_MAP: BandRole[] = [
        BandRole.MainInst, BandRole.Accomp, BandRole.Bass, BandRole.Drums, BandRole.Atmosphere,
    ];
    for (let r = 0; r < ROLES_TO_MAP.length; r++) {
        const role = ROLES_TO_MAP[r];
        const musician = rosterByRole[role];
        if (musician === null || musician === undefined) continue;
        const trackKeys = bandRoleToTrackKeys(role);
        if (trackKeys.length === 0) continue;

        // 仅"显式"选择时写 override
        const forcedGm = options.forcedGmPrograms?.[role];
        let gm: number | undefined;
        if (forcedGm !== undefined) gm = forcedGm;
        else if (musician.gmProgramOverride !== undefined) gm = musician.gmProgramOverride;
        else continue;  // 无显式选择 → 不写入 → MidiConverter 走文件级默认

        for (let k = 0; k < trackKeys.length; k++) {
            const key: GmProgramTrackKey = trackKeys[k];
            (gmProgramOverrides as Record<string, number>)[key] = gm;
        }
    }

    const context: MusicContext = {
        keyOffset,
        tonality,
        bpm,
        timeSignature,
        grooveDNA: [],
        style,
        gmProgramOverrides,
    };

    return { track, context };
}

// ============================================================
// 默认 Roster 构造（V1 MVP 固定 4 人乐队）
// ============================================================
//
// V1：直接装载 MUSICIAN_POOL 里的 4 张 MVP 卡牌。
// forcedBand 可按 BandRole 覆盖单个槽位（UI BandSelection 下拉传入）。
// V2+：按 styleId 做"风格 × 乐手"匹配度评分 + PRNG 随机抽取，支持双钢琴。
function buildDefaultRoster(
    forcedBand?: Partial<Record<BandRole, string | null>>,
): BandRoster {
    const pickOrDefault = (role: BandRole, defaultId: string) => {
        const forcedId = forcedBand?.[role];
        if (forcedId === null) return null;  // UI 显式置空
        if (typeof forcedId === 'string') return getMusicianById(forcedId) ?? null;
        return getMusicianById(defaultId) ?? null;
    };

    return {
        mainInst:   pickOrDefault(BandRole.MainInst,   'alex_piano'),
        accomp:     pickOrDefault(BandRole.Accomp,     'alex_piano'),
        bass:       pickOrDefault(BandRole.Bass,       'frank_bass'),
        drums:      pickOrDefault(BandRole.Drums,      'dave_drums'),
        atmosphere: pickOrDefault(BandRole.Atmosphere, 'nina_pad'),
    };
}
