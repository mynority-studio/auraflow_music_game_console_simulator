/**
 * runPipeline — 生成管线统一入口(C.2 永久切到 mg 路径)
 *
 * 当前实装范围(C.2 后):
 *   Stage 1  selectStyle           PRNG ×1   — 从 allowedStyleIds 池抽
 *   Stage 2  resolveBasicParams    PRNG ×4   — tonality / keyOffset / BPM / formTemplate 抽样
 *   Stage 3  MgEngineFacade        PRNG ×0   — mg 接管钢琴和声 + 旋律推演(PRNG 隔离子流)
 *   Stage 4  (C.4 待做)— bass / drums / atmosphere 接 mg chord
 *   Stage 5  (C.4 待做)— Realizer 渲染 bass / drums / atmosphere 轨
 *
 * 输出契约:
 *   - track.chords             — mg ChordDef[] 经 MgChordAdapter 转换的 GeneratedChord[]
 *   - track.melody             — [](C.1 设计:melody 与 chord 合并到 accompaniment 走 PIANO_RH)
 *   - track.accompaniment      — mg melody + chordTexture 合并(一架钢琴的演绎)
 *   - track.bass/drums/atmosphere — []  (C.4 待接和声后填充)
 *   - context 携带 bpm / tonality / keyOffset / style / gmProgramOverrides
 *
 * 仍尊重的形参约束:
 *   allowedStyleIds / forcedStyleId / forcedBand / forcedGmPrograms / generation
 *
 * PRNG 快照点(D-5):
 *   stateB(Stage 1 入口) / stateC(Stage 3 前) / stateD(Stage 5 前)
 *
 * PRNG 隔离锚点(plan §2 决策 3):
 *   mg 用自己的 Random(`${PRNGManager.state}::mg`)— 跟 PRNGManager 完全独立。
 *   Stage 1+2 仍消费 PRNGManager,Stage 3+ 不消费(mg facade 内部用 mg Random)。
 *   Phase 3 壳化时合并到 PRNGManager.fork API。
 */

import {
    GeneratedTrack, GenerationOptions, MusicContext, NoteData,
    BandRole, BandRoster, Tonality, SectionMetadata, SectionType, SectionTypeName,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { getStyleHarmonyBundle } from '../config/styles';
import { PRNGManager } from '../../utils/PRNG';
import { getMusicianById } from '../idioms/MusicianRegistry';
import { bandRoleToTrackKeys, GmProgramTrackKey } from '../data/GMSoundMap';
import { MgEngineFacade } from './MgEngineFacade';
import { chordDefsToGeneratedChords, noteEventsToNoteData } from './MgChordAdapter';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedBand?: Partial<Record<BandRole, string | null>>;
    /**
     * B3：UI 端 per-role GM 程式号覆盖（0~127）。
     *   优先级：forcedGmPrograms > musician.gmProgramOverride > (无,走 MidiConverter 文件级默认)
     * 写进 context.gmProgramOverrides → AbsoluteTransposer 透传 → MidiConverter 消费。
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
            : [StyleId.POP, StyleId.JAZZ, StyleId.RNB]);
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

    // ============================================================
    // Stage 3 — MgEngineFacade(C.2 永久切 mg 路径)
    // ============================================================
    // 设计哲学(plan §2 决策 3 PRNG 隔离):
    //   - mg 用自己的 Random(`${PRNGManager.state}::mg`)— 与 PRNGManager 完全隔离
    //   - mg facade 内部 0 次 PRNGManager.next() 调用 → D-5 保证
    //   - Phase 3 壳化时改用 PRNGManager.fork('mg') API
    //
    // 验收锚点:同 seed → 听感 = melodygenerative-standalone(决策 3 隔离的保证)
    const mgSeed = PRNGManager.getState();
    const mgResult = MgEngineFacade.generate({
        seed: mgSeed,
        styleId,
        keyRootPc: keyOffset,
        isMinor: tonality === Tonality.Minor,
    });

    // ChordDef[] → GeneratedChord[](最简 adapter,Phase 2/C.4 精化)
    const mgChords = chordDefsToGeneratedChords(mgResult.chords);
    for (let i = 0; i < mgChords.length; i++) {
        mgChords[i].keyOffset = keyOffset;
    }

    // NoteEvent[] → NoteData[]:mg melody + chord 合并到 accompaniment(走 PIANO_RH)
    //
    // 关键设计:mg 在 standalone 是单一 Salamander piano sampler,所有声音同音色 + 同混响。
    // auraflow MidiConverter 给 melody(GM=1 Bright + vol=122)和 pianoRH(GM=0 Grand +
    // vol=102)不同 mix → 听感"两架钢琴"。修复:统一走 PIANO_RH channel(Grand Acoustic),
    // 保留 mg 内部 velocity 比例 → "一架钢琴演奏旋律 + 和声"(mg divisi 哲学)。
    const mgMelodyNotes = noteEventsToNoteData(mgResult.melody);
    const mgChordNotes = noteEventsToNoteData(mgResult.chordTexture);
    const mgPianoUnified: NoteData[] = mgMelodyNotes.concat(mgChordNotes);
    mgPianoUnified.sort((a, b) => a.onset - b.onset);

    PRNGManager.recordSnapshot('D');

    // ============================================================
    // Stage 4 — Roster + Band 系统(乐手卡片 / GM 程式 override 准备)
    // ============================================================
    // C.4 待做:用 roster 决定哪些 bass/drums/atmosphere 乐手在场,接 mg chord 渲染。
    // 当前 C.2 阶段:roster 构造完成,但 bass/drums/atmosphere 仍输出空数组。
    const roster: BandRoster = buildDefaultRoster(options.forcedBand);

    // ============================================================
    // Stage 5 — 输出(C.4 待接 bass/drums/atmosphere 渲染)
    // ============================================================
    const track: GeneratedTrack = {
        chords: mgChords,
        melody: [],                       // 设计:统一到 accompaniment 走 Grand Acoustic
        accompaniment: mgPianoUnified,    // mg melody + chord stab 合并(一架钢琴)
        bass: [],                          // C.4 接 BassRealizer + mg chord
        drums: [],                         // C.4 接 DrumRealizer
        atmosphere: [],                    // C.4 接 AtmosphereRealizer
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
