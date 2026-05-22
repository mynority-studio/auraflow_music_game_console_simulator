// ============================================================
// Af2EngineFacade — AuraFlow v2 融合引擎入口(Phase 2a 实装)
// ============================================================
//
// 设计意图(详见 ARCHITECTURE.md):
//   AF2 取 mg 的"全局和声 / 段落和声编配 / topline" 作为内核,
//   接 AF 的"段落骨架 / 能量曲线 / 乐器分配" 作为外壳。
//
// 调用契约(Single Pipeline 原则):
//   - 输入:PipelineRunOptions(同 AF / MG)
//   - 输出:{ track: GeneratedTrack, context: MusicContext }
//   - 下游 AbsoluteTransposer / MidiConverter / AudioEngine 零改动
//
// Phase 2a 实装 8 步管线(见 PHASE2A.md §2):
//   Step 1:   SectionPlanner.plan          ← AF 段落骨架
//   Step 2:   MgKernelInvoker.invoke       ← 调 mg 核心(bit-exact = MG)
//   Step 3:   SectionMapper.assignSections ← events 标段落
//   Step 4:   SlotRouter.route             ← 6 槽位路由(读 forcedBand)
//   Step 4.5: PadGenerator(条件性)        ← Atmosphere 槽位有乐手时
//   Step 4.6: DrumGenerator(条件性)       ← Drums 槽位有乐手时
//   Step 5:   按 musician.instrumentFamily 分支 idiom:
//               · Bass family → BassIdiom + electricBass 通道
//               · 其余 → PianoIdiom 直通
//   Step 6:   装配 GeneratedTrack + MusicContext
//
// 融合原则(README.md):
//   - mg.melody / mg.chord / mg.bass **bit-exact 保留**(只换通道 / 音色)
//   - Pad / Drums 是 AF2 自生成(mg 之外),不动 mg 任何东西
//   - AF 可干预:段落骨架 + 能量曲线(驱动 Pad/Drum velocity) + 乐器分配
//
// PRNG 策略:
//   - mg 内核:`mg_${auraflowSeed}` seedString(与 MG 模式完全一致)
//   - AF 段落骨架(SectionPlanner):PRNGManager 抽 1 次
//   - Pad / Drum 生成:**完全决定性,不消费 PRNG**
//     → AF2 不增加 PRNG 消耗,bit-exact 验收脚本继续通过
// ============================================================

import { BandRole, InstrumentFamily, Tonality } from '../types';
import type { GeneratedTrack, MusicContext, NoteData } from '../types';
import type { PipelineRunOptions } from '../pipeline';
import { StyleId } from '../config/StyleFlags';
import { PRNGManager } from '../../utils/PRNG';
import { EngineSelectionStore } from '../../../state/EngineSelectionStore';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import { getMusicianById } from '../idioms/MusicianRegistry';
import { Random } from '../mg-engine/musicEngine';
import { bandRoleToTrackKeys } from '../data/GMSoundMap';
import type { GmProgramTrackKey } from '../data/GMSoundMap';

import { MgKernelInvoker } from './MgKernelInvoker';
import { SectionPlanner } from './SectionPlanner';
import { SectionMapper } from './SectionMapper';
import { SlotRouter } from './SlotRouter';
import { PianoIdiom } from './instruments/PianoIdiom';
import { BassIdiom } from './instruments/BassIdiom';
import { PadGenerator, PadIdiom } from './instruments/PadIdiom';
import { DrumGenerator } from './instruments/DrumIdiom';

export interface Af2GenerateResult {
    track: GeneratedTrack;
    context: MusicContext;
}

/** mg style → 占位 auraflow StyleId(给 ArrangedTrack.styleId 字段提供值) */
const MG_STYLE_TO_AF_STYLE: Record<MgStyle, StyleId> = {
    POP:   StyleId.ModernPop,
    JAZZ:  StyleId.ChillJazz,
    BLUES: StyleId.ChillJazz,
    RNB:   StyleId.NeoSoul,
};

export const Af2EngineFacade = {
    /**
     * 主入口:被 runPipeline 在 EngineSelectionStore.getEngine() === 'AF2' 时调用。
     */
    generate(options: PipelineRunOptions): Af2GenerateResult {
        // -----------------------------------------------------------
        // 0. 准备 seed / mgStyle
        // -----------------------------------------------------------
        const auraflowSeed = PRNGManager.getInitialSeed();
        const mgSeedString = `mg_${auraflowSeed >>> 0}`;
        const mgStyle = EngineSelectionStore.getMgStyle();
        const key = 'C';

        // -----------------------------------------------------------
        // Step 2(先调,因为段落骨架要知道总小节)
        // -----------------------------------------------------------
        const mg = MgKernelInvoker.invoke(mgSeedString, mgStyle, key);

        // -----------------------------------------------------------
        // Step 1: AF 段落骨架(总小节 = mg.recommendedBars)
        // -----------------------------------------------------------
        const sections = SectionPlanner.plan(mgStyle, mg.recommendedBars, 4);

        // -----------------------------------------------------------
        // Step 3: 段落映射(只读切片)
        // -----------------------------------------------------------
        const eventsWithSection = SectionMapper.assignSections(mg.events, sections);

        // -----------------------------------------------------------
        // Step 4: 6 槽位路由 + musician 装配
        // -----------------------------------------------------------
        const routed = SlotRouter.route(eventsWithSection, options.forcedBand, getMusicianById);

        // -----------------------------------------------------------
        // Step 4.5: PadGenerator(条件:Atmosphere 槽位有 Pad family 乐手)
        // -----------------------------------------------------------
        const atmosphereMusician = routed[BandRole.Atmosphere].musician;
        const padNotes = atmosphereMusician?.instrumentFamily === InstrumentFamily.Pad
            ? PadGenerator.generate({ chords: mg.chords, sections })
            : [];

        // -----------------------------------------------------------
        // Step 4.6: DrumGenerator(条件:Drums 槽位有 Percussion family 乐手)
        //
        // Phase 2b.2 升级:port AF 16-step grid 架构 + per-mgStyle 4 套 grid
        //   (POP/JAZZ/BLUES/RNB)+ energy 双轴缩放 + Dynamic Override
        //   (Crash/Fill/Ride)+ 保留 chord/bass modifier。
        //
        //   - mgStyle 决定 grid 风格 DNA
        //   - rng:独立 PRNG 派生 seed(与 mg / ChordTextureEngine 不冲突,
        //     每 step 固定 3 次 gate PRNG D-5 锁帧)
        //   - bassNotes/chordNotes 作为 probability modifier
        // -----------------------------------------------------------
        const drumMusician = routed[BandRole.Drums].musician;
        const drumNotes = drumMusician?.instrumentFamily === InstrumentFamily.Percussion
            ? DrumGenerator.generate({
                sections,
                beatsPerMeasure: 4,
                mgStyle,
                bassNotes: routed[BandRole.Bass].notes,
                chordNotes: routed[BandRole.Accomp].notes,
                rng: new Random(`af2_drum_${auraflowSeed >>> 0}`),
            })
            : [];

        // -----------------------------------------------------------
        // Step 5: Realizer — 按 musician.instrumentFamily 分支
        //
        //   Bass 槽位:Bass family → BassIdiom + electricBass 通道
        //              其他 / 空 → PianoIdiom + pianoLH/RH 通道(Phase 1 行为)
        //   MainInst / Accomp:Phase 2a 统一 PianoIdiom(Phase 2b+ 加非钢琴 idiom 时
        //                      在此分支)
        // -----------------------------------------------------------
        const bassMusician = routed[BandRole.Bass].musician;
        const useElectricBass = bassMusician?.instrumentFamily === InstrumentFamily.Bass;

        const renderedMain   = PianoIdiom.realize(routed[BandRole.MainInst].notes);
        const renderedAccomp = PianoIdiom.realize(routed[BandRole.Accomp].notes);
        const renderedBass   = useElectricBass
            ? BassIdiom.realize(routed[BandRole.Bass].notes)
            : PianoIdiom.realize(routed[BandRole.Bass].notes);
        const renderedPad    = PadIdiom.realize(padNotes);
        // DrumGenerator 直接产 NoteData,无须 DrumIdiom.realize 后处理(它也是直通)

        // -----------------------------------------------------------
        // Step 6: 装配 GeneratedTrack
        //
        // 2026-05-21 Channel 重构:bass 一律走 bass channel,GM program 由
        //   musician.instrumentFamily 决定(钢琴=0 / 电贝斯=34)。
        //   - useElectricBass=true  → track.bass = renderedBass,accompaniment = chord 单独
        //   - useElectricBass=false → bass 槽位为空或钢琴(钢琴一手包办低音):
        //                              accompaniment = chord + bass 合并 → ch2,
        //                              track.bass = []
        //   - atmosphere / drums:Phase 2a 已启用
        // -----------------------------------------------------------
        let accompaniment: NoteData[];
        let trackBass: NoteData[];
        if (useElectricBass) {
            accompaniment = [...renderedAccomp];
            trackBass = renderedBass;
        } else {
            // 钢琴在 Accomp + Bass 槽位空/钢琴:一手包办,chord+bass 合并到 accompaniment
            accompaniment = [...renderedAccomp, ...renderedBass];
            trackBass = [];
        }
        accompaniment.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);

        const track: GeneratedTrack = {
            chords: mg.chords,
            melody: renderedMain,
            accompaniment,
            bass: trackBass,
            drums: drumNotes,
            atmosphere: renderedPad,
            sections,
            bpm: mg.bpm,
            key,
            keyOffset: 0,
            tonality: Tonality.Major,
            timeSignature: [4, 4],
            blockIndex: 0,
            absoluteStartBeat: 0,
            hasIntro: sections[0]?.sectionType === 0,
        };

        // -----------------------------------------------------------
        // Step 6b: MusicContext + gmProgramOverrides
        //
        // 优先级(与 AF 路径一致):
        //   1. options.forcedGmPrograms[role]    — UI Instr 下拉显式选(最高)
        //   2. musician.gmProgramOverride        — musician 卡内置 override
        //   3. AF2 idiom 默认                     — PianoIdiom=0 / BassIdiom=34 / PadIdiom=89
        //   4. 不写入                              — MidiConverter 文件级默认
        //
        //   Drums:Channel 9 硬路由,不设 program(GM Drum Map)
        // -----------------------------------------------------------
        const afStyleId = MG_STYLE_TO_AF_STYLE[mgStyle];

        // Step 6b.1:先按 AF2 idiom 默认填(钢琴/电贝斯/Pad)
        const gmOverrides: NonNullable<MusicContext['gmProgramOverrides']> = {
            melody: PianoIdiom.getGmProgram(),
            accomp: PianoIdiom.getGmProgram(),
        };
        if (useElectricBass) {
            gmOverrides.bass = BassIdiom.getGmProgram();
        }
        if (renderedPad.length > 0) {
            gmOverrides.atmosphere = PadIdiom.getGmProgram();
        }

        // Step 6b.2:用 forcedGmPrograms / musician.gmProgramOverride 覆盖
        //   遍历 5 槽位,trackKey 映射后写入(BandRole.MainInst → 'melody' 等)
        const ROLES_TO_MAP: BandRole[] = [
            BandRole.MainInst, BandRole.Accomp, BandRole.Bass, BandRole.Drums, BandRole.Atmosphere,
        ];
        for (const role of ROLES_TO_MAP) {
            const slotMusician = routed[role].musician;
            const forcedGm = options.forcedGmPrograms?.[role];
            let gm: number | undefined;
            if (forcedGm !== undefined) {
                gm = forcedGm;
            } else if (slotMusician?.gmProgramOverride !== undefined) {
                gm = slotMusician.gmProgramOverride;
            } else {
                continue;  // 无显式选择 → 保留 6b.1 默认 或 走文件级
            }
            const trackKeys = bandRoleToTrackKeys(role);
            for (const key of trackKeys as ReadonlyArray<GmProgramTrackKey>) {
                (gmOverrides as Record<string, number>)[key] = gm;
            }
        }

        const context: MusicContext = {
            keyOffset: 0,
            tonality: Tonality.Major,
            bpm: mg.bpm,
            timeSignature: [4, 4],
            grooveDNA: [],
            style: {
                id: afStyleId,
            } as MusicContext['style'],
            gmProgramOverrides: gmOverrides,
        };

        return { track, context };
    },
};
