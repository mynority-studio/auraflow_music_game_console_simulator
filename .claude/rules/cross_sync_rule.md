# Cross-Sync Rule — AF2 跨模块同步规则

> **改任何"会牵动其他文件"的东西之前先读完。**
> 历史教训:加新字段 / 改 enum 顺序 / 改 PRNG 消耗 都可能 silently 破坏听感
> 或导致跨模块对账失败。

**本文件描述 AF2 唯一内核(2026-05-24 删 AF/MG 后)的关联变更登记表**。
旧 AF / MG 时代登记的关联组(VoiceRole / RenderContext / Stage5Bundle / 等)
已**全部作废**(对应模块已物理删除)。

---

## 0. 何时必读本文件

任一条件命中,**先读完再动手**:

- 改 IR 字段(`types.ts` / `ir/index.ts` / `af2-engine/types/ChordDef.ts`)
- 改任何 enum 的数值或顺序(尤其 `SectionType` / `ChordQuality` / `BandRole` /
  `MgStyle` / `InstrumentFamily` / `WalkPatternId`)
- 改任何函数的 PRNG 消耗
- 加新 BandRole / 新 Musician / 新 mgStyle / 新 SectionType
- 改 `PipelineRunOptions` / `AudioEngine` 公开方法签名
- 改 `Score` / `MusicianPlanInput` / `SectionAssignment` 接口
- 改 musician `af2Overrides` 字段集
- 重命名跨 5 处以上 src 引用的模块/类/接口

---

## 1. 已登记的关联变更组

> 每组三段:**触发器** / **必须同步位置** / **风险等级**
> - **高**:silently 破坏(lint 不报错,但生成错位 / 听感坏)
> - **中**:lint 能拦,但漏改一处运行时崩
> - **低**:只影响文档/规则同步

### 1.1 PipelineRunOptions ↔ 所有 App 自动继承(Single Pipeline 原则)

- **触发器**:
  - 改 `pipeline/index.ts` `PipelineRunOptions` 字段(增/删/改)
  - 改 `Af2EngineFacade.generate` 输入参数 / 输出 schema
- **必须同步**:
  - PipelineMonitor.handlePlay → 跑试听
  - AuraBar.EndlessRadioManager.triggerGeneration → 试听
  - AuraJam.JamSessionManager.triggerGeneration → 试听
  - 3 个 app 行为必须一致 — 不一致即 Single Pipeline 违规
  - `.claude/rules/app_integration_rule.md` §3 PipelineRunOptions 字段表更新
- **反向触发**:加新跨 app 配置 → 必须 3 个 app 都消费(类 BandSelectionStore 模式)
- **违规检测**:`grep -rn "from.*af2-engine/" src/apps/` 应为空
- **风险**:**中**(违反原则会让 app 间听感不同)

### 1.2 Score ↔ MusicianPlanInput ↔ 6 个 musician.plan()

- **触发器**:
  - 改 `af2-engine/Score.ts` `Score` interface
  - 改 `af2-engine/Conductor.ts` `MusicianPlanInput` / `SectionAssignment`
- **必须同步**:
  - 6 个 plan() 消费方:
    - `instruments/PianoIdiom.ts` planMelody / planAccomp / planBass
    - `instruments/BassIdiom.ts` plan
    - `instruments/DrumIdiom.ts` DrumGenerator.plan(用 DrumPlanInput 扩展)
    - `instruments/PadIdiom.ts` PadGenerator.plan
  - 算法模块(从 plan() 调出去):
    - `Af2MelodyGen.generateAf2Melody`
    - `Af2AccompGen.generateAf2Accomp`
  - `af2-engine/Dispatcher.ts` `dispatchMusicians` 构造 input
  - `af2-engine/Af2EngineFacade.ts` Step 4.1 + Step 5 装配
- **风险**:**中**(lint 能拦,但 ≥6 处 callsite 漏改易报错)

### 1.3 SectionType 枚举 ↔ Conductor 模板 / Arranger 池 / Pad slice / Accomp pool

- **触发器**:`types.ts` 中 `SectionType` enum 数值变更或新增段落类型
- **必须同步**:
  - `af2-engine/Conductor.ts`:
    - `DEFAULT_CONDUCTOR_TEMPLATE`
    - `CONDUCTOR_TEMPLATE_VARIANTS_BY_STYLE`(POP/JAZZ/RNB 各 variant)
    - `POP_MINIMAL` / `POP_DENSE` / `JAZZ_INTRO_SOLO` / `JAZZ_QUIET` / `RNB_AIRY`
  - `af2-engine/Af2Arranger.ts`:
    - `DEFAULT_BY_SECTION`
    - `SECTION_POOLS_BY_STYLE`(POP/JAZZ/BLUES/RNB 各 sectionType 池)
  - `af2-engine/Af2AccompGen.ts` `SECTION_ACCOMP_POOL`
  - `af2-engine/Af2MelodyGen.ts` `phraseContourBias`(per sectionType bias)
  - `af2-engine/instruments/PadIdiom.ts` `SECTION_SLICE_POOL` + `attackPreRoll`
  - `af2-engine/SectionPlanner.ts` 段落生成(structureTemplate)
- **风险**:**高**(新 sectionType 漏配 → fallback 到 default 听感不符,silently)

### 1.4 ChordQuality 枚举 ↔ Composer interval / Af2MelodyGen / BassIdiom 选音

- **触发器**:`types.ts` `ChordQuality` enum 变更或新 quality
- **必须同步**:
  - `af2-engine/Af2Composer.ts` `MG_TYPE_TO_QUALITY` 表(string → enum)
  - `af2-engine/MgKernelInvoker.ts` `MG_TYPE_TO_QUALITY` 表(同上,镜像)
  - `af2-engine/DynamicHarmony.ts` `DYNAMIC_TSD_DICTIONARY` per-quality 字段(M 阶段,2026-05-24)
  - `af2-engine/Af2MelodyGen.ts` `thirdInterval` / `fifthInterval` / `seventhInterval`
  - `af2-engine/instruments/BassIdiom.ts` `thirdInterval` / `fifthInterval`
  - `af2-engine/music-theory/chord-types.ts` `CHORD_TYPES`
- **风险**:**高**(quality 漏配 → fallback Major triad,色彩消失)

### 1.5 MgStyle 枚举 ↔ Arranger / Composer / Conductor / Drum-grid / Idiom 节奏池

- **触发器**:`state/EngineSelectionStore.ts` `MgStyle` union 变更或新增风格
- **必须同步**:
  - `af2-engine/Af2Arranger.ts` `AF2_PROGRESSION_POOL` + `SECTION_POOLS_BY_STYLE`
  - `af2-engine/BorrowChordPlanner.ts` `STYLE_BORROW_PROB` + `STYLE_MAX_BORROWS_PER_SONG`(L 阶段,2026-05-24)
  - `af2-engine/TonicizationPlanner.ts` `STYLE_TONICIZE_PROB` + `STYLE_TONICIZE_MAX_PER_SONG` + `STYLE_PLACEMENT_WEIGHTS`(L 阶段)
  - `af2-engine/DynamicHarmony.ts` `DYNAMIC_TSD_DICTIONARY[mgStyle]` + `COLOR_LEVEL_PROBABILITIES[mgStyle]`(M 阶段,2026-05-24)
  - `af2-engine/Af2Composer.ts` `DEFAULT_VOICING_MODE_BY_STYLE[mgStyle]`(M 阶段)
  - `af2-engine/Conductor.ts` `CONDUCTOR_TEMPLATES_BY_STYLE` +
    `CONDUCTOR_TEMPLATE_VARIANTS_BY_STYLE`
  - `af2-engine/instruments/drum-grid/grids/` per-style grid 文件
  - `af2-engine/Af2AccompGen.ts` `STYLE_ACCOMP_POOL[mgStyle]`(B2,2026-05-24)
  - `af2-engine/Af2MelodyGen.ts` `RHYTHM_PATTERNS_BY_STYLE[mgStyle]`(B3,2026-05-24)
  - `af2-engine/instruments/BassIdiom.ts` `DEFAULT_WALK_PATTERN_BY_STYLE[mgStyle]`(B4,2026-05-24)
  - `af2-engine/MgKernelInvoker.ts` `MG_STYLE_BARS` + `MG_STYLE_BPM`
  - `af2-engine/Af2EngineFacade.ts` `MG_STYLE_TO_AF_STYLE`
- **风险**:**高**(新 mgStyle 漏配某层 → fallback 行为多端不一致,
  Af2AccompGen/MelodyGen/BassIdiom 缺则 fallback 到 POP 静默劣化)

### 1.6 BandRole 枚举 ↔ Roster / Conductor / SlotRouter / MidiConverter

- **触发器**:`types.ts` `BandRole` enum 加新角色或重命名
- **必须同步**:
  - `af2-engine/Conductor.ts` `Band` 类型 + `buildDefaultByMusician`
  - `af2-engine/SlotRouter.ts` 路由表
  - `idioms/MusicianRegistry.ts` musician `role` / `eligibleRoles`
  - `audio/MidiConverter.ts` + `data/GMSoundMap.ts` channel 分配 + `bandRoleToTrackKeys`
  - `state/BandSelectionStore.ts` BandSelection type
  - `app_integration_rule.md` §3 BandRole 取值文档
- **风险**:**中**(漏一处 → 新角色"看起来在 roster 但不演奏")

### 1.7 WalkPatternId ↔ BassIdiom swing / BassWalkPatterns

- **触发器**:`data/BassWalkPatterns.ts` `WalkPatternId` enum 加新值
- **必须同步**:
  - `data/BassWalkPatterns.ts` `WALK_PATTERNS` 数组(索引 = enum 数值)
  - `af2-engine/instruments/BassIdiom.ts` `SWING_RATIO_BY_PATTERN` 表
- **风险**:**中**(漏配 swing → 默认 0.5 直拍,听感不符)

### 1.8 Af2MusicianOverrides ↔ PianoIdiom / BassIdiom / PadIdiom

- **触发器**:`types.ts` `Af2MusicianOverrides` interface 加字段
- **必须同步**:
  - PianoIdiom 各 planMelody / planAccomp / planBass 消费 `regions` / `escapeProbability`
    / `add11GateProbability` / `melodyAlgorithm` / `accompAlgorithm`
  - BassIdiom.plan 消费 `sectionRolePreference`(via Conductor 已转 SectionAssignment)
  - PadGenerator.plan 消费 `regions`(若加)/ persona DNA
  - Conductor 消费 `sectionRolePreference`
  - 添加新字段 → 同时更新 MusicianRegistry 注释 + engine_architecture_rule §8 乐器速查表
- **风险**:**中**(新字段 musician 卡填了但 idiom 不消费 → 改卡无效果)

### 1.9 Conductor 5 层决策 ↔ persona 字段 / musician 卡

- **触发器**:
  - 改 `Conductor.dispatch` 5 层决策逻辑
  - 加新 persona 字段(wakeK / peakK / isApex / sectionRolePreference / etc.)
- **必须同步**:
  - musician 卡填新字段(MusicianRegistry)
  - 文档 engine_architecture_rule §1 第 2 层 Conductor 5 层说明同步更新
  - 各 musician.persona 默认值(undefined / 0 / 5 / 等)行为兼容性
- **风险**:**中**(改决策顺序但 musician 卡没改默认 → 行为漂移)

### 1.10 PRNG 消耗 ↔ deterministic-hash 模块

- **触发器**:
  - 改任何模块的 `new Random(seedString).next()` 调用次数
  - 把 PRNG 调用换成 hash gate(或反之)
- **必须同步**:
  - 验证 Af2Arranger / Af2Composer 等 PRNG 顺序不变(同 seed 同输出)
  - 文档 engine_architecture_rule §3.2 "完全决定性"清单更新
- **风险**:**中**(改 PRNG 顺序 = 同 seed 不同输出,跨 session debug 失效)

### 1.11 GM Drum Map ↔ DrumIdiom 常量 ↔ MidiConverter Channel 9

- **触发器**:**基本不应该改** — GM 标准
- **必须同步**(若强改):
  - `af2-engine/instruments/DrumIdiom.ts` `DRUM_KICK=36` 等键位常量
  - `audio/MidiConverter.ts` `CHANNEL_DRUMS=9` channel
  - `engine_architecture_rule.md` §3.1 K-8 第三空间说明
- **风险**:**极高**(破 GM 标准 → 所有 SF2 音源加载失败)

### 1.12 BandSelectionStore ↔ 跨 app 配置

- **触发器**:
  - 改 `state/BandSelectionStore.ts` API(setBand / getBand / etc.)
  - 加新跨 app 共享配置(类 BandSelectionStore 的新 store)
- **必须同步**:
  - 3 个 app 全部消费:PipelineMonitor / EndlessRadioManager / JamSessionManager
  - app_integration_rule §0 Single Pipeline 原则文档
  - 任何新 store 必须放在 `state/` 而非 app 各自 useState
- **风险**:**中**(单 app 私藏状态 → 跨 app 行为分裂)

### 1.13 Dispatcher steps 顺序 ↔ peers 可见性

- **触发器**:改 `Af2EngineFacade` 内构造 `steps` 数组的顺序
- **必须同步**:
  - 后置 step 看前面 step emit 的 notes;改顺序前确认依赖关系
  - 当前顺序:bass → accomp → drums → melody → pad
  - drums 消费 bass + accomp peers(kick-bass interlock + chord syncopate)
  - 其他 step 当前**不消费** peers(预留接口)
- **风险**:**中**(改顺序 silently 破坏 cross-track 协调,如 drum 看不到 bass)

---

## 2. 流程

### 2.1 改动前(plan 阶段)

1. **grep 自己要改的标识符**:
   ```bash
   grep -rn "<旧名>\|<结构名>" src/ .claude/rules/
   ```
2. **查本文件 §1** 找匹配的关联变更组
3. **在 plan / commit 描述里把所有同步点列出**

### 2.2 改动中

- 改一个,就近 grep 验证 callsite 全覆盖
- **不允许"先 commit 这个,后面补那个"** — 灰色中间状态风险高于不改
- 多文件改动批量做,一个 commit 完成

### 2.3 改动后

- `npm run lint` — 类型契约对账
- 听感测试 — Pop + JAZZ + RNB 各 seed 至少一遍
- commit message 显式列同步位置 + 风险等级

---

## 3. 添加新关联变更组

发现新的"改 A 忘改 B"踩坑后:

1. **本文件 §1 末尾追加子节**(§1.14, §1.15, ...)
2. **格式三段**:触发器 / 必须同步位置 / 风险等级
3. **风险等级**:严格按 §1 定义
4. **commit 时**:单独 docs commit,message 说明踩坑源头

---

## 4. 旧 AF/MG 关联组的命运

历史上(2026-05-23 前)曾登记的 20+ 关联组(VoiceRole bit 偏移 / Stage5Bundle ↔
HarmonyCore / RenderContext ↔ 4 Idiom / MoodRouter 二维表索引 / 等)**全部作废**
— 对应模块(pipeline/* / primitives/* / mg-engine)已物理删除。

如果未来发现"删 AF 时漏处理"的关联(如某 enum 字段仍被读但 writer 没了),
则按 §3 流程作为新 §1.X 登记。

---

## 5. 与其他规则的关系

- `engine_architecture_rule.md` §2 单一真理之源 — 关注**改什么去哪改**(纵向)
- `engine_architecture_rule.md` §8 乐器速查 — 关注**改某乐器去哪些文件**(横向)
- **本文件**(`cross_sync_rule.md`)— 关注**改某文件必须同时改哪些其他文件**(关联)
- `app_integration_rule.md` — App 视角

三者互补:
1. 先查 `engine_architecture_rule §2/§8` 找主改文件
2. 再查本文件 §1 找需同步的其他文件
3. 改 App 入口契约前查 `app_integration_rule`

---

## 附录:本文件维护承诺

- 改本文件不需要 lint
- 每次发现新关联组 → 追加 §1 子节
- 发现 §1 描述与现状不符 → 优先更新本文件
- 大重构 → 同步审视 §1 各组的"必须同步位置"是否仍准确
