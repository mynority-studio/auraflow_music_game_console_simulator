# Cross-Sync Rule — 跨端/跨模块同步规则

> **改任何"会牵动其他文件"的东西之前先读完。**
> 历史教训:RenderContext 字段加了但 4 个 Idiom Input 接口忘了同步 / VoiceRole 加了枚举但 VoicingMask 位偏移没改 / IR 字段动了但 C 端 sync 漏掉 —— 这些都是 silently 破坏 bit-exact / 编译失败 / sync gap 累积的根因。

本文件维护一份**"关联变更组登记表"**,标注每种改动必须同步的所有位置。所有 dev(包括 AI 助手)在改动前 grep 自己要改的标识符,然后查本文件 §1 找匹配的关联组,把同步点列入 plan。

---

## 0. 何时必读本文件

任一条件命中,**先读完再动手**:

- 改 IR 字段(`src/core/generation/ir/` 下任何 interface / enum)
- 改任何 enum 的数值或顺序(尤其 `SectionType` / `VoiceRole` / `ChordQuality` / `BandRole` / `StyleId` / `InstrumentFamily`)
- 改任何函数的 PRNG 消耗(`PRNGManager.next()` 调用增/减/换序)
- 加新 BandRole / 新 Musician / 新 Style / 新 SectionType / 新 InstrumentFamily
- 改 `PipelineRunOptions` / `AudioEngine` 公开方法签名
- 重命名任何模块、类、接口(尤其跨 src 引用 ≥ 5 处的)
- 准备执行 `/sync-to-c`
- 看到本文件 §4 C 端 gap 想做 sync

---

## 1. 已登记的关联变更组

> 每组三段:**触发器** / **必须同步位置** / **风险等级**
> 风险分级:
> - **高**:silently 破坏(lint 不报错,但生成错位 / golden seed 偏移)
> - **中**:lint 能拦,但漏改一处会运行时崩
> - **低**:只影响文档/规则同步,不影响生成

### 1.1 TS ↔ C 端口同步(任何 IR / PRNG 变更)

- **触发器**:
  - 改任何 `src/core/generation/ir/` 下 interface 字段(NoteData / GeneratedChord / SectionMetadata / VoicedPitch 等)
  - 改任何函数的 PRNG 消耗
  - 任何 enum 数值/顺序变更
- **必须同步**:
  - `/Users/mynority/vibe_coding/auraflow_music_game_console/main/aura_radio/ar4_types.h` struct/enum
  - 重跑 `npm run golden-seed` + `python scripts/json2c.py` → 更新 C 端 `golden_seed_data.h`
  - 执行 `/sync-to-c` 工作流(若 C 端 gap 不大;gap 大见 §4)
  - `.sync_state.json` 更新 `last_sync_ts_commit`
- **风险**:**高**(C 端测试与 TS 不对账,bug 无法跨端追)

### 1.2 VoiceRole 枚举 ↔ VoicingMask 位偏移

- **触发器**:`src/core/generation/ir/index.ts` 中 `VoiceRole` enum 数值变更或新增 role
- **必须同步**:
  - `src/core/generation/pipeline/VoicingMask.ts`:
    - `MASK_ROOT_ONLY / MASK_ROOT_FIFTH / MASK_TRIAD / MASK_SEVENTH / MASK_EXTENDED / MASK_ALL` 常量定义(每常量是 bit 组合)
    - `applyVoicingMask` 中 `(mask >> v.role) & 1` 检测(假设 role 值 ≤ 7)
  - `ir/index.ts` VoiceRole 注释中的"bit 偏移"说明文字
  - `VoicingProcessor.deriveVoiceRole` 返回的 role 值
- **风险**:**高**(silently 错位过滤 — bit 偏移错了,3rd 当 9th 被 mask,听不出明显异常但生成漂移)

### 1.3 SectionType 枚举 ↔ Conductor / VoicingMask / FractalStructureEngine

- **触发器**:`src/core/generation/types.ts` 中 `SectionType` enum 数值变更或新增段落类型
- **必须同步**:
  - `src/core/generation/pipeline/Conductor.ts`:`CONDUCTOR_MASK_BY_SECTION_TYPE` 表(按 sectionType 索引)
  - `src/core/generation/pipeline/VoicingMask.ts`:`computeChordMask` 的 switch case 覆盖
  - `src/core/generation/primitives/FractalStructureEngine.ts`:段落生成的 sectionType 输出
  - `config/styles/*.ts`:`structureTemplates` 中引用的 section types
- **风险**:**高**(新 sectionType 漏配 ConductorMask → 整段静音 / 漏配 VoicingMask → 走 default fallback,色彩不符)

### 1.4 ChordQuality 枚举 ↔ CHORD_INTERVALS / CQ_IS_* / deriveVoiceRole 消歧

- **触发器**:`types.ts` 中 `ChordQuality` enum 变更或新增 quality
- **必须同步**:
  - `types.ts`:
    - `CHORD_INTERVALS` 表(每 quality 对应 interval 集)
    - `CHORD_SCALE_INTERVALS` 表
    - `CHORD_SCALE_NAME` 表(Phase 7c 补登记)— 与 CHORD_SCALE_INTERVALS **平行数组**,改一个必同步另一个,否则 idiomMode='diatonic' 查表越界
    - `ChordQualityName` 字符串数组
    - `CQ_IS_MAJOR / CQ_IS_DOM / CQ_IS_MINOR / CQ_IS_DIM` bit 分组
  - `src/core/generation/primitives/VoicingProcessor.ts`:`deriveVoiceRole` 函数的 interval 6/9 消歧逻辑(依赖 quality 内含哪些 intervals 来区分 b5 vs #11 / dim7-bb7 vs 13)
  - `pipeline/MacroProgressionEngine.ts`:进行推演的 quality 转移表(如适用)
  - `data/ScaleHelpers.ts`:相关 getChordTonePCs / snapToPool 等
- **风险**:**高**(voicing silently 错位 — 新 quality 漏配 intervals,deriveVoiceRole 把 9 当成 13,Phase 1b mask 把"该过的 voice"过滤掉)

### 1.18 StyleId 顺序变更 ↔ MoodRouter 二维表列索引(Phase 7c 补登记)

- **触发器**:`config/StyleFlags.ts` 中 `StyleId` enum 顺序变更
- **必须同步**(§1.6 已列大多数,本条补遗漏点):
  - `pipeline/MoodRouter.ts` 中以下二维表的**列索引**(列 = StyleId):
    - `MOOD_RECIPE[mood][styleId]` — mood × style → recipe 映射
    - `MOOD_WALK_PATTERN[mood][styleId]` — bass walking 路由
    - `MOOD_PHRASE_CHAIN[mood][styleId]` — phrase chain 路由
  - 列重排后 Pop/Jazz/NeoSoul 的 recipe / walk / phrase 全部错位 — golden seed 大幅 rebaseline
- **风险**:**高**(silently 错位,听感"风格混乱"但不报错)

### 1.19 MoodId 枚举顺序变更 ↔ MoodRouter 二维表行索引(Phase 7c 新登记)

- **触发器**:`pipeline/MoodRouter.ts` 中 `MoodId` enum 顺序变更或新增 mood
- **必须同步**:
  - 三个二维表的**行索引**(行 = MoodId):
    - `MOOD_RECIPE` / `MOOD_WALK_PATTERN` / `MOOD_PHRASE_CHAIN`
  - 行重排会让原 "Dreamy 路由 Recipe X" 变成 "Triumphant 路由 Recipe X"
  - `MoodName` 字符串数组同步
- **风险**:**高**(同 §1.18)

### 1.5 BandRole 枚举 ↔ Roster / Conductor / CastingEngine / MidiConverter / MusicianRegistry

- **触发器**:`types.ts` 中 `BandRole` enum 加新角色(或重命名现有)
- **必须同步**:
  - `src/core/generation/pipeline/Conductor.ts`:`rosterMask` 构造 switch + `MASK_*` 常量
  - `src/core/generation/pipeline/index.ts`:`buildDefaultRoster` 默认填充
  - `src/core/generation/pipeline/CastingEngine.ts`:编曲决策路由 / `pickXxxParams` 函数
  - `src/core/audio/MidiConverter.ts`:channel 分配 + `bandRoleToTrackKeys` 映射 + GM 程式默认
  - `src/core/generation/idioms/MusicianRegistry.ts`:musician.eligibleRoles 标注
  - `app_integration_rule.md` §3:BandRole 取值文档
- **风险**:**中-高**(漏一处 → 新角色"看起来在 roster 但不演奏"或"演奏但 channel 错位")

### 1.6 StyleId 枚举顺序 ↔ pickup 概率 ↔ Golden seed

- **触发器**:
  - `config/StyleFlags.ts` 中 `StyleId` enum 顺序变更
  - 加新 style 到枚举中间(而非末尾)
  - 改 `allowedStyleIds` 默认池构造
- **必须同步**:
  - 接受 **golden seed 全部 rebaseline**(`pool[Math.floor(PRNG.next() * pool.length)]` 抽取索引漂移)
  - `config/StyleRegistry.ts`:`getStyleConfig` 路由
  - `config/styles/index.ts`:`getStyleHarmonyBundle` / `getStyleStage5Bundle`
  - `data/GMSoundMap.ts`:相关 channel 路由
- **风险**:**高**(默认 styleId=0 行为变了,所有不带 forcedStyleId 的 PR 都受影响)

### 1.7 InstrumentFamily 枚举 ↔ MidiConverter channel / ToplineEngine sustain / Musician

- **触发器**:`types.ts` 中 `InstrumentFamily` enum 加新 family
- **必须同步**:
  - `src/core/audio/MidiConverter.ts`:channel 分配 + GM 程式默认 + `MIX_*` 物理常量
  - `src/core/generation/pipeline/ToplineEngine.ts` Pass 3:`sustain_model` 路由(piano_pedal / pad_envelope / wind_legato / 等)
  - `src/core/generation/idioms/MusicianRegistry.ts`:musician.instrumentFamily 标记
  - `engine_architecture_rule.md` §11:加该 family 的乐器速查节(§11.X)
- **风险**:**中**(新 family 漏配 channel → MIDI 路由失败;漏配 sustain → 音色不对)

### 1.8 RenderContext 字段 ↔ 4 Idiom Input 接口 ↔ Conductor 构造点

- **触发器**:`src/core/generation/pipeline/RenderContext.ts` 中 RenderContext / WeatherSnapshot 字段变更
- **必须同步**:
  - 4 个 Idiom Input 接口:
    - `primitives/PianoAccompIdiom.ts` PianoAccompRenderInput
    - `primitives/BassIdiom.ts` BassIdiomInput
    - `primitives/DrumIdiom.ts` DrumIdiomInput
    - `primitives/AtmosphereRenderer.ts` AtmosphereRenderInput
  - `pipeline/Conductor.ts`:`createDefaultRenderContext()` 调用点 + 4 个 `realize()` 调用的 context 字段
  - 任何直接调 `*.render()` 的 scripts(grep `PianoAccompIdiom.render` / `BassIdiom.render` / `DrumIdiom.render` / `AtmosphereRenderer.render`)
- **风险**:**中**(lint 能拦,但 ≥ 5 处 callsite 漏改一处就报错;script 调用容易遗漏)

### 1.9 GM Drum Map pitch ↔ DrumIdiom 常量 ↔ MidiConverter Channel 9

- **触发器**:**基本不应该改** — GM 标准约定。但若有人手痒:
  - 改 DrumIdiom 物理键位常量(`DRUM_KICK=36` 等)
  - 改 `CHANNEL_DRUMS=9` channel 路由
- **必须同步**:
  - `primitives/DrumIdiom.ts`:键位常量
  - `audio/MidiConverter.ts`:`CHANNEL_DRUMS` + 路由逻辑
  - `engine_architecture_rule.md` §4.1 K-8 第三空间说明
  - 所有外部 GM 音色库(无法控制)→ **基本上不可同步**
- **风险**:**极高**(破 GM 标准 → 所有 SF2 / Sound Font 播放器加载失败)。**强烈不建议改**。

### 1.10 PipelineRunOptions / AudioEngine 公开 API ↔ app_integration_rule

- **触发器**:
  - `src/core/generation/pipeline/index.ts`:`PipelineRunOptions` 字段增/删/改
  - `src/core/audio/AudioEngine.ts`:任何 public 方法签名变更
- **必须同步**:
  - `.claude/rules/app_integration_rule.md` §3(PipelineRunOptions 字段详解)+ §5(AudioEngine API 速查)
  - 嵌入式 C 端对接文档(若有)
  - React/UI 调用代码(`src/components/*`)
- **风险**:**高**(App / 嵌入式直接破坏;app_integration_rule 是 App dev 的真理之源,不同步会让外部消费方踩坑)

### 1.17 SectionPlan.soloFromBeat/toBeat ↔ ImprovisationStrategy ↔ Conductor melody overlay(Phase 6b)

- **触发器**:
  - 改 `PLATEAU_K_THRESHOLD`(默认 0.65)/ `MIN_PLATEAU_BEATS`(默认 8)
  - 改 `TENSION_FORCE_THRESHOLD`(默认 5)/ Tension 增量表
  - 改 Solo 音域(SOLO_RANGE_LO/HI)
  - 改 hash choice 公式(40% chord / 30% scale / 30% NCT)
- **必须同步**:
  - `pipeline/ImprovisationStrategy.ts`:
    - findPlateauRegions / pickSoloist / generateSoloNotes 三个函数公式一致
    - Tension Accumulator 阈值与 chord/scale/NCT 增量协调
  - `pipeline/Conductor.ts`:
    - findPlateauRegions 调用点 + melody overlay 替换逻辑(剔除 + 注入 + sort)
    - **必须在 Reconciler 之前**(Reconciler 需要处理 solo 与其他声部撞音)
  - `data/NCTApproachPatterns.ts`:NCT pickApproachPattern 与 R 阈值表对齐
  - **MainInst / Accomp 角色**:pickSoloist 优先级(MainInst → Accomp);改 BandRole 优先级需同步
- **风险**:**中-高**(Solo 区间叠加多机制 — sleeping + apex + drop + solo 同段时优先级未明)

### 1.15 MusicianPersona.wakeK/peakK ↔ WakeStateMachine ↔ Conductor sleeping gates(Phase 6a)

- **触发器**:
  - 改 musician.persona.wakeK / peakK 数值
  - 改 `THRESHOLD_MUTATION_RANGE`(0.15)— per-song 偏移幅度
  - 改 `deriveSongHash` 输入(目前 styleId+tonality+sections.length+chords.length)
- **必须同步**:
  - `pipeline/WakeStateMachine.ts`:`attachWakeStates` 算法 + `clamp01` 边界
  - `pipeline/Conductor.ts`:5 个 Realizer 调用点的 sleeping gate
    (Drums:filter drumSections / Bass/Piano/Atmosphere:per-section sleeping check)
  - `primitives/DrumIdiom.ts`:已删硬编 K<=0.15;若回退需同步删 attachWakeStates
  - `primitives/AtmosphereRenderer.ts`:同上
  - **anchor / apex 与 wake 互不冲突**:isAnchor=true 通常配 wakeK 0-0.10;
    isApex=true 通常配 peakK=1.00
- **风险**:**中-高**(漏 Conductor 端 gate → sleeping 标了但 Idiom 仍渲染 → 矛盾状态)

### 1.16 S/G 维度消费链(Phase 6a)

- **触发器**:
  - 改 S anchor 公式(CurveWeatherSampler.computeS)
  - 改 G anchor 公式(CurveWeatherSampler.computeG)
  - 改 GrooveHumanizer 偏移常量
- **必须同步**:
  - **S 维度**(release / sustain / pedal):
    - `AtmosphereRenderer.ts`:`effectiveReleaseRatio = releaseRatio * (0.7 + s*0.8)` 公式
    - `AtmosphereRenderer.ts`:`effectiveCrossfade = s > 0.6 ? true : crossfade`
    - `PianoAccompIdiom.ts`:`sPedalFactor = 0.6 + sectionS * 0.8`(段首采样)
    - `BassIdiom.ts`:`sStaccatoFactor = 0.78 + sBass * 0.33`(每 step 采样)
  - **G 维度**(humanization):
    - `pipeline/GrooveHumanizer.ts`:`ONSET_OFFSET_MAX_BEATS` / `VELOCITY_OFFSET_MAX` / `HIHAT_LAYBACK_MAX_BEATS`
    - `pipeline/Conductor.ts`:5 个 `humanizeTrack` 调用点(每 track 独立 salt)
    - **必须在 Reconciler 之后**(否则破 v1 damp 匹配 / v2 LIL lift 解析)
- **风险**:**中**(S 公式不一致 → 不同乐器对同 S 值响应方向不同,听感分裂)

### 1.13 SectionPlan.dropFromBeat ↔ MarkovStateMachine / Bass-Drum 消费链(Phase 5)

- **触发器**:
  - `MarkovStateMachine.attachDropStates` 触发条件变更(SectionType / 概率 / 持续时长)
  - `DROP_TRIGGER_PROBABILITY` / `DROP_DURATION_BEATS` 常量调整
- **必须同步**:
  - `src/core/generation/pipeline/Conductor.ts`:
    - `attachDropStates` 调用顺序(必须在 attachSuppressionPlan 之后,Realizer 之前)
    - `collectDropWindows` + `filterNotesByDropWindows` 应用点(Drums + Bass 渲染后)
  - `src/core/generation/primitives/BassIdiom.ts` / `DrumIdiom.ts`:**不在 Idiom 内 skip**
    (D-5 PRNG 配额铁律)— 必须事后过滤
  - 若加新乐器需要 Drop 静默 → 同步 Conductor 加 `filterNotesByDropWindows` 调用
- **风险**:**中**(漏过滤 → Drop 失效;在 Idiom 内 skip → 破 D-5 PRNG)

### 1.14 NCTApproachPatterns ↔ BassIdiom A 规则 ↔ 未来 Phase 6 Solo(Phase 5)

- **触发器**:
  - `data/NCTApproachPatterns.ts` 中 `NCT_APPROACH_PATTERNS` 数组变更
  - `ApproachPatternId` 枚举数值变更
  - 任一 pattern 的 `minRiskLevel` / `vector` / `useDiatonic` 变更
- **必须同步**:
  - `src/core/generation/primitives/BassIdiom.ts`:
    A 规则的 R 维度阈值(目前 0.4)需与 ApproachPattern.minRiskLevel 表一致
  - Phase 6 Solo `ImprovisationStrategy`(待实装):需复用相同表
  - `pickApproachPattern` 函数(若改算法或新增过滤条件)
- **风险**:**中**(数据表与消费方阈值不一致 → 同 R 值下不同消费方做不同决策)

### 1.12 isApex flag ↔ TextureContinuum / Piano-Atmosphere 消费链(Phase 4)

- **触发器**:
  - `MusicianPersona.isApex` 字段值变更或新增 apex musician
  - `TextureContinuum.attachSuppressionPlan` 的 K 阈值 / SectionType 触发条件变更
  - Apex 与 Anchor 同时设(语义冲突,严禁)
- **必须同步**:
  - `src/core/generation/pipeline/TextureContinuum.ts`:`APEX_K_THRESHOLD` /
    `DUCKING_TARGET_ROLES` / 触发 SectionType 集合(BuildUp / Drop)
  - `src/core/generation/primitives/PianoAccompIdiom.ts`:`params.apexActive`
    + `params.suppressionFactor` 消费(velocity 缩放点)
  - `src/core/generation/primitives/AtmosphereRenderer.ts`:`input.apexActive`
    + `input.suppressionFactor` 消费(velocity 缩放点)
  - `src/core/generation/pipeline/Conductor.ts`:AtmosphereRealizer 调用点透传
    `atmoAssign.apexActive` / `atmoAssign.suppressionFactor`
  - `idioms/MusicianRegistry.ts`:apex/anchor 互斥校验(同 musician 不能同时设 true)
- **风险**:**中**(漏改消费方 → ducking 不生效,听感无感;但不会破坏算法 D-5)

### 1.11 DensityLevel 枚举 ↔ PianoTextureRecipes / RhythmMask / Idiom 消费链

- **触发器**:
  - `src/core/generation/types.ts` 中 `DensityLevel` enum 数值变更或新增等级
  - `src/core/generation/pipeline/RhythmMask.ts` 中 `METRIC_TIER` 表变更(影响 stepTier 派生)
  - `src/core/generation/pipeline/TextureContinuum.ts` 中 `kToDensity` 量化边界变更
- **必须同步**:
  - `src/core/generation/data/PianoTextureRecipes.ts`:每个 recipe 的 `densityLevel` 字段
    重新归档(Phase 3 标注的 14 个 recipe 的 L2-L7 分布)
  - `src/core/generation/pipeline/CastingEngine.ts`:`STYLE_ANCHOR_RECIPE` 表(每风格的 anchor recipe 引用 DensityLevel 间接定义)
  - `src/core/generation/pipeline/RhythmMask.ts`:`maskFromDensity` 的 tier ≤ density 阈值规则
  - `src/core/generation/primitives/PianoAccompIdiom.ts`:`filterGridByDensity` 调用点(读 params.densityLevel)
  - `src/core/generation/primitives/DrumIdiom.ts`:`k <= 0.15` Tacit 静默阈值(与 TextureContinuum.kToDensity 对齐)
  - `src/core/generation/primitives/AtmosphereRenderer.ts`:`k <= 0.15` / `k <= 0.45` / `k > 0.75` 三档阈值(同上)
- **风险**:**高**
  - DensityLevel 数值即 stepTier 阈值;改值会让所有 mask 计算错位
  - kToDensity 与 Idiom 内联阈值不同步 → Drum 与 Piano 在同一 K 下做不同决策(听感分裂)
  - PianoTextureRecipes 漏标 densityLevel → CastingEngine.STYLE_ANCHOR_RECIPE 选择异常

---

## 2. 流程

### 2.1 改动前(plan 阶段)

1. **grep 自己要改的标识符**:
   ```bash
   grep -rn "<旧名>\|<结构名>" src/ scripts/ .claude/rules/
   ```
2. **查本文件 §1** 找匹配的关联变更组
3. **在 plan / commit 描述里把所有同步点列出**(明确写"X 改动需要同步 A、B、C 三处")

### 2.2 改动中

- 改一个,就近 grep 验证 callsite 全覆盖
- **不允许"先 commit 这个,后面补那个"** —— 灰色中间状态(部分同步)风险高于不改
- 多文件改动批量做,一个 commit 完成

### 2.3 改动后

- `npm run lint` — 类型契约对账(只拦得住 §1.5 / §1.8 这类显式接口变更)
- `npm run golden-seed` — 算法/PRNG 对账(拦得住 §1.6 / §1.1 这类隐式变更)
- 若触动 IR 字段 → 额外执行 `/sync-to-c` 或更新 `.sync_state.json` 显式记录 C 端 gap

### 2.4 提交

- commit message 显式列出"同步了哪些位置 + 风险等级"(便于未来 grep 回溯)

---

## 3. 添加新关联变更组的流程

发现新的"改 A 忘改 B"踩坑后:

1. **本文件 §1 末尾追加子节**(§1.11, §1.12, ...)
2. **格式三段**:触发器 / 必须同步位置 / 风险等级
3. **风险等级**:严格按 §1 定义("高"= silently 破 / "中"= lint 能拦 / "低"= 只影响文档)
4. **commit 时**:单独 docs commit,message 说明"为什么这条要登记 — 源于什么踩坑"

> 本表是**经验性增长**的清单,不强求一次性穷尽。每发现一个新坑,登记一个,后人受益。

---

## 4. C 端 sync gap 当前状态(2026-05-20)

### 当前现状

- **Last sync commit**: `eb6a2f9`(2026-04-03)
- **TS HEAD**: `7bae8fd`(Phase 1b VoicingMask 实装)
- **Gap**: 81 commits / 141 文件 / +17147 / -12626 行

### 跨过的关键 phase(C 端未跟进)

| Phase | TS 变更 | C 端缺失 |
|-------|---------|---------|
| 引擎 Phase 0 | IR 抽取至 `ir/` 目录 | — |
| 引擎 Phase 1 | VoicingProcessor(合并 3 处 voicing) | 无对应模块 |
| 引擎 Phase 2 | BandEngine → CastingEngine 重命名 | 仍是旧名 |
| 引擎 Phase 3-4 | InstrumentRealizer 接口 + 4 个 Realizer | 无 |
| 引擎 Phase 5 | Reconciler 弱版本 | 无 |
| 引擎 Phase 6 | Stage5Layering → Conductor 重命名 | 仍是 Orchestrator |
| 引擎 Phase 7 | AbsoluteTransposer 重命名 + AtmosphereConfig | 无 |
| 引擎 Phase 8a/b | Piano pedal / bass-piano doubling | 无 |
| 引擎 Phase 9 | 严格 roster gate | 无 |
| 编曲 Phase 0 | RenderContext / WeatherSampler | 无 |
| 编曲 Phase 1a | VoiceRole / VoicedPitch / voicingTagged | 无 |
| 编曲 Phase 1b | VoicingMask / voicingMask 字段 | 无 |

### 决策(2026-05-20)

**选项 C: C 端按当前 TS 完全重建**(选定)

不做增量 sync,理由:
- 跨多次重命名 + 架构重构,自动翻译大概率错位
- C 端基础已偏移,中间产物(Conductor / Realizer / Reconciler 等)缺失
- C 端 golden seed 与当前 TS PRNG 配额已脱钩

### TODO marker(待启动)

**C 端重建项目**:
- 待 TS 端 Phase 2-5(五维气象 / Live 模式 / Motif 模式)架构稳定后启动
- 启动时单独制定 `c_port_rebuild_plan.md`(届时再写,提前写会过时)
- 启动前先讨论:C 端命名规范统一(`ar_*` 与 `ar4_*` 取舍)、是否完全删除 legacy 文件
- 预计搭配大版本号(如 `v2.0.0-c-port-rebuild`)

### 期间约束

在 C 端重建启动之前:
- TS 端改动**继续遵守** §1 各组的 sync 要求,**仅 §1.1 的 C 端同步部分豁免**(因 C 端整体落后)
- `.sync_state.json` **保持不动**(避免误以为已 sync)
- 任何引入新关联组的改动,**仍要登记到本文件 §1**(为未来 C 端重建时一次性消化)

---

## 附录:本文件维护承诺

- 改本文件本身 **不需要** 跑 lint / golden-seed(纯文档)
- 但**每次发现新关联组 → 追加 §1 子节**,不要遗漏
- 发现 §1 描述与现状不符 → 优先更新本文件(它是真理之源)
- 每次大重构(Phase X.0 级)→ 顺便审视 §1 各组的"必须同步位置"是否仍准确(文件路径会随重构变化)

## 附录:本规则与其他规则的关系

- `engine_architecture_rule.md` §2"单一真理之源"表 — 关注**改什么去改哪个文件**(纵向)
- `engine_architecture_rule.md` §11"乐器修改速查" — 关注**改某乐器去改哪些文件**(横向)
- **本文件**(`cross_sync_rule.md`)— 关注**改某文件必须同时改哪些其他文件**(关联横向)
- `app_integration_rule.md` — App / 嵌入式视角,只读引擎不改引擎

三者互补:做引擎修改时,先查 `engine_architecture_rule §2/§11` 找主改文件,再查本文件 §1 找需要同步的其他文件。
