# AuraRadio 核心接口约束框架

> 本文档定义 AuraRadio 生成管道的四模块接口边界、数据结构与行为约束。
> 用途：指导需求改动评审、C++ 移植设计、测试用例编写。
> 数据类型与当前源码（`types.ts`、`GlobalContext.ts`、`PRNG.ts`、`MidiScheduler.ts`）一致。

---

## 1. 管道总览

### 1.1 四模块与数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AuraRadio 无限电台                              │
│                                                                      │
│  ┌────────────────┐   ┌──────────────────────┐                       │
│  │  PRNGManager   │   │ 风格查表（静态只读）    │                       │
│  │ setSeed/next   │   │ ·StyleId (enum)      │                       │
│  │ getState/      │   │ ·StyleFlagTable      │                       │
│  │ setState       │   │ ·StyleConfigTable    │                       │
│  └──┬─────────┬───┘   └────┬─────────┬───────┘                       │
│     │         │             │         │                               │
│     ▼         ▼             ▼         ▼                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │  生成引擎     │  │  编配引擎     │  │ MIDI 转换层   │                │
│  │  MelodyEngine├─►│  Orchestrator├─►│ PlaybackEngine│                │
│  │              │  │              │  │  .convert()   │                │
│  └──────────────┘  └──────────────┘  └──────┬───────┘                │
│   GeneratedTrack    ArrangedTrack           │                        │
│   + MusicContext                            │ MidiEvent[]            │
│                                             │ ← 生成管道终点          │
│  ╔══════════════════════════════════════════╧═══════════════╗        │
│  ║              【平台层 — 不属于生成管道】                    ║        │
│  ║  MidiScheduler → 合成器 → 音频输出 → onTrackEnd → 循环   ║        │
│  ╚═════════════════════════════════════════════════════════╝        │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 黑盒接口输入输出图

以下是四个黑盒模块的完整输入、输出和数据流。此图定义了模块间的不可变边界——无论各黑盒内部如何改动，输入数据、输出数据和流向不变。

```
                    显式输入                     隐式输入
                 ┌───────────┐    ┌────────┐   ┌──────────────┐
                 │  styleId  │    │options? │   │ PRNGManager  │
                 │(StyleId   │    │·motif   │   │ .next()      │
                 │  enum)    │    │·tonality│   │ .getState()  │
                 └─────┬─────┘    │·timeSig │   │ .setState()  │
                       │          └────┬────┘   │              │
                       │               │        └──────┬───────┘
                       │               │               │
                       ▼               ▼               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ MelodyEngine.generateFullSong(styleId) │
                    │          【生成引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │                                        │
                    │   同步 · 纯数据 · 确定性                │
                    │                                        │
                    └───────┬────────────────┬───────────────┘
                            │                │
                            ▼                ▼
                    ┌──────────────────────────┐  ┌──────────────┐
                    │      GeneratedTrack       │  │ MusicContext  │
                    │ ·vocal, melody, chords    │  │ ·keyOffset   │
                    │ ·sections                 │  │ ·tonality    │
                    │ ·bpm, key, keyOffset      │  │ ·bpm         │
                    │ ·tonality, timeSignature  │  │ ·timeSignature│
                    │ ·blockIndex               │  │ ·grooveDNA   │
                    │ ·absoluteStartBeat        │  │ ·singerPersona│
                    │ ·hasIntro                 │  └──────┬───────┘
                    │ ·preSelectedPalette       │         │
                    │ ·globalRiff               │         │
                    │ ·processedUserMotif       │         │
                    │ ·motifRole                │         │
                    └────────────┬─────────────┘         │
                                 │                       │
                                 │  styleId              │
                                 ▼  (透传)               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ Orchestrator.arrange(track, styleId,   │
                    │                      context)          │
                    │          【编配引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │ 读取 context: keyOffset, tonality, ... │
                    │                                        │
                    │   单旋律 → 7 轨 · Idiom 渲染           │
                    │   人性化处理 · 消耗 PRNG                │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────────────┐
                    │        ArrangedTrack               │
                    │  ·vocal           : NoteData[]?    │
                    │  ·melody          : NoteData[]     │
                    │  ·secondaryMelody : NoteData[]?    │
                    │  ·pianoLH         : NoteData[]     │
                    │  ·pianoRH         : NoteData[]     │
                    │  ·drums           : NoteData[]?    │
                    │  ·counterMelody   : NoteData[]?    │
                    │  ·palette         : EnsembleDraft  │
                    │  ·sections        : SectionMeta[]? │
                    │  ·bpm, key, absStartBeat           │
                    │  ·timeSignature, styleId           │
                    │  ·globalRiff, userMotif            │
                    └──────────────┬─────────────────────┘
                                  │
                                  │  styleId (透传)
                                  │
                                  ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │  PlaybackEngine.convert(arranged)      │
                    │          【MIDI 转换层】                 │
                    │                                        │
                    │ 内部查表: StyleFlagTable[styleId]       │
                    │          （混音风格 → MIDI CC）          │
                    │                                        │
                    │   NoteData → MidiEvent[]               │
                    │   (noteOn/noteOff/CC + channel + time) │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  │  MidiEvent[] ← 生成管道终点（测试断言点）
                                  │
                    ╔═════════════╧═══════════════════════════╗
                    ║          【平台层 — 不属于生成管道】       ║
                    ║                                         ║
                    ║  MidiScheduler（5ms 轮询）               ║
                    ║       ↓                                 ║
                    ║  合成器（SpessaSynth / FluidSynth）      ║
                    ║       ↓                                 ║
                    ║  音频输出（扬声器）                       ║
                    ║       ↓                                 ║
                    ║  onTrackEnd → playNext() → 循环回顶部    ║
                    ╚═════════════════════════════════════════╝
```

### 1.3 四个模块职责

| # | 模块 | 类 | 输入 | 输出 | PRNG |
|---|------|---|------|------|------|
| 1 | PRNGManager | （新增包装层） | seed | 随机数序列 | — |
| 2 | 生成引擎 | `MelodyEngine` | styleId + options | GeneratedTrack + MusicContext | 消耗 N 次 |
| 3 | 编配引擎 | `Orchestrator` | track + styleId + context | ArrangedTrack | 消耗 M 次 |
| 4 | MIDI 转换层 | `PlaybackEngine.convert` | ArrangedTrack + styleId | MidiEvent[] | 不消耗 |

**风格查表系统**（StyleId enum + StyleFlagTable + StyleConfigTable）是共享的静态只读数据层，程序启动时固定，不作为独立模块。

### 1.4 完整执行周期

**第 0 步 — 初始化**
- AuraRadio 调用 `PRNGManager.setSeed(seed)`，LCG 状态归零，序列从此确定

**第 1 步 — 选风格**
- AuraRadio 调用 `PRNGManager.next()` → 从 14 个 StyleId 中选一个

**第 2 步 — 生成曲目**
- AuraRadio 调用 `MelodyEngine.generateFullSong(styleId, options)`
- 内部按固定顺序执行：决策 BPM/调性/拍号 → StructureEngine → HarmonyEngine → EnsembleDrafter → SingerPersona → ToplineEngine → reharmonize
- 返回 `{ track: GeneratedTrack, context: MusicContext }`

**第 3 步 — 存历史**
- AuraRadio 将 `(track, styleId, context)` 存入历史栈

**第 4 步 — 编配**
- 调用 `Orchestrator.arrange(track, styleId, context)`
- 内部：查表 → 读 context → 逐段落展开为 7 轨 → Idiom 渲染 → 人性化
- 返回 `ArrangedTrack`

**第 5 步 — MIDI 转换**
- 调用 `PlaybackEngine.convert(arranged, styleId)`
- 内部：7 轨 NoteData → MidiEvent[]（noteOn/noteOff/CC + 通道 + 时间戳）
- 返回 `MidiEvent[]` — **生成管道到此结束**

**第 6 步 — 平台层播放**（不属于生成管道）
- MidiScheduler 加载 MidiEvent[]，5ms 轮询驱动合成器输出音频

**第 7 步 — 循环**
- onTrackEnd → playNext()：历史有下一首 → 跳到第 4 步；末尾 → 跳到第 1 步

---

## 2. PRNGManager 接口

贯穿全管道的随机数供给模块。内部维护一个 LCG（线性同余生成器），所有需要随机数的模块统一从这里取数。

> **名词解释**
> - **PRNG**（Pseudo-Random Number Generator）：伪随机数生成器，给定相同种子必定产生相同序列。
> - **LCG**（Linear Congruential Generator）：线性同余生成器。本项目参数：`a=1664525, c=1013904223, m=2³²`（源码 `PRNG.ts:17`）。

**工作原理**:

PRNGManager 内部只有一个整数 `state`，这就是它的全部状态。

```
setSeed(42)  → state = 42                                     （初始化）

第 1 次 next() → state = (1664525 × 42 + 1013904223) % 2³²   → 返回 state / 2³²
第 2 次 next() → state = (1664525 × state + 1013904223) % 2³²  → 返回 state / 2³²
第 3 次 next() → 同上，永远用上一次的 state 算下一个
...
```

seed 决定起点，之后每次 `next()` 不可逆地往前走一步。整条序列是一条**单向链**，完全由 seed 唯一确定。不管谁调用 `next()`，只要调用顺序一样，出来的数就一样。

**实际消费顺序**（单次生成周期）:

```
setSeed(seed)
  │
  ├─ AuraRadio 选风格            → next() ×1      ← 从 14 个 StyleId 中选一个
  │
  ├─ 生成引擎内部                 → next() ×N 次
  │   ├─ StructureEngine         → next() ×若干
  │   ├─ HarmonyEngine           → next() ×若干
  │   ├─ EnsembleDrafter         → next() ×若干
  │   ├─ ToplineEngine           → next() ×若干
  │   │   ├─ GrooveEngine        → next() ×若干
  │   │   ├─ RhythmCells         → next() ×若干
  │   │   └─ SingerPersona.apply → next() ×若干
  │   └─ reharmonize             → next() ×0      ← 纯 Viterbi DP，不消耗
  │
  ├─ 编配引擎内部                 → next() ×M 次
  │   ├─ Orchestrator 自身        → next() ×若干   ← 乐器选择 + 编排决策
  │   ├─ TextureMapper           → next() ×若干   ← 贝斯/和弦织体/鼓/副旋律
  │   ├─ TransitionEngine        → next() ×若干   ← 段落过渡
  │   ├─ InstrumentIdiom         → next() ×若干
  │   └─ humanize                → next() ×若干
  │
  └─ MIDI 转换层                  → next() ×0      ← 纯数据转换，不消耗随机数
```

**接口**:

```typescript
PRNGManager.setSeed(seed: number): void       // 设置 state = seed，序列从头开始
PRNGManager.next(): number                    // 算下一个 state，返回 0~1
PRNGManager.nextInt(min, max): number         // next() 基础上映射到整数范围
PRNGManager.nextFloat(min, max): number       // next() 基础上映射到浮点范围
PRNGManager.getState(): number                // 读取当前 state（用于快照）
PRNGManager.setState(state: number): void     // 恢复到指定 state（用于复现）
```

**测试钩子** — `getState()` / `setState()` 的用法:

正常运行时，在每个模块入口自动快照当前 state：

```
setSeed(12345)
                          stateA = getState()  → 42          ← 选风格前
AuraRadio 选风格           next() ×1
                          stateB = getState()  → 98371052    ← 生成引擎入口
生成引擎                   next() ×N
                          stateC = getState()  → 2748193604  ← 编配引擎入口
编配引擎                   next() ×M
                          stateD = getState()  → 817432956   ← MIDI 转换前
MIDI 转换层                （不消耗）
                          → 最终输出 MidiEvent[]
```

单独测试某个模块时，不需要从 seed 重跑整条链：

```
// 只测编配引擎
setState(2748193604)                              ← 恢复到编配引擎入口的 state
Orchestrator.arrange(track, styleId, context)     ← 喂入之前记录的输入
→ 对比输出是否与完整运行时一致                       ← 一致则该模块正确
```

意义：**把单向链切断成片段，任意一段都能独立重放和验证**。

**行为约束**:
- v1 实现与当前 `globalPRNG` 行为完全一致，黄金种子测试零差异
- `getState()`/`setState()` 是新增能力，当前代码不存在
- 当前源码中 `globalPRNG = new PRNG(Date.now())`，`setSeed()` 虽已实现但项目中从未被调用，每次运行种子不同（不可复现）。黄金种子测试需在入口处显式调用 `setSeed(固定值)`
- 纯确定性，不依赖任何外部状态
- C++ 侧对应 `struct PRNGManager { uint32_t state; }` + `uint8_t protocolVersion`
- v2 分流种子派生（每个模块独立子链）见架构文档第 8 章

---

## 3. 生成引擎接口

```typescript
MelodyEngine.generateFullSong(styleId: StyleId, options?: GenerationOptions)
  → { track: GeneratedTrack, context: MusicContext }
```

同步调用，返回纯数据，不触发音频。

### 3.1 显式输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `styleId` | `StyleId`（enum） | 是 | 风格枚举值，索引 `StyleConfigTable` 和 `StyleFlagTable` |
| `options.userMotifRoot` | `KeyId`（enum） | 否 | 调号枚举（0=C, 1=Db, 2=D, 3=Eb, 4=E, 5=F, 6=F#, 7=G, 8=Ab, 9=A, 10=Bb, 11=B），直接锁定全曲调号。不传则由内部 PRNG 生成（与当前源码行为一致） |
| `options.processedUserMotif` | `NoteData[]` | 否 | 用户动机音符序列，由上层意图识别模块给出。不传则全部由 PRNG 生成（与当前源码默认行为一致） |
| `options.motifRole` | `MotifRole`（enum） | 否 | 动机角色枚举，决定 processedUserMotif 在编配中的层级。`Foreground`=主旋律模板、`Middleground`=副旋律/和弦层、`Background`=贝斯层。由上层意图识别模块给出，默认 `Foreground` |
| `options.detectedTimeSignature` | `[int, int]` | 否 | 拍号，如 `[4, 4]`（四四拍）、`[3, 4]`（三四拍）。传入则直接使用，不传则由 PRNG 从风格配置的拍号池按权重随机抽取 |
| `options.detectedTonality` | `TonalityId`（enum） | 否 | 调式枚举。`0`=由 PRNG 从风格配置的调式池按权重随机抽取，非 0 直接作为调式引用（与当前源码行为一致，仅将字符串机械替换为枚举值） |

### NoteData 在此阶段的有效字段

用户动机的 `NoteData` 只需以下 4 个字段，其余由管道内部后续阶段填充：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pitch` | `uint8` | MIDI 音高 0~127 |
| `onset` | `float` | 起始拍位（单位：拍） |
| `duration` | `float` | 时长（单位：拍） |
| `velocity` | `float` | 力度 0.0~1.0 |

### 待移除参数

- `motifExpertise`（动机专业度标记）：当前源码 `types.ts:172` 中仍存在，未被任何逻辑使用，纯透传，目标删除。

---

### 3.2 隐式输入

| 名称 | 说明 |
|------|------|
| `PRNGManager` | 入口自动记录状态快照（`getState()`），内部各子模块依次调用 `next()` 消耗随机数 |
| `StyleConfigTable[styleId]` | 内部查表得到，定义 BPM 范围、和弦池、旋律约束、乐器候选等规则边界 |
| `StyleFlagTable[styleId]` | 内部查表得到，风格分类标签位掩码（25 flag） |

---

### 3.3 输出：GeneratedTrack

| 字段 | 类型 | 必填 | 来源 | 说明 |
|------|------|------|------|------|
| `chords` | `GeneratedChord[]` | 是 | HarmonyEngine | 全曲和弦进行（经 reharmonize 优化） |
| `melody` | `NoteData[]` | 是 | ToplineEngine | 主旋律音符 |
| `vocal` | `NoteData[]` | 否 | ToplineEngine | 人声轨（有人声编制时才有） |
| `bpm` | `int` | 是 | MelodyEngine | 速度 |
| `key` | `string` | 是 | MelodyEngine | 调号名称（"C"/"Db"/...），keyOffset 查表得到 |
| `keyOffset` | `uint8` | 是 | MelodyEngine | 调号 0~11 |
| `tonality` | `string` | 是 | MelodyEngine | 调式（当前源码为字符串） |
| `timeSignature` | `[int, int]` | 是 | MelodyEngine | 拍号 |
| `sections` | `SectionMetadata[]` | 是 | StructureEngine | 段落结构（grooveDNA 由 ToplineEngine 后续填充） |
| `blockIndex` | `int` | 是 | — | 固定为 0（预留） |
| `absoluteStartBeat` | `float` | 是 | — | 固定为 0（预留） |
| `hasIntro` | `bool` | 是 | — | 固定为 true（预留） |
| `preSelectedPalette` | `EnsembleDraft` | 否 | EnsembleDrafter | 乐器编制方案 |
| `globalRiff` | `NoteData[]` | 否 | ToplineEngine | Foreground 动机时提取的全局 Riff |
| `processedUserMotif` | `NoteData[]` | 否 | 透传 | 用户动机原样透传 |
| `motifRole` | `MotifRole`（enum） | 否 | 透传 | 动机角色 |

---

### 3.4 输出：MusicContext

对应当前源码 `GlobalContext` 公开字段的显式抽取，传递给编配引擎：

| 字段 | 类型 | 说明 |
|------|------|------|
| `keyOffset` | `uint8` | 调号 0~11 |
| `tonality` | `TonalityId`（enum） | 调式 |
| `bpm` | `int` | 速度 |
| `timeSignature` | `[int, int]` | 拍号 |
| `grooveDNA` | `float[]` | 节奏指纹 |
| `singerPersona` | `SingerPersonaConfig?` | 歌手人格配置 |

---

### 3.5 行为约束

1. **确定性**：相同 PRNG 状态 + 相同输入 = 相同输出
2. **纯数据**：不触发音频、不访问硬件、不产生副作用
3. **PRNG 消耗**：每次调用消耗若干 `next()`，状态不可逆前进
4. **无全局写入**：音乐上下文通过返回值 `context` 显式输出，不写入 `GlobalContext` 等全局单例
5. **快照支持**：入口处 `PRNGManager.getState()` 自动快照，支持独立复现本阶段输出

### 3.6 内部执行顺序

```
generateFullSong(styleId, options)
  │
  ├─ 查表 StyleConfigTable[styleId] → style 规则
  ├─ 查表 StyleFlagTable[styleId]   → flag 标签
  │
  ├─ 决策 BPM          ← PRNG / style.bpmRange
  ├─ 决策 keyOffset     ← userMotifRoot / PRNG
  ├─ 决策 tonality      ← detectedTonality / PRNG + style.tonalityPool
  ├─ 决策 timeSignature  ← detectedTimeSignature / PRNG + style.timeSignaturePool
  │
  ├─ StructureEngine    → SectionMetadata[]         ← 段落结构
  ├─ HarmonyEngine      → GeneratedChord[]          ← 和弦进行
  ├─ EnsembleDrafter    → EnsembleDraft             ← 乐器编制
  ├─ SingerPersona 查表  → SingerPersonaConfig       ← 歌手人格
  ├─ ToplineEngine      → NoteData[] (vocal/melody)  ← 旋律 + grooveDNA 填充
  ├─ HarmonyEngine.reharmonize → GeneratedChord[]    ← 反向优化和弦
  │
  └─ return { track: GeneratedTrack, context: MusicContext }
```

每一步按固定顺序消耗 PRNG，顺序不可变。

---

## 4. 编配引擎接口

```typescript
Orchestrator.arrange(
  track: GeneratedTrack,
  styleId: StyleId,
  context: MusicContext
): ArrangedTrack
```

**输入**:

| 参数 | 说明 |
|------|------|
| `track` | 生成引擎输出的 `GeneratedTrack` |
| `styleId` | 风格枚举值，内部查 `StyleConfigTable` 和 `StyleFlagTable` |
| `context` | 生成引擎输出的 `MusicContext`（keyOffset、tonality、bpm、grooveDNA 等） |

**输出**: 七轨分离的 `ArrangedTrack`（vocal / melody / secondaryMelody / pianoLH / pianoRH / drums / counterMelody），含乐器编制、混音参数，以及透传的元数据。

**行为约束**:
- 同步调用，返回纯数据
- 入口自动记录 `PRNGManager.getState()` 快照，内部调用 `next()` 消耗随机数
- 同一 `GeneratedTrack` + 同一 `MusicContext` + 同一 PRNG 状态 = 同一输出
- **不读写任何全局状态**：所有音乐上下文从 `context` 参数读取，不访问全局单例
- 编配引擎内部逐段落遍历时的段落级状态（activeSection、activeChord、energyLevel）通过局部变量管理并显式传参给 TextureMapper / Idiom，不纳入 MusicContext

---

## 5. MIDI 转换层接口

生成管道的末端。将编配引擎输出的 `ArrangedTrack` 转换为 `MidiEvent[]` 序列，这是整个生成管道的最终确定性输出。

```typescript
PlaybackEngine.convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]
```

**输入**: `ArrangedTrack`（七轨音符数据 + 音色 + 混音参数）+ `StyleId`（查 `StyleFlagTable` 确定混音风格 → MIDI CC 指令）

**输出**: `MidiEvent[]`——时间排序的 MIDI 指令序列（noteOn/noteOff/CC + 通道 + 时间戳）

**行为约束**:
- 同步调用，纯数据转换，不涉及音频硬件
- 同一 `ArrangedTrack` + 同一 `StyleId` = 同一 `MidiEvent[]`（确定性）
- 不消耗 PRNG，不读写 MusicContext

**平台层播放**（不属于生成管道）：

```
MidiEvent[] → MidiScheduler（5ms 轮询）→ 合成器 → 音频输出
              │                          │
              │ Web: setTimeout           │ Web: SpessaSynth + GM128_3MB.sf2
              │ ESP32: vTaskDelay         │ ESP32: FluidSynth / TinySoundFont
              └──────────────────────────┘
              因平台/合成器/音色库差异，音频波形允许不同
```

---

## 6. 数据结构定义

> 管道中流转的核心数据结构，字段类型与当前源码一致。

### NoteData — 单个音符

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pitch` | `uint8` | 是 | MIDI 音高 0~127 |
| `onset` | `float` | 是 | 起始拍位（相对曲首，单位：拍） |
| `duration` | `float` | 是 | 时长（单位：拍） |
| `velocity` | `float` | 是 | 力度 0.0~1.0 |
| `isGraceNote` | `bool` | 否 | 装饰音标记，由 ToplineEngine 内部生成 |
| `pitchBend` | `float` | 否 | 弯音量，由 SynthVoiceIdiom 填充 |
| `pitchBendDuration` | `float` | 否 | 弯音持续拍数，由 SynthVoiceIdiom 填充 |
| `fadeOutDuration` | `float` | 否 | 淡出拍数，由 SynthVoiceIdiom 填充 |
| `isUserMotif` | `bool` | 否 | 标记是否来自用户动机，由 ToplineEngine 标记 |

> C++ 映射：`struct NoteData { uint8_t pitch; float onset, duration; uint8_t velocity; uint8_t flags; }` — 可选字段压缩为 bitfield。

### GeneratedChord — 单个和弦

| 字段 | 类型 | 说明 |
|------|------|------|
| `numeral` | `string` | 罗马数字标记（"I"、"vi"、"V7" 等），仅内部解析使用，解析后由 root + quality 承载语义 |
| `root` | `uint8` | 根音 0~11（0=C, 1=Db, ..., 11=B） |
| `quality` | `enum` | 和弦品质，16 种：`Major` / `Minor` / `Diminished` / `Augmented` / `Dominant7` / `Minor7` / `Major7` / `HalfDiminished` / `Sus4` / `Dominant7Sus4` / `Add9` / `Minor9` / `Major9` / `Dominant9` / `Minor11` / `Dominant13` |
| `startBeat` | `float` | 起始拍位 |
| `endBeat` | `float` | 结束拍位 |

### SectionMetadata — 段落结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 段落名（"Intro"、"Verse_1"、"Chorus_Main" 等） |
| `startBeat` | `float` | 是 | 起始拍位 |
| `endBeat` | `float` | 是 | 结束拍位 |
| `energyLevel` | `int` | 是 | 能量等级 1~10 |
| `grooveDNA` | `float[]` | 否 | 节奏指纹：2 小节循环内的律动打击点偏移（拍），由 GrooveEngine 生成 |
| `lofiEffect` | `bool` | 否 | 复古留声机/黑胶质感 |
| `endingType` | `enum` | 否 | 收尾方式：`hard_stop` / `fade_out` |
| `type` | `string` | 否 | 段落类型（"Verse"、"Chorus"、"PreChorus"、"Bridge"、"Intro"、"Outro"） |
| `lengthBars` | `int` | 否 | 小节数 |
| `phraseTemplate` | `string` | 否 | 乐句模板（"A-B"、"A-A-B-A'" 等） |
| `harmony` | `HarmonyState` | 否 | `{ baseProgression: string[], complexityProb: float, harmonicRhythm: float }` |
| `groove` | `GrooveState` | 否 | `{ density: float, syncopationProb: float, swing: float }` |
| `tracks` | `TrackState[]` | 否 | 轨道配置数组 |
| `localStyleOverride` | `string` | 否 | 局部风格覆盖 |
| `isRiffDriven` | `bool` | 否 | 是否由 Riff 驱动 |

### EnsembleDraft — 乐器编制

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `melodySound` | `string` | 是 | 主旋律乐器名（GM 音色名） |
| `vocalSound` | `string` | 否 | 人声音色 |
| `secondaryMelodySound` | `string` | 否 | 副旋律乐器名 |
| `chordSound` | `string \| null` | 否 | 和弦伴奏乐器（`null` 表示无此乐器） |
| `bassSound` | `string \| null` | 否 | 贝斯乐器（`null` 表示无此乐器） |
| `drumSound` | `string \| null` | 否 | 鼓组（`null` 表示无此乐器） |
| `counterMelodySound` | `string \| null` | 否 | 对位旋律乐器（`null` 表示无此乐器） |
| `filterSweep` | `string` | 否 | 滤波扫过特效 |
| `mixing` | `{ vocal?, melody?, secondaryMelody?, chord?, bass?, drums?, counterMelody?: MixingConfig }` | 否 | 各轨混音参数（7 个具名可选键） |

### MixingConfig — 单轨混音参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pan` | `float` | 是 | 声像 -1.0（左）~ 1.0（右） |
| `reverb` | `float` | 是 | 混响发送量 0.0~1.0 |
| `volume` | `float` | 是 | 音量偏移（dB） |
| `delay` | `float` | 否 | 延迟发送量 0.0~1.0 |

### SingerPersonaConfig — 歌手人格

固定预设表（13 个），由 `StyleConfig.allowedPersonas` 索引。`.id` 和 `.name` 不参与生成逻辑，仅 `.traits` 有效。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 唯一标识（未被业务逻辑使用） |
| `name` | `string` | 显示名称（未被业务逻辑使用） |
| `traits.staccatoTendency` | `float` | 断奏倾向 0~1 |
| `traits.trailingFade` | `float` | 叹息尾音概率 0~1 |
| `traits.graceNoteProbability` | `float` | 装饰音概率 0~1 |
| `traits.syncopationPush` | `float` | 抢拍强度 0~1 |

### ArrangedTrack — 编配引擎输出

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bpm` | `int` | 是 | 速度（透传） |
| `key` | `string` | 是 | 调号名称（透传） |
| `absoluteStartBeat` | `float` | 是 | 绝对起始拍（透传） |
| `timeSignature` | `[int, int]` | 否 | 拍号（透传） |
| `styleId` | `string` | 否 | 风格标识（当前源码为字符串） |
| `vocal` | `NoteData[]` | 否 | 人声轨 |
| `melody` | `NoteData[]` | 是 | 主旋律轨 |
| `secondaryMelody` | `NoteData[]` | 否 | 副旋律轨 |
| `pianoLH` | `NoteData[]` | 是 | 钢琴左手（贝斯/低音伴奏） |
| `pianoRH` | `NoteData[]` | 是 | 钢琴右手（和弦/织体） |
| `drums` | `NoteData[]` | 否 | 鼓组轨 |
| `counterMelody` | `NoteData[]` | 否 | 对位旋律轨 |
| `userMotif` | `NoteData[]` | 否 | 用户动机轨 |
| `palette` | `EnsembleDraft` | 否 | 乐器编制（透传） |
| `sections` | `SectionMetadata[]` | 否 | 段落结构（透传） |
| `globalRiff` | `NoteData[]` | 否 | 全局 Riff（透传） |

### MidiEvent — MIDI 指令（管道终点输出）

| 字段 | 类型 | 说明 |
|------|------|------|
| `ticks` | `int` | 时间戳（tick，如 480 PPQ） |
| `type` | `enum` | 指令类型：`noteOn` / `noteOff` / `cc` / `programChange` / `visual` |
| `channel` | `uint8` | MIDI 通道 0~15 |
| `data1` | `uint8` | 参数 1（noteOn/Off: 音高；cc: 控制器编号；programChange: 音色编号） |
| `data2` | `uint8` | 参数 2（noteOn/Off: 力度；cc: 控制值） |
| `visualData` | `any?` | 选填，可视化事件附加数据（仅 type=visual 时使用） |

---

## 7. 与当前源码的差异

> 本文档描述的是**目标接口设计**。以下列出与当前源码实现的具体差异。所有差异项均为非破坏性机械替换，不改变算法逻辑和 PRNG 消耗顺序。

| 项 | 当前源码 | 本框架 | 涉及文件 |
|---|---|---|---|
| **基础设施** | | | |
| styleId 类型 | `string`（如 `'modern_pop'`） | `StyleId`（enum 数值） | `types.ts`、所有接口签名 |
| 风格分类方式 | `style.id.includes('house')` 子串匹配（8 个文件、31 处） | `StyleFlagTable[styleId]` 位掩码查表 | `Orchestrator.ts`、`TextureMapper.ts`、`HarmonyCore.ts`、`StructureEngine.ts`、`EnsembleDrafter.ts`、`PlaybackEngine.ts`、`RhythmCells.ts`、`LiveLoopingEngine.ts` |
| 风格配置查询 | `getStyleConfig(id: string)` 哈希表查找 | `StyleConfigTable[styleId]` 静态数组直接寻址 | `StyleRegistry.ts` |
| PRNG 管理 | 裸 `globalPRNG` 单例，无状态快照 | `PRNGManager` 模块，支持 `next()`、`getState()`/`setState()` | `PRNG.ts` → 新增 `PRNGManager.ts` |
| 音乐上下文传递 | `GlobalContext` 全局可变单例，生成引擎写入、编配引擎隐式读取 | `MusicContext` 结构体，生成引擎显式返回、编配引擎显式接收 | `GlobalContext.ts`、`MelodyEngine.ts`、`Orchestrator.ts` |
| **生成引擎** | | | |
| 生成引擎参数签名 | `generateFullSong(styleId: string)` | `generateFullSong(styleId: StyleId)` | `MelodyEngine.ts` |
| 生成引擎返回值 | `GeneratedTrack` | `{ track: GeneratedTrack, context: MusicContext }` | `MelodyEngine.ts` |
| userMotifRoot | `number?`（可选，不传时内部 PRNG 生成） | `KeyId?`（enum，可选） | `MelodyEngine.ts` |
| motifRole | `string` union | `MotifRole`（enum） | `types.ts`、`MelodyEngine.ts` |
| motifExpertise | `string?`（源码 `types.ts:172` 仍存在，未被逻辑使用，纯透传） | 删除 | `MelodyEngine.ts`、`types.ts` |
| detectedTonality | `'Major' \| 'Minor'` | `TonalityId`（enum，0=随机） | `MelodyEngine.ts` |
| **编配引擎** | | | |
| 编配引擎参数 | `arrange(track, style: StyleConfig)` | `arrange(track, styleId: StyleId, context: MusicContext)` | `Orchestrator.ts` |
| **播放引擎** | | | |
| 生成管道终点 | `AudioEngine.playSong()` 内调用 `Orchestrator.arrange()` + `PlaybackEngine.loadSong()`（后者内含 MIDI 转换 + 音频初始化，无独立 `convert()` 方法） | 独立 `PlaybackEngine.convert()` 纯函数输出 `MidiEvent[]`，音频合成剥离到平台层 | `PlaybackEngine.ts`、`AudioEngine.ts` |
| 播放引擎参数 | `playSong(track, style: StyleConfig, ...)` | `playSong(track, styleId: StyleId, context: MusicContext, ...)` | `AudioEngine.ts` |
| playSong generator 参数 | `playSong(track, style, generator: MelodyEngine, options?)` | `playSong(track, styleId, context, options?)`（移除 generator） | `AudioEngine.ts` |
| **外围** | | | |
| StyleConfig 查表次数 | EndlessRadioManager 查一次 + MelodyEngine 内部再查一次（冗余） | 各组件内部按需查一次 | `EndlessRadioManager.ts`、`AudioEngine.ts` |
| 历史栈存储 | `{ track: GeneratedTrack, style: StyleConfig }` | `{ track: GeneratedTrack, styleId: StyleId, context: MusicContext }` | `EndlessRadioManager.ts` |
| 风格显示名称 | `style.name` 从 StyleConfig 对象读取 | `StyleIdName[styleId]` 独立数组 | UI 层 |

---

## 8. 接口设计约束

> 以下约束已融入第 2~5 章的接口设计中，所有改动不改变生成输出，黄金种子测试结果零差异。

1. **PRNG 由 `PRNGManager` 统一管理**：废弃裸 `globalPRNG` 单例，统一通过 `PRNGManager.next()` 获取随机数，模块管理种子、状态快照（`getState()`/`setState()`）、协议版本。v1 串联流行为与原 `globalPRNG` 一致。
2. **`StyleId` 为 enum 类型**：废弃 `style.id` 字符串。所有接口只传 `StyleId`（enum 数值），各组件内部按需查 `StyleConfigTable[styleId]` 和 `StyleFlagTable[styleId]`。
3. **风格分类走 `StyleFlagTable` 位掩码**：废弃所有 `style.id.includes()` 子串匹配（8 个文件、31 处）。flag 分配按代码中实际的分支命中路径确定，确保替换前后每个风格命中的 if 分支完全一致。`uint32_t` 容纳，不做乐理归约合并。新增风格时必须在 `StyleFlagTable` 中声明 flags。**StyleId enum 迁移与 StyleFlag 替换必须同步执行，不可拆分。** EnsembleDrafter 中的 `style.id.split('_')` 双向模糊匹配逻辑需重构为乐器侧 flag 匹配（`instrumentFlags & styleFlags`）。
4. **接口参数统一**：`generateFullSong(styleId)`、`arrange(track, styleId, context)`、`playSong(track, styleId, context, ...)` 全部只收 `StyleId`，消除 StyleConfig 对象的冗余传递。
5. **`MusicContext` 显式传递**：废弃 `GlobalContext` 全局可变单例。生成引擎通过返回值 `MusicContext` 显式输出，编配引擎通过参数显式接收。各黑盒不读写任何全局状态。编配引擎内部段落级状态通过局部变量管理，不纳入 MusicContext。
6. **阶段入口自动快照**：`generateFullSong()` 和 `arrange()` 入口处自动记录 `PRNGManager.getState()`，支持独立复现任一阶段的输出。
7. **`StyleId`、`StyleFlagTable`、`StyleIdName` 集中定义**：统一在一处（如 `StyleFlags.ts`），禁止散落。`StyleFlagTable` 每条记录必须在风格注册时一并声明。
8. **生成管道终点为 `MidiEvent[]`**：整个生成管道的最终确定性输出为 `MidiEvent[]`，不涉及音频。MIDI 之后的调度与合成属于平台层，不纳入测试范围。

---

## 9. 复核结论

### 9.1 可测试性复核

验证四个黑盒（PRNGManager、生成引擎、编配引擎、MIDI 转换层）是否可通过 `getState()`/`setState()` 测试钩子独立测试。

**结论：框架设计可测试，当前源码未实现。**

| 黑盒 | 设计可测试性 | 当前源码阻碍 |
|------|------------|------------|
| PRNGManager | ✅ | `getState()`/`setState()` 未实现 |
| 生成引擎 | ✅ | 不返回 MusicContext，写入 GlobalContext 全局单例 |
| 编配引擎 | ✅ | 缺 context 参数，读写 GlobalContext 全局单例 |
| MIDI 转换层 | ✅ | 无独立 `convert()` 纯函数，与音频初始化耦合 |

以上阻碍均为已知的设计-源码差异（见第 7 章差异表），不是设计缺陷。按本框架实施后，四个黑盒均可独立测试：

- **PRNGManager**：`setSeed()` + 调用序列 → 验证输出数列
- **生成引擎**：`setState(stateA)` + styleId + options → 验证 GeneratedTrack + MusicContext
- **编配引擎**：`setState(stateC)` + 预录 track/styleId/context → 验证 ArrangedTrack
- **MIDI 转换层**：预录 ArrangedTrack + styleId → 验证 MidiEvent[]（不消耗 PRNG，无需快照）

### 9.2 机械替换兼容性复核

验证本框架的所有接口变更在完整机械替换后是否保证生成效果零差异。

**结论：全部 7 项替换零差异可行。**

| 替换项 | 结果 | 条件 |
|--------|------|------|
| StyleId enum 替换 string | ✅ 零差异 | StyleFlagTable 覆盖全部 38 个 `includes()` 调用场景 |
| GlobalContext → MusicContext 显式传递 | ✅ 零差异 | 6 个字段完整覆盖所有外部读取 |
| globalPRNG → PRNGManager | ✅ 零差异 | `getState()`/`setState()` 只读写 state 整数，不消耗 PRNG |
| userMotifRoot 类型 enum 化 | ✅ 零差异 | `number? → KeyId?`，值域 0~11 不变，保持可选，不传时内部 PRNG 生成（与当前源码行为一致） |
| detectedTonality enum 化 | ✅ 零差异 | enum 值一一映射，`0`=随机 与 `undefined`=随机 行为一致 |
| motifExpertise 删除 | ✅ 零差异 | 源码中完全未被任何逻辑使用 |
| 返回值 { track, context } | ✅ 零差异 | MusicContext 字段可从 GeneratedTrack + GlobalContext 完全提取 |

**userMotifRoot 保持可选**：当前源码中 `keyOffset = Math.floor(globalPRNG.next() * 12)` 在 `generateFullSong` 内部执行。目标设计保持此行为不变（不传时由内部 PRNG 生成），仅将类型从 `number?` 改为 `KeyId?`（enum），PRNG 消耗位置和顺序不变。

---

## 版本修订

| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-03-30 | 初版。定义生成引擎接口签名、输入输出、数据结构、行为约束、执行顺序、源码差异表 |
| v1.1 | 2026-03-30 | 新增复核结论（可测试性 + 机械替换兼容性），新增版本修订章节 |
| v2.0 | 2026-03-30 | 重构为完整四模块框架。新增第 1 章管道总览（四模块职责、完整执行周期）、第 2 章 PRNGManager 接口（工作原理、消费顺序、测试钩子）、第 4 章编配引擎接口、第 5 章 MIDI 转换层接口。生成引擎接口归入第 3 章，数据结构归入第 6 章 |
| v2.1 | 2026-03-31 | 与架构文档第七章和源码完整对齐。第 6 章补充 ArrangedTrack 和 MidiEvent 字段表；第 7 章差异表扩充为 15 项含涉及文件列，标注"目标设计 vs 当前源码"；新增第 8 章接口设计约束（8 条）；复核结论移至第 9 章 |
