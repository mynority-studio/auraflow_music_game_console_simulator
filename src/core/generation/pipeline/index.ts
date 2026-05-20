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
    ActiveMusician, Musician,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleConfig } from '../config/StyleRegistry';
import { getStyleHarmonyBundle, getStyleStage5Bundle } from '../config/styles';
import { PRNGManager } from '../../utils/PRNG';
import { getMusicianById } from '../idioms/MusicianRegistry';
import { bandRoleToTrackKeys, GmProgramTrackKey } from '../data/GMSoundMap';
import { MgEngineFacade } from './MgEngineFacade';
import { chordDefsToGeneratedChords, noteEventsToNoteData } from './MgChordAdapter';
import { CurveWeatherSampler } from './CurveWeatherSampler';
import type { RenderContext } from '../ir/RenderContext';
import { BassRealizer } from '../realizers/BassRealizer';
import { DrumRealizer } from '../realizers/DrumRealizer';
import { AtmosphereRealizer } from '../realizers/AtmosphereRealizer';
import { modulateMgPianoByWeather } from './MgPianoWeatherModulator';

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

    // ============================================================
    // C.5 timing 对齐 — sections 总长截短到 ≤ mg 总长
    // ============================================================
    // 问题:mg styleDictionary.recommendedBars(POP/JAZZ=16 / BLUES=12)固定整曲长度,
    // 但 auraflow structureTemplates 总长可能远大于(如 POP standard 64 bars)。
    // 不修复 → 后半段 sections 没钢琴 → bass/drums/atmosphere 仍渲染但听感空洞。
    //
    // 修复:截短 sections 到 ≤ mg 实际生成总长(以最后一个 mg chord.endBeat 为准),
    // sections 内 partial-section 也按比例 clip。
    const mgTotalBeats = mgChords.length > 0
        ? mgChords[mgChords.length - 1].endBeat
        : sections.reduce((acc, s) => Math.max(acc, s.endBeat), 0);
    for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].startBeat >= mgTotalBeats) {
            sections.splice(i, 1);  // 整段超出 → 删除
        } else if (sections[i].endBeat > mgTotalBeats) {
            sections[i].endBeat = mgTotalBeats;  // 部分超出 → clip
        }
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
    // Stage 4 — Roster / Band / Weather(C.4 — auraflow 护城河接入)
    // ============================================================
    // 设计:mg 接管钢琴和声,auraflow 用乐手 / band / weather 系统装饰
    //   bass / drums / atmosphere。所有 Realizer 接收 mg 输出的 chord 进行 +
    //   auraflow 自己的 weather 调制。
    const roster: BandRoster = buildDefaultRoster(options.forcedBand);
    const activeMusicians: ActiveMusician[] = buildActiveMusicians(roster);

    // CurveWeatherSampler:per-section 5 维气象 anchor(K/T/S/R/G)+ 80/20 插值。
    // 各 Realizer 通过 context.weather.at(beat) 获取该 beat 的瞬时气象,调制渲染参数。
    const weatherSampler = new CurveWeatherSampler(sections, styleId, activeMusicians);
    const renderContext: RenderContext = {
        weather: weatherSampler,
        lookaheadLimit: 9999,           // 离线模式 — Idiom 不会真用满
        prevState: undefined,
    };

    // Stage 5 bundle — drum grid / atmosphere idiom 等
    const stage5Bundle = getStyleStage5Bundle(styleId);

    // ============================================================
    // Stage 5 — 渲染 bass / drums / atmosphere 三轨(钢琴已由 mg 接管)
    // ============================================================
    // 用 RELATIVE 空间的 mgChords 作为输入,Realizer 渲染 RELATIVE NoteData[]。
    // 下游 AbsoluteTransposer.arrange 加 keyOffset 转 ABSOLUTE(K-2 铁律唯一加点)。

    // BASS — 取 roster.bass 的 persona 渲染 walking / pattern bass
    let bassNotes: NoteData[] = [];
    if (roster.bass !== null && roster.bass !== undefined) {
        bassNotes = BassRealizer.realize({
            chords: mgChords,
            styleId,
            tonality,
            persona: roster.bass.persona,
            context: renderContext,
        });
    }

    // DRUMS — DrumGrid 来自 stage5Bundle(风格驱动),sections 决定能量 + section type
    let drumsNotes: NoteData[] = [];
    if (roster.drums !== null && roster.drums !== undefined) {
        drumsNotes = DrumRealizer.realize({
            sections,
            grid: stage5Bundle.drum,
            context: renderContext,
        });
    }

    // ATMOSPHERE — pad / strings 长音 voicing,intensityScale 段间能量插值
    let atmosphereNotes: NoteData[] = [];
    if (roster.atmosphere !== null && roster.atmosphere !== undefined) {
        // intensityScale 取整曲段落能量平均(段落级 idiom 不感知 per-beat,用平均作 baseline)
        const avgIntensity = sections.length > 0
            ? sections.reduce((acc, s) => acc + s.energyLevel, 0) / sections.length / 10
            : 0.5;
        atmosphereNotes = AtmosphereRealizer.realize({
            chords: mgChords,
            idiom: roster.atmosphere.personnel?.atmosphereOverrides,
            intensityScale: avgIntensity,
            context: renderContext,
        });
    }

    // ============================================================
    // C.5 — Weather post-modulation 钢琴轨
    // ============================================================
    // mg 完整输出后(motif / cadence 跨段连贯保留),按每个 note onset 查 weather:
    //   K → velocity 调制(段落能量驱动 — Verse 弱 / Chorus 强)
    //   S → duration 调制(spatial sustain — ambient 长音 / build staccato)
    // 不动 pitch / chord(保留 mg 哲学),只调音量+延时。
    const mgPianoModulated = modulateMgPianoByWeather(mgPianoUnified, renderContext);

    const track: GeneratedTrack = {
        chords: mgChords,
        melody: [],                       // 统一到 accompaniment 走 Grand Acoustic
        accompaniment: mgPianoModulated,  // mg piano + C.5 weather modulation
        bass: bassNotes,                  // C.4 — auraflow BassRealizer + mg chord
        drums: drumsNotes,                // C.4 — auraflow DrumRealizer
        atmosphere: atmosphereNotes,      // C.4 — auraflow AtmosphereRealizer
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
// buildActiveMusicians — roster 内非 null 槽位转 ActiveMusician[]
// ============================================================
//
// C.4 — CurveWeatherSampler 消费 activeMusicians 计算 5 维气象 anchor。
// 跳过 null / undefined 槽位(forcedBand: { ...role: null } 显式置空)。
// 不做 eligibleRoles 校验(简化 — 旧 CastingEngine 的 Pass A 已删,Realizer 内部宽容处理)。
function buildActiveMusicians(roster: BandRoster): ActiveMusician[] {
    const out: ActiveMusician[] = [];
    const tryAdd = (musician: Musician | null | undefined, role: BandRole) => {
        if (musician !== null && musician !== undefined) {
            out.push({ card: musician, assignedRole: role });
        }
    };
    tryAdd(roster.vocal,      BandRole.Vocal);
    tryAdd(roster.mainInst,   BandRole.MainInst);
    tryAdd(roster.accomp,     BandRole.Accomp);
    tryAdd(roster.bass,       BandRole.Bass);
    tryAdd(roster.drums,      BandRole.Drums);
    tryAdd(roster.atmosphere, BandRole.Atmosphere);
    return out;
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
