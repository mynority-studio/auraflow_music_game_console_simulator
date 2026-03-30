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
┌─────────────────────────────────────────────────────────────────────────┐
│                         AuraRadio 无限电台                               │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  参数决定     │    │  生成引擎     │    │  编配引擎     │               │
│  │              │    │              │    │              │               │
│  │ globalPRNG ──┼──► │ MelodyEngine ├──► │ Orchestrator │               │
│  │ StyleConfig  │    │ (实例调用)    │    │ (静态调用)    │               │
│  └──────┬───────┘    └──────────────┘    └──────┬───────┘               │
│         │                                       │                       │
│         │ styleId                               │ ArrangedTrack         │
│         ▼                                       ▼                       │
│  ┌──────────────┐                        ┌──────────────┐               │
│  │ StyleRegistry │                        │  播放引擎     │               │
│  │ (14 个风格)   │                        │              │               │
│  └──────────────┘                        │ PlaybackEng. │               │
│                                          │ MidiScheduler│               │
│                                          │ SpessaSynth  │               │
│                                          └──────┬───────┘               │
│                                                 │                       │
│                                                 │ onTrackEnd            │
│                                                 ▼                       │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │                      历史栈                               │           │
│  │  [(Track,Style)₀][(Track,Style)₁] ... [(Track,Style)ₙ]   │           │
│  │                                          ▲ historyIndex  │           │
│  │                                                          │           │
│  │  下一首: index+1 存在 → 取历史 → 编配管道（跳过生成）      │           │
│  │          index+1 不存在 → triggerGeneration()（重新生成）  │           │
│  │  上一首: index-1 ≥ 0 → 取历史 → 编配管道                  │           │
│  └──────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 黑盒接口输入输出图

```
                          显式输入                 隐式输入
                       ┌───────────┐          ┌──────────────┐
                       │  styleId  │          │  globalPRNG  │
                       │ (string)  │          │  (LCG 状态)  │
                       └─────┬─────┘          └──────┬───────┘
                             │                       │
                             │    ┌──────────────┐   │
                             │    │ options?      │   │  每次调用消耗 N 次
                             │    │ ·userMotif    │   │  PRNG.next()
                             │    │ ·motifRole    │   │  状态不可逆前进
                             │    │ ·tonality     │   │
                             │    │ ·timeSignature│   │
                             │    └──────┬───────┘   │
                             │           │           │
                             ▼           ▼           ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ new MelodyEngine().generateFullSong()  │
                    │          【生成引擎黑盒】                │
                    │                                        │
                    │   同步 · 纯数据 · 确定性                │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │      GeneratedTrack        │
                    │  ·vocal     : NoteData[]?  │
                    │  ·melody    : NoteData[]   │
                    │  ·chords    : GenChord[]   │
                    │  ·sections  : SectionMeta[]│
                    │  ·bpm, key, keyOffset      │
                    │  ·tonality, timeSignature  │
                    │  ·preSelectedPalette       │
                    │  ·globalRiff, userMotif    │
                    │  ·absStartBeat, blockIndex │
                    └──────────────┬─────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │      StyleConfig           │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │     Orchestrator.arrange()             │
                    │          【编配引擎黑盒】                │
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
                                  ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │   PlaybackEngine + MidiScheduler       │
                    │          【播放引擎黑盒】                │
                    │                                        │
                    │   NoteData → MidiEvent → 合成输出       │
                    │   5ms 轮询 · MIDI CC 混音               │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
                    ┌───────────┐   ┌───────────┐
                    │ 音频输出   │   │ onTrackEnd│
                    │ (扬声器)  │   │  (回调)    │
                    └───────────┘   └─────┬─────┘
                                         │
                                         ▼
                                    playNext()
                                    → 循环回到顶部
```

### 7.3 生成引擎黑盒接口

生成引擎对外暴露一个入口（实例方法）：

```typescript
const engine = new MelodyEngine();
engine.generateFullSong(styleId: string, options?: GenerationOptions): GeneratedTrack
```

**显式输入**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `styleId` | `string` | 是 | 风格 ID，从 `StyleRegistry` 的 14 个已注册风格中选取 |
| `options.userMotifRoot` | `number` | 否 | 用户动机根音，传入则锁定调号 |
| `options.processedUserMotif` | `NoteData[]` | 否 | 用户动机音符序列 |
| `options.motifRole` | `'Foreground' \| 'Middleground' \| 'Background'` | 否 | 动机角色，默认 `'Foreground'` |
| `options.motifExpertise` | `string` | 否 | 动机专业度标记，默认 `'Seed'` |
| `options.detectedTimeSignature` | `[number, number]` | 否 | 指定拍号，跳过随机抽取 |
| `options.detectedTonality` | `'Major' \| 'Minor'` | 否 | 指定调式，跳过随机抽取 |

**隐式输入**:

| 名称 | 说明 |
|------|------|
| `globalPRNG` 内部状态 | 所有随机决策的唯一随机源。不同状态产生不同曲目。 |
| `StyleConfig` | 由 `styleId` 查表得到，定义 BPM 范围、和弦池、旋律约束、乐器候选等规则边界。 |

**输出**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `vocal` | `NoteData[]?` | 人声旋律序列（若 `EnsembleDraft.vocalSound` 存在） |
| `melody` | `NoteData[]` | 器乐主旋律（有 vocal 时为较稀疏的伴奏旋律） |
| `chords` | `GeneratedChord[]` | 全曲和弦时间轴 |
| `sections` | `SectionMetadata[]` | 段落结构（类型、起止拍、能量等级） |
| `bpm` | `number` | 速度 |
| `key` | `string` | 调号（`"C"` ~ `"B"`） |
| `keyOffset` | `number` | 调号偏移量（0~11），用于后续移调 |
| `tonality` | `string` | 调式 |
| `timeSignature` | `[number, number]` | 拍号 |
| `preSelectedPalette` | `EnsembleDraft?` | 乐器编制 + 混音参数（含 `vocalSound?`） |
| `absoluteStartBeat` | `number` | 绝对起始拍（播放引擎对齐时间轴） |
| `blockIndex` | `number` | 块索引（通常为 0） |
| `hasIntro` | `boolean` | 是否包含前奏 |
| `globalRiff` | `NoteData[]?` | 全局核心 Riff（Riff-Driven 风格用） |
| `processedUserMotif` | `NoteData[]?` | 透传处理后的用户动机 |
| `motifRole` | `string?` | 动机角色标记（透传） |
| `motifExpertise` | `string?` | 动机专业度标记（透传） |

**行为约束**:
- 同步调用，返回纯数据，不触发音频
- 相同 PRNG 状态 + 相同输入 = 相同输出（确定性）
- 每次调用消耗若干 `globalPRNG.next()`，PRNG 状态不可逆前进

### 7.4 编配引擎黑盒接口

```typescript
Orchestrator.arrange(track: GeneratedTrack, style: StyleConfig): ArrangedTrack
```

**输入**: `GeneratedTrack` + `StyleConfig`

**输出**: 七轨分离的 `ArrangedTrack`（vocal / melody / secondaryMelody / pianoLH / pianoRH / drums / counterMelody），含乐器编制、混音参数，以及透传的元数据（`bpm`、`key`、`absoluteStartBeat`、`timeSignature`、`styleId`、`sections`、`userMotif`、`globalRiff`）供 PlaybackEngine 和 UI 层使用。

**行为约束**:
- 同步调用，返回纯数据
- 内部消耗 `globalPRNG`（乐器选择、人性化偏移）
- 同一 `GeneratedTrack` 多次编配，若 PRNG 状态不同则结果不同

### 7.5 播放引擎黑盒接口

```typescript
AudioEngine.playSong(
  track: GeneratedTrack,
  style: StyleConfig,
  generator: MelodyEngine,
  options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }
): Promise<void>
```

内部串联 `Orchestrator.arrange()` → `PlaybackEngine.loadSong()` → `PlaybackEngine.play()`。将 `ArrangedTrack` 转为 MIDI 事件流，通过 `MidiScheduler`（5ms 轮询）驱动 SpessaSynth 实时合成。播放结束触发 `onTrackEnd` 回调。

### 7.6 AuraRadio 如何实现无限不重复播放

**不重复的保证**: 每次调用 `generateFullSong()` 消耗 PRNG 状态使其不可逆前进。AuraRadio 不重置种子，后续调用的随机决策序列必然不同，加上从 14 种风格中随机选取，每首曲目在旋律、和声、编制、速度、调性上均不相同。

**无限的保证**: 曲目播放结束时 `onTrackEnd` 自动触发下一首，形成闭环：

```
triggerGeneration()
  ├─ styleId ← globalPRNG.next() → 14 个风格之一
  ├─ GeneratedTrack ← new MelodyEngine().generateFullSong(styleId)  ← 无 options
  ├─ 存入历史栈
  └─ playTrack()
       ├─ AudioEngine.playSong(track, style, ...)
       └─ onTrackEnd ──► playNext()
                           ├─ 历史有下一首 → playTrack()（跳过生成，重新编配）
                           └─ 历史末尾 → triggerGeneration()  ← 循环回到顶部
```

**历史导航**: 已生成的 `GeneratedTrack` 缓存在内存栈中。回放时直接进入编配 + 播放，跳过生成。新生成时截断当前位置之后的历史。

### 7.7 接口扩展性风险与重构建议

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
