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

## 附录:历史里程碑 tag

- `v1.35.0` —— 技术债清零基线
- `v1.36.0 The Pianist Update` —— 钢琴织体重构 + Band UI 解封
- `v1.37.0-refactor-foundations` —— IR / VoicingProcessor / CastingEngine / Realizer 四件套落地
- `v1.38.0-reconciler-online` —— Reconciler 上线 + Conductor 命名收尾

每次重构后**同步更新本文件 + 打 tag**。

---

## 附录:本文件维护

- 改本文件本身 **不需要** 跑 lint / golden-seed(纯文档)
- 但**每次架构重构 commit 应在 PR 描述里说明本文件是否需要更新**
- 发现本文件描述与现状不符 → 优先更新本文件(它是真理之源)
