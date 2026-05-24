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
//   Step 2:   Af2KernelDriver.invoke       ← 调 mg 核心(bit-exact = MG)
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
import { Random } from './utils/Random';
import { bandRoleToTrackKeys } from '../data/GMSoundMap';
import type { GmProgramTrackKey } from '../data/GMSoundMap';

import { Af2KernelDriver } from './Af2KernelDriver';
import { KEYS } from './music-theory/spell';
import { SectionPlanner } from './SectionPlanner';
import { SectionMapper } from './SectionMapper';
import { SlotRouter } from './SlotRouter';
import { PianoIdiom } from './instruments/PianoIdiom';
import { BassIdiom } from './instruments/BassIdiom';
import { PadGenerator, PadIdiom } from './instruments/PadIdiom';
import { DrumGenerator } from './instruments/DrumIdiom';
import { Reconciler } from './Reconciler';
// C.1 + C.2 + C.4:Score 数据契约 + Conductor 分谱层(DynamicConductor 默认,
// per-section 模板编排;StaticConductor 保留作 fallback)
import type { Score } from './Score';
import type { Band, SectionAssignment } from './Conductor';
import { DynamicConductor, pickConductorTemplate } from './Conductor';
import type { MusicianStep } from './Dispatcher';
import { dispatchMusicians } from './Dispatcher';

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
        //
        // mgStyle 决定 Arranger 进行池 / Composer Divisi 概率 / Conductor 模板 /
        // Drum grid。优先级:
        //   1. options.forcedStyleId(Apps 显式传入)→ 映射为 mgStyle
        //   2. EngineSelectionStore.getMgStyle()(Q+H Style 下拉全局状态)
        // -----------------------------------------------------------
        const auraflowSeed = PRNGManager.getInitialSeed();
        const mgSeedString = `af2_${auraflowSeed >>> 0}`;
        const mgStyle: MgStyle = (() => {
            if (options.forcedStyleId !== undefined) {
                // Apps 传入的 forcedStyleId(auraflow 历史 StyleId)→ 映射回 mgStyle
                switch (options.forcedStyleId) {
                    case StyleId.ModernPop:  return 'POP';
                    case StyleId.ChillJazz:  return 'JAZZ';
                    case StyleId.NeoSoul:    return 'RNB';
                }
            }
            return EngineSelectionStore.getMgStyle();
        })();

        // K 阶段(2026-05-24):PRNG-driven keyOffset + tonality 替代硬编 'C'/Major。
        // forked stream `af2_key_${seed}` / `af2_tonality_${seed}` 独立 —
        // 主 rng 流不受影响,同 seed 之前生成内容(进行/voicing/family)行为不变。
        //
        // Tonality 分布:Major 70% / Minor 30%(Pop/Jazz/Blues/RNB 通用经验值;
        // 后续可 per-mgStyle 微调,如 BLUES 偏 Major、Jazz 偏 Minor)。
        //
        // Minor 限制(K2 阶段):
        //   - BorrowChordPlanner 在 Minor 时 short-circuit(rule 池是 Major-designed,
        //     Minor borrow 留 K3)
        //   - Arranger 用 Minor 专用进行池(SECTION_POOLS_BY_STYLE_MINOR)
        //   - TonicizationPlanner 自动 minor-aware(读 next.roman/type 判 quality)
        //   - Composer isMinorKey=true 让 spell 正确(Bb 调 minor vs A# 调 major)
        const keyRng = new Random(`af2_key_${auraflowSeed >>> 0}`);
        const keyOffset = keyRng.range(0, 11);
        const key = KEYS[keyOffset];
        const tonalityRng = new Random(`af2_tonality_${auraflowSeed >>> 0}`);
        const tonality = tonalityRng.next() < 0.7 ? Tonality.Major : Tonality.Minor;

        // -----------------------------------------------------------
        // Step 1: AF 段落骨架(先于 mg 调用,因为 Section-aware Arranger 要 sections)
        //
        // mg.recommendedBars 通过 Af2KernelDriver.getRecommendedBars 静态查表,
        // 不需要先 invoke mg。
        // -----------------------------------------------------------
        const totalBars = Af2KernelDriver.getRecommendedBars(mgStyle);
        const sections = SectionPlanner.plan(mgStyle, totalBars, 4);

        // -----------------------------------------------------------
        // Step 2: AF2 内核(Af2KernelDriver 仅保留命名,内部全 AF2 — 删 mg 后简化)
        //   - Af2Arranger:section-aware 决进行
        //   - Af2Composer:决 voicing + bass + chordSymbol
        //   - events 永远空(全 AF2 musicians plan() 自给)
        // -----------------------------------------------------------
        const isMinor = tonality === Tonality.Minor;
        const mg = Af2KernelDriver.invoke(mgSeedString, mgStyle, key, sections, isMinor);

        // -----------------------------------------------------------
        // Step 3: 段落映射(只读切片)
        // -----------------------------------------------------------
        const eventsWithSection = SectionMapper.assignSections(mg.events, sections);

        // -----------------------------------------------------------
        // Step 4: 6 槽位路由 + musician 装配
        // -----------------------------------------------------------
        const routed = SlotRouter.route(eventsWithSection, options.forcedBand, getMusicianById);

        // -----------------------------------------------------------
        // Step 4.1 (C.1+C.2):构造 Score + Conductor.dispatch
        //
        // Score = mg + SectionPlanner 输出的素材打包(数据契约,无新算法)。
        // StaticConductor.dispatch = 把当前 band 映射到所有 sections(行为等价
        // 当前 forcedBand)。SectionAssignment 暂未被 musicians 消费 — C.3+ 才
        // 让 musicians 改造为 plan(score, role, peers) 协议时接入。
        // -----------------------------------------------------------
        const score: Score = {
            chords: mg.chords,
            sections,
            bpm: mg.bpm,
            key,
            keyOffset,
            tonality,
            timeSignature: [4, 4],
        };
        const band: Band = {
            [BandRole.MainInst]:   routed[BandRole.MainInst].musician,
            [BandRole.Accomp]:     routed[BandRole.Accomp].musician,
            [BandRole.Bass]:       routed[BandRole.Bass].musician,
            [BandRole.Drums]:      routed[BandRole.Drums].musician,
            [BandRole.Atmosphere]: routed[BandRole.Atmosphere].musician,
        };
        // C.4 + Conductor 模板自家化(2026-05-24):per-mgStyle 多 variants,
        //   seed deterministic 抽 1 个 variant 用全曲。同 mgStyle 不同 seed
        //   听感差异更大(POP standard/minimal/dense 3 variants 等)。
        const variantPick = pickConductorTemplate(mgStyle, auraflowSeed);
        const conductor = new DynamicConductor(variantPick.template);
        const sectionAssignments: ReadonlyArray<SectionAssignment> = conductor.dispatch(score, band);

        // -----------------------------------------------------------
        // Step 4.5 + 5:Dispatcher(显式"大脑分谱" — 8 层架构 #5)
        //
        // 按顺序调用 musicians.plan(),累积 peers(cross-track 协调地基)。
        //   Order:bass → accomp → drums → melody → pad
        //   (rhythm 先建 → harmonic 上 → drums 看 bass/accomp → melody → pad 收尾)
        //
        // 每个 step 是 closure,内部桥接到对应 idiom 实现 + 捕获原料 notes /
        // musician 卡 / drum 专用 rng 等。Dispatcher 不感知 idiom 细节,只管"按顺序
        // 调,累积 peers"。peers 暂未被 musicians 消费(future ready)。
        // -----------------------------------------------------------
        const atmosphereMusician = routed[BandRole.Atmosphere].musician;
        const drumMusician = routed[BandRole.Drums].musician;
        const mainMusician = routed[BandRole.MainInst].musician;
        const accompMusician = routed[BandRole.Accomp].musician;
        const bassMusician = routed[BandRole.Bass].musician;
        const useElectricBass = bassMusician?.instrumentFamily === InstrumentFamily.Bass;

        const steps: MusicianStep[] = [];

        // 1. Bass(rhythm 底)
        if (bassMusician) {
            const bm = bassMusician;
            steps.push({
                musicianId: bm.id,
                plan: (input) => useElectricBass
                    ? BassIdiom.plan({ ...input, musician: bm, notes: { bass: routed[BandRole.Bass].notes } })
                    : PianoIdiom.planBass({ ...input, musician: bm, notes: { bass: routed[BandRole.Bass].notes } }),
            });
        }

        // 2. Accomp(harmonic 底)
        if (accompMusician) {
            const am = accompMusician;
            steps.push({
                musicianId: am.id,
                plan: (input) => PianoIdiom.planAccomp({ ...input, musician: am, notes: { accomp: routed[BandRole.Accomp].notes } }),
            });
        }

        // 3. Drums(rhythm grid,跨 part peers 实际消费 B 升级:
        //    从 input.peers 读 bass + accomp musicians 已 emit 的 notes,而非
        //    closure 直接传 routed.notes)
        //
        //    peers 的好处:
        //    - 看到的是 musician 已经经过 plan() 调整的 notes(per-section gate /
        //      Phase B/C 处理后的最终输出),drums 对齐的是"实际听到的"bass/accomp
        //    - 不再 hard-code 与 routed 槽位的耦合
        //
        //    若 bass / accomp musician null → peers 没对应 key → 空数组 fallback
        if (drumMusician?.instrumentFamily === InstrumentFamily.Percussion) {
            const dm = drumMusician;
            const bassMusicianId = bassMusician?.id;
            const accompMusicianId = accompMusician?.id;
            steps.push({
                musicianId: dm.id,
                plan: (input) => DrumGenerator.plan({
                    score: input.score,
                    musicianId: input.musicianId,
                    assignments: input.assignments,
                    mgStyle,
                    // B 升级:从 peers 读(drums 是 step 3,bass+accomp 已 emit 完毕)
                    bassNotes: bassMusicianId ? (input.peers.get(bassMusicianId) ?? []) as NoteData[] : [],
                    chordNotes: accompMusicianId ? (input.peers.get(accompMusicianId) ?? []) as NoteData[] : [],
                    rng: new Random(`af2_drum_${auraflowSeed >>> 0}`),
                    persona: dm.persona,
                }),
            });
        }

        // 4. Melody(看 bass + accomp + drums,跨 part 协调可参考 peers)
        if (mainMusician) {
            const mm = mainMusician;
            steps.push({
                musicianId: mm.id,
                plan: (input) => PianoIdiom.planMelody({ ...input, musician: mm, notes: { melody: routed[BandRole.MainInst].notes } }),
            });
        }

        // 5. Pad(填空 / ambient,看所有人 peers — 当前不消费)
        if (atmosphereMusician?.instrumentFamily === InstrumentFamily.Pad) {
            const atm = atmosphereMusician;
            steps.push({
                musicianId: atm.id,
                plan: (input) => PadGenerator.plan({ ...input, musician: atm }),
            });
        }

        const performanceByMusician = dispatchMusicians(score, sectionAssignments, steps, mgStyle);

        // Extract per-musician notes(空 musician → [])
        const renderedBassRaw   = bassMusician      ? performanceByMusician.get(bassMusician.id)      ?? [] : [];
        const renderedAccompRaw = accompMusician    ? performanceByMusician.get(accompMusician.id)    ?? [] : [];
        const drumNotes         = drumMusician?.instrumentFamily === InstrumentFamily.Percussion
                                  ? performanceByMusician.get(drumMusician.id)      ?? [] : [];
        const renderedMainRaw   = mainMusician      ? performanceByMusician.get(mainMusician.id)      ?? [] : [];
        const padNotes          = atmosphereMusician?.instrumentFamily === InstrumentFamily.Pad
                                  ? performanceByMusician.get(atmosphereMusician.id) ?? [] : [];

        const renderedPadRaw = PadIdiom.realize(padNotes);

        // -----------------------------------------------------------
        // Step 5.5: Reconciler v1.0 — 段落能量驱动 velocity humanization
        //
        // Note:Phase C add11 人手物理(原 Step 5.4)已下沉到 PianoIdiom.planMelody
        // 内化(commit C.5 末)。Reconciler 现在专注 velocity / 段落动态层。
        //
        // 对 melody / accompaniment / bass 三轨按段落 energyLevel 缩放 velocity:
        //   energy 1 → ×0.70(intro 弱)/ 5 → ×1.00 / 10 → ×1.10(chorus 略强)
        //
        // **跳过 drums / atmosphere** — DrumGenerator 已带 energyVelScale,
        // PadGenerator 已用 energy 决定 velocity,二次缩放会过度。
        // -----------------------------------------------------------
        const energyMain   = Reconciler.applyEnergyHumanization(renderedMainRaw, sections);
        const energyAccomp = Reconciler.applyEnergyHumanization(renderedAccompRaw, sections);
        const energyBass   = Reconciler.applyEnergyHumanization(renderedBassRaw, sections);

        // -----------------------------------------------------------
        // Step 5.6: Reconciler v1.1 — 撞音 damp(只 damp accomp)
        //
        // 优先级 melody > bass > accomp,accomp 在以下情况 velocity × 0.5:
        //   · pitch < 60 且与 bass 同 onset±0.05 + 同 pitch class → 让 bass 主导低频
        //   · pitch >= 60 且与 melody 同 onset±0.05 + 同 pitch class → 让 melody 主导顶音
        //
        // melody / bass 是 mg 主输出,不修改。
        // -----------------------------------------------------------
        const collisionAccomp = Reconciler.dampAccompForCollisions(energyAccomp, energyBass, energyMain);

        // -----------------------------------------------------------
        // Step 5.7: Reconciler v1.2 — Drop / BuildUp 段落动态
        //
        // Drop 段(energy<3):accomp×0.5 / bass×0.6 / pad×1.2(反向)/ melody 不动
        // BuildUp 段(next.energy > cur+2):末 1 bar velocity 线性 ramp(per-kind)
        // Drums 跳过:DrumIdiom 内部 isBuildUp + Tom Fill 已感知
        // -----------------------------------------------------------
        const renderedMain   = Reconciler.applyDropBuildupDynamics(energyMain,      sections, 'melody');
        const renderedBass   = Reconciler.applyDropBuildupDynamics(energyBass,      sections, 'bass');
        const renderedAccomp = Reconciler.applyDropBuildupDynamics(collisionAccomp, sections, 'accomp');
        const renderedPad    = Reconciler.applyDropBuildupDynamics(renderedPadRaw,  sections, 'pad');

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
            keyOffset,
            tonality,
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
            keyOffset,
            tonality,
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
