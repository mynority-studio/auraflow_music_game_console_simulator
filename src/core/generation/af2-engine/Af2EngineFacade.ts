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
        // -----------------------------------------------------------
        const drumMusician = routed[BandRole.Drums].musician;
        const drumNotes = drumMusician?.instrumentFamily === InstrumentFamily.Percussion
            ? DrumGenerator.generate({ sections, beatsPerMeasure: 4 })
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
        //   - bass 路径取决于 useElectricBass:
        //       true  → track.bass = renderedBass(走 electricBass 通道,GM 34)
        //              accompaniment 只含 mg.chord(走 pianoLH/RH 通道)
        //       false → track.bass = []
        //              accompaniment = mg.chord + mg.bass 合并(Phase 1 行为,
        //              AbsoluteTransposer 按 pitch<48 切 pianoLH/RH)
        //   - atmosphere / drums 在 Phase 2a 真实启用
        //   - skipHandSplit = false → 走 AF 标准路径(SpessaSynth GM128 SF2)
        // -----------------------------------------------------------
        let accompaniment: NoteData[];
        let trackBass: NoteData[];
        if (useElectricBass) {
            accompaniment = [...renderedAccomp];
            trackBass = renderedBass;
        } else {
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
            skipHandSplit: false,
        };

        // -----------------------------------------------------------
        // Step 6b: MusicContext + gmProgramOverrides
        //
        //   钢琴(melody/pianoLH/pianoRH)— 总是设(MainInst/Accomp 都走 PianoIdiom)
        //   electricBass — 仅 useElectricBass=true 时设
        //   atmosphere   — 仅 padNotes 非空时设(避免空通道也覆盖默认)
        //   drums        — 走 Channel 9 GM Drum Map 硬路由,不设 gmProgram
        // -----------------------------------------------------------
        const afStyleId = MG_STYLE_TO_AF_STYLE[mgStyle];
        const gmOverrides: NonNullable<MusicContext['gmProgramOverrides']> = {
            melody:  PianoIdiom.getGmProgram(),
            pianoLH: PianoIdiom.getGmProgram(),
            pianoRH: PianoIdiom.getGmProgram(),
        };
        if (useElectricBass) {
            gmOverrides.electricBass = BassIdiom.getGmProgram();
        }
        if (renderedPad.length > 0) {
            gmOverrides.atmosphere = PadIdiom.getGmProgram();
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
