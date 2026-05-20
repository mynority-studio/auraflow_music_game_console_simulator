# Engine Architecture Rule — 引擎修改宪法

> **每次动 `src/core/generation/` 之前先读完这份文档。**
> 偏离本文档的改动,golden seed 大概率挂,架构债大概率回潮。

本文件描述 v1.38 之后(Phase 0-6 重构落地后)的引擎架构。后续每次重构应同步更新本文件。

---

## 0. 何时必读本文件

任一条件命中,**先读完再动手**:

- 改 `src/core/generation/` 下任何文件
- 新增引擎模块 / 重命名模块 / 删模块
- 调整任何模块的 PRNG 消耗
- 改 IR 类型(`ir/` 下任何 interface 或 type)
- 改风格配置中映射到管线决策的字段(`config/styles/*.ts`)
- 改 Conductor / AbsoluteTransposer / Reconciler 调用顺序

---

## 1. 当前架构(数据流)

```
┌─ Structure ─────────────────────────────────────┐
│ FractalStructureEngine                          │  → SectionMetadata[]
│ SongHookEncoder                                 │
└─────────────────────────────────────────────────┘
        ↓
┌─ Harmony ───────────────────────────────────────┐
│ MacroProgressionEngine  (代数推演)              │  → GeneratedChord[] (含 voicing)
│ HarmonyCore             (薄 facade,委托)       │
│   └→ VoicingProcessor   (唯一 voicing 源)       │
│ PassingChordEngine      (经过和弦注入)          │
└─────────────────────────────────────────────────┘
        ↓
┌─ Casting ───────────────────────────────────────┐
│ CastingEngine           (导演:角色 + 织体)      │  → BandPlan
│   └→ MoodRouter         (mood→recipe 查表)      │
└─────────────────────────────────────────────────┘
        ↓
┌─ Realization (4 乐器并行) ──────────────────────┐
│ PianoRealizer       → PianoAccompIdiom         │  → NoteData[] (RELATIVE)
│ BassRealizer        → BassIdiom                │
│ DrumRealizer        → DrumIdiom                │  (GM Drum Map 第三空间)
│ AtmosphereRealizer  → AtmosphereRenderer       │
│ + Lead 直渲(ToplineEngine + PCFG + Fractal)    │
└─────────────────────────────────────────────────┘
        ↓
┌─ Conductor (总装) ──────────────────────────────┐
│ Conductor.conduct()                             │  → 4 轨 NoteData[] + ReconcilerReport
│   末尾调 Reconciler.reconcile()                 │
└─────────────────────────────────────────────────┘
        ↓
┌─ AbsoluteTransposer (K-2 唯一加 keyOffset 点) ───────┐
│ AbsoluteTransposer.arrange()                          │  → ArrangedTrack (ABSOLUTE)
└─────────────────────────────────────────────────┘
        ↓
   MidiConverter → PlaybackEngine → 音频输出
```

---

## 2. 单一真理之源(每件事去哪个模块改)

修改前先查这张表,**禁止在错位置实现**。

| 修改诉求 | 必须改 | 禁止改 |
|---------|--------|--------|
| 任何 voicing(SATB / Rootless / Quartal / Shell) | `primitives/VoicingProcessor.ts` | 各 *Idiom 内嵌 voicing 逻辑 |
| 编曲决策(谁演奏什么角色/织体/idiomMode) | `pipeline/CastingEngine.ts` | PianoAccompIdiom 兜底分支 / Conductor 内决策 |
| Mood → Recipe / WalkPattern 映射 | `pipeline/MoodRouter.ts`(纯数据表) | CastingEngine 不要硬编 |
| 和弦推演规则(T/S/D 转移概率) | `pipeline/MacroProgressionEngine.ts` | HarmonyCore(已是薄 facade,只委托) |
| 乐器具体渲染算法(钢琴织体/贝斯走法/鼓型) | `primitives/*Idiom.ts` 或 `AtmosphereRenderer.ts` | Realizer 包装层只 forward,不加逻辑 |
| 加新乐器 | 新建 `realizers/XxxRealizer.ts` + `primitives/XxxIdiom.ts` | Conductor 直接 import Idiom |
| RELATIVE → ABSOLUTE 转换 | `pipeline/AbsoluteTransposer.ts`(K-2 唯一点) | 任何上游 |
| 跨乐器协调(damp / voice crossing 检测) | `pipeline/Reconciler.ts` | 各 Realizer / Conductor 内 |
| 核心 IR 类型字段增删 | `ir/index.ts` / `ir/harmonic-skeleton.ts` | `types.ts` 旧位置(已 re-export) |
| 风格参数(BPM 范围/和声池/personas) | `config/styles/*.ts` | 引擎模块内硬编 |
| 风格无关音乐物理(LIL / breath / range) | InstrumentProfile(Phase 4+ 引入) | 在 Realizer 内 if/else 处理 |

---

## 3. 命名约定

| 后缀 | 语义 | 类型 | 例子 |
|------|------|------|------|
| `*Engine` | 主动决策模块(消费输入 → 产决策) | class | CastingEngine, MacroProgressionEngine |
| `*Realizer` | 乐器具象化(InstrumentRealizer 接口实现) | const/class | PianoRealizer, BassRealizer |
| `*Processor` | 集中算法库(策略集合) | class | VoicingProcessor |
| `*Transposer` | 空间转换 | class | AbsoluteTransposer |
| `*Renderer` / `*Idiom` | 渲染器(class,历史命名) | **class only** | AtmosphereRenderer, PianoAccompIdiom |
| `*Config` | 配置数据接口(取代历史 `*Idiom interface`) | **interface only** | AtmosphereConfig |
| `*Encoder` | 分析器(从音符提取元数据) | class | SongHookEncoder |
| `*Planner` / `*Router` | 路由/规划(纯查表 + 决策) | function | PhraseContourPlanner, MoodRouter |
| `*Mutator` | 变换器(同形输入输出) | class/function | RhythmMutator, TopologyMutator |

**关键约定(Phase 7 后定型)**:
- `*Idiom` 后缀**仅指 class**(渲染器);interface 名禁用 `*Idiom`,改用 `*Config`(配置)/ `*Params`(参数)
- `*Renderer` 与 `*Idiom` 当前并存(历史遗留);新代码偏好 `*Realizer` 包装,旧 `*Idiom` class 不必改名

**Engine vs Processor 的区别**:
- Engine 知道音乐意图("这段要 Triumphant"),Processor 只算数学("给我 4-voice voicing")
- 新增模块前先想清楚:是决策还是计算?

---

## 4. 三大不变式(违反 = 必坏)

### 4.1 Pitch Space 三空间(K-1 / K-2 / K-7 / K-8)

- **RELATIVE 空间**:Structure / Harmony / Casting / Realizer 全程使用,pitch 不含 keyOffset
- **ABSOLUTE 空间**:AbsoluteTransposer.arrange() 之后,pitch = relative + keyOffset,clamp [0,127]
- **GM Drum Map 第三空间**:Drums 轨 pitch 是物理键位(36-81),Conductor / AbsoluteTransposer 都**不加 keyOffset**
- **K-2 铁律**:AbsoluteTransposer 之前的任何模块**禁止**给 `NoteData.pitch` 加 `keyOffset`

任何一处违反 K-2,golden seed 立即挂,且会导致跨调式渲染错位。

### 4.2 PRNG 序列固定(D-1 / D-5)

- 所有随机性走 `PRNGManager`,**禁止** `Math.random()`
- 每个引擎应在注释里**预声明 PRNG 预算**("每和弦消耗 N 次")
- 重构时:**PRNG 调用顺序必须 verbatim 一致**(算法搬运不能改 PRNG 调用顺序,否则 D-5 锁帧失效)
- 验证手段:`npm run golden-seed`,7 个 seed 的 sha256 必须一致(算法不变时)

### 4.3 数据契约稳定(types.ts + ir/)

- IR 字段**只增不减**,删除前必须跨整个引擎评估 + C 端移植同步
- 新增字段**必须可选**(`field?: T`)
- `GeneratedChord.voicing` 在 RELATIVE 空间;AbsoluteTransposer 之后才转 ABSOLUTE
- `SectionMetadata.startBeat/endBeat` 是拍数(float),不是采样数
- `NoteData.velocity` 是 [0,1] float;C 端折算到 0-127

---

## 5. 改动前决策树

```
要改的是什么?
├─ 音乐算法逻辑(voicing/进行/织体/groove)
│  └─ 查"单一真理之源"表 → 改对应模块
│     └─ 改前 grep callsite 数量
│        └─ ≥5 个 callsite → 谨慎,考虑接口稳定性后再改
├─ 重命名 / 移动文件
│  └─ git mv + grep callsite + 全部更新 + lint 必过
│     └─ 配合命名约定(*Engine / *Realizer / *Processor)
├─ 加新乐器
│  ├─ 新建 primitives/XxxIdiom.ts(渲染算法)
│  ├─ 新建 realizers/XxxRealizer.ts(包装层)
│  ├─ CastingEngine 加 idiom params 分支
│  └─ Conductor 加 mask 分支 + Realizer 调用
├─ 改 IR 类型
│  ├─ 加字段(可选)→ 改 ir/index.ts 或 ir/harmonic-skeleton.ts
│  └─ 删字段 → 慎重,跨全引擎评估 + 同步 sync-to-c
├─ 优化算法(目的就是改输出)
│  └─ 明确接受 golden seed 重录
│     └─ commit message **必须列**新旧 sha 对照
└─ 修 bug
   └─ 先决定是 bit-exact 修(行为不变,只是去除潜在路径)
      还是行为修(改输出 → 重录 golden seed)
```

---

## 6. 改动后必跑清单

每次 commit 前:

1. `npm run lint` — TypeScript 类型检查必过
2. `npm run golden-seed` — 输出 7 个 sha256 值
3. **对照上一次的 sha 值**:
   - 算法不变的重构 → sha **必须 bit-exact 一致**(scripts/*-output*.json 是 gitignored,看 console 输出)
   - 算法变更的 PR → sha 变化,commit message **必须列**新旧 sha 对照(供未来对账)
4. **黄金种子必须刻意维护** — 不允许"我觉得没改算法不用查"的态度

**黄金种子文件状态**:
- `scripts/golden-seed-output.json` —— gitignored,本地工件
- `scripts/golden_seed_data.h` —— gitignored,C 端工件,由 `scripts/json2c.py` 从 .json 转出
- 真实"baseline"是 commit message 里记录的 sha 值

---

## 7. 抽取/重命名 SOP

参考 Phase 1-6 commits 的成功模式:

1. **算法 verbatim 搬运** —— 抽取时**不要"顺便优化"**,改算法导致 PRNG 漂移
2. **先创建新模块,callsite 更新,再删旧文件** —— 中间状态 lint 必须能过
3. **Comment 保留 "原 X.Y" 痕迹** —— 后续人能 grep 追溯算法出处
4. **每一步分阶段验证**:
   - 创建新文件 → `npm run lint`
   - 更新 callsite → lint + golden-seed
   - 删旧文件 → lint + golden-seed
5. **PRNG-sensitive 模块抽取需格外仔细** —— 任何 PRNG 调用顺序变化都会破 bit-exact;
   建议先打开 `scripts/prng-verify.ts` 等工具对照
6. **重命名时 grep 必扫**:
   - 类/函数名:`grep -rn "OldName" src/ scripts/`
   - 文件路径 import:`grep -rn "from.*OldFileName" src/ scripts/`
7. **commit message 必须说清楚**:
   - 算法搬运还是优化?
   - bit-exact 保持还是重录?
   - 若重录,列新 sha

---

## 8. 反模式禁区(已踩过的坑,不要重蹈)

不要做:

- ❌ **class static state** —— 参考 BandEngine 旧版 `currentSwingRatio / currentStyleId` 等(Phase 2 已删)
  → 用显式 PlanContext 参数沿调用链传

- ❌ **同种 voicing 在多文件实现** —— Phase 1 前的 RootlessVoicer 问题
  → `VoicingProcessor.ts` 是唯一源,新策略直接加在那里

- ❌ **AbsoluteTransposer 之前任何模块给 pitch 加 keyOffset**
  → K-2 铁律,全局唯一加点在 `AbsoluteTransposer.arrange()`

- ❌ **用 `Math.random()`**
  → `PRNGManager.next()`,且在文件头声明 PRNG 预算

- ❌ **types.ts / ir/ 字段从可选改必填**
  → 破坏向后兼容 + C 端移植对齐

- ❌ **Realizer 内自己做织体/节奏决策**
  → 那是 CastingEngine 的职责;Realizer 只渲染

- ❌ **Idiom 文件直接被 Conductor 调用** —— Phase 4 之前的旧模式
  → 走 Realizer 包装层

- ❌ **"我先 commit 一版,golden seed 等 PR 通过后再修"**
  → 每个 commit 都必须 lint + golden-seed 至少一项绿;算法重构强制两项绿

- ❌ **"反正 .json 是 gitignored,sha 改了无所谓"**
  → commit message 必须显式记录 sha 变化,否则未来无 baseline

- ❌ **跳过 Reconciler / Conductor 直接拼 4 轨**
  → Conductor 是总装唯一入口,Reconciler 是其末尾调用

---

## 9. Reconciler v1 → v2 升级条件

详见 `src/core/generation/pipeline/Reconciler.ts` 文件头的完整 **UPGRADE TRIGGER + UPGRADE PATH** 注释。

简要(必须先读源文件再动手):
- **v1 当前能力**:同 `(pitch, onset)` 重复音 velocity ×0.6 damp + Low Interval Limit 仅检测
- **v2 触发条件**(任一命中):
  - 编制中和声乐器从 2 个 → 3 个及以上
  - 听感测试反复"糊/乱/撞"标注 ≥3 次
  - 加入第二个 lead 乐器(如萨克斯 + 小号)
- **v2 升级是纯增量**:不动 InstrumentRealizer / CastingEngine / HarmonyCore 任何接口,仅在 Conductor 加 `while` 循环 + Reconciler 内消费 `unresolvedIssues`
- **不要提前实现 v2** —— 没触发条件就是过度工程

---

## 10. 模块依赖规则(允许 / 禁止)

```
ir/                   ← 谁都能依赖,自己不依赖任何引擎模块
types.ts              ← 全管线共享(含 IR re-export)
pipeline/             ← 可依赖 primitives/ + realizers/ + ir/
primitives/           ← 可依赖 ir/,**禁止**依赖 pipeline/
realizers/            ← 可依赖 primitives/ + ir/,**禁止**依赖 pipeline/
config/styles/        ← 可依赖 types.ts + ir/,**禁止**依赖 pipeline/ 或 primitives/
data/                 ← 纯数据,不依赖任何引擎模块
```

**圆圈依赖一律禁止**;发现 import cycle 直接重构。

---

## 11. 乐器修改速查 — 按"想优化什么"反查文件

> 当你脑子里有"我想让钢琴更摇摆 / 更稀疏 / 加个新 lick / 改撞音规则"等
> **具体需求**时,直接查本节对应行,避免在错位置改 + 多处打补丁。
>
> 本节是 §2"单一真理之源"的**乐器维度补充**——§2 按"改什么"查,本节按
> "想优化哪个乐器的什么方面"查。
>
> 当前覆盖:钢琴(Phase 7 后第一个详细范例)。
> 未来加吉他 / 萨克斯 / 弦乐等,**按本节模板新增 §11.2 / §11.3 子节**。

### 11.1 钢琴 — 5 层关切点分布

```
┌─ 决策层(说"这段钢琴想怎么演奏") ────────────────────────┐
│  pipeline/MoodRouter.ts          ← Mood 决策(8 桶)       │
│    pickMood()                    (style/bpm/section/persona → MoodId)
│    moodToRecipe()                (mood × style → TextureRecipeId)
│                                                          │
│  pipeline/CastingEngine.ts       ← 综合决策              │
│    pickPianoAccompParams()         (line 238-334)        │
│    - 选 LH 模式(Sustained/Walking/Tacit/Shell)           │
│    - 选 RH 织体(Block/Stab/Broken)                       │
│    - 选 CoordMode(M1/M5/M6/M7)                           │
│    - Persona DNA 映射(colorBias→voicingSpan 等)          │
│                                                          │
│  config/styles/*.ts              ← 风格池注入(personas)  │
└──────────────────────────────────────────────────────────┘
        ↓ 决策结果打包成 PianoAccompParams
┌─ 物理约束层(钢琴的物理事实) ────────────────────────────┐
│  primitives/PianoAccompIdiom.ts (常量区,line 58-107)     │
│    RH_MIN_PITCH=48 / SHELL_RANGE [52, 69] / 等           │
│    MIN_HAND_SEPARATION=3 半音                            │
│    enforceHandSeparation()       (line 992-1008)         │
│                                                          │
│  pipeline/ToplineEngine.ts (Pass 3,line 651-697)         │
│    pianoPedalRatio → 阻尼器自然延音建模                  │
└──────────────────────────────────────────────────────────┘
        ↓
┌─ 算法 / Voicing 层(怎么算出具体音符) ───────────────────┐
│  primitives/VoicingProcessor.ts                          │
│    buildShellLH()       ← LH guide-tone shell            │
│    buildRootlessRH()    ← RH rootless                    │
│    buildQuartalRH()     ← RH quartal                     │
│    computeSATBVoicings()← 4-voice 全局                   │
│                                                          │
│  primitives/RhythmTopologyMutator.ts                     │
│    OP_DENSIFY/DECIMATE/ROTATE/MIRROR 等节奏算子          │
│  primitives/SyncopationEvaluator.ts                      │
│    metricalWeight() — 切分张力评估                       │
└──────────────────────────────────────────────────────────┘
        ↓
┌─ 渲染层(把决策 + 算法 → NoteData[]) ────────────────────┐
│  primitives/PianoAccompIdiom.ts (1679 行,核心)           │
│    render()           ← 入口(被 PianoRealizer 包装)       │
│    renderGrid()       ← 应用 baseGrid + 算子链           │
│    renderLHWalkPattern() ← LH walking 解释器             │
│    renderM5TwoHandedVoicing() ← Bill Evans 风            │
│    renderLHShellVoicing() ← 调 VoicingProcessor          │
│    renderLick()       ← 签名 lick 落音                   │
└──────────────────────────────────────────────────────────┘
        ↓
┌─ 资源层(数据库 / 卡片库,只读不算) ──────────────────────┐
│  data/PianoTextureRecipes.ts  ← 10 种 RH 织体配方        │
│  data/PianoTextureEnums.ts    ← LHTexture/RHTexture/CoordMode 枚举
│  data/BassWalkPatterns.ts     ← Solo Piano LH walking 配方
│  idioms/LickDictionary.ts     ← 4 个签名 lick            │
│  idioms/MusicianRegistry.ts   ← alex/chloe/marcus_piano 卡
└──────────────────────────────────────────────────────────┘
```

### 11.2 钢琴优化场景对照表(每个最多动 1-2 个文件)

| 你想优化什么 | 主要改哪 | 次要改哪(如需) | Blast |
|------------|---------|----------------|-------|
| **加一种新 RH 织体**(如 Stride / Latin Montuno 变体) | `data/PianoTextureRecipes.ts` 加 enum + 配方 | `PianoAccompIdiom.renderGrid()` 如需新分支 | 1-2 文件 |
| **调某 mood 下的 voicing 偏好** | `pipeline/MoodRouter.ts` 改 `MOOD_RECIPE[mood][styleId]` 表 | — | **1 文件** |
| **加新 signature lick** | `idioms/LickDictionary.ts` 加 Lick 对象到 LICKS 数组 | — (hash 自动路由) | **1 文件** |
| **改进双手撞音检测** | `PianoAccompIdiom.enforceHandSeparation()` (line 992-1008) | 若涉及跨乐器,扩 `Reconciler.ts` | 1-2 文件 |
| **新 LH 演奏模式**(如 Boogie Woogie) | `data/BassWalkPatterns.ts` 加 WalkPatternId + WALK_PATTERNS 配方 | `MoodRouter.MOOD_WALK_PATTERN` 表加路由 | 1-2 文件 |
| **改 LH/RH 物理约束**(改音域 / 改最小间隔) | `PianoAccompIdiom.ts` 顶部常量 (line 58-107) | — | **1 文件** |
| **新 CoordMode**(双手协作模式,如 M8) | `data/PianoTextureEnums.ts` enum + `PianoAccompIdiom` 渲染分支 + `CastingEngine.pickPianoAccompParams` 路由 | (3 文件,但都是已知点) | 3 文件 |
| **新钢琴 musician**(如 herbie_jazz_piano) | `idioms/MusicianRegistry.ts` 加 musician 卡 | `config/styles/*.ts` 选择性 plug 进 personas | 1-2 文件 |
| **改 voicing 算法本身**(如重写 rootless 加 chromatic approach) | `primitives/VoicingProcessor.ts` 对应 build*RH 函数 | — | **1 文件** |
| **改 persona DNA → params 映射**(如 colorBias 加非线性) | `pipeline/CastingEngine.pickPianoAccompParams` (line 298-300) | — | **1 文件** |
| **改踏板物理**(如双层踏板 / sostenuto) | `pipeline/ToplineEngine.ts` Pass 3 + 新增 `pedalSostenuto?` 字段到 `MusicianPersona` | types.ts | 2-3 文件 |

### 11.3 钢琴 — 三个反直觉但关键的事实

#### 11.3.1 **PianoAccompIdiom.ts 是渲染器,不是决策器**

1679 行看起来吓人,但**决策代码全不在这里**——它只渲染 `PianoAccompParams`
(已经决策好的输入)。如果你想"让钢琴在 verse 段加更多切分",改
`CastingEngine.pickPianoAccompParams` 或 `MoodRouter`,**别在 PianoAccompIdiom
里加 if/else**——那是反模式,会让决策散落。

#### 11.3.2 **voicing 改造已经收口到 VoicingProcessor**

Phase 1 + 3a 之后,所有钢琴 voicing(SATB / Rootless / Quartal / Shell)集中
在 `VoicingProcessor.ts`。**PianoAccompIdiom 不算 voicing**——它调
`VoicingProcessor.buildShellLH()` / `buildRootlessRH()` 拿现成结果。要改
voicing 算法,只动 VoicingProcessor 一个文件。

#### 11.3.3 **persona DNA 是钢琴个性的真正源头**

钢琴乐手卡的 DNA 字段直接映射到行为:
- `colorBias` → Drop-2 开放度 / 9-13 扩展色彩
- `syncopationAssault` → push hit 密度
- `sparsityTendency` → grid 击点删除概率
- `bouncePreference` → Solo Piano 时切到 Oom-Pah 节奏
- `pianoPedalRatio` → 踏板延音比例
- `signatureLickProb` → 签名乐句触发率
- `walkPatternId` → Solo Piano LH walking 选择

**加新 musician = 调上面这些 DNA 参数 + 写一张卡**(`MusicianRegistry.ts` 内)。
完全不动渲染代码。

### 11.4 优化前自问 3 个问题(对应 §2 单一真理之源)

1. **决策 vs 渲染?**
   - 决策 → CastingEngine / MoodRouter / config/styles
   - 渲染 → PianoAccompIdiom / VoicingProcessor

2. **算法 vs 数据?**
   - 算法 → VoicingProcessor / PianoAccompIdiom / RhythmTopologyMutator
   - 数据(配方/枚举/lick 库)→ data/* 或 idioms/*

3. **钢琴专有 vs 跨乐器共通?**
   - 专有 → 上述钢琴文件
   - 共通(撞音/voice crossing/跨乐器声部协调)→ `pipeline/Reconciler.ts`

**90% 的钢琴优化只改 1-2 个文件**。剩 10%(如新增 CoordMode、改 IR 字段)需要
3+ 文件,这是天然的"加新概念"代价,不可避免。

### 11.5 未来其他乐器速查(待补)

待添加的乐器专题(按 §11.1-11.4 结构):
- [ ] 贝斯(BassRealizer + BassIdiom + BassWalkPatterns)
- [ ] 鼓组(DrumRealizer + DrumIdiom + drumPatterns 风格池)
- [ ] 氛围(AtmosphereRealizer + AtmosphereRenderer + AtmosphereConfig)
- [ ] 吉他(Phase 8+ 加入)
- [ ] 萨克斯 / 管乐(Phase 8+ 加入,届时引入 InstrumentProfile breath constraints)

**每次加新乐器时,本节同步补 §11.X 子节**——把"决策/物理约束/算法/渲染/资源"
5 层分布 + 优化场景表 + 反直觉提醒填好。

---

## 附录:历史里程碑 tag

- `v1.35.0` —— 技术债清零基线
- `v1.36.0 The Pianist Update` —— 钢琴织体重构 + Band UI 解封
- `v1.37.0-refactor-foundations` —— IR / VoicingProcessor / CastingEngine / Realizer 四件套落地
- `v1.38.0-reconciler-online` —— Reconciler 上线 + Conductor 命名收尾
- `v1.39.0-rules-online` —— 规则双轨完整覆盖(engine + app integration 双文件)
- `v1.39.1-naming-cleanup` —— Orchestrator → AbsoluteTransposer + AtmosphereIdiom interface → AtmosphereConfig

每次重构后**同步更新本文件 + 打 tag**。

---

## 附录:本文件维护

- 改本文件本身 **不需要** 跑 lint / golden-seed(纯文档)
- 但**每次架构重构 commit 应在 PR 描述里说明本文件是否需要更新**
- 发现本文件描述与现状不符 → 优先更新本文件(它是真理之源)
