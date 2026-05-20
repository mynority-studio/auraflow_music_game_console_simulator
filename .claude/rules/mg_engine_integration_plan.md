# MG-Engine Integration Plan — melodygenerative 激进替换工程

> **写本文档时点**:基线 commit `4232c56` + tag `v1.44.0-mg-port-v1`(Batch 1-7 完成,
> "翻译进 auraflow 单引擎"路线的终点)。本文档定义**下一阶段路线** —
> 把 melodygenerative 整体 move 进来作为 auraflow 的新内核,而不是再翻译。

---

## §0 何时必读本文件

任一条件命中,**先读完再动手**:

- 开始 / 继续推进 Phase 1 / Phase 2 / Phase 3 的工程
- 改 `src/core/generation/mg-engine/`(Phase 1 后该目录存在)下任何文件
- 修改 runPipeline 的 Stage 3 调用链(原 HarmonyCore.generate 调用点)
- 决定要不要"删 / 保留"现有 Batch 1-7 移植代码
- 对 PRNG 隔离 / 合并的时机做调整
- `.claude/rules/engine_architecture_rule.md` 大改前(本文档结束后会触发其重写)

---

## §1 背景与决策起点

### 1.1 路线变更

v1.44.0-mg-port-v1 完成"Batch 1-7 翻译式移植" — 把 melodygenerative 9 个核心机制
翻译进 auraflow 的 enum / PRNG / pipeline 风格。审计发现的稀释问题:

- HarmonicEvaluator 完全无消费方(Batch 2 整个 430 行评估器 0% 生效)
- MoodRouter 24 cell 中只 5 个 rootless cell,**ModernPop 完全用不到 Bill Evans dict**
- progressionPool 70% chord 走 pool 路径,**跳过 Gate 4 DYNAMIC_TSD 注入**
- 骨架 chord 全是 4-voice,Active Divisi Magnet **缺乏 5+ intervals 触发目标**
- Solo Piano 系列(Batch 4 / 7C)默认 roster 含 bass,**永不触发**

实际生效率加权:ModernPop ~10-15% / ChillJazz ~30-40% / NeoSoul ~40-55%。
距离用户期望的 ~95% 复刻 melodygenerative 听感差距大。

### 1.2 新路线哲学

**激进替换**:把 melodygenerative 整体 copy 进来,**成为** auraflow 的内核;
而不是再翻译 / adapter。

对照之前两个方案:

| 方案 | 哲学 | 听感复刻 | 代码动作 |
|------|------|---------|---------|
| Batch 1-7 翻译移植(已废) | "把 mg 资源翻译进 auraflow" | ~10-55% | 翻译进 auraflow enum/PRNG |
| Adapter 共存(已废) | "两个引擎职责分明" | ~95% | 加 adapter 中间层 |
| **激进替换(本路线)** | **"mg 就是 auraflow 的内核"** | **~99%** | **删 auraflow 老模块,move mg 进来** |

---

## §2 4 个核心决策(已对齐)

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | mg 代码目录位置 | `src/core/generation/mg-engine/` | 与 pipeline/primitives 同级,在 generation 内部最自然 |
| 2 | 代码风格保留 vs 立即改 | **原样保留**(跑通后再壳化) | "先跑通,再壳化"正确顺序;改风格留 Phase 3 |
| 3 | PRNG 策略 | **Phase 1+2 隔离,Phase 3 合并** | Phase 1 听感对账锚点 + Phase 3 长期统一 |
| 4 | bass/pad 接和声方式 | ChordDef → GeneratedChord adapter(~80 行 utility) | bass/pad 渲染逻辑不动,只换输入源 |

### 2.1 关于 PRNG 的关键约束

**Phase 1+2 期间隔离的具体做法**:
- mg-engine 保留自己的 `Random` 类(基于 mulberry32,字符串 fork)
- runPipeline 调用 mg 时传 `mgSeed = \`${auraflow_seed}::mg-piano\``
- mg 内部用自己的 Random 实例,跟 PRNGManager **完全隔离**
- 验收:同 seed → mg 输出 = melodygenerative-standalone 输出(听感对账锚点)

**Phase 3 合并的具体做法**:
- 删 mg 的 Random 类
- 所有 mg 内部 `rng.next()` 改为 `PRNGManager.next()`
- 字符串 fork 语义:用 `PRNGManager.fork(channelName)` API 等价物
- 接受听感 ≠ standalone(此时 mg 已成"auraflow 内核",原版概念不再成立)
- golden seed 重建 v2 baseline

### 2.2 关于 mg 后续迭代假设

**用户已确认**:melodygenerative 上游不再独立迭代,完全合并到 auraflow。
此约束是选 PRNG 分阶段方案的关键依据 —— 若 mg 仍独立更新,Phase 3 合并不可行。

---

## §3 3 个 Phase 实施路径

### Phase 1 — Copy + 跑通纯钢琴(1-2 周)

**目标**:melodygenerative 整体 copy 进来,删被替换的 auraflow 模块,
跑通"钢琴轨独立生成 + bass/drums/atmosphere 临时静音",听感 = melodygenerative
standalone。

**Deliverable**:
1. Copy `~/vibe_coding/melodygenerative/src/lib/` → `src/core/generation/mg-engine/`
2. 删 §4 清单中"要删"的 auraflow 模块
3. 新建 `pipeline/MgEngineFacade.ts`:包装 mg.generate* 系列,输出
   `{ chords: ChordDef[], melody: NoteEvent[], texture: NoteEvent[] }`
4. runPipeline 改造:Stage 3 调 facade 而不是 HarmonyCore
5. 钢琴 accomp 轨直接消费 facade 输出
6. bass/drums/atmosphere 临时静音(用 forcedBand `null` 槽实现)

**验收**:
- `npm run lint` ✅ 0 errors
- 7 个 golden seed 听感 = melodygenerative-standalone(同 seed 同输出)
- 整个 mg-engine 不消费 PRNGManager

**Phase 1 不做**:
- 不接 bass / drums / atmosphere(下个 Phase)
- 不接 5 维气象 / wake / apex(可能 Phase 2 接,可能简化)
- 不删 Batch 1-7 中"未被替代"的代码(留作 fallback / 装饰乐器用)
- 不改 mg 代码风格(原 string enum / Math.random 全保留)

### Phase 2 — bass/pad/drums 接和声(1 周)

**目标**:bass / atmosphere / drums 三轨重新上线,接收 mg-engine 输出的 chord 进行
渲染。weather/wake/apex 选择性接入。

**Deliverable**:
1. 新建 `pipeline/MgChordAdapter.ts`(~80 行):
   - `chordDefToGeneratedChord(ChordDef, voicingProcessor): GeneratedChord`
   - chord.type 字符串 → ChordQuality enum 映射(可能扩 ChordQuality 兼容)
   - chord.rootMidi → root pc
   - chord.duration 累积 → startBeat / endBeat
   - chord.compingVoicing → voicing[](SATB 4-voice 抽取)
2. BassRealizer / AtmosphereRealizer / DrumRealizer 输入源切换到 adapter 输出
3. 5 维气象选择性接入(段落级 K/T/S/R/G 仍由 auraflow CurveWeatherSampler 计算,
   feed 给 bass/drums 渲染参数)
4. wake / apex / drop 系统选择性接入(simplified,只针对 bass/drums)

**验收**:
- 全编制 listening test
- bass walking 跟 mg 输出 chord 进行走
- atmosphere pad voicing 跟 mg 色彩走
- drums 接 weather 节奏密度

### Phase 3 — 壳化 + 规则重整(1-2 周)

**目标**:mg 代码风格统一,PRNG 合并,规则文件重写,打 v2.0.0 tag。

**Deliverable**:
1. mg 代码壳化:
   - 字符串 chord type → ChordQuality enum 统一(Batch 5 已扩到 25 个,可能补全)
   - 字符串 scale name → Tonality enum 统一(Batch 5 已扩到 17 个)
   - mg Random 类删,改调 PRNGManager
   - mg 大类拆文件(musicEngine.ts 6465 行不能保持)
2. IR 统一:删 mg 的 ChordDef / NoteEvent,统一用 auraflow GeneratedChord / NoteData
3. PRNG 合并:`PRNGManager.fork(channelName)` API 等价 mg 原字符串 fork
4. 规则文件重写:
   - `engine_architecture_rule.md`:重画数据流图,§2 单一真理之源表更新
   - `cross_sync_rule.md`:删 mg 替代后的失效条目,加新条目
   - `app_integration_rule.md`:小改(runPipeline 接口契约保持)
5. golden seed v2 baseline 重建
6. 打 tag `v2.0.0-mg-engine-native`

**验收**:
- mg 代码风格与 auraflow 一致
- 规则文件覆盖新架构
- v2 golden seed 7 sha 重建并 commit message 记录
- C 端 sync gap 文档化(留 v2 C 端重建项目)

---

## §4 文件清单

### 4.1 Phase 1 要 copy 的文件(原样,不改)

```
~/vibe_coding/melodygenerative/src/lib/
  musicTheory.ts      (4107 行)
  musicEngine.ts      (6465 行)
  styleDictionary.ts  (1435 行)
  dynamicHarmony.ts   (170 行)
  basslineRules.ts    (454 行)
  motifTransform.ts   (179 行)
  rhythmPattern.ts    (118 行)
  utils.ts            (3 行)
合计 ~13000 行,move 到:
  src/core/generation/mg-engine/
```

### 4.2 Phase 1 要删的 auraflow 模块

```
src/core/generation/pipeline/
  HarmonyCore.ts                ← mg.generateProgressions 取代
  MacroProgressionEngine.ts     ← mg 进行推演取代(Batch 5.2 改造的代码作废)
  ToplineEngine.ts              ← mg.generateArrangement 旋律部分取代
  CadenceResolver.ts            ← mg Cadence Definition 4 取代(Batch 6 代码作废)
  PassingChordEngine.ts         ← mg secondary dominant / sub-V 取代

src/core/generation/primitives/
  HarmonicEvaluator.ts          ← mg evaluateNoteInChordContext 取代(Batch 2 代码作废)
  PCFGGrammarEngine.ts          ← mg motif system 取代
  MasterPhraseRenderer.ts       ← mg phrase render 取代
  MasterLickCompiler.ts         ← mg lick 库取代
  PhraseContourPlanner.ts       ← mg motif contour 取代
  PianoAccompIdiom.ts           ← 大部分删,留 LH 习语作 bass 装饰参考

src/core/generation/data/
  TendencyTable.ts              ← mg TENDENCY_TABLE 取代(Batch 1 代码作废)
  IntervalAesthetics.ts         ← mg INTERVAL_AESTHETICS 取代
  ScaleGravity.ts               ← mg SCALE_GRAVITY 取代
  ModalCharacteristics.ts       ← mg MODAL_CHARACTERISTIC_NOTES 取代
  ChordColors.ts                ← mg CHORD_COLOR_DICTIONARY 取代
  PianoVoicingDictionary.ts     ← mg JAZZ_ROOTLESS_VOICINGS 等 4 dict 取代
  DynamicTSDDictionary.ts       ← mg DYNAMIC_TSD_DICTIONARY 取代
  VoicingStylePreferences.ts    ← mg STYLE_SHELL/ROOTLESS/CLUSTER/FULL/BLUES 取代
  PianoLHPatterns.ts            ← mg basslineRules 取代(Batch 4 代码作废)
```

### 4.3 Phase 1 要保留的 auraflow 模块

```
src/core/generation/
  primitives/
    FractalStructureEngine.ts     # 段落生成,mg 无替代
    SongHookEncoder.ts            # 段落 hook 编码
    VoicingProcessor.ts           # 给 atmosphere/lead 的 SATB voicing 用
    RhythmMutator.ts              # atmosphere 可能用
    BassIdiom.ts                  # auraflow 强项(walking / Latin Tumbao / Bebop Walk)
    DrumIdiom.ts                  # auraflow 强项
    AtmosphereRenderer.ts         # auraflow 强项
    RhythmMask.ts / TopologyMutator.ts / 等  # bass/atmosphere 仍用
    NCTApproachPatterns.ts        # Phase 5 Bass A 规则
  pipeline/
    Conductor.ts                  # 重写编排逻辑,但保留主体框架
    AbsoluteTransposer.ts         # K-2 唯一加 keyOffset 点,不变
    Reconciler.ts                 # 跨乐器协调,弱化但保留
    GrooveHumanizer.ts            # humanization
    CurveWeatherSampler.ts        # 5 维气象,Phase 2 选择性接入
    WakeStateMachine.ts           # wake 系统
    MarkovStateMachine.ts         # drop 系统
    TextureContinuum.ts           # apex/density
    ImprovisationStrategy.ts      # solo 引擎,mg 没有 solo
    MoodRouter.ts                 # 简化或保留给 bass/drums 用
    CastingEngine.ts              # 简化(钢琴角色撤,bass/drums/atmosphere 保留)
  data/
    PianoLIL.ts                   # 给 atmosphere placement 用
    EuclideanRhythms.ts           # drum 可能用
    BassWalkPatterns.ts           # electric bass walking
    PianoTextureRecipes.ts        ← 不确定,可能删(钢琴织体 mg 接管)
    PianoTextureEnums.ts          ← 同上
    ScaleHelpers.ts / ChordNumeralParser.ts / CommonRoots.ts / 等
  ir/                             # 全保留,可能字段扩展
  config/                         # 风格配置保留,bundle 简化
  idioms/                         # MusicianRegistry / LickDictionary 保留
```

### 4.4 Phase 2 新建 adapter

```
src/core/generation/pipeline/
  MgChordAdapter.ts               # ChordDef → GeneratedChord 转换(~80 行)
  MgEngineFacade.ts               # mg-engine 包装(Phase 1 就建,Phase 2 增强)
```

---

## §5 PRNG 分阶段统一计划

### Phase 1+2:隔离

```ts
// runPipeline.ts(伪代码)

PRNGManager.setSeed(seed);            // auraflow 主流

// Stage 1+2:styleId / tonality / keyOffset / BPM 抽样(auraflow PRNGManager)
const styleId = pickStyle(...);

// Stage 3:mg-engine 接管,独立 Random
const mgSeed = `${seed}::mg-piano`;
const mgFacade = new MgEngineFacade();
const mgResult = mgFacade.generate({
    seed: mgSeed,                     // mg 内部 new Random(mgSeed)
    style: 'POP', bars: totalBars,
});
// mgResult = { chords: ChordDef[], melody: NoteEvent[], texture: NoteEvent[] }
// PRNGManager 完全不被 mg 触碰

// Stage 4/5:bass/drums/atmosphere 继续用 PRNGManager
```

### Phase 3:合并

```ts
// 改造后
PRNGManager.setSeed(seed);
// mg 内部所有 `rng.next()` 改为 `PRNGManager.next()`
// 字符串 fork 用 PRNGManager.fork('mg-emotion').next() 等价物
const mgResult = mgFacade.generate({ ... });
// PRNGManager state 经 mg 内部消费推进
// bass/drums 起步状态依赖 mg 消耗了多少 PRNG(信号传递)
```

### PRNG 验证锚点

**Phase 1 验收必须满足**:
- 7 个 golden seed 跑出来的 mg 输出 = melodygenerative-standalone 输出(同 seed 同输出)
- 这是"算法移植 100% 正确"的客观证据
- 如果听感对不上,说明 copy 过程有遗漏 / runPipeline 调用方式错 / chord adapter 漏字段

**Phase 3 验收**:
- 听感 ≠ standalone 是预期(此时 mg 已成内核,原版概念失效)
- 重建 v2 golden seed baseline,commit message 记录新 sha

---

## §6 验证锚点 & 回退路径

### 6.1 锚点 tag

| Tag | commit | 含义 |
|------|--------|------|
| `v1.44.0-mg-port-v1` | `4232c56` | Batch 1-7 翻译移植终点(本文档前的状态) |
| `v1.45.0-mg-copy-done` | (Phase 1 完成时打) | mg 代码 copy 进 auraflow,纯钢琴跑通,听感 = standalone |
| `v1.46.0-mg-full-band` | (Phase 2 完成时打) | bass/drums/atmosphere 接和声,全编制运转 |
| `v2.0.0-mg-engine-native` | (Phase 3 完成时打) | 壳化完成,PRNG 合并,规则文件重写,v2 正式版 |

### 6.2 回退路径

任何 Phase 出问题:
```bash
git reset --hard v1.44.0-mg-port-v1   # 回到激进路线起点
# 或
git reset --hard v1.45.0-mg-copy-done # 回到 Phase 1 终点
```

每个 Phase 完成后 commit + tag,保证可回退。

### 6.3 不应该回退的状态

- 不要回到激进路线之前(`3831f89` 等)— v1.44 的 Batch 1-7 翻译移植虽然稀释率高,
  但里面的数据资源(EuclideanRhythms / PianoLIL / NCTApproachPatterns 等)
  仍在 §4.3 保留清单内,有价值

---

## §7 现有 .claude/rules/ 文件的失效影响

### 7.1 即将作废 / 大改的条目

| 条目 | 状态 |
|------|------|
| `engine_architecture_rule.md` §1 数据流图 | **Phase 3 重画**(Structure → mg-engine → Conductor → AbsoluteTransposer) |
| `engine_architecture_rule.md` §2 单一真理之源表 | **Phase 3 重写**(钢琴系列全条目失效,bass/drums/atmosphere 保留) |
| `engine_architecture_rule.md` §11 乐器修改速查 | **Phase 3 §11.1-§11.5 钢琴部分失效,重写;§11.6-§11.15 bass/drums/atmosphere 保留** |
| `cross_sync_rule.md` §1.4 ChordQuality | **失效**(Batch 5 扩 enum 在 Phase 3 可能恢复 / 简化 / 删除) |
| `cross_sync_rule.md` §1.11 DensityLevel | 保留(给 bass/drums 用) |
| `cross_sync_rule.md` §1.15 wakeK | 保留(Phase 2 选择性接入) |
| `cross_sync_rule.md` §1.17 SoloFromBeat | 保留(mg 没有 solo,auraflow 保留) |
| `cross_sync_rule.md` §1.20 Single Pipeline | 保留(runPipeline 接口契约不变) |
| `app_integration_rule.md` | 小改,主要 §1 三大入口接口不变 |

### 7.2 Phase 3 必做的规则更新

- `engine_architecture_rule.md` 整体重写,涵盖新数据流(structure → mg → bass/drums/atmosphere)
- `cross_sync_rule.md` 删失效条目,加新条目(mg-engine ↔ adapter / mg ChordDef ↔ auraflow GeneratedChord 等)
- 本文档(`mg_engine_integration_plan.md`)在 v2.0.0 完成后归档(改为历史记录文档)

---

## §8 决策记录历史(讨论过程摘要)

按时间倒序:

1. **2026-05-20**(本文档创建当日):用户提出"激进替换"想法,4 个决策对齐
   (目录 A / 风格 A / PRNG B 分阶段 / adapter 同意)
2. **同日早些时候**:基于代码审计指出 Batch 1-7 实际生效率 10-55%,稀释问题严重
3. **同日早些时候**:用户考虑过"adapter 共存"方案,被激进替换取代
4. **2026-05-20 之前数次对话**:Batch 1-7 完成,commit `4232c56` + tag `v1.44.0-mg-port-v1`
5. **更早**:用户最初提出"melodygenerative 听感符合预期",启动移植路线

---

## §9 文件维护承诺

- 改本文件本身**不需要**跑 lint / golden-seed(纯文档)
- 但每完成一个 Phase,**必须更新本文件**:
  - §3 deliverable 标 `✅ 完成`
  - §6.1 加新 tag
  - §7 同步规则文件改动
- Phase 3 完成 + 打 v2.0.0 tag 后,本文档归档到 `docs/history/` 改名 `mg_engine_integration_history.md`
- 当本文件描述与现状不符 → 优先更新本文件(它是激进替换路线的真理之源)
