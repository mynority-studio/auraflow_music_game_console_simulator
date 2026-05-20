/**
 * runPipeline — 生成管线统一入口
 *
 * 当前实装范围:
 *   Stage 1  selectStyle           PRNG ×1   — 从 allowedStyleIds 池抽
 *   Stage 2  resolveBasicParams    PRNG ×4   — tonality / keyOffset / BPM / formTemplate 抽样
 *   Stage 3  HarmonyEngine         PRNG ×0   — 钢琴伴奏引擎(和声进行 + 钢琴 melody+comping)
 *                                              内部 string Random 隔离子流,PRNGManager 不消费
 *   Stage 4  buildActiveMusicians + CurveWeatherSampler — auraflow 乐手/Band/Weather
 *   Stage 5  Realizer 渲染 bass / drums / atmosphere(消费 HarmonyEngine 的 chord)
 *
 * 输出契约:
 *   - track.chords             — HarmonyEngine 推演的 GeneratedChord[]
 *   - track.melody             — [](melody 与 chord 合并到 accompaniment 走 PIANO_RH)
 *   - track.accompaniment      — 钢琴 melody + chordTexture 合并 + weather 调制(一架钢琴的演绎)
 *   - track.bass/drums/atmosphere — auraflow Realizer 渲染
 *   - context 携带 bpm / tonality / keyOffset / style / gmProgramOverrides
 *
 * 仍尊重的形参约束:
 *   allowedStyleIds / forcedStyleId / forcedBand / forcedGmPrograms / generation
 *
 * PRNG 快照点(D-5):
 *   stateB(Stage 1 入口) / stateC(Stage 3 前) / stateD(Stage 5 前)
 *
 * PRNG 隔离锚点:
 *   HarmonyEngine 用自己的 Random(`${PRNGManager.state}::harmony`)— 跟 PRNGManager 完全独立。
 *   Stage 1+2 仍消费 PRNGManager,Stage 3+ 不消费(HarmonyEngine facade 内部 string seed)。
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
import { HarmonyEngine } from './HarmonyEngine';
import { chordDefsToGeneratedChords, noteEventsToNoteData } from './HarmonyChordAdapter';
import { CurveWeatherSampler } from './CurveWeatherSampler';
import type { RenderContext } from '../ir/RenderContext';
import { BassRealizer } from '../realizers/BassRealizer';
import { DrumRealizer } from '../realizers/DrumRealizer';
import { AtmosphereRealizer } from '../realizers/AtmosphereRealizer';

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
    // Stage 3 — HarmonyEngine 一次性整曲生成(原生 N bars)
    // ============================================================
    // 设计哲学:
    //   - HarmonyEngine 是 auraflow 的"和声+钢琴伴奏"原生引擎
    //   - auraflow sections 系统决定整曲总 bars 数,HarmonyEngine 用 totalBars 接受
    //   - 内部 progression 模板 ring loop(i % chosen.length)+
    //     phrase 边界 modulo(i % motifInterval)→ N bars 自然适配
    //   - motif/cadence/sub-style 哲学跨段连贯(motif 在 phrase 边界
    //     自然复现,cadence 在 song_end 自然触发)
    //   - 段落对比靠 weather post-modulation(modulatePianoByWeather
    //     里 per-note onset 查 weather 调 velocity/duration)
    //
    // PRNG 隔离:HarmonyEngine 用 string Random(`${seed}::harmony`),
    //          PRNGManager 不被触碰。
    const harmonySeed = PRNGManager.getState();
    const totalBeats = sections.length > 0
        ? sections[sections.length - 1].endBeat
        : 16 * timeSignature[0];
    const totalBars = Math.max(4, Math.round(totalBeats / timeSignature[0]));

    const harmonyResult = HarmonyEngine.generate({
        seed: harmonySeed,
        styleId,
        keyRootPc: keyOffset,
        isMinor: tonality === Tonality.Minor,
        totalBars,
    });

    // ChordDef[] → GeneratedChord[]:整曲 0-based,直接累积到 totalBeats
    const harmonyChords = chordDefsToGeneratedChords(harmonyResult.chords, 0);
    for (let i = 0; i < harmonyChords.length; i++) {
        harmonyChords[i].keyOffset = keyOffset;
    }

    // NoteEvent → NoteData:整曲 0-based,无 offset
    //
    // HarmonyEngine 内部输出三层 NoteEvent(melody / chord / bass),全部是
    // "一架 Salamander piano" 同时弹奏的 3 part。映射到 auraflow:
    //   melody (高音区 60-86)    → MainInst       → track.melody       → CHANNEL_MELODY
    //   chord  (中音区 48-81)    → Accomp 钢琴右手 ┐
    //   bass   (低音区 33-55)    → Accomp 钢琴左手 ┴→ track.accompaniment → CHANNEL_PIANO_RH/LH
    //                                                (AbsoluteTransposer 按 pitch<48 自然分流)
    //
    // 钢琴轨**完全原生 mg 输出**,不做 weather 调制(I1):
    //   - mg 内部已有完善的 velocity 设计(motif accent / cadence boost / melody-avoid duck)
    //   - 段落起伏由 mg motif/phrase/cadence 哲学跨段自然体现
    //   - weather 调制只保留给 bass/drums/atmosphere(auraflow 自渲染的轨道)
    const pianoMelody = noteEventsToNoteData(harmonyResult.melody, 0);
    const pianoChord = noteEventsToNoteData(harmonyResult.chordTexture, 0);
    const pianoBass = noteEventsToNoteData(harmonyResult.bass, 0);
    pianoMelody.sort((a, b) => a.onset - b.onset);

    // Accomp = chord(右手中音区)+ bass(左手低音区)合并 — 钢琴一架弹两手
    const pianoAccomp: NoteData[] = pianoChord.concat(pianoBass);
    pianoAccomp.sort((a, b) => a.onset - b.onset);

    PRNGManager.recordSnapshot('D');

    // ============================================================
    // Stage 4 — Roster / Band / Weather
    // ============================================================
    // 设计:HarmonyEngine 接管钢琴和声,auraflow 用乐手 / band / weather 系统
    //   装饰 bass / drums / atmosphere。所有 Realizer 接收 harmonyChords +
    //   weather 调制。
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
    // Stage 5 — 渲染 bass / drums / atmosphere 三轨(钢琴已由 HarmonyEngine 接管)
    // ============================================================
    // 用 RELATIVE 空间的 harmonyChords 作为输入,Realizer 渲染 RELATIVE NoteData[]。
    // 下游 AbsoluteTransposer.arrange 加 keyOffset 转 ABSOLUTE(K-2 铁律唯一加点)。

    // BASS — 取 roster.bass 的 persona 渲染 walking / pattern bass
    let bassNotes: NoteData[] = [];
    if (roster.bass !== null && roster.bass !== undefined) {
        bassNotes = BassRealizer.realize({
            chords: harmonyChords,
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
            chords: harmonyChords,
            idiom: roster.atmosphere.personnel?.atmosphereOverrides,
            intensityScale: avgIntensity,
            context: renderContext,
        });
    }

    // ============================================================
    // BandRole 路由 — melody → MainInst / (chord+bass) → Accomp
    // ============================================================
    // HarmonyEngine 内部 melody / chord / bass 三层是"一架 piano 弹三 part"的
    // 三个独立输出。映射到 auraflow:
    //   roster.mainInst  ↔ 主奏(melody)        → track.melody       → CHANNEL_MELODY (Bright)
    //   roster.accomp    ↔ 伴奏(chord + bass) → track.accompaniment → CHANNEL_PIANO_RH/LH (Grand)
    //                                            (pianoChord 在中音区进 RH,pianoBass 在低音区进 LH)
    //
    // 空槽语义(BandSelection UI 显式 null):
    //   roster.mainInst = null → track.melody=[],主奏 channel 静音(只剩 chord+bass 伴奏)
    //   roster.accomp   = null → track.accompaniment=[],伴奏 channel 静音(只剩 melody 主奏)
    //   两个都 null → 钢琴全静,只剩 bass/drums/atmosphere 节奏组
    //
    // 注意:HarmonyEngine 始终生成完整 melody+chord+bass 不变(避让逻辑保持),
    //      此处只是按 roster 决定输出。切换 roster 不影响输出确定性 + bit-exact。
    const trackMelody = roster.mainInst !== null && roster.mainInst !== undefined
        ? pianoMelody : [];
    const trackAccompaniment = roster.accomp !== null && roster.accomp !== undefined
        ? pianoAccomp : [];

    const track: GeneratedTrack = {
        chords: harmonyChords,
        melody: trackMelody,              // HarmonyEngine melody → CHANNEL_MELODY
        accompaniment: trackAccompaniment,// HarmonyEngine chord+bass → CHANNEL_PIANO_RH+LH
        bass: bassNotes,                  // auraflow BassRealizer ElectricBass
        drums: drumsNotes,                // auraflow DrumRealizer
        atmosphere: atmosphereNotes,      // auraflow AtmosphereRealizer
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
    //   同一张 mg_piano 卡会让两个通道都变成 0(Grand)，损失辨识度。
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
        mainInst:   pickOrDefault(BandRole.MainInst,   'mg_piano'),
        accomp:     pickOrDefault(BandRole.Accomp,     'mg_piano'),
        bass:       pickOrDefault(BandRole.Bass,       'frank_bass'),
        drums:      pickOrDefault(BandRole.Drums,      'dave_drums'),
        atmosphere: pickOrDefault(BandRole.Atmosphere, 'nina_pad'),
    };
}
