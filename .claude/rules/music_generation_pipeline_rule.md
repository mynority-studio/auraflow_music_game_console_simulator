# Music Generation Pipeline Rule

> **文档等级** — 最高约束
> **读者** — TypeScript 算法开发者 / AI Agent
> **冲突规则** — 其他文档与本 Rule 冲突时，以本 Rule 为准
> **自包含** — 本文档不依赖外部文档，所有约束和数据契约在此完整定义

---

## 0. 适用范围与扩展协议

### 0.1 功能边界（按行为管辖，非仅按路径）

凡满足以下**任一条件**的代码，无论文件位置，均受本 Rule 约束：

- 调用 `PRNGManager.next()` 或其派生方法
- 生产或变换 `NoteData` / `GeneratedChord` / `ArrangedTrack` / `MidiEvent`
- 做出影响音乐输出的决策（音高、节奏、和声、编配、混音参数）

> 主要代码集中在 `/src/core/generation/`、`/src/core/audio/`、`/src/core/utils/PRNG.ts`，
> 但上述行为如果出现在其他目录（如 `/src/apps/`），同样受本 Rule 管辖。

### 0.2 接口边界（管道对外暴露的公开 API）

管道外部代码（App 层）**仅允许**调用以下入口：

| 公开 API | 说明 |
|----------|------|
| `PRNGManager.setSeed()` | 种子初始化（仅限播放入口处调用） |
| `MelodyEngine.generateFullSong()` | 生成曲目 |
| `Orchestrator.arrange()` | 编配 |

`MidiConverter.convert()` 由平台层（PlaybackEngine）内部调用，因为 `channelMap`（MIDI 通道分配）是平台层职责，App 层不应感知具体通道编号。

**禁止**：管道外部代码调用 `PRNGManager.next()`。外部消耗 PRNG 会破坏管道内的确定性消耗序列。唯一例外是 step 1（PRNG 消耗 ×1 保持序列对齐），该调用必须紧邻 `generateFullSong()` 之前。

**禁止**：管道外部代码直接 import 内部子模块（如 `HarmonyEngine`、`ToplineEngine`、`TextureMapper`、`GrooveEngine`）。内部子模块仅限管道内部互相调用。

### 0.3 扩展协议（如何在不违反拓扑的前提下新增功能）

| 场景 | 做法 | 不需改动 |
|------|------|---------|
| 新增风格 | 修改 `StyleFlags.ts` 中 `DefaultStyleConfig` 或新增 `StyleId` + 配置 | 管道接口 |
| 新增演奏 Idiom | `/src/core/generation/idioms/` 下新增文件，由 Orchestrator/TextureMapper 分派 | 管道接口 |
| 新增生成子模块 | 放入对应模块目录，自动继承本 Rule 全部约束 | 管道拓扑 |
| 新增管道阶段 | **禁止** — 五阶段拓扑不可变，需先修订本 Rule | — |

---

## 1. 管道拓扑

### 1.1 五阶段管道（2026-04-23 重构）

```
              ┌──────────────────────────────────────────────────────┐
              │               PRNGManager（隐式供给层）                │
              │       setSeed · next · getState · setState           │
              └──┬──────┬──────┬──────┬──────┬───────────────────────┘
                 │      │      │      │      │
                 ▼      ▼      ▼      ▼      ▼
              ┌─────┐┌─────┐┌─────┐┌─────┐┌────────────┐
              │Stg 1││Stg 2││Stg 3││Stg 4││ Stage 5    │
              │style││basic││harm ││cond ││ instrument │──► GeneratedTrack
              │mood ││param││+251 ││plan ││ layering   │    + MusicContext
              └─────┘└─────┘└─────┘└─────┘└────────────┘
                                                  │
                                                  ▼
                                        ┌──────────────────┐
                                        │ Orchestrator     │──► ArrangedTrack
                                        │ (consumes plan)  │
                                        └──────────────────┘
                                                  │
                              ════════════════════▼════════════════════
                              ║  平台层（不属于本规范）                 ║
                              ║  PlaybackEngine → MidiScheduler        ║
                              ║  → SpessaSynth → 音频输出              ║
                              ══════════════════════════════════════════
```

> 各阶段输入/输出的完整字段定义见 §2（接口签名）和 §3（数据契约）。
> 五阶段实现位于 `src/core/generation/pipeline/`，统一入口 `runPipeline()`。

### 1.2 阶段职责

| # | 阶段 | 职责 | PRNG |
|---|------|------|------|
| 0 | PRNGManager | 确定性伪随机序列，支持状态快照/恢复 | 供给方 |
| 1 | StyleAndMoodSelector | 在管道内部抽取 styleId + moodId（风格→情绪偏好表） | ×2 |
| 2 | BasicParamsResolver | 按顺序：timeSig → tonality → keyOffset → bpm → sections | ×5~N |
| 3 | HarmonicEngine | 和弦进行生成（Viterbi 或旧版）+ 251 桥接检测/注入 | ×M |
| 4 | ConductorPlanner | 输出 ConductorPlan：每段 focus/support/silent/rhythm/fillWindows | ×10 |
| 5 | InstrumentLayering | ToplineEngine 生成旋律 + GlobalReviewer 检查 | ×K |
| * | Orchestrator | 读取 MusicContext.conductorPlan 执行乐器避让与加花（平台层之前） | ×J |
| * | MidiConverter | 多轨 NoteData → MidiEvent[]（平台层） | ×0 |

### 1.3 链路约束

| ID | 约束 |
|----|------|
| L-1 | 严格线性：PRNG → Stage1 → Stage2 → Stage3 → Stage4 → Stage5 → Orchestrator，禁止跨阶段调用 |
| L-2 | 阶段间仅通过函数参数与返回值传递数据，禁止访问对方内部状态 |
| L-3 | PRNGManager 为唯一允许的全局可变单例 |
| L-4 | 风格配置（`StyleConfig`）为静态只读数据层，通过 `StyleRegistry[styleId]` 查询 |
| L-5 | 管道终点为 `MidiEvent[]`，之后的调度/合成属于平台层 |
| L-6 | **确定性**：同一 PRNG 状态 + 同一输入 = 同一输出（具体实现规则见 §4.1） |
| L-7 | Stage 1 负责风格/情绪抽取——App 层禁止自己抽 styleId 传入（仅允许传 allowedStyleIds 约束池） |
| L-8 | Stage 4 的 ConductorPlan 是指挥层的**唯一**输出——Stage 5 和 Orchestrator 必须遵守其 silentInstruments 硬约束 |

### 1.4 执行周期

```
step 0  PRNGManager.setSeed(seed)
step 1  PipelineResult = runPipeline({ allowedStyleIds?, generation? })
        ├─ Stage 1  selectStyleAndMood()          → { styleId, style, moodId }
        ├─ Stage 2  resolveBasicParams()           → + { timeSig, tonality, keyOffset, bpm, sections }
        ├─ Stage 3  generateHarmony()              → + { chords, cadentialBridges }
        ├─ Stage 4  planConductor()                → + { ensemble, conductorPlan }
        └─ Stage 5  layerInstruments()             → { track: GeneratedTrack, context: MusicContext }
step 2  history.push({ track, context })
step 3  arranged = Orchestrator.arrange(track, styleId, context)
        ──── 以下为平台层（PlaybackEngine 内部）────
step 4  PlaybackEngine.loadSong(arranged)
step 5  midiScheduler.load(events) → play
step 6  onTrackEnd → 有下一首 → goto 1 | 末尾 → idle
```

---

## 2. 模块接口

### 2.1 PRNGManager

```typescript
// LCG 参数: a=1664525, c=1013904223, m=2^32

class PRNG {
  setSeed(seed: number): void;         // state = seed，序列归零
  next(): number;                      // [0, 1)，state 不可逆前进
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
  getState(): number;                  // 读取当前 state（快照）
  setState(state: number): void;       // 恢复指定 state（回放）
}
```

### 2.2 runPipeline（五阶段统一入口）

```typescript
// src/core/generation/pipeline/index.ts
function runPipeline(options?: PipelineRunOptions): {
  track: GeneratedTrack;
  context: MusicContext;  // 含 conductorPlan + cadentialBridges
};

interface PipelineRunOptions {
  allowedStyleIds?: StyleId[];    // App 层风格池约束（仅白名单，不抽取）
  forcedStyleId?: StyleId;        // 强制指定风格（调试/兼容旧签名）
  forcedMoodId?: MoodId;          // 强制指定情绪
  generation?: GenerationOptions; // 传递到 Stage 5 的生成选项（motif 等）
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 — 禁止 async |
| 副作用 | 无 — context 通过返回值输出，Stage 5 内仅兼容性写入 GlobalContext |
| PRNG | 消耗 ×N，阶段入口记录 stateB / stateB2 / stateC / stateD |

### 2.3 Stage 1 — selectStyleAndMood

```typescript
function selectStyleAndMood(options?: {
  allowedStyleIds?: StyleId[];
  forcedStyleId?: StyleId;
  forcedMoodId?: MoodId;
}): { styleId: StyleId; style: StyleConfig; moodId: MoodId };
```

| 属性 | 值 |
|------|---|
| PRNG | 消耗 ×2（style + mood），除非强制指定 |
| 契约 | 风格→情绪偏好表内置：ModernPop 偏向 Euphoric/Energetic，Synthwave 偏向 Melancholic/Energetic，LofiChill 偏向 Chill/Melancholic |

### 2.4 Stage 2 — resolveBasicParams

```typescript
function resolveBasicParams(
  stage1: Stage1Output,
  options?: { forcedTimeSignature?, forcedTonality?, forcedKeyOffset? }
): Stage2Output;  // + { timeSignature, tonality, keyOffset, keyName, bpm, sections }
```

| 属性 | 值 |
|------|---|
| 顺序 | **timeSig → tonality → keyOffset → bpm → sections**（新管道规定顺序，Stage 1 之后） |
| PRNG | 消耗 ×5 + StructureEngine 内部消耗 |

### 2.5 Stage 3 — generateHarmony

```typescript
function generateHarmony(stage2: Stage2Output): Stage3Output;
// + { chords: GeneratedChord[], cadentialBridges: CadentialBridge[] }
```

| 属性 | 值 |
|------|---|
| 和声引擎 | `style.useViterbiHarmony` 决定走 HarmonyPipeline 或旧版 HarmonyEngine |
| 251 注入 | ii-V-I 策略（ModernPop）真正插入 ii7/iiø；其他策略仅标记 bridges，暂不改和弦 |
| 前置条件 | 仅当前和弦时长 >= 2 拍且非 ii 家族时才注入，缩短前和弦 1 拍 |

### 2.6 Stage 4 — planConductor

```typescript
function planConductor(stage3: Stage3Output): Stage4Output;
// + { ensemble: EnsembleDraft, conductorPlan: ConductorPlan }
```

| 属性 | 值 |
|------|---|
| PRNG | 消耗 ×10（EnsembleDrafter 内部） |
| 决策维度 | SectionType × StyleId × MoodId 三层叠加 |
| 输出 | `ConductorPlan.sections[]` 每段含 focus/support/silent/rhythmCenter/counterpointPairs/fillWindows |

### 2.7 Stage 5 — layerInstruments

```typescript
function layerInstruments(
  stage4: Stage4Output,
  options?: GenerationOptions
): { track: GeneratedTrack; context: MusicContext };
```

| 属性 | 值 |
|------|---|
| 生成内容 | melody + vocal（复用 ToplineEngine）+ GlobalReviewer 检查 |
| 副作用 | GlobalContext.initializeNewEra()（兼容保留，计划后续移除） |
| 输出 context | 携带 conductorPlan / cadentialBridges 传递到 Orchestrator |

### 2.8 Orchestrator

```typescript
class Orchestrator {
  static arrange(
    track: GeneratedTrack,
    styleId: StyleId,
    context: MusicContext  // 消费 context.conductorPlan
  ): ArrangedTrack;
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 |
| ConductorPlan 消费 | silentInstruments 硬约束覆盖能量阈值；fillWindows / rhythmCenter / focusInstrument 消费待实现 |
| PRNG | 消耗 ×M |

### 2.9 MidiConverter

```typescript
class MidiConverter {
  static convert(
    song: ArrangedTrack,
    channelMap: ChannelMap = DEFAULT_CHANNEL_MAP,
    options?: { countInBeats?: number; drumDucking?: boolean }
  ): MidiEvent[];
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 |
| PRNG | 不消耗（入口记录 stateD 快照仅用于验证） |
| 确定性 | 同一输入 = 同一输出 |
| 调用方 | 平台层（PlaybackEngine），非 App 层直接调用 |

---

## 3. 数据契约

> 时间单位：生成管道内统一使用**拍 (beat)** 作为时间单位（音乐生成的自然单位）。
> beat → tick/ms 的转换在 MidiConverter 内完成，不传播到上游。

### 3.1 核心类型

```typescript
interface NoteData {
  pitch: number;                  // MIDI 0~127 — ★ 生成管道内为相对空间（见 §4.7 K-1），applyOffset 后为绝对空间
  onset: number;                  // 起始拍位（拍）
  duration: number;               // 时长（拍）
  velocity: number;               // 力度 0.0~1.0
  isGraceNote?: boolean;
  pitchBend?: number;
  pitchBendDuration?: number;
  fadeOutDuration?: number;
  isUserMotif?: boolean;
}

interface GeneratedChord {
  numeral: string;                // 罗马数字 ("I", "vi", "V7")，仅内部解析
  root: number;                   // 根音 0~11 — ★ 相对于调式主音的偏移（I=0, ii=2），不含 keyOffset
  quality: ChordQuality;          // 17 种枚举
  startBeat: number;
  endBeat: number;
  keyOffset?: number;             // 调号偏移（Eb=3, A=9 等），仅由 Orchestrator.applyOffset() 读取
}

// ★ SectionType — 数值枚举，替代 section.type 字符串比较和对象键查表
enum SectionType {
  Intro = 0, Verse, PreChorus, Chorus, Bridge, Outro,
  Break, Breakdown, BuildUp, Drop, PreOutro, Solo_Bridge  // 共 12 种
}

interface SectionMetadata {
  name: string;                   // 段落显示名 ("Verse_1", "Chorus_Main")，仅显示
  type?: SectionType;
  startBeat: number;
  endBeat: number;
  energyLevel: number;            // 1~10
  grooveDNA?: number[];           // 律动指纹
}
```

### 3.2 模块边界类型

```typescript
// MelodyEngine 输出 → Orchestrator 输入
interface GeneratedTrack {
  chords: GeneratedChord[];
  melody: NoteData[];
  vocal?: NoteData[];
  sections: SectionMetadata[];
  bpm: number;
  key: string;                    // "C"/"Db"/...（由 keyOffset 查表得到）
  keyOffset: number;              // 调号 0~11
  tonality: Tonality;
  timeSignature: [number, number];
  preSelectedPalette?: EnsembleDraft;
  globalRiff?: NoteData[];
  processedUserMotif?: NoteData[];
  motifRole?: MotifRole;
}

// 生成引擎伴随输出，显式传递给编配引擎
interface MusicContext {
  keyOffset: number;
  tonality: Tonality;
  bpm: number;
  timeSignature: [number, number];
  grooveDNA: number[];
  moodId?: MoodId;
}

interface GenerationOptions {
  userMotifRoot?: number;         // 调号 0~11，不传由 PRNG 生成
  processedUserMotif?: NoteData[];
  motifRole?: MotifRole;
  detectedTimeSignature?: [number, number];
  detectedTonality?: Tonality;
}

// Orchestrator 输出 → PlaybackEngine 输入
interface ArrangedTrack {
  bpm: number;
  key: string;
  absoluteStartBeat: number;
  timeSignature?: [number, number];
  mixStyle?: string;
  requireSidechain?: boolean;
  vocal?: NoteData[];
  melody: NoteData[];
  secondaryMelody?: NoteData[];
  pianoLH: NoteData[];            // 贝斯/低音伴奏
  pianoRH: NoteData[];            // 和弦/织体
  drums?: NoteData[];
  counterMelody?: NoteData[];
  userMotif?: NoteData[];
  palette?: EnsembleDraft;
  sections?: SectionMetadata[];
  globalRiff?: NoteData[];
  chords?: GeneratedChord[];
  tempoCurves?: TempoCurve[];
}

// 管道终点输出
interface MidiEvent {
  ticks: number;                  // PPQ=480
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
  channel: number;                // 0~15
  data1: number;
  data2: number;
  visualData?: {                  // 仅 type='visual' 时存在，驱动 LED 可视化
    type: string;
    midiNote?: number;
    velocity?: number;
    source?: string;
    onset?: number;
    isUserMotif?: boolean;
  };
}
```

### 3.3 枚举与位标志

> **实现状态说明**：标记 ✅ 表示已在代码中实现。
> 风格系统使用 `StyleId` + `StyleConfig`（`config/StyleFlags.ts`），单风格 `DefaultStyleConfig`。
> types.ts 底部已添加 `Tonality`/`ChordQuality`/`SectionType` 数值枚举和查找表（cherry-pick）。

```typescript
// ✅ Tonality — 数值枚举（已实现于 types.ts）
enum Tonality {
  Major = 0, Minor, Major_Pentatonic, Minor_Pentatonic,
  Blues, Dorian, Mixolydian, Melodic_Minor               // 共 8 种
}
// 翻译表：TonalityName[Tonality.Major] → 'Major'
// 查表：SCALE_INTERVALS[tonality] → number[]

type MotifRole = 'Foreground' | 'Middleground' | 'Background';

// ✅ 乐器标识 — 数值枚举（已实现于 config/InstrumentFlags.ts，60 值）
// 翻译表：InstrumentIdName[id] → 显示名
// GM 桥接：InstrumentGMProgram[id] → MIDI Program Number
// 族分类：InstrumentIdFamily[id] → InstrumentFamily
type InstrumentId = number;           // enum InstrumentId { Acoustic_Grand=0, ... }
```

### 3.4 辅助类型

```typescript
interface EnsembleDraft {
  melodySound: InstrumentId;
  vocalSound?: InstrumentId;
  secondaryMelodySound?: InstrumentId;
  chordSound: InstrumentId | null;    // null = 无此乐器
  bassSound: InstrumentId | null;
  drumSound: InstrumentId | null;
  counterMelodySound: InstrumentId | null;
  filterSweep?: string;               // 音效名称，非乐器，允许 string
  mixing?: {
    vocal?: MixingConfig;
    melody?: MixingConfig;
    secondaryMelody?: MixingConfig;
    chord?: MixingConfig;
    bass?: MixingConfig;
    drums?: MixingConfig;
    counterMelody?: MixingConfig;
  };
}

interface MixingConfig {
  pan?: number;                       // -1.0 (L) ~ 1.0 (R)
  reverb?: number;                    // 0.0 ~ 1.0
  volume?: number;                    // dB 偏移
  delay?: number;                     // 0.0 ~ 1.0
}

// SingerPersonaConfig 已移除 — 人声特征由 GenerationParams.melody 参数控制

interface TempoCurve {
  startTick: number;
  endTick: number;
  startBpm: number;
  endBpm: number;
  curveType: 'linear' | 'exponential';
}

// ✅ ChordQuality — 数值枚举（已实现于 types.ts）
enum ChordQuality {
  Major = 0, Minor, Diminished, Diminished7, Augmented,
  Dominant7, Minor7, Major7, HalfDiminished,
  Sus4, Dominant7Sus4, Add9, Minor9, Major9,
  Dominant9, Minor11, Dominant13                         // 共 17 种
}
// 翻译表：ChordQualityName[ChordQuality.Major] → 'Major'
// 查表：CHORD_INTERVALS[quality] → number[]（和弦音程）
// 位掩码：CQ_IS_MINOR, CQ_IS_MAJOR, CQ_IS_DOM 等分类检查
```

---

## 4. 约束条款

### 4.1 确定性

| ID | 约束 |
|----|------|
| D-1 | 禁止 `Math.random()`，统一使用 `PRNGManager.next()` |
| D-2 | 禁止 `Date.now()` / `performance.now()` 进入生成逻辑 |
| D-3 | `Array.sort()` 必须提供完全确定的比较函数，消除所有 tie（如同 onset 时按 pitch 二次排序） |
| D-4 | 浮点比较禁止 `===`，必须使用 epsilon 容差（ε ≤ 1e-6） |
| D-5 | 模块入口必须调用 `getState()` 记录 PRNG 快照，任何代码修改必须通过快照隔离验证（见 §5） |

### 4.2 可移植性

| ID | 约束 |
|----|------|
| P-1 | 禁止 `Map` / `Set` / `WeakMap`，包括临时去重。C 语言无对应数据结构，去重用排序数组 + 线性扫描，分组用预分配 buffer + 索引 |
| P-2 | 禁止依赖 `Object.keys()` 遍历顺序做逻辑判断 |
| P-3 | 整数除法必须显式 `Math.floor()` 或 `Math.trunc()`，禁止依赖隐式截断 |
| P-4 | 位运算结果必须 `\| 0`（有符号）或 `>>> 0`（无符号）保底 |
| P-5 | 禁止隐式类型转换做逻辑判断 — `if (velocity)` 当 `velocity === 0` 时为 false，必须写 `if (velocity !== undefined)` |

### 4.3 类型纪律

| ID | 约束 |
|----|------|
| T-1 | 禁止 string 做**风格/段落分类**的查表键或子串匹配（如 `style.id.includes('house')`、`section.name.includes('Chorus')`），改用 enum 比较。和弦罗马数字（`chord.numeral`）作为音乐理论内部表示允许使用字符串 |
| T-2 | 标识/分类用 enum，多状态组合用位掩码（见 §3.3 ChordQuality / Tonality） |
| T-3 | 生成管道代码禁止 `any` 类型 |
| T-4 | 禁止无注释的 `as` 强转 — 每处 `as` 必须附注释说明安全性理由 |
| T-5 | 可选字段使用 `null` 或哨兵值（如 `0xFF`），禁止依赖 `undefined` 语义做逻辑分支 |
| T-6 | 数组元素类型必须统一，禁止混合类型数组 |

### 4.4 纯净性

| ID | 约束 |
|----|------|
| S-1 | 除 PRNGManager 外，禁止共享可变全局变量 |
| S-2 | MusicContext 通过返回值/参数显式传递，禁止读写 `GlobalContext` 全局单例 |
| S-3 | 生成管道全部同步，禁止 `async` / `await` / `Promise` |
| S-4 | 输出必须可 JSON 序列化 — 禁止函数、类实例、循环引用出现在 GeneratedTrack / ArrangedTrack / MidiEvent 中 |
| S-5 | `/src/core/generation/` 禁止 import React / Web API / DOM / Node API |
| S-6 | 禁止闭包捕获外部可变变量 — 生成函数的行为只能取决于显式参数和 PRNG |
| S-7 | **错误处理**：生成管道内部对非法输入（无效 styleId、空数组等）抛出明确的 `Error` 子类并附带上下文信息，管道外部调用方在入口处统一 catch |

### 4.5 性能纪律（Guideline 级别 — 非强制禁止，但 code review 时优先关注）

| ID | 建议 |
|----|------|
| M-1 | 热循环内不应创建新对象/数组 — 复用预分配 buffer（`buf.length = 0` 后重填） |
| M-2 | 生成循环内不应做字符串拼接 |
| M-3 | 大批量数值数据应使用 `TypedArray`（Float32Array / Uint8Array） |

### 4.6 C 可移植性（ESP32-S3 硬约束 — 补充 §4.2）

> 以下约束是 §4.1~4.4 在 C 移植场景下的具体化。与上游条款冲突时以本节为准。

| ID | 约束 |
|----|------|
| C-1 | **禁止两个浮点变量直接 `===` 比较**（D-4 的强化）。`beat === chord.startBeat` 必须写为 `Math.abs(beat - chord.startBeat) < 1e-6`。JS 可能侥幸通过，C 浮点累加后必定失配 |
| C-2 | **beat 循环累加风险意识**。`for (let beat = start; beat < end; beat += 0.25)` 循环超过 100 次后浮点误差累积，循环内所有比较必须用 epsilon |
| C-3 | **热循环内 `.push()` 可接受**（C 翻译时改为 `buf[count++]`），但**禁止**在热循环内使用 `.map()` / `.filter()` / `[...spread]` 创建临时数组 |
| C-4 | **输出数组无上界时必须文档化最大长度**。新增 NoteData 数组的函数须在注释中标注预期最大元素数（如 `// max ~300 notes for 3-min song`） |

### 4.7 Pitch Space 契约（调性统一）

> 管道内所有 pitch 计算使用**相对空间**（主音 = 0），`Orchestrator.applyOffset()` 是唯一的相对→绝对转换点。
> 此契约是调性正确性的地基。违反它会导致"双重偏移"或"空间混用"类 bug，且症状为**跨调不和谐**，极难定位。

| ID | 约束 |
|----|------|
| K-1 | **双空间定义**：管道内有且仅有两种 pitch 空间 — **相对空间**（`chord.root` 以调式主音为 0，I=0, ii=2, V=7；`NoteData.pitch` 基于 C=60 为参考中心）和**绝对空间**（`NoteData.pitch` 已加上 `keyOffset`，可直接送入 MIDI 合成器）。不存在第三种中间状态 |
| K-2 | **唯一转换点**：`Orchestrator.applyOffset()` 是管道中**唯一允许**将 `keyOffset` 加到 `NoteData.pitch` 的位置。其他任何函数**禁止**在返回的 pitch 中包含 `keyOffset` |
| K-3 | **生成函数一律相对空间**：`HarmonyCore.getChordTones()`、`getSafeScalePitches()`、`getScalePitches()`、`shiftDiatonic()`、`snapToScale()` 的输入和输出均为相对空间。`TextureMapper` 和 `ToplineEngine` 生成的 `NoteData[]` 也是相对空间 |
| K-4 | **禁止预补偿**：禁止在调用生成函数时做 `targetCenter - keyOffset` 的预减操作（"你减我加"对消模式）。如果需要调整音域，应修改生成函数的 `targetCenter` 参数本身（相对空间内的偏移），而非注入 keyOffset |
| K-5 | **`GlobalContext.currentKeyOffset` 禁入生成逻辑**：生成管道内（MelodyEngine / Orchestrator 的生成阶段）**禁止**读取 `GlobalContext.currentKeyOffset` 用于 pitch 计算。唯一允许的用途是 `applyOffset()` 内部和音域限制（clamp to range）的边界调整 |
| K-6 | **后处理空间声明**：`GlobalReviewer` 接收的输入已经过 `applyOffset()`，处于绝对空间。其内部调用 `HarmonyCore` 函数（返回相对 pitch class）时，必须通过 `% 12` 桥接比较，不得直接与绝对 pitch 做加减运算 |
| K-7 | **新函数标注义务**：新增任何返回 pitch 值的函数，必须在函数签名上方注释标注其 pitch 空间（`// Pitch Space: RELATIVE` 或 `// Pitch Space: ABSOLUTE`） |

---

## 5. 确定性验证义务 (ACVE)

> 任何对生成管道代码的修改，必须通过 ACVE（算法兼容性验证引擎）的快照隔离验证。
> 这不是可选的测试建议，而是代码合入的前置条件。
> 验证失败 = 修改不可合入。

### 5.1 五个快照点（不可移动）

> 2026-04-23 重构：四模块拓扑 → 五阶段拓扑，快照点相应调整为 A / B / B2 / C / D。
> 重构后全部黄金种子需重新录制（见用户决策 5B）。

```
setSeed(seed)
  ├─ stateA  ← getState()        // App 层 triggerGeneration() 入口（setSeed 之后）
  ├─ runPipeline() 进入
  │   ├─ stateB  ← getState()    // Stage 1 入口（selectStyleAndMood）
  │   ├─ Stage 1 消耗 ×2         // style + mood
  │   ├─ stateB2 ← getState()    // Stage 2 入口（resolveBasicParams）
  │   ├─ Stage 2~3 消耗 ×N
  │   ├─ stateC  ← getState()    // Stage 4 入口（planConductor）
  │   ├─ Stage 4~5 消耗 ×M
  │   └─ stateD  ← getState()    // Stage 5 入口（layerInstruments）
  └─ Orchestrator.arrange() 消耗 ×J
```

stateA/B/B2/C/D 的位置绑定在阶段入口，禁止移动。这是全管道确定性验证的基础设施。

### 5.2 验证义务

每次修改生成管道代码后，必须执行以下验证：

1. **PRNG 消耗一致性** — 修改前后，同一 seed 下各快照点的 state 值必须匹配（除非修改本身有意变更 PRNG 消耗次数）
2. **输出等效性** — 同一 seed + 同一输入 → 输出逐字段匹配
3. **模块隔离** — 被修改的模块必须能通过 `setState()` + 预录输入独立复现

```typescript
// 示例：验证 Orchestrator 修改后仍等效
PRNGManager.setState(recorded_stateC);
const result = Orchestrator.arrange(recorded_track, styleId, recorded_context);
expect(result).toDeepEqual(recorded_output);           // 输出等效
expect(PRNGManager.getState()).toBe(recorded_stateD);   // PRNG 消耗一致
```

如果修改有意变更了 PRNG 消耗次数（如新增算法分支），则**全部下游快照必须重新录制**。

---

## 附录：约束编号速查

| 类别 | 编号 | 数量 |
|------|------|------|
| 链路约束 | L-1 ~ L-6 | 6 |
| 确定性 | D-1 ~ D-5 | 5 |
| 可移植性 | P-1 ~ P-5 | 5 |
| 类型纪律 | T-1 ~ T-6 | 6 |
| 纯净性 | S-1 ~ S-7 | 7 |
| C 可移植性 | C-1 ~ C-4 | 4 |
| Pitch Space 契约 | K-1 ~ K-7 | 7 |
| 性能建议 | M-1 ~ M-3 | 3 (guideline) |
| **合计** | | **43** (40 硬约束 + 3 guideline) |

