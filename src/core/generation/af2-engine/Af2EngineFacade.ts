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
// 2026-05-26 Step 6.4:EngineSelectionStore 已退化(单引擎,runPipeline 直接调本 Facade)
import { getMusicianById } from '../idioms/MusicianRegistry';
import { Random } from './utils/Random';
import { bandRoleToTrackKeys } from '../data/GMSoundMap';
import type { GmProgramTrackKey } from '../data/GMSoundMap';

import { Af2KernelDriver } from './Af2KernelDriver';
import { KEYS } from './music-theory/spell';
import { SUB_STYLES_POP, type SubStyle } from './SubStyleTextures';
// 2026-05-26 Step 6.4:SUB_STYLE_PRIMARY_TEXTURES + TEXTURE_DENSITY 已死(AccompGen 删,
// 无人消费 songBase)。songBase 字段保留但赋默认值,后续清理 input 协议时一并删。
import { SectionPlanner } from './SectionPlanner';
import { SectionMapper } from './SectionMapper';
import { SlotRouter } from './SlotRouter';
import { PianoIdiom } from './instruments/PianoIdiom';
import { BassIdiom } from './instruments/BassIdiom';
import { PadGenerator, PadIdiom } from './instruments/PadIdiom';
import { DrumGenerator } from './instruments/DrumIdiom';
import { EnergyHumanizer, CollisionDamper, DropBuildupDynamics } from './plugins/reconciler';
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

/** POP-only 占位 auraflow StyleId(给 ArrangedTrack.styleId 字段提供值) */
const POP_STYLE_ID: StyleId = StyleId.ModernPop;

export const Af2EngineFacade = {
    /**
     * 主入口:被 runPipeline 调用(单一引擎入口,2026-05-26 起)。
     */
    generate(options: PipelineRunOptions): Af2GenerateResult {
        // -----------------------------------------------------------
        // 0. 准备 seed(POP-only,2026-05-25 大瘦身后无 mgStyle 分支)
        // -----------------------------------------------------------
        const auraflowSeed = PRNGManager.getInitialSeed();
        const mgSeedString = `af2_${auraflowSeed >>> 0}`;

        // K 阶段(2026-05-24):PRNG-driven keyOffset + tonality 替代硬编 'C'/Major。
        // forked stream `af2_key_${seed}` / `af2_tonality_${seed}` 独立 —
        // 主 rng 流不受影响,同 seed 之前生成内容(进行/voicing/family)行为不变。
        //
        // Tonality 分布:Major 70% / Minor 30%(Pop/Jazz/Blues/RNB 通用经验值)。
        //
        // K5 阶段 user override 优先级(若 user 显式传):
        //   detectedKey ∈ [0, 11]    → 用 user keyOffset(否则 PRNG 抽,sub-rng 仍 fork)
        //   detectedTonality 已传    → 用 user tonality(否则 PRNG 抽)
        //
        // 两字段独立:user 可单独锁 key 而保持 tonality 随机,或反之。
        // sub-rng 独立 fork — user override 时 rng 创建但不 advance(主流不变)。
        const keyRng = new Random(`af2_key_${auraflowSeed >>> 0}`);
        const tonalityRng = new Random(`af2_tonality_${auraflowSeed >>> 0}`);
        const userKey = options.generation?.detectedKey;
        const keyOffset = (userKey !== undefined && Number.isInteger(userKey) && userKey >= 0 && userKey <= 11)
            ? userKey
            : keyRng.range(0, 11);
        const key = KEYS[keyOffset];
        const userTonality = options.generation?.detectedTonality;
        const tonality = (userTonality === Tonality.Major || userTonality === Tonality.Minor)
            ? userTonality
            : (tonalityRng.next() < 0.7 ? Tonality.Major : Tonality.Minor);

        // P 阶段:per-song sub-style fork(影响 AccompGen textureType pool 选择)
        // 跨 mgStyle 不匹配的 user override → ignore,走 PRNG
        const substyleRng = new Random(`af2_substyle_${auraflowSeed >>> 0}`);
        const userSubStyle = options.generation?.detectedSubStyle;
        const subStylePool = SUB_STYLES_POP;
        const subStyle: SubStyle = (userSubStyle && (subStylePool as ReadonlyArray<string>).includes(userSubStyle))
            ? userSubStyle as SubStyle
            : subStylePool[substyleRng.range(0, subStylePool.length - 1)];

        // S 阶段:per-song songBase textureType — 整曲贯穿的"律动外壳"。
        // 从 sub-style primaryTextures 抽 medium-density textureType(避免起点
        // 太 sparse 或太 dense)。AccompGen 会:
        //   energy 4-6 (Verse/Bridge): 直接用 songBase
        //   energy >= 7 (Chorus/Drop): VARIATIONS[songBase].dense 升级
        //   energy <= 3 (Intro/Outro): VARIATIONS[songBase].sparse 降级
        // 这样整曲 60-70% bar 用同一 textureType(律动外壳一致),
        // section 切换时按主题升降级(变化服务于段落能量曲线)。
        // 2026-05-26 Step 6.4:songBase 死字段(AccompGen 删后无 consumer);保占位以兼容 input 协议
        void auraflowSeed;
        const songBase: string = 'Single_Root';

        // -----------------------------------------------------------
        // Step 1: AF 段落骨架(先于 mg 调用,因为 Section-aware Arranger 要 sections)
        //
        // mg.recommendedBars 通过 Af2KernelDriver.getRecommendedBars 静态查表,
        // 不需要先 invoke mg。
        // -----------------------------------------------------------
        const totalBars = Af2KernelDriver.getRecommendedBars();
        const sections = SectionPlanner.plan(totalBars, 4);

        // -----------------------------------------------------------
        // Step 2: AF2 内核(Af2KernelDriver 仅保留命名,内部全 AF2 — 删 mg 后简化)
        //   - Af2Arranger:section-aware 决进行
        //   - Af2Composer:决 voicing + bass + chordSymbol
        //   - events 永远空(全 AF2 musicians plan() 自给)
        // -----------------------------------------------------------
        const isMinor = tonality === Tonality.Minor;
        const mg = Af2KernelDriver.invoke(mgSeedString, key, sections, isMinor, subStyle);

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
        const variantPick = pickConductorTemplate(auraflowSeed);
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

        // N6 阶段(2026-05-24)Dispatcher steps 顺序重排:
        //   melody → bass → accomp → drums → pad
        //
        //   原因:cross-track chord-texture 'Call_And_Response' 需要 melody peers
        //   在 accomp 跑时已就位。melody 当前 self-contained(不读任何 peers),
        //   前置无副作用;drums 仍能在 bass+accomp 之后读到它们的 peers。
        //
        //   原顺序 bass → accomp → drums → melody → pad:
        //     - drums 读 bass/accomp peers ✓
        //     - 其他 musicians 都不读 peers
        //   新顺序 melody → bass → accomp → drums → pad:
        //     - accomp 读 melody peers(CallAndResponse 用)✓
        //     - drums 仍读 bass/accomp peers ✓
        //     - 其他不读 peers
        //   迁移影响:零(只有 drums 用 peers,顺序不变)

        // 1. Melody(N6:前置 — 让 accomp 能读 melody peers 给 CallAndResponse)
        if (mainMusician) {
            const mm = mainMusician;
            steps.push({
                musicianId: mm.id,
                plan: (input) => PianoIdiom.planMelody({ ...input, musician: mm, notes: { melody: routed[BandRole.MainInst].notes } }),
            });
        }

        // 2. Bass(rhythm 底)
        if (bassMusician) {
            const bm = bassMusician;
            steps.push({
                musicianId: bm.id,
                plan: (input) => useElectricBass
                    ? BassIdiom.plan({ ...input, musician: bm, notes: { bass: routed[BandRole.Bass].notes } })
                    : PianoIdiom.planBass({ ...input, musician: bm, notes: { bass: routed[BandRole.Bass].notes } }),
            });
        }

        // 3. Accomp(harmonic 底)
        //   N6:从 input.peers 读 melody musicianId 的 NoteData[] → 通过
        //   melodyPeerNotes 字段透传到 AccompGen → ChordTextureEngine → CallAndResponse。
        //   P 阶段:加 subStyle 透传(AccompGen 优先用 sub-style primaryTextures)
        //   S 阶段:加 songBase 透传(AccompGen 优先 base + variation,而非 phrase 抽)
        if (accompMusician) {
            const am = accompMusician;
            const mainMusicianId = mainMusician?.id;
            steps.push({
                musicianId: am.id,
                plan: (input) => PianoIdiom.planAccomp({
                    ...input,
                    musician: am,
                    notes: { accomp: routed[BandRole.Accomp].notes },
                    melodyPeerNotes: mainMusicianId
                        ? (input.peers.get(mainMusicianId) ?? []) as NoteData[]
                        : undefined,
                    subStyle,
                    songBase,
                }),
            });
        }

        // 4. Drums(rhythm grid)— 从 peers 读 bass + accomp(它们在 drums 前 emit)
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
                    bassNotes: bassMusicianId ? (input.peers.get(bassMusicianId) ?? []) as NoteData[] : [],
                    chordNotes: accompMusicianId ? (input.peers.get(accompMusicianId) ?? []) as NoteData[] : [],
                    rng: new Random(`af2_drum_${auraflowSeed >>> 0}`),
                    persona: dm.persona,
                }),
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

        const performanceByMusician = dispatchMusicians(score, sectionAssignments, steps);

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
        // Step 5.5-5.7: Reconciler plugin chain(无 core,3 plugin 顺序叠加)
        //
        // 原 Reconciler.ts 拆为 plugins/reconciler/* 三 plugin(2026-05-25)。
        // 全部 zero PRNG 消耗,velocity-only 改写,任一 plugin 拔掉听感
        // 劣化(less humanization)但不破坏正确性。
        //
        // 顺序与依赖:
        //   1. EnergyHumanizer  — 段落能量驱动 velocity(skip drums/atmosphere)
        //   2. CollisionDamper  — accomp 撞 bass/melody 时 velocity × 0.5
        //   3. DropBuildupDynamics — Drop/BuildUp 段 kind-specific 动态(skip drums)
        // -----------------------------------------------------------
        const energyMain   = EnergyHumanizer.apply(renderedMainRaw,   sections);
        const energyAccomp = EnergyHumanizer.apply(renderedAccompRaw, sections);
        const energyBass   = EnergyHumanizer.apply(renderedBassRaw,   sections);

        const collisionAccomp = CollisionDamper.apply(energyAccomp, energyBass, energyMain);

        const renderedMain   = DropBuildupDynamics.apply(energyMain,      sections, 'melody');
        const renderedBass   = DropBuildupDynamics.apply(energyBass,      sections, 'bass');
        const renderedAccomp = DropBuildupDynamics.apply(collisionAccomp, sections, 'accomp');
        const renderedPad    = DropBuildupDynamics.apply(renderedPadRaw,  sections, 'pad');

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
        const afStyleId = POP_STYLE_ID;

        // Step 6b.1:先按 AF2 idiom 默认填(钢琴/电贝斯/Pad)
        // W 阶段:POP-only Pad GM = 89(Warm Pad — 温暖默认)
        const PAD_GM_POP = 89;
        const gmOverrides: NonNullable<MusicContext['gmProgramOverrides']> = {
            melody: PianoIdiom.getGmProgram(),
            accomp: PianoIdiom.getGmProgram(),
        };
        if (useElectricBass) {
            gmOverrides.bass = BassIdiom.getGmProgram();
        }
        if (renderedPad.length > 0) {
            gmOverrides.atmosphere = PAD_GM_POP;
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
