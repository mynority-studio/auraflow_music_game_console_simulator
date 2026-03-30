# AuraFlow 核心架构与 ESP32-S3 移植指南

## 版本信息
- **当前版本:** 1.4.0
- **最后更新:** 2026-03-30
- **更新日志:**
  - `v1.4.0`: 完全移除 `Meowsynth.sf2` 及所有相关依赖。将所有音频合成统一使用单一标准音色库（`GM128_3MB.sf2`）。在所有生成与编配逻辑中将 `Meowsynth_Vocal` 乐器替换为 `Solo_Vox`（GM 音色编号 85）。已验证 1:1 音质一致性和正确的 MIDI 通道分配。
  - `v1.3.0`: 从 `package.json` 和源代码中完全移除所有 `Tone.js` 依赖。重构 `LedMatrix` 和 `WebSimulatorHAL` 改用原生 Web Audio API 与 `spessasynth_lib`。通过强制使用严格的 MIDI 驱动混音与调度，确保与 ESP32-S3 的 1:1 音质一致性。
  - `v1.2.0`: 根除 Tone.js 依赖。引入 `MidiScheduler` 模拟 ESP32 FreeRTOS 定时任务。所有音频混音与播放现在严格通过 `spessasynth_lib`（SF2）以 MIDI 驱动方式进行。
  - `v1.1.0`: 新增详尽的 AI 辅助移植指南，涵盖组件耦合、SPI/I2S 映射、内存优化（TrackSerializer）及"黄金种子"验证方法。
  - `v1.0.1`: 将所有 `Math.random()` 替换为 `globalPRNG.next()` 以实现确定性生成。将 `EndlessRadioManager` 重构为纯 TS 类，与 React hooks 解耦。
  - `v1.0.0`: 初版架构文档，定义 HAL 接口、PRNG 及 C++ 移植准则。

---

## 1. 架构概述
AuraFlow 在 **核心逻辑（音乐引擎）** 与 **平台层（Web/ESP32）** 之间实行严格分离。模拟器使用 React 和 WebAssembly（SpessaSynth），但核心引擎必须保持平台无关，以便 1:1 翻译为 ESP32-S3 的 C/C++ 代码。

### 目录结构
- `/src/core/generation/`: 纯音乐理论与生成算法。**（必须是 100% 可移植的 C++ 逻辑）**
- `/src/core/hal/`: 硬件抽象层，定义 I/O 接口。
- `/src/core/audio/`: Web 专用音频实现（SpessaSynth + MidiScheduler）。**（ESP32 上将替换为 I2S/合成器）**
- `/src/apps/`: 应用状态机。**（应为纯 TS 类，非 React hooks）**
- `/src/components/`: 模拟器的 React UI 组件。**（ESP32 移植时忽略）**

---

## 2. 音乐生成与播放流水线
整体流水线分为两个阶段：**生成阶段**（纯算法，不涉及音频）和**播放阶段**（编配 + 音频调度）。

### 2.1 生成阶段 — `MelodyEngine.generateFullSong(styleId)` → `GeneratedTrack`

1. **输入与种子**: 用户交互以特定 PRNG 种子触发生成，初始化 `GlobalContext`（BPM、调性、拍号）。
2. **结构引擎 (`StructureEngine.ts`)**: 确定段落（前奏、主歌、副歌、桥段、尾声）及长度，返回 `SectionMetadata[]`。
3. **和声引擎 (`HarmonyCore.ts`)**: 文件导出两个类——`HarmonyCore`（和弦解析/声部进行工具）和 `HarmonyEngine`（和弦进行生成）。调用 `HarmonyEngine.generateHarmonyTimeline()` 基于调性与风格生成和弦进行，返回 `GeneratedChord[]`。
4. **乐器编制 (`EnsembleDrafter.ts`)**: 调用 `EnsembleDrafter.draft(style)` 选择乐器编制方案（人声音色、主旋律音色、和弦音色、贝斯、鼓、副旋律），返回 `EnsembleDraft`。
5. **歌手人格 (`SingerPersona.ts`)**: 查找 `SingerPersona.PERSONAS[personaId]` 获取歌手人格配置，作为参数传入旋律生成，影响装饰音、弯音、气口等表情。
6. **旋律生成 (`ToplineEngine.ts`)**: 根据 `EnsembleDraft.vocalSound` 是否存在分为两条路径：
   - **有人声时**: 先为人声调用 `ToplineEngine.generateTrackMelody()` 生成主旋律（`vocal`），再为乐器生成较稀疏的伴奏旋律（`melody`）——两次 ToplineEngine 调用。
   - **无人声时**: 仅调用一次 `ToplineEngine.generateTrackMelody()` 生成器乐主旋律（`melody`）。
   - 内部均调用 `GrooveEngine.generateRhythmFingerprint()` 生成节奏指纹。
7. **反向重和声 (`HarmonyCore.ts`)**: 旋律生成后调用 `HarmonyEngine.reharmonize(chords, melody, style)`，根据实际旋律反向优化和弦进行，返回更新后的 `GeneratedChord[]`。
8. **输出**: 返回 `GeneratedTrack`（包含 `vocal?: NoteData[]`、`melody: NoteData[]`、`chords: GeneratedChord[]`、`keyOffset`、段落结构、元数据）。注意：此阶段**不包含**分轨编配。

### 2.2 播放阶段 — `AudioEngine.playSong()` → 音频输出

9. **编配 (`Orchestrator.ts`)**: `AudioEngine.playSong()` 内部调用 `Orchestrator.arrange(GeneratedTrack, StyleConfig)`，将旋律 + 和弦数据展开为七轨分离的 `ArrangedTrack`（vocal、melody、secondaryMelody、pianoLH、pianoRH、drums、counterMelody）。编配过程中对每条轨道调用 `InstrumentIdiom.apply()`（乐器惯用法渲染）和 `InstrumentIdiom.humanize()`（人性化处理）。
10. **MIDI 事件转换 (`PlaybackEngine.ts`)**: 将 `ArrangedTrack` 的音符数据转换为 `MidiEvent[]`，通过 `globalMidiScheduler.loadTrack()` 加载。
11. **播放**: `MidiScheduler` 以 5ms 轮询驱动 SpessaSynth 实时合成输出。

---

## 3. 硬件抽象层（HAL）映射
移植到 ESP32-S3 时，`/src/core/hal/IHardware.ts` 中的 TypeScript 接口直接映射到 ESP-IDF 驱动：

| TS 接口 | 模拟器实现 | ESP32-S3 实现（C/C++） |
| :--- | :--- | :--- |
| `ILedMatrix` | React 状态 + CSS 网格 | **SPI / RMT**（WS2812B / APA102 驱动） |
| `ITouchPad` | DOM `onPointerDown` | **I2C**（如 CST816S）或原生触摸板 |
| `IAudioOut` | SpessaSynth（SF2）+ MidiScheduler | **I2S**（如 MAX98357A）+ FluidSynth/TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

---

## 4. C/C++ 移植开发规范（关键）

为确保 TS 代码可轻松翻译为 ESP32-S3 的 C/C++，`/src/core/` 中所有后续开发**必须**遵守以下规则：

1. **核心代码禁止 React**: 永远不要在 `/src/core/` 中使用 `useState`、`useEffect` 或 JSX。核心逻辑必须是纯 TS 类或函数。
2. **确定性随机**: 永远不要使用 `Math.random()`，必须使用 `/src/core/utils/PRNG.ts` 中的 `globalPRNG.next()`。确保相同种子在 Web 和 ESP32 上产生相同曲目。
3. **内存管理（避免 GC）**:
   - 避免在紧密循环中创建对象（如 `new Object()`、`.map()`、`.filter()`）。
   - 尽量使用预分配数组或 TypedArray（`Uint8Array`、`Float32Array`）。
   - 在 C++ 中，这些将映射为静态数组或内存池，以防止 ESP32 上的堆碎片化和 OOM 崩溃。
4. **纯数据结构**: 生成引擎的输出必须是纯数据（可 JSON 序列化）。最终 `ArrangedTrack` 对象中禁止出现函数或类实例。
5. **禁止 Tone.js**: 所有音频调度必须使用 `MidiScheduler`。所有混音必须使用 MIDI CC 消息（CC 7=音量、CC 10=声像、CC 91=混响）。

---

## 5. AI 辅助移植指南（面向固件工程师和 Claude/AI）

如果你是被委派将本代码库移植到 ESP32-S3 的 AI 助手或固件工程师，请仔细阅读本节以了解系统的边界与耦合关系。

### 5.1 代码分离：保留 vs. 替换
- **不要修改（1:1 移植为 C++）**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts` 中的所有内容。这是纯算法逻辑。将 TS 类直接翻译为 C++ 类。TS 的 `number` 根据上下文转为 `float` 或 `uint8_t`。
- **替换（硬件相关）**: `/src/core/hal/` 和 `/src/core/audio/` 中的所有内容。你必须编写实现 HAL 接口和 MIDI 调度器的 C++ 类。
  - `ILedMatrix` → 使用 ESP-IDF **SPI Master** 驱动或 **RMT** 外设驱动 WS2812/APA102 LED。
  - `ITouchPad` → 使用 ESP-IDF **I2C** 驱动读取触摸控制器（如 CST816S）。
  - `MidiScheduler` → 使用 FreeRTOS 定时任务（`vTaskDelay`）从 MIDI 事件队列中读取并推送到 SF2 引擎。

### 5.2 组件耦合与数据流（系统如何连接）
为防止乐器"各行其是"（音符冲突、节奏不同步），架构强制执行严格的**自顶向下、共享上下文**数据流：
1. **风格与配置 (`StyleRegistry`)**: 定义全局规则（BPM 范围、允许的和弦、乐器）。风格按类别组织为 PopStyles、RockStyles、ElectronicStyles、BalladStyles、CinematicStyles、RnBStyles，共注册 **14 个风格**（ModernPop、ClassicJPop、ModernJPop、DarkPop、PopRock、IndieRock、PostRock、LofiHipHop、ProgressiveHouse、Synthwave、PowerBallad、RussianFolkBallad、GhibliOrchestral、NeoSoul）。
2. **宏观结构 (`StructureEngine`)**: 将歌曲划分为段落（前奏、主歌、副歌）。
3. **全局和声 (`HarmonyCore.ts`)**: `HarmonyEngine` 类为每个段落生成统一的和弦进行，旋律生成后还会执行 `reharmonize()` 反向优化。**关键**：所有乐器（主旋律、贝斯、伴奏和弦）必须引用完全相同的 `HarmonyState`，不得自行生成和弦。
4. **全局节奏 (`GrooveEngine`)**: 生成统一的节奏网格（切分、摇摆）。
5. **乐器编制 (`EnsembleDrafter`)**: 根据风格配置选择乐器编制方案（人声、主旋律、和弦、贝斯、鼓、副旋律的音色分配）。
6. **歌手人格 (`SingerPersona`)**: 为主旋律选择歌手人格配置，影响装饰音、弯音、气口等声乐表情。
7. **编配 (`Orchestrator`)**: 作为调度器。接收全局和声与全局节奏，将 `GeneratedTrack` 展开为七轨 `ArrangedTrack`（含可选 vocal 轨），并通过 `InstrumentIdiom` 将每条轨道传递给特定的 **Idiom** 进行乐器化渲染和人性化处理。
8. **惯用法 (`PianoIdiom`、`BassIdiom`、`StringIdiom` 等)**: 乐器专用渲染器（共 7 种：Piano、Guitar、String、Drum、Bass、Wind、SynthVoice）。接收共享的 `HarmonyState` 并翻译为乐器特定的 `NoteData`（如 BassIdiom 仅演奏共享和弦的根音/五音；PianoIdiom 演奏块状和弦）。`InstrumentIdiom` 调度器按乐器名称字符串匹配路由到对应 Idiom。这保证了音乐的统一性。

### 5.3 内存管理与 C++ 结构体映射
JavaScript 使用垃圾回收。如果在音频循环中动态分配对象，ESP32-S3 会崩溃（OOM）。
- **TS `NoteData`** 必须翻译为紧凑的 C 结构体：
  ```cpp
  struct NoteData {
      uint8_t pitch;       // 0-127 MIDI 音符
      uint8_t velocity;    // 0-127
      float onset;         // 拍位位置
      float duration;      // 拍长
  };
  ```
- **避免 `std::vector` 重新分配**: 预分配音符数组（如 `NoteData trackBuffer[1024]`）。参见 `/src/core/utils/TrackSerializer.ts` 了解我们如何在 TS 中使用 `Float32Array` 模拟扁平内存布局。

### 5.4 验证策略（"黄金种子"测试）
如何证明你的 C++ 移植与 Web 模拟器 1:1 一致？
1. **固定种子**: 在 Web 模拟器中硬编码 `globalPRNG.setSeed(12345)`。
2. **生成并导出**: 运行生成流水线，将结果 `GeneratedTrack`（或经 Orchestrator 编配后的 `ArrangedTrack`）序列化为 JSON 文件（或使用 `TrackSerializer` 获得二进制缓冲区）。
3. **运行 C++ 移植版**: 在 ESP32（或 PC C++ 测试构建）上，用 `12345` 初始化你的移植版 PRNG，运行移植版生成流水线。
4. **比对**: 结果 C++ 结构体必须与 Web 模拟器的输出逐字节匹配。如果任一音符的 `onset` 或 `pitch` 有差异，说明你的 C++ 移植有逻辑错误（通常是浮点精度问题、排序算法差异或遗漏的 `PRNG.next()` 调用）。

---

## 6. 接口使用说明与调用逻辑

### 6.1 HAL 接口 (`/src/core/hal/IHardware.ts`)
这些接口定义了操作系统逻辑与物理硬件之间的边界。
- **`IAudioOut`**:
  - *Web*: 由 `AudioEngine`（SpessaSynth + Web Audio API）处理。
  - *ESP32*: 必须使用 I2S DMA 实现。`playNote` 和 `stopNote` 方法应将 MIDI 事件推送到 ESP32 上运行的 FluidSynth/TinySoundFont 引擎。
- **`ILedMatrix`**:
  - *Web*: 通过 React 状态（`LedMatrix.tsx`）模拟。
  - *ESP32*: 使用 SPI 或 RMT 实现。`setPixel` 方法写入帧缓冲区，`update` 通过 DMA 将缓冲区刷新到 LED。
- **`ITouchPad`**:
  - *Web*: 通过 DOM 指针事件模拟。
  - *ESP32*: 使用 I2C 读取触摸控制器。`getTouchState` 读取当前寄存器，`onPadDown`/`onPadUp` 应由硬件中断（ISR）触发并映射到 FreeRTOS 队列。
- **`ISystemTimer`**:
  - *Web*: 使用 `performance.now()` 和 `setTimeout`。
  - *ESP32*: 使用 `esp_timer_get_time()` 获取微秒精度，使用 `vTaskDelay()` 进行阻塞延时。

### 6.2 音频调用逻辑（MIDI 流水线）
1. **事件生成**: `PlaybackEngine` 或 `LiveLoopingEngine` 读取 `ArrangedTrack` 数据并将其转换为 `MidiEvent` 对象。
2. **调度**: 这些事件被推送到 `globalMidiScheduler`（`MidiScheduler.ts`）。
3. **执行**: 调度器使用前瞻循环（模拟 FreeRTOS 定时任务）。当事件时间到达时，调用 `spessaSynth` 实例的相应方法（如 `noteOn`、`noteOff`、`controllerChange`）。
4. **混音**: 所有混音（音量、声像、混响）通过向特定 MIDI 通道发送 MIDI 控制变化（CC）消息完成。不使用 Web Audio API GainNode 进行分轨混音。

---

## 7. AuraRadio 与生成引擎的接口关系

### 7.1 总览管道

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          AuraRadio 无限电台                                │
│                                                                          │
│  ┌────────────────┐   ┌──────────────────┐                               │
│  │  PRNGManager   │   │ StyleId (enum)   │                               │
│  │ getStream(stg) │   │ ┌──────────────┐ │                               │
│  └──┬─────────┬───┘   │ │StyleFlagTable│ │                               │
│     │         │        │ │StyleConfig[] │ │                               │
│     │         │        │ │StyleIdName[] │ │                               │
│     ▼         ▼        │ └──────────────┘ │                               │
│  ┌──────────┐  ┌───────┴──┐  ┌────────────┐                              │
│  │ 生成引擎  │  │ 编配引擎  │  │  播放引擎   │                              │
│  │ Melody   │  │ Orches-  │  │ Playback   │                              │
│  │ Engine   ├─►│ trator   ├─►│ Engine     │                              │
│  │(styleId) │  │(styleId) │  │(styleId)   │                              │
│  └──────────┘  └──────────┘  └─────┬──────┘                              │
│       │ GeneratedTrack  │ ArrangedTrack   │                              │
│       │                 │                 │ onTrackEnd                    │
│       │                 │                 ▼                               │
│  ┌──────────────────────────────────────────────────────────┐            │
│  │                       历史栈                               │            │
│  │  [(Track,StyleId)₀][(Track,StyleId)₁]...[(Track,StyleId)ₙ]│            │
│  │                                          ▲ historyIndex  │            │
│  │                                                          │            │
│  │  下一首: index+1 存在 → 取历史 → 编配管道（跳过生成）      │            │
│  │          index+1 不存在 → triggerGeneration()（重新生成）  │            │
│  │  上一首: index-1 ≥ 0 → 取历史 → 编配管道                  │            │
│  └──────────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 黑盒接口输入输出图

```
                    显式输入                     隐式输入
                 ┌───────────┐    ┌────────┐   ┌──────────────┐
                 │  styleId  │    │options? │   │ PRNGManager  │
                 │(StyleId   │    │·motif   │   │ .getStream() │
                 │  enum)    │    │·tonality│   │              │
                 └─────┬─────┘    │·timeSig │   │ 每阶段独立   │
                       │          └────┬────┘   │ 状态可快照   │
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
                    ┌──────────────┐  ┌──────────────┐
                    │GeneratedTrack│  │ MusicContext  │
                    │ ·vocal       │  │ ·keyOffset   │
                    │ ·melody      │  │ ·tonality    │
                    │ ·chords      │  │ ·bpm         │
                    │ ·sections    │  │ ·timeSignature│
                    │ ·bpm, key    │  │ ·grooveDNA   │
                    │ ·tonality    │  │ ·singerPersona│
                    │ ·timeSignature│  └──────┬───────┘
                    │ ·palette     │         │
                    │ ·globalRiff  │         │
                    │ ·userMotif   │         │
                    └──────┬───────┘         │
                           │                 │
                           │  styleId        │
                           ▼  (透传)         ▼
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

### 7.3 PRNGManager 接口

贯穿全管道的随机数供给模块。内部维护一个 LCG（线性同余生成器），所有需要随机数的模块统一从这里取数。

> **名词解释**
> - **PRNG**（Pseudo-Random Number Generator）：伪随机数生成器，给定相同种子必定产生相同序列。
> - **LCG**（Linear Congruential Generator）：线性同余生成器，PRNG 的一种具体算法。本项目参数：`a=1664525, c=1013904223, m=2³²`（源码 `PRNG.ts:17`）。

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
  ├─ AuraRadio 选风格      → next() ×1        ← 从 14 个 StyleId 中选一个
  │
  ├─ 生成引擎内部           → next() ×N 次     ← BPM/调性/拍号/和弦/旋律/编制...
  │   ├─ StructureEngine   → next() ×若干
  │   ├─ HarmonyEngine     → next() ×若干
  │   ├─ EnsembleDrafter   → next() ×若干
  │   ├─ ToplineEngine     → next() ×若干
  │   └─ reharmonize       → next() ×若干
  │
  ├─ 编配引擎内部           → next() ×M 次     ← Idiom 渲染 + 人性化
  │   ├─ InstrumentIdiom   → next() ×若干
  │   └─ humanize          → next() ×若干
  │
  └─ MIDI 转换层            → next() ×0        ← 纯数据转换，不消耗随机数
```

所有模块共享同一条链，按上述固定顺序依次消费。相同 seed → 相同调用顺序 → 相同输出。

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

意义：**把单向链切断成片段，任意一段都能独立重放和验证**。用于定位哪个模块产生了偏差（Web 与 C++ 对比时尤其关键）。

**行为约束**:
- v1 实现与当前 `globalPRNG` 行为完全一致，黄金种子测试零差异
- `getState()`/`setState()` 是新增能力，当前代码不存在
- 当前源码中 `globalPRNG = new PRNG(Date.now())`，`setSeed()` 虽已实现但项目中从未被调用，每次运行种子不同（不可复现）。黄金种子测试需在入口处显式调用 `setSeed(固定值)`
- 纯确定性，不依赖任何外部状态
- C++ 侧对应 `struct PRNGManager { uint32_t state; }` + `uint8_t protocolVersion`
- v2 分流种子派生（每个模块独立子链）见第 8 章

### 7.4 生成引擎黑盒接口

```typescript
const engine = new MelodyEngine();
engine.generateFullSong(styleId: StyleId, options?: GenerationOptions)
  : { track: GeneratedTrack, context: MusicContext }
```

**显式输入**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `styleId` | `StyleId`（enum） | 是 | 风格枚举值，索引 `StyleConfigTable` 和 `StyleFlagTable` |
| `options.userMotifRoot` | `number` | 否 | 用户动机根音，传入则锁定调号 |
| `options.processedUserMotif` | `NoteData[]` | 否 | 用户动机音符序列 |
| `options.motifRole` | `'Foreground' \| 'Middleground' \| 'Background'` | 否 | 动机角色，默认 `'Foreground'` |
| `options.motifExpertise` | `string` | 否 | 动机专业度标记，默认 `'Seed'` |
| `options.detectedTimeSignature` | `[number, number]` | 否 | 指定拍号，跳过随机抽取 |
| `options.detectedTonality` | `'Major' \| 'Minor'` | 否 | 指定调式，跳过随机抽取 |

**隐式输入**:

| 名称 | 说明 |
|------|------|
| `PRNGManager` | 通过 `getStream("gen")` 获取本阶段 PRNG 实例，入口自动记录状态快照。 |
| `StyleConfigTable[styleId]` | 内部查表得到，定义 BPM 范围、和弦池、旋律约束、乐器候选等规则边界。 |
| `StyleFlagTable[styleId]` | 内部查表得到，风格分类标签位掩码（25 flag）。 |

**输出**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `track` | `GeneratedTrack` | 生成的曲目数据（字段同 7.2 图中所列） |
| `context` | `MusicContext` | 生成过程中产生的音乐上下文状态，显式传递给编配引擎 |

`MusicContext` 包含生成引擎在生成过程中确定的全局音乐状态：

| 字段 | 类型 | 说明 |
|------|------|------|
| `keyOffset` | `number` | 调号偏移量（0~11） |
| `tonality` | `string` | 调式（Major/Minor） |
| `bpm` | `number` | 速度 |
| `timeSignature` | `[number, number]` | 拍号 |
| `grooveDNA` | `number[]` | 节奏指纹 |
| `singerPersona` | `SingerPersonaConfig?` | 歌手人格配置 |

**行为约束**:
- 同步调用，返回纯数据，不触发音频
- 相同 PRNG 状态 + 相同输入 = 相同输出（确定性）
- 每次调用消耗若干 PRNG，状态不可逆前进
- **不修改任何全局状态**：音乐上下文通过返回值 `context` 显式输出，不写入全局单例

### 7.5 编配引擎黑盒接口

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
- 通过 `PRNGManager.getStream("arr")` 获取本阶段 PRNG 实例，入口自动记录状态快照
- 同一 `GeneratedTrack` + 同一 `MusicContext` + 同一 PRNG 状态 = 同一输出
- **不读写任何全局状态**：所有音乐上下文从 `context` 参数读取，不访问全局单例

### 7.6 MIDI 转换层接口

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

`MidiEvent[]` 之后的调度和合成由平台层负责，不在生成管道测试范围内：

```
MidiEvent[] → MidiScheduler（5ms 轮询）→ 合成器 → 音频输出
              │                          │
              │ Web: setTimeout           │ Web: SpessaSynth + GM128_3MB.sf2
              │ ESP32: vTaskDelay         │ ESP32: FluidSynth / TinySoundFont
              └──────────────────────────┘
              因平台/合成器/音色库差异，音频波形允许不同
```

### 7.7 AuraRadio 如何实现无限不重复播放

**不重复的保证**: 每次调用 `generateFullSong()` 消耗 PRNG 状态使其不可逆前进。AuraRadio 不重置种子，后续调用的随机决策序列必然不同，加上从 14 种风格中随机选取，每首曲目在旋律、和声、编制、速度、调性上均不相同。

**无限的保证**: 曲目播放结束时 `onTrackEnd` 自动触发下一首，形成闭环：

```
triggerGeneration()
  ├─ styleId ← PRNGManager.getStream("style").next() → 14 个 StyleId 之一
  ├─ { track, context } ← engine.generateFullSong(styleId)  ← 无 options
  ├─ 存入历史栈 (track, styleId, context)
  └─ playTrack()
       ├─ AudioEngine.playSong(track, styleId, context, ...)
       │    └─ 内部调用 Orchestrator.arrange(track, styleId, context)
       └─ onTrackEnd ──► playNext()
                           ├─ 历史有下一首 → playTrack()（跳过生成，重新编配）
                           └─ 历史末尾 → triggerGeneration()  ← 循环回到顶部
```

**历史导航**: 已生成的 `GeneratedTrack` + `StyleId` + `MusicContext` 缓存在内存栈中。回放时直接进入编配 + 播放，跳过生成。新生成时截断当前位置之后的历史。

### 7.8 接口扩展性风险与重构建议

以下接口在未来扩展时需要联动修改多处代码。针对每项风险，给出结合 ESP32-S3 (C/C++) 嵌入式环境约束的重构方案。

**风险 1：轨道字段逐个命名**

涉及接口：`GeneratedTrack`、`ArrangedTrack`、`EnsembleDraft`、`EnsembleDraft.mixing`

当前每条轨道（vocal、melody、pianoLH、pianoRH、drums、counterMelody、secondaryMelody）是独立的具名字段。新增轨道类型需同步修改上述四个接口 + `Orchestrator` + `PlaybackEngine`，共六处联动变更。`vocal` 的加入即经历了这一过程。

- **重构方案 — 轨道集合化（Track Collection）**：废弃具名轨道字段，改用 `TrackData[]` 数组配合 `TrackRole` 枚举。
- **C++ 映射**：对应 `enum` + `struct` 静态数组，内存布局紧凑。
- **注意事项**：由于数组丢失了 TS 接口中 `melody` 等必填字段的编译时保证，需在 `TrackRole` 定义处明确标注必填角色（如 Melody, PianoLH, PianoRH），并在生成器出口增加运行时完整性校验。

**风险 2：InstrumentIdiom 路由硬编码**

涉及文件：`InstrumentIdiom.ts`

路由通过 if/else 字符串匹配分发到 7 种 Idiom。新增乐器类别必须修改路由代码。当前已有缺陷：vocal 默认音色 `Marimba` 不命中任何分支，走 fallback 原样返回，未经过 Idiom 处理。

- **重构方案 — Idiom 策略注册表（Strategy Registry）**：在乐器元数据（或 `EnsembleDraft`）中显式绑定 `IdiomType`，通过 `IdiomRegistry` 动态分发，消除 `if/else` 字符串硬编码。这也能顺带修复当前 `Marimba` 走 fallback 的 Bug。
- **C++ 映射**：对应静态查找表（Static Lookup Table），通过乐器 ID 直接索引对应的 Idiom 处理函数。

**风险 3：Orchestrator 风格分类靠 style.id 推断**

涉及文件：`Orchestrator.ts`

通过 `style.id.includes('house')` 等字符串匹配推断风格分类（electronic / acoustic / cinematic / rock）。新增风格如 `NeoSoul` 不命中任何分支，静默走 else 默认逻辑。风格分类信息未由 `StyleConfig` 自身声明。

- **重构方案 — 风格标签位掩码（Tag Flags）**：废弃 `style.id` 隐式推断。由于风格存在重叠（如 `PopRock` 同时具备 Pop 的电子感和 Rock 的属性），单一枚举无法满足需求。应在 `StyleConfig` 中引入 `tags: string[]` 数组（如 `['electronic', 'rock']`）。
- **C++ 映射**：将 tags 严格映射为 `uint8_t styleFlags` 位掩码（Bitmask）。例如 `FLAG_ELECTRONIC | FLAG_ROCK`，通过按位与（`&`）进行极速路由，比字符串匹配更安全、更紧凑。

**风险 4：类型枚举频繁扩展**

涉及接口：`GeneratedChord.quality`（已从 12 → 16 种）、`StyleConfig.orchestration.texturePool`（已追加 `Octave_Melody_Bass`）、`idiomPreferences` 的风格枚举

每次支持新和弦类型、新织体、新 Idiom 风格都需要修改 union type 定义。

- **重构方案 — 开放式枚举与静态映射（Open Enums & Static Pointers）**：将频繁变动的联合类型在 TS 侧改为开放式类型（`string`）配合常量字典，符合开闭原则。
- **C++ 映射**：在 C++ 侧**严禁使用 String 字典**（避免堆分配和慢速比较）。必须映射为 `enum : uint8_t`，新增值追加到 enum 末尾；TS 侧的 `Map<string, Generator>` 注册表，在 C++ 侧必须实现为**静态函数指针数组**，通过 enum ID 直接寻址调用。

### 7.9 接口设计约束

> 以下约束已融入 7.1~7.7 的接口设计中，所有改动不改变生成输出，黄金种子测试结果零差异。

1. **PRNG 由 `PRNGManager` 统一管理**：废弃裸 `globalPRNG` 单例，通过 `PRNGManager.getStream(stage)` 按阶段获取 PRNG 实例。模块统一管理种子派生策略、状态快照（`getState()`/`setState()`）、协议版本。当前仅实现 v1 串联流，行为与原 `globalPRNG` 一致。C++ 侧对应管理结构体 + `uint8_t` 协议版本。
2. **`StyleId` 为 enum 类型**：废弃 `style.id` 字符串。所有接口统一只传 `StyleId`（enum 数值），各组件内部按需查 `StyleConfigTable[styleId]`（生成规则）和 `StyleFlagTable[styleId]`（分类标签）。C++ 侧 `enum StyleId : uint8_t`，静态数组直接寻址。
3. **风格分类走 `StyleFlagTable` 位掩码**：废弃所有 `style.id.includes()` 子串匹配（8 个文件、80+ 处）。每个风格的 flag 分配按**代码中实际的分支命中路径**确定（不是按字符串包含关系），确保每个风格在替换后命中的 if 分支与替换前完全一致。`uint32_t` 容纳，不做乐理归约合并。新增风格时必须在 `StyleFlagTable` 中声明 flags。**StyleId enum 迁移与 StyleFlag 替换必须同步执行，不可拆分。** EnsembleDrafter 中的 `style.id.split('_')` 双向模糊匹配逻辑需重构为乐器侧 flag 匹配（`instrumentFlags & styleFlags`）。
4. **接口参数统一**：`MelodyEngine.generateFullSong(styleId)`、`Orchestrator.arrange(track, styleId, context)`、`AudioEngine.playSong(track, styleId, context, ...)` 全部只收 `StyleId`，消除 StyleConfig 对象的冗余传递和重复查表。
5. **`MusicContext` 显式传递**：废弃 `GlobalContext` 全局可变单例。生成引擎将曲目级音乐上下文（keyOffset、tonality、bpm、timeSignature、grooveDNA、singerPersona）作为返回值 `MusicContext` 显式输出，编配引擎通过参数 `context` 显式接收。各黑盒不读写任何全局状态，所有输入均在函数签名上可见，支持完全独立测试。C++ 侧对应值传递的结构体。编配引擎内部逐段落遍历时的段落级状态（activeSection、activeChord、energyLevel）属于编配引擎的内部实现，通过局部变量管理并显式传参给 TextureMapper / Idiom，不纳入 MusicContext，不经过全局单例。
6. **阶段入口自动快照**：`MelodyEngine.generateFullSong()` 和 `Orchestrator.arrange()` 入口处自动记录 `PRNGManager.getState()`，支持独立复现任一阶段的输出。
7. **`StyleId`、`StyleFlagTable`、`StyleIdName` 集中定义**：统一在一处（如 `StyleFlags.ts`），禁止散落。`StyleFlagTable` 每条记录必须在风格注册时一并声明。
8. **生成管道终点为 `MidiEvent[]`**：整个生成管道（生成引擎 → 编配引擎 → MIDI 转换层）的最终确定性输出为 `MidiEvent[]` 序列，不涉及音频。同一输入必须产生相同的 `MidiEvent[]`。MIDI 之后的调度与合成属于平台层（MidiScheduler + 合成器 + 音色库），因平台差异允许不同波形，不纳入生成管道测试范围。

**待验证边界项**（flag 分配需按代码实际分支命中路径逐个确认）：

- `post_rock`：字符串无 `cinematic`，但 `Orchestrator.ts:18` 代码逻辑中 `includes('post_rock')` 被显式归入 cinematic 分支，flag 应为 `ROCK | CINEMATIC`
- `synthwave`：`Orchestrator.ts:16` 有 `includes('synthwave')` 归入 electronic 分支，需确认是否需要新增 `SYNTHWAVE` flag 或分配已有 flag 组合
- `lofi_hip_hop`：需全文搜索确认是否有 `includes('lofi')` 或 `includes('hip_hop')` 的专属匹配，如果确实无命中则 flag 为 0
- `ghibli_orchestral`：`includes('ghibli')` 有专属逻辑，需搜索确认是否总是与 `cinematic` 成对出现，若有独立使用则需第 26 个 `GHIBLI` flag
- `SectionMetadata.localStyleOverride`：当前为 `string`，需确认取值范围和迁移方式
- `EnsembleDrafter.ts:32`：`style.id.split('_')` 双向模糊匹配无法用 flag 直接复制，需重构为乐器侧 flag 匹配，并逐个确认重构后的匹配结果与当前一致

### 7.10 与当前代码的差异明细

> 7.1~7.7 描述的是目标接口设计，以下列出与当前代码实现的具体差异。

| 项 | 当前代码 | 目标设计 | 涉及文件 |
|---|---|---|---|
| styleId 类型 | `string`（如 `'modern_pop'`） | `StyleId`（enum 数值） | `types.ts`、所有接口签名 |
| 风格分类方式 | `style.id.includes('house')` 子串匹配（80+ 处） | `StyleFlagTable[styleId]` 位掩码查表 | `Orchestrator.ts`、`TextureMapper.ts`、`HarmonyCore.ts`、`StructureEngine.ts`、`EnsembleDrafter.ts`、`PlaybackEngine.ts`、`LiveLoopingEngine.ts`、`RhythmCells.ts` |
| 风格配置查询 | `getStyleConfig(id: string)` 哈希表查找 | `StyleConfigTable[styleId]` 静态数组直接寻址 | `StyleRegistry.ts` |
| PRNG 管理 | 裸 `globalPRNG` 单例，无状态快照 | `PRNGManager` 模块，支持 `getStream(stage)`、`getState()`/`setState()` | `PRNG.ts` → 新增 `PRNGManager.ts` |
| 音乐上下文传递 | `GlobalContext` 全局可变单例，生成引擎写入、编配引擎隐式读取 | `MusicContext` 结构体，生成引擎显式返回、编配引擎显式接收 | `GlobalContext.ts` → 新增 `MusicContext` 类型、`MelodyEngine.ts`、`Orchestrator.ts` |
| 生成引擎返回值 | `GeneratedTrack` | `{ track: GeneratedTrack, context: MusicContext }` | `MelodyEngine.ts` |
| 生成引擎参数 | `generateFullSong(styleId: string)` | `generateFullSong(styleId: StyleId)` | `MelodyEngine.ts` |
| 编配引擎参数 | `arrange(track, style: StyleConfig)` | `arrange(track, styleId: StyleId, context: MusicContext)` | `Orchestrator.ts` |
| 生成管道终点 | `AudioEngine.playSong()` 内含编配+MIDI转换+音频合成，输出为音频 | MIDI 转换层 `PlaybackEngine.convert()` 输出 `MidiEvent[]`，音频合成剥离到平台层 | `PlaybackEngine.ts`、`AudioEngine.ts` |
| 播放引擎参数 | `playSong(track, style: StyleConfig, ...)` | `playSong(track, styleId: StyleId, context: MusicContext, ...)` | `AudioEngine.ts` |
| StyleConfig 查表次数 | EndlessRadioManager 查一次 + MelodyEngine 内部再查一次（冗余） | 各组件内部按需查一次，无冗余 | `EndlessRadioManager.ts`、`AudioEngine.ts` |
| 历史栈存储 | `{ track: GeneratedTrack, style: StyleConfig }` | `{ track: GeneratedTrack, styleId: StyleId, context: MusicContext }` | `EndlessRadioManager.ts` |
| 风格显示名称 | `style.name` 从 StyleConfig 对象读取 | `StyleIdName[styleId]` 独立数组 | UI 层 |

---

## 8. 版本升级方向建议

> 以下改进会改变生成输出。同一种子在改进前后产生不同曲目。实施时需要版本标识区分，并重新建立黄金种子基线。

### 8.1 PRNG 阶段隔离（分流种子派生 v2）

**现状**：全系统共用单一 `globalPRNG` 实例，生成引擎与编配引擎的 PRNG 调用严格串联（管道内共计 314+ 处调用点）。生成引擎内部任何改动（增减一次 `next()` 调用）会改变编配引擎的起始 PRNG 状态，导致七轨编配结果全部变化。

**升级方式**：在 PRNGManager（7.8.2）中新增 v2 分流派生协议——由主种子 hash 派生各阶段独立的 PRNG 实例：

```
masterSeed
  ├─ hash(masterSeed, "style")  → styleSelectionPRNG   （风格选择）
  ├─ hash(masterSeed, "gen")    → generationPRNG       （生成引擎）
  ├─ hash(masterSeed, "arr")    → arrangementPRNG      （编配引擎）
  └─ hash(masterSeed, "perf")   → performancePRNG      （Idiom 人性化）
```

| 协议 | 派生方式 | 阶段间耦合 | 种子兼容性 |
|------|---------|-----------|-----------|
| `v1`（当前） | 串联流——全局共用单一 PRNG，顺序消耗 | 强 | 基线 |
| `v2`（新增） | 分流派生——主种子 hash 派生独立实例 | 无 | 与 v1 不兼容，同种子产生不同曲目 |

**影响**：
- 同一 masterSeed 在 v1 和 v2 下输出不同曲目（两种协议各自确定性、可复现）
- 314+ 调用点需逐个确认归属哪个阶段实例
- 若需回放旧种子收藏，按版本标识走 v1 路径
- C++ 侧每个模块持有独立 `LCG` 实例，内存增量仅为每实例一个 `uint32_t`

### 8.2 风格标签乐理归约与分层

**前置依赖**：7.8.3（25 flag 机械替换）已安全落地。

**现状**：第一步保留了 25 个与原始子串 1:1 对应的 Flag，未做合并。部分 Flag 在代码中总是成对出现（如 `electronic` 和 `electro`），存在归约空间；同时缺少乐理维度的正交分层。

**升级方式**：在 25 flag 基础上分三步进行：

**步骤 1 — 逐对验证合并**

检查以下候选合并对在代码中是否**总是成对出现于同一 if 条件**。总是成对 → 可安全合并；存在独立使用 → 不能合并。

| 候选合并 | 风险点 |
|---|---|
| `JAZZ` + `SWING` | 是否存在只匹配 swing 不匹配 jazz 的分支？ |
| `ELECTRONIC` + `ELECTRO` | 是否完全等价？ |
| `RNB` + `SOUL` | 是否存在只匹配 soul 不匹配 rnb 的分支？ |
| `JPOP` + `ANIME` | 是否完全等价？ |
| `FUNK` + `DISCO` | 是否存在独立使用？ |
| `BALLAD` + `ACOUSTIC` | 是否存在独立使用？ |
| `HOUSE` + `EDM` + `ELECTRONIC` + `ELECTRO` + `DANCE` | 是否能统一为 ELECTRONIC？需逐处确认 |
| `NEO_SOUL` → `RNB` | neo_soul 有独立 voicingStyle 逻辑，强行合并会丢失专属和弦排列 |
| `CINEMATIC` + `AMBIENT` | 电影配乐和 ambient 编配策略差异大 |

**高风险合并**（极可能导致输出变化）：
- `NEO_SOUL` 归入 `RNB`：Neo Soul 失去专属和弦排列，变成普通 R&B
- `HOUSE`+`EDM` 合并为 `ELECTRONIC`：`progressive_house` 会意外命中原本只属于 edm 的分支
- 给 `lofi_hip_hop`（当前 flag=0）分配任何标签：会突然命中某些 if 分支，原本安静的 Lofi 可能加入激烈的电子鼓点

**步骤 2 — 引入正交维度**

将验证安全后的合并标签按乐理维度拆分为独立字段：

```typescript
interface StyleFlags {
    genre: GenreFlag;     // 基因：POP | ROCK | JAZZ | ELECTRONIC | FOLK | RNB ...
    groove: GrooveFlag;   // 律动：SWING | SHUFFLE | STRAIGHT | SYNCOPATED | LATIN_CLAVE ...
    mood: MoodFlag;       // 情绪：BALLAD | UPBEAT | DARK | CINEMATIC | AMBIENT ...
}
```

C++ 映射：每个维度一个 `uint8_t`，整体结构体 3 字节。

**步骤 3 — 补充缺失标签**

以下常见乐理分类在当前代码中不存在，但后续新增风格可能需要：

| 候选标签 | 维度 | 说明 |
|---|---|---|
| BLUES | genre | 12 小节蓝调结构、蓝调音阶、shuffle 节奏 |
| CLASSICAL | genre | 对位法、奏鸣曲式 |
| COUNTRY | genre | Nashville 和弦套路、Pedal Steel |
| METAL | genre | Power chord、双踩、失真 |
| HIP_HOP | genre | 808 鼓机、Loop 结构（区别于 TRAP） |
| LATIN | genre | Salsa/Cumbia/Reggaeton（区别于 BOSSA） |

**影响**：
- 合并 Flag 会改变部分风格的分支命中路径，导致 PRNG 消耗顺序变化，生成结果不同
- 需要逐个风格验证合并后的输出是"修复了 Bug"还是"破坏了设计"
- 合并完成后需重新建立黄金种子基线
