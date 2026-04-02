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

管道外部代码**仅允许**调用以下入口：

| 公开 API | 说明 |
|----------|------|
| `MelodyEngine.generateFullSong()` | 生成曲目 |
| `Orchestrator.arrange()` | 编配 |
| `MidiConverter.convert()` | MIDI 转换 |
| `PRNGManager.setSeed()` | 种子初始化（仅限播放入口处调用） |

**禁止**：管道外部代码调用 `PRNGManager.next()`。外部消耗 PRNG 会破坏管道内的确定性消耗序列。唯一例外是 step 1（选风格），该调用必须紧邻 `generateFullSong()` 之前。

**禁止**：管道外部代码直接 import 内部子模块（如 `HarmonyEngine`、`ToplineEngine`、`TextureMapper`、`GrooveEngine`）。内部子模块仅限管道内部互相调用。

### 0.3 扩展协议（如何在不违反拓扑的前提下新增功能）

| 场景 | 做法 | 不需改动 |
|------|------|---------|
| 新增风格 | StyleRegistry 注册 + StyleFlagTable 声明 flags | 管道接口 |
| 新增乐器 Idiom | `/src/core/generation/performance/idioms/` 下新增文件 | 管道接口 |
| 新增生成子模块 | 放入对应模块目录，自动继承本 Rule 全部约束 | 管道拓扑 |
| 新增管道阶段 | **禁止** — 四模块拓扑不可变，需先修订本 Rule | — |

---

## 1. 管道拓扑

### 1.1 四模块管道

```
              ┌──────────────────────────────────────────────────────┐
              │               PRNGManager（隐式供给层）                │
              │       setSeed · next · getState · setState           │
              └───┬──────────────────┬──────────────────┬────────────┘
                  │ next() ×N        │ next() ×M        │ ×0
                  ▼                  ▼                  ▼
              ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
 StyleId ────►│ MelodyEngine │  │ Orchestrator │  │ Midi         │
 Options? ───►│              ├─►│              ├─►│ Converter    ├──► MidiEvent[]
              └──────────────┘  └──────────────┘  └──────────────┘
                     │                 │                  │
              GeneratedTrack    ArrangedTrack        MidiEvent[]
              + MusicContext

              ══════════════════════════════════════════════════════
              ║  平台层（不属于本规范）                               ║
              ║  MidiScheduler → SpessaSynth → 音频输出              ║
              ══════════════════════════════════════════════════════
```

> 各模块输入/输出的完整字段定义见 §2（接口签名）和 §3（数据契约）。

### 1.2 模块职责

| # | 模块 | 职责 | PRNG |
|---|------|------|------|
| 0 | PRNGManager | 确定性伪随机序列，支持状态快照/恢复 | 供给方 |
| 1 | MelodyEngine | 从风格配置生成完整曲目（结构/和声/旋律/编制） | ×N |
| 2 | Orchestrator | 单旋律展开为多轨编配 | ×M |
| 3 | MidiConverter | 多轨 NoteData → MidiEvent[] | ×0 |

### 1.3 链路约束

| ID | 约束 |
|----|------|
| L-1 | 严格线性：PRNG → Melody → Orchestrate → Playback，禁止跨层调用 |
| L-2 | 模块间仅通过函数参数与返回值传递数据，禁止访问对方内部状态 |
| L-3 | PRNGManager 为唯一允许的全局可变单例 |
| L-4 | 风格查表（StyleRegistry / StyleFlagTable）为静态只读数据层，非独立模块 |
| L-5 | 管道终点为 `MidiEvent[]`，之后的调度/合成属于平台层 |
| L-6 | **确定性**：同一 PRNG 状态 + 同一输入 = 同一输出（具体实现规则见 §4.1） |

### 1.4 执行周期

```
step 0  PRNGManager.setSeed(seed)
step 1  styleId = allStyles[Math.floor(PRNGManager.next() * count)] // ×1
step 2  { track, context } = engine.generateFullSong(styleId, options?)
step 3  history.push({ track, styleId, context })
step 4  arranged = Orchestrator.arrange(track, styleId, context)
step 5  events = MidiConverter.convert(arranged, channelMap)  // ← 管道终点
step 6  [平台层] midiScheduler.load(events) → play
step 7  onTrackEnd → 有下一首 → goto 4 | 末尾 → goto 1
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

### 2.2 MelodyEngine

```typescript
class MelodyEngine {
  generateFullSong(
    styleId: StyleId,
    options?: GenerationOptions
  ): { track: GeneratedTrack; context: MusicContext };
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 — 禁止 async |
| 副作用 | 无 — context 通过返回值输出，禁止写入全局单例 |
| PRNG | 消耗 ×N，入口自动 `getState()` 快照 |

### 2.3 Orchestrator

```typescript
class Orchestrator {
  static arrange(
    track: GeneratedTrack,
    styleId: StyleId,
    context: MusicContext
  ): ArrangedTrack;
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 |
| 副作用 | 无 — 所有上下文从 context 参数读取 |
| PRNG | 消耗 ×M，入口自动 `getState()` 快照 |

### 2.4 MidiConverter

```typescript
class MidiConverter {
  static convert(
    song: ArrangedTrack,
    channelMap: ChannelMap,          // 由平台层提供的 MIDI 通道分配表
    options?: { countInBeats?: number; drumDucking?: boolean }
  ): MidiEvent[];
}
```

| 属性 | 值 |
|------|---|
| 同步 | 是 |
| PRNG | 不消耗（入口记录 stateD 快照仅用于验证） |
| 确定性 | 同一输入 = 同一输出 |

---

## 3. 数据契约

> 时间单位：生成管道内统一使用**拍 (beat)** 作为时间单位（音乐生成的自然单位）。
> beat → tick/ms 的转换在 MidiConverter 内完成，不传播到上游。

### 3.1 核心类型

```typescript
interface NoteData {
  pitch: number;                  // MIDI 0~127
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
  root: number;                   // 根音 0~11
  quality: ChordQuality;          // 17 种枚举
  startBeat: number;
  endBeat: number;
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
  singerPersona: SingerPersonaConfig | null;
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
  styleId?: StyleId;
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
}
```

### 3.3 枚举与位标志

> **实现状态说明**：标记 ✅ 表示已在代码中实现，⏳ 表示目标设计（代码中仍为字符串）。

```typescript
// ✅ 风格标识 — 数值枚举，用于数组直接寻址（已实现于 StyleFlags.ts）
enum StyleId {
  ModernPop = 0, ClassicJPop = 1, ModernJPop = 2,
  PopRock = 4, Eurodance = 7, Trance = 8,
  Synthwave = 9, PowerBallad = 10, RussianFolkBallad = 11,
  GhibliOrchestral = 12, Lofi = 16
  // 值不连续，预留扩展空间
}

// ⏳ 风格分类位掩码 — 目标设计，当前代码使用 StyleId 直接比较替代
// const StyleFlag = { IS_ELECTRONIC: 1 << 0, ... } as const;
// StyleFlagTable[StyleId.Lofi] → number
// 当前替代方案：style.id === StyleId.Eurodance || style.id === StyleId.Trance

// ⏳ Tonality — 目标为数值枚举，当前代码使用字符串 'Major' / 'Minor' / ...
// enum Tonality { Major = 0, Minor, Major_Pentatonic, Minor_Pentatonic, ... }
// 当前实际类型：string（如 'Major'、'Minor'、'Dorian'）
type Tonality = string;

type MotifRole = 'Foreground' | 'Middleground' | 'Background';

// ⏳ 乐器标识 — 目标为 GM Program Number，当前代码使用字符串名称
// type InstrumentId = number;  // GM Program Number 0~127
// 当前实际类型：string（如 'Acoustic_Grand'、'Violin'、'Standard_DrumKit'）
type InstrumentId = string;
```

### 3.4 辅助类型

```typescript
interface EnsembleDraft {
  melodySound: string;                // 当前为乐器名称字符串（⏳ 目标 InstrumentId）
  vocalSound?: string;
  secondaryMelodySound?: string;
  chordSound: string | null;          // null = 无此乐器
  bassSound: string | null;
  drumSound: string | null;
  counterMelodySound: string | null;
  filterSweep?: string;               // 音效名称，非乐器
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

interface SingerPersonaConfig {
  id: string;                         // 仅日志/调试显示，不参与生成逻辑
  name: string;                       // 仅日志/调试显示，不参与生成逻辑
  traits: {
    staccatoTendency: number;         // 0~1 断奏倾向
    trailingFade: number;             // 0~1 叹息尾音概率
    graceNoteProbability: number;     // 0~1 装饰音概率
    syncopationPush: number;          // 0~1 抢拍强度
  };
}

interface TempoCurve {
  startTick: number;
  endTick: number;
  startBpm: number;
  endBpm: number;
  curveType: 'linear' | 'exponential';
}

// ⏳ ChordQuality — 目标为数值枚举，当前代码使用字符串联合类型
// enum ChordQuality { Major = 0, Minor, Diminished, ... }
// 当前实际类型：'Major' | 'Minor' | 'Diminished' | ... (17 种字符串联合)
type ChordQuality = 'Major' | 'Minor' | 'Diminished' | 'Diminished7' | 'Augmented' |
  'Dominant7' | 'Minor7' | 'Major7' | 'HalfDiminished' |
  'Sus4' | 'Dominant7Sus4' | 'Add9' | 'Minor9' | 'Major9' |
  'Dominant9' | 'Minor11' | 'Dominant13';
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
| T-2 | 标识/分类用 enum，多状态组合用位掩码（见 §3.3 StyleId / StyleFlag） |
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

---

## 5. 确定性验证义务 (ACVE)

> 任何对生成管道代码的修改，必须通过 ACVE（算法兼容性验证引擎）的快照隔离验证。
> 这不是可选的测试建议，而是代码合入的前置条件。
> 验证失败 = 修改不可合入。

### 5.1 四个快照点（不可移动）

```
setSeed(seed)
  ├─ stateA ← getState()         // step 1 入口（选风格前）
  ├─ next() ×1                    // 选风格
  ├─ stateB ← getState()         // step 2 入口（MelodyEngine）
  ├─ generateFullSong() 内部      // next() ×N
  ├─ stateC ← getState()         // step 4 入口（Orchestrator）
  ├─ arrange() 内部               // next() ×M
  ├─ stateD ← getState()         // step 5 入口（MidiConverter）
  └─ convert()                   // next() ×0
```

stateA/B/C/D 的位置绑定在模块入口，禁止移动。这是全管道确定性验证的基础设施。

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
| 性能建议 | M-1 ~ M-3 | 3 (guideline) |
| **合计** | | **32** (29 硬约束 + 3 guideline) |

