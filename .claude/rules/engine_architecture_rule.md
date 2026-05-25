# Engine Architecture Rule — AF2 唯一内核宪法

> **每次动 `src/core/generation/af2-engine/` 之前先读完这份文档。**
> 偏离本文档的改动,听感大概率挂,架构债大概率回潮。

本文件描述 **2026-05-24 删 AF/MG 之后** 的 AF2 唯一内核架构。
旧 AF pipeline / primitives / realizers + mg-engine 已全部物理删除,本文件不再
保留旧架构的历史描述(如需考古查 git history)。

---

## 0. 何时必读本文件

任一条件命中,**先读完再动手**:

- 改 `src/core/generation/af2-engine/` 下任何文件
- 改 IR 类型(`types.ts` / `ir/index.ts`)
- 调整任何模块的 PRNG 消耗
- 改 Conductor template / Arranger 进行池 / Composer voicing 流
- 改 musician 卡 af2Overrides 字段
- 新增 musician / 新增 mgStyle / 新增 SectionType
- 改 runPipeline 入口契约(`pipeline/index.ts`)

---

## 1. AF2 8 层架构(数据流)

```
┌─ 1. BandEngine ───────────────────────────────────────────────┐
│ BandSelectionStore + MusicianRegistry                          │
│   → 选定 Band(5 槽位:MainInst / Accomp / Bass / Drums /      │
│                       Atmosphere)+ forcedBand 覆盖             │
└────────────────────────────────────────────────────────────────┘
        ↓
┌─ 2. Conductor(core + 5 RoleFilter plugin chain)──────────────┐
│ af2-engine/Conductor.ts — DynamicConductor.dispatch            │
│   pickConductorTemplate(mgStyle, seed) → template variant      │
│   core = buildDefaultByMusician(全员上岗 1:1 默认 role)        │
│   plugins/conductor/ DEFAULT_ROLE_FILTERS 链(2026-05-25 拆):  │
│     1. WakeKGate          — K < wakeK 时 sleeping              │
│     2. PeakKGate          — K > peakK 时退出                   │
│     3. StyleTemplateFilter — per-mgStyle template INTERSECTION │
│     4. EnergyFilter       — energy 密度档 INTERSECTION         │
│     5. MusicianPrefFilter — musician 卡 sectionRolePreference  │
│   apex 例外:isApex && energy>=7 → 前 4 filter bypass(尊重 #5) │
│   Z3 continuity:prev 上岗时 wakeK/peakK 给 ±0.15 容差          │
│   全部 zero PRNG 消耗;加/减/调 filter 改 plugins/conductor/index.ts 数组 │
│   → SectionAssignment[](per section per musician → roles)     │
└────────────────────────────────────────────────────────────────┘
        ↓
┌─ 3. Arranger ─────────────────────────────────────────────────┐
│ af2-engine/Af2Arranger.ts                                      │
│   per section:从 SECTION_POOLS_BY_STYLE[mgStyle][sectionType] │
│     抽进行 → 累积成全曲 abstractPath                            │
│   L 阶段(2026-05-24)2 planner 双 pass:                       │
│     · BorrowChordPlanner — 7 rule × 3 source 锁定 × 5 防呆    │
│       (POP 0.45/3 | JAZZ 0.35/4 | RNB 0.55/5 | BLUES 0)       │
│     · TonicizationPlanner — 4 placement × target mult × cooldown│
│       (POP 0.30/2 | JAZZ 0.65/4 | RNB 0.40/3 | BLUES 0)       │
│   → Af2AbstractStep[](roman + type + rootOffset)             │
└────────────────────────────────────────────────────────────────┘
        ↓
┌─ 4. Composer(orchestrator + DynamicHarmonyDecorator plugin)──┐
│ af2-engine/Af2Composer.ts — orchestrator(2026-05-25 decorator 拆 plugin) │
│   per step + Look-ahead next:                                  │
│     1. plugins/composer/DynamicHarmonyDecorator(全 decoration):│
│        · lockType skip(Planner 已锁,2 PRNG ceremony)         │
│        · colorLevel roll(per-mgStyle 0/1/2 概率)              │
│        · DYNAMIC_TSD[mgStyle][T/S/D].find(target) pick type    │
│        · Sub-V activation(D + fifth-down + tritoneProb)       │
│        · data-debt guard(downgrade unknown type)               │
│     2. assembleVoicing(per-mgStyle mode):                     │
│        POP=full / JAZZ=rootless / RNB=cluster / BLUES=blues    │
│        含 addColorOnTriad + clash detection + density 优先 drop │
│     3. placeVoicingMidi → voice-leading + chord range placement │
│     4. spellPcInKey / midiToNoteInChord → 拼写                 │
│     5. smoothChordVoicings post-pass(R 阶段,事实 plugin)      │
│   → ChordDef[](voicing + bass + chordSymbol)                  │
└────────────────────────────────────────────────────────────────┘
        ↓ (转 GeneratedChord IR)
┌─ 5. Dispatcher ───────────────────────────────────────────────┐
│ af2-engine/Dispatcher.ts — dispatchMusicians(score, ...)       │
│   顺序 melody → bass → accomp → drums → pad(N6 重排)         │
│   每 step 把前面 emit 的 notes 累积到 peers                    │
│   → Map<musicianId, NoteData[]>                                │
└────────────────────────────────────────────────────────────────┘
        ↓ (per musician)
┌─ 6. 乐手 idiom plan() ────────────────────────────────────────┐
│ af2-engine/instruments/PianoIdiom.planMelody/Accomp/Bass      │
│ af2-engine/instruments/BassIdiom.plan (WALK_PATTERNS 渲染)    │
│ af2-engine/instruments/DrumIdiom.DrumGenerator.plan           │
│ af2-engine/instruments/PadIdiom.PadGenerator.plan             │
│ + Af2MelodyGen.generateAf2Melody (PianoIdiom 调)              │
│ + Af2AccompGen.generateAf2Accomp (PianoIdiom 调)              │
│   musician.af2Overrides 控制:                                  │
│     - regions / escapeProbability(音区 phase)                 │
│     - add11GateProbability(物理 phase)                        │
│     - melodyAlgorithm / accompAlgorithm('af2' | 'mg')         │
│     - sectionRolePreference(per-section role override)        │
│   persona DNA(sparsityTendency / syncopationAssault /        │
│              dynamicRange / colorBias)真实影响算法行为        │
│   → NoteData[] per musician                                    │
└────────────────────────────────────────────────────────────────┘
        ↓
┌─ 7. Reconciler plugin chain(无 core,3 plugin 顺序叠加)─────┐
│ af2-engine/plugins/reconciler/(2026-05-25 拆 plugin)         │
│   EnergyHumanizer  v1.0 — 段落能量驱动 velocity              │
│   CollisionDamper  v1.1 — accomp 撞 bass/melody 时 ×0.5      │
│   DropBuildupDynamics v1.2 — Drop/BuildUp kind-specific 动态 │
│   pitch 协调(如 add11)已下沉到 PianoIdiom 内部,此层 velocity-only │
│   全部 zero PRNG 消耗;任一 plugin 拔掉听感劣化但不破坏正确性  │
└────────────────────────────────────────────────────────────────┘
        ↓
┌─ 8. GM128 装配 ────────────────────────────────────────────────┐
│ Af2EngineFacade Step 6b                                        │
│ gmProgramOverrides 优先级链:                                   │
│   forcedGmPrograms > musician.gmProgramOverride > musician.    │
│   defaultSound > AF2 idiom 默认                                │
│ → GeneratedTrack + MusicContext                                │
└────────────────────────────────────────────────────────────────┘
        ↓
   AbsoluteTransposer (K-2 唯一加 keyOffset 点)
        ↓
   MidiConverter → PlaybackEngine → 音频输出
```

---

## 2. 单一真理之源(改 X 去哪个文件)

修改前先查这张表,**禁止在错位置实现**。

| 修改诉求 | 必须改 | 禁止改 |
|---------|--------|--------|
| 和弦进行池(per mgStyle × sectionType) | `af2-engine/Af2Arranger.ts` 的 `SECTION_POOLS_BY_STYLE` | 任何其他位置硬编 progression |
| Modal interchange(7 rule × 3 source) | `af2-engine/BorrowChordPlanner.ts` 的 `RULES` / `STYLE_BORROW_PROB` / `STYLE_MAX_BORROWS_PER_SONG` | 不要散到 Arranger / Composer |
| Tonicization / 二级属(4 placement) | `af2-engine/TonicizationPlanner.ts` 的 `STYLE_TONICIZE_PROB` / `STYLE_PLACEMENT_WEIGHTS` / `TARGET_MULT` | 不要散到 Arranger / Composer |
| Voicing 算法 / placeVoicingMidi | `af2-engine/music-theory/voicing.ts`(+ `Af2Composer.ts` 调用层) | 不要在各 Idiom 重写 voicing |
| Dynamic TSD chord type 字典(Look-ahead) | `af2-engine/DynamicHarmony.ts` 的 `DYNAMIC_TSD_DICTIONARY` + `COLOR_LEVEL_PROBABILITIES` + `analyzeTargetQuality` | 不要散到 Composer / Arranger |
| Sub-V tritone substitution 触发 | `af2-engine/DynamicHarmony.ts` 的 rule.`tritoneProb` + `plugins/composer/DynamicHarmonyDecorator.ts` 内 Sub-V override(2026-05-25 拆 plugin) | 不要在 Arranger borrow 处做 |
| Chord-type decoration(colorLevel / TSD / Sub-V / data-debt guard) | `af2-engine/plugins/composer/DynamicHarmonyDecorator.ts`(2026-05-25 拆 plugin;原 Af2Composer.decorateChordType) | 不要散到 Composer 主循环 |
| Per-mgStyle 默认 voicing mode(shell/rootless/cluster/full/blues) | `af2-engine/Af2Composer.ts` 的 `DEFAULT_VOICING_MODE_BY_STYLE` | 不要 musician 卡 override(voicing mode 是风格属性) |
| Voicing PCs assembly(addColor + clash + density) | `af2-engine/music-theory/voicing.ts` 的 `assembleVoicing` | Composer 一律走它,不要 inline pcs 计算 |
| Chord type interval 表 | `af2-engine/music-theory/chord-types.ts` 的 `CHORD_TYPES` | 不要硬编到具体 idiom |
| Conductor 编排决策(template / variant) | `af2-engine/Conductor.ts` 的 `CONDUCTOR_TEMPLATE_VARIANTS_BY_STYLE` + `DynamicConductor.dispatch` | 不要在 Dispatcher / Idiom 加 role gate |
| Conductor 5 层 filter(WakeK / PeakK / Template / Energy / Pref) | `af2-engine/plugins/conductor/{WakeKGate,PeakKGate,StyleTemplateFilter,EnergyFilter,MusicianPrefFilter}.ts` + `index.ts` 的 `DEFAULT_ROLE_FILTERS` 数组(2026-05-25 拆 plugin) | 不要散到 Conductor.ts 内部硬编 if 链 |
| Conductor filter 顺序 / 启停 | `af2-engine/plugins/conductor/index.ts` 的 `DEFAULT_ROLE_FILTERS` 数组 | 不要 fork dispatch 跳过某 filter |
| 乐手 idiom 实装(钢琴/贝斯/鼓/Pad) | `af2-engine/instruments/{Piano,Bass,Drum,Pad}Idiom.ts` | 不要在 Dispatcher 加渲染逻辑 |
| 钢琴 melody orchestrator(core) | `af2-engine/Af2MelodyGen.ts`(generateAf2Melody — 主循环 / role gate / chord-tone cycle / placeNearAnchor) | 不要在 PianoIdiom 直接写算法 |
| 钢琴 melody 6 plugin(rhythm / contour / passing / phrase end / sparsity / velocity) | `af2-engine/plugins/melody/{RhythmPatternPicker,PhraseContourShaper,PassingToneSelector,PhraseEndingDecider,SparsityGate,VelocityHumanizer}.ts`(2026-05-25 拆 plugin) | 不要把 plugin 决策搬回 orchestrator |
| 钢琴 accomp orchestrator(core) | `af2-engine/Af2AccompGen.ts`(generateAf2Accomp — pickTextureType / family dispatch / velocity persona 重映射) | 不要在 PianoIdiom 直接写算法 |
| 钢琴 accomp post-pass 3 plugin(duck / swing / micro-timing) | `af2-engine/plugins/accomp/{MelodyDensityDucker,SwingApplier,MicroTimingHumanizer}.ts`(2026-05-25 拆 plugin) | 不要把 post-pass 决策搬回 orchestrator;swing 必须早于 micro-timing |
| Bass walking 模式 | `af2-engine/instruments/BassIdiom.ts` 的 `renderAf2Walking` + `data/BassWalkPatterns.ts` 的 `WALK_PATTERNS` | 不要在 Composer 改 bass |
| 鼓组 grid | `af2-engine/instruments/drum-grid/grids/` per-mgStyle 配置 | 不要在 DrumIdiom 硬编 |
| 鼓组 orchestrator(主循环 + PRNG 3 gate + role gate) | `af2-engine/instruments/DrumIdiom.ts` 的 `renderSection` + `DrumGenerator` | 不要分散 |
| 鼓组 3 Modifier(pre-PRNG prob 调整) | `af2-engine/plugins/drum/{PersonaSparsity,CrossTrackModifier,PersonaSyncopation}.ts`(2026-05-25 拆 plugin) | 不要把 modifier 逻辑搬回 orchestrator |
| 鼓组 5 Override(post-PRNG hit state) | `af2-engine/plugins/drum/{Break,Crash,Fill,Ride,OpenHihat}Override.ts`(2026-05-25 拆 plugin) | 不要把 override 决策搬回 orchestrator |
| Drum plugin 链顺序 | `af2-engine/plugins/drum/index.ts` 的 `DEFAULT_DRUM_MODIFIERS` / `EXCLUSIVE_DRUM_OVERRIDES` / `INDEPENDENT_DRUM_OVERRIDES` | Modifier 顺序敏感(Sparsity→CrossTrack→Sync);Override 互斥链 first-match short-circuit |
| Pad voicing slice / attack / velocity | `af2-engine/instruments/PadIdiom.ts`(PadGenerator)| 不要分散 |
| Dispatcher 顺序 / peers 累积 | `af2-engine/Dispatcher.ts` 的 `dispatchMusicians` 中 steps 数组顺序 | 不要在 idiom 互相 import |
| Reconciler velocity 调整 | `af2-engine/plugins/reconciler/{EnergyHumanizer,CollisionDamper,DropBuildupDynamics}.ts`(2026-05-25 拆 plugin) | 不要在各 musician plan() 内调 velocity |
| musician 卡个性 | `idioms/MusicianRegistry.ts` 的 `af2Overrides` + `persona` | 不要在 PianoIdiom 内硬编 musician 行为 |
| Note 拼写 / KEYS / midiToNote | `af2-engine/music-theory/spell.ts` | 不要重写 |
| PRNG 类 / 字符串 fork | `af2-engine/utils/Random.ts`(标准 Random class)| 不要 `Math.random()` |
| ChordDef IR 类型 | `af2-engine/types/ChordDef.ts` | 不要复制定义 |
| RELATIVE → ABSOLUTE 转换 | `pipeline/AbsoluteTransposer.ts`(K-2 唯一点)| 任何上游 |
| Channel 路由 / GM 程式 | `audio/MidiConverter.ts` + `data/GMSoundMap.ts` | 不要在 musician 直接发 channel |
| runPipeline 入口 | `pipeline/index.ts` 已是 thin shim,真正逻辑在 `Af2EngineFacade.generate` | 不要在 pipeline/index.ts 加业务逻辑 |
| App 跨 store 状态 | `state/BandSelectionStore.ts` / `state/EngineSelectionStore.ts` | 不要 useState 私藏 |

---

## 3. 三大不变式(违反 = 必坏)

### 3.1 Pitch Space 三空间(K-1 / K-2 / K-7 / K-8)

- **RELATIVE 空间**:Arranger / Composer / Dispatcher / Idiom 全程使用,pitch 不含 keyOffset
- **ABSOLUTE 空间**:`AbsoluteTransposer.arrange()` 之后,pitch = relative + keyOffset,clamp [0,127]
- **GM Drum Map 第三空间**:Drums 轨 pitch 是物理键位(36-81),AbsoluteTransposer **不加 keyOffset**
- **K-2 铁律**:AbsoluteTransposer 之前的任何模块**禁止**给 `NoteData.pitch` 加 `keyOffset`

### 3.2 PRNG 序列(D-5)

- 主流:`PRNGManager.next()`(Apps / Facade 顶层抽种子用)
- 子流:`new Random(seedString)` from `af2-engine/utils/Random.ts`(per-engine 独立 stream)
- **禁止** `Math.random()`
- 算法不变的重构 → PRNG 调用顺序必须 verbatim 一致
- 部分模块**完全决定性**(deterministic hash gate,零 PRNG 消耗):
  - Af2MelodyGen / Af2AccompGen(rhythm pattern / passing tone / pattern 选择都是 hash)
  - PadGenerator(slice mode 选 hash)
  - Conductor template 抽 variant(seed XOR styleHash)
- Forked sub-stream(KernelDriver 在 invoke 内 fork,与主 rng 隔离):
  - `${seed}::borrow-source` — Borrow 单 source 锁定(80/12/8)抽 1 个
  - `${seed}::borrow` — BorrowChordPlanner 主 PRNG 流
  - `${seed}::tonicize` — TonicizationPlanner 主 PRNG 流(每 slot 1-2 rolls)
  - `af2_drum_${seed}` — DrumGenerator

### 3.3 数据契约(types.ts + ir/)

- IR 字段**只增不减**;删除前跨 AF2 评估
- 新字段**必须可选**(`field?: T`)
- `GeneratedChord.voicing` 在 RELATIVE 空间;AbsoluteTransposer 之后才转 ABSOLUTE
- `NoteData.velocity` 是 [0,1] float
- `SectionMetadata.startBeat/endBeat` 是拍数 float

---

## 4. 改动前决策树

```
要改的是什么?
├─ 音乐算法(进行池 / voicing / 织体 / groove)
│  └─ 查 §2 单一真理之源表 → 改对应模块
│
├─ 重命名 / 移动文件
│  └─ git mv + grep callsite + 全部更新 + lint 必过
│
├─ 加新乐器(钢琴/贝斯/鼓/Pad 之外)
│  ├─ 新建 instruments/XxxIdiom.ts(plan(input): NoteData[])
│  ├─ Conductor template 加新 role(若需要)
│  ├─ Dispatcher steps 数组加新 step
│  ├─ Af2EngineFacade 加 step 调用
│  └─ MusicianRegistry 加 musician 卡
│
├─ 加新 mgStyle(POP/JAZZ/BLUES/RNB 之外)
│  ├─ EngineSelectionStore MgStyle union 加新值
│  ├─ Af2Arranger SECTION_POOLS_BY_STYLE 加进行池
│  ├─ Af2Composer EXTENSION_PROB 加 Divisi 概率
│  ├─ Conductor CONDUCTOR_TEMPLATE_VARIANTS_BY_STYLE 加 variant
│  ├─ instruments/drum-grid/grids 加 grid
│  └─ MgKernelInvoker MG_STYLE_BARS / BPM 表加
│
├─ 改 IR 类型
│  ├─ 加字段(可选)→ 改 ir/index.ts 或 types.ts
│  └─ 删字段 → 慎重,跨 AF2 评估
│
└─ 修 bug
   └─ 先决定是否改变听感:
      bit-exact 修(行为不变)vs 行为修(听感改)
```

---

## 5. 模块依赖规则

```
af2-engine/             ← 唯一活跃引擎
├─ utils/               ← Random / TopologyMutator(底层 helpers)
├─ types/               ← ChordDef(本地 IR)
├─ music-theory/        ← MIDI / mode / scale / chord-types /
│                        chord-detection / chord-color / voicing /
│                        tendency / cadence / spell(数学+理论)
├─ instruments/         ← 5 个 idiom(Piano/Bass/Drum/Pad)+ drum-grid
│   └─ DrumIdiom.ts     ← orchestrator(主循环 + PRNG 3 gate + role gate)
├─ plugins/drum/        ← 3 Modifier + 5 Override(2026-05-25 拆 plugin)
├─ chord-texture/       ← N+N5 阶段(2026-05-24)mg 移植 23 family + Engine + Mapping
│   ├─ types.ts             ─ FamilyName(23)/ FamilyParams / NoteEvent
│   ├─ PitchPrimitives.ts   ─ bassMidi / chordVoicing / quality intervals
│   ├─ adapter.ts           ─ GeneratedChord → ChordDef
│   ├─ ChordTextureEngine.ts─ dispatcher(23 case)+ NoteEvent→NoteData adapter
│   ├─ TextureTypeMapping.ts─ textureType → {family, params}(38 个,1 待 N6)
│   └─ families/            ─ 23 个 family:
│                              N(8): Sustained/PopAnthem/PopBroken8th/JazzCharleston/
│                                    Bossa/BoogieWalk/GhostStab/PureArp
│                              N5(15): PureWalk/WalkingBass/Hemiola/PureStab/
│                                      ScratchSlap/ShuffleChop/OstinatoLayered/
│                                      Triplet/Roll/BlockLayered/SweepProgressive/
│                                      GrooveDelay/SpecialVoicing/DoubleStopTremolo/
│                                      AnticipatedBlock
│                              N6 待移植: CallAndResponse(需 cross-track melody peers)
├─ Score.ts             ← 总谱契约
├─ Conductor.ts         ← 编排决策 core(template + DynamicConductor.dispatch)
├─ plugins/conductor/   ← 5 RoleFilter plugin chain(WakeK/PeakK/Template/Energy/Pref + types.ts + index.ts)
├─ Af2Arranger.ts       ← 进行决策 + 接 2 planner
├─ BorrowChordPlanner.ts← Modal interchange(7 rule × 3 source 锁定)
├─ TonicizationPlanner.ts← Tonicization(4 placement × target mult)
├─ DynamicHarmony.ts    ← TSD 字典 + Sub-V(Composer Look-ahead 用)
├─ Af2Composer.ts       ← orchestrator(主循环 + assembleVoicing + placeVoicingMidi + smoothChordVoicings)
├─ plugins/composer/    ← DynamicHarmonyDecorator(chord-type decoration:TSD/colorLevel/Sub-V/data-debt)
├─ Dispatcher.ts        ← 调用顺序
├─ Af2MelodyGen.ts      ← melody orchestrator(core:role gate + cycle + placeNearAnchor)
├─ plugins/melody/      ← 6 plugin(RhythmPattern / PhraseContour / PassingTone / PhraseEnding / Sparsity / Velocity)
├─ Af2AccompGen.ts      ← accomp orchestrator(core:pickTextureType + family dispatch + velocity persona)
├─ plugins/accomp/      ← 3 post-pass plugin(MelodyDensityDucker / SwingApplier / MicroTimingHumanizer)
├─ plugins/reconciler/  ← velocity plugin chain(EnergyHumanizer / CollisionDamper / DropBuildupDynamics + types.ts)
├─ SectionPlanner.ts    ← 段落生成
├─ SectionMapper.ts     ← events 段落标注
├─ SlotRouter.ts        ← Band 槽位路由
├─ MgKernelInvoker.ts   ← AF2 chord 生成入口(命名遗留,内部全 AF2)
└─ Af2EngineFacade.ts   ← 顶层 facade

types.ts + ir/          ← 共享 IR(全跨模块可依赖)
config/                 ← StyleFlags / StyleRegistry(stub)/ styles(stub)
idioms/MusicianRegistry ← musician 卡定义
data/                   ← BassWalkPatterns / GMSoundMap(剩余 2 个)
pipeline/               ← 仅 index.ts(thin shim)+ AbsoluteTransposer
state/                  ← BandSelectionStore / EngineSelectionStore
utils/                  ← PRNGManager
```

**禁止**:
- 循环依赖
- `pipeline/` 任何文件(除 AbsoluteTransposer)再被加新代码
- `MelodyEngine.ts`(已删,不要重建 thin wrapper)

---

## 6. 抽取/重命名 SOP

1. **算法 verbatim 搬运** — 不"顺便优化"
2. **先创建新模块,callsite 更新,再删旧文件** — 中间状态 lint 必过
3. **Comment 保留 "原 X.Y" 痕迹** — 后续可 grep 追溯
4. **PRNG-sensitive 模块抽取需格外仔细**
5. **重命名时 grep 必扫**:
   - 类/函数名:`grep -rn "OldName" src/`
   - 文件路径 import:`grep -rn "from.*OldFileName" src/`
6. **commit message 必须说清楚**:
   - 算法搬运还是优化?
   - 听感不变 / 改变?
   - 改变 PRNG 消耗?

---

## 7. 反模式禁区

不要做:

- ❌ 重建 `mg-engine/`(已删,不要复活;mg 算法已彻底放弃)
- ❌ 重建 `pipeline/HarmonyCore.ts` / `Conductor.ts`(旧 AF,已删;新 Conductor 在 af2-engine/)
- ❌ 重建 `primitives/PianoAccompIdiom.ts`(已删;新 idiom 在 af2-engine/instruments/)
- ❌ AbsoluteTransposer 之前任何模块给 pitch 加 keyOffset(K-2 铁律)
- ❌ `Math.random()`(用 `Random` 或 `PRNGManager`)
- ❌ App 直接 import `af2-engine/*`(必须通过 `runPipeline`)
- ❌ App 直接 import `primitives/*`(已不存在;但即使你想重建也禁止)
- ❌ 在 Idiom 内做编排决策(那是 Conductor 职责;Idiom 只渲染)
- ❌ 在 Dispatcher 内做 musician 算法(那是 Idiom 职责)
- ❌ 在 Composer 内做 voicing 物理(那是 music-theory.placeVoicingMidi 职责)
- ❌ 跳过 Dispatcher 直接拼 5 轨(Dispatcher 是唯一调用乐手 plan() 的地方)

---

## 8. 乐器修改速查

按"想优化什么"反查文件,避免在错位置改。

### 8.1 钢琴(PianoIdiom / Af2MelodyGen / Af2AccompGen)

| 想优化什么 | 主要改哪 |
|------------|---------|
| Melody 节奏 pattern(per mgStyle) | `plugins/melody/RhythmPatternPicker.ts` 的 `RHYTHM_PATTERNS_BY_STYLE` |
| Melody phrase contour(arch/up/down)| `plugins/melody/PhraseContourShaper.ts` |
| Melody chord-tone cycle [root,5,3,7] | `Af2MelodyGen.generateAf2Melody` 主循环内 cyclePcs 构造(core,不在 plugin)|
| Melody passing tone | `plugins/melody/PassingToneSelector.ts`(gate + pick 两 method)|
| Melody phrase ending | `plugins/melody/PhraseEndingDecider.ts` |
| Melody sparsity / velocity | `plugins/melody/{SparsityGate,VelocityHumanizer}.ts` |
| Accomp textureType 池(per mgStyle × sectionType) | `Af2AccompGen.STYLE_TEXTURE_POOL` + `pickTextureType` |
| Chord 演绎 family(8 个,如 PopAnthem/JazzCharleston/Bossa/BoogieWalk/GhostStab/PureArp/PopBroken8th/Sustained) | `af2-engine/chord-texture/families/*.ts` | 不要在 AccompGen 重新实装演绎逻辑 |
| Chord 演绎 textureType → family + params 映射 | `af2-engine/chord-texture/TextureTypeMapping.ts` `TEXTURE_MAPPING` | 加新 textureType 必须同步 family case |
| Chord 演绎 dispatch + NoteEvent → NoteData adapter | `af2-engine/chord-texture/ChordTextureEngine.ts` | 不要绕过 dispatcher 直接调 family |
| Accomp velocity 重映射 to persona | `Af2AccompGen.generateAf2Accomp` 末尾 dynamic loop(orchestrator core) |
| Accomp melody-aware density ducking(T 阶段) | `af2-engine/plugins/accomp/MelodyDensityDucker.ts` |
| Accomp per-mgStyle swing 8th and(Z1b 阶段) | `af2-engine/plugins/accomp/SwingApplier.ts` |
| Accomp 同 onset cluster strum micro-delay(U 阶段) | `af2-engine/plugins/accomp/MicroTimingHumanizer.ts` |
| add11 物理触发 | `PianoIdiom.applyAdd11HandPhysics` |
| 主区 / 越界自然感 | `PianoIdiom.PIANO_REGIONS` + `applyRegionProbability` |
| musician 卡个性 | `MusicianRegistry` 的 `af2Overrides`(regions/escape/add11Gate/algorithm) |

### 8.2 贝斯(BassIdiom)

| 想优化什么 | 主要改哪 |
|------------|---------|
| Walking pattern(HalfNote/LatinTumbao/Stride/等)| `data/BassWalkPatterns.ts` `WALK_PATTERNS` |
| Per-mgStyle 默认 walking | `BassIdiom.DEFAULT_WALK_PATTERN_BY_STYLE` |
| Swing 比例 | `BassIdiom.SWING_RATIO_BY_PATTERN` |
| Dynamic accent(down/off-beat)| `BassIdiom.ACCENT_DOWN/OFF` |
| 物理音域 / anchor | `BassIdiom.BASS_INSTRUMENT_SPEC` + `BASS_ANCHOR_MIDI` |
| 选哪个 pattern 给 musician(override mgStyle 默认) | `MusicianRegistry` 的 `persona.walkPatternId` |
| musician 加 section preference | `MusicianRegistry` 的 `af2Overrides.sectionRolePreference` |

### 8.3 鼓组(DrumIdiom)

| 想优化什么 | 主要改哪 |
|------------|---------|
| Per-mgStyle drum grid | `instruments/drum-grid/grids/{Pop,Jazz,Blues,Rnb}.ts` |
| Crash / Fill / Break / Ride / OpenHihat 触发 | `af2-engine/plugins/drum/*.ts`(5 个 Override plugin,2026-05-25) |
| Persona sparsity / syncopation 接入 | `af2-engine/plugins/drum/{PersonaSparsity,PersonaSyncopation}.ts`(2026-05-25 拆 plugin) |
| Bass-kick interlock 阈值 | `af2-engine/plugins/drum/CrossTrackModifier.ts` 的 `BASS_STRONG_VEL` + `hasBassStrongNear`(2026-05-25 拆 plugin) |

### 8.4 氛围(PadIdiom)

| 想优化什么 | 主要改哪 |
|------------|---------|
| Voicing slice(Low/Mid/High)per-sectionType 偏好 | `PadIdiom.SECTION_SLICE_POOL` |
| Attack pre-roll | `PadIdiom.attackPreRoll` |
| BuildUp velocity ramp | `PadIdiom.plan()` BuildUp 分支 |
| Pad 音域 / pad 中心区 | `PadIdiom.PAD_INSTRUMENT_SPEC` + `PAD_CENTER_LO/HI` |
| Persona colorBias 加权 | `PadIdiom.pickSliceMode` |

---

## 9. 模块命名约定

| 后缀 | 语义 | 例子 |
|------|------|------|
| `*Idiom` | 乐器渲染器(class 或 const)| PianoIdiom / BassIdiom / DrumIdiom / PadIdiom |
| `*Generator` | musician 生成器(plan() 协议实现)| DrumGenerator / PadGenerator |
| `*Gen` | 算法实现(独立模块,被 Idiom 调用)| Af2MelodyGen / Af2AccompGen |
| `Af2*` | AF2 自家命名(区别历史 AF/MG)| Af2Arranger / Af2Composer / Af2EngineFacade |
| `*Router` | 路由 | SlotRouter |
| `*Planner` | 规划 | SectionPlanner |
| `*Mapper` | 标注/映射 | SectionMapper |
| `*Reconciler` | 协调/调整 | Reconciler |
| `*Conductor` | 编排决策 | DynamicConductor |
| `*Dispatcher` | 调用协调 | Dispatcher |
| `*Transposer` | 空间转换 | AbsoluteTransposer |
| `*Manager` | 全局可变状态(应少用) | PRNGManager |

---

## 10. 历史里程碑

- 2026-05-21:三引擎(AF/MG/AF2)分流上线
- 2026-05-22:mg.Engine class 解构 → engine-utils free function 库
- 2026-05-24 上午:AF2 8 层架构完整化(32 commits 单日)
- 2026-05-24 下午:**AF2 唯一内核里程碑** — 删 AF/MG + mg-engine,净 -33,700 行 dead code

---

## 11. 本文件维护承诺

- 改本文件**不需要** lint
- 但每次 AF2 内核重构 → 同步更新本文件
- 发现本文件与实现不符 → 优先更新本文件(它是真理之源)
- 命名变更(类 / 文件)→ 更新 §2 单一真理之源表 + §8 乐器速查表
