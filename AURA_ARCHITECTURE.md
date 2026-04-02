# AuraFlow 架构变更日志与 ESP32-S3 移植指南

> 本文档仅包含**变更日志**和 **ESP32 移植专属内容**。
> 架构概述、开发规则 → 见 `CLAUDE.md`
> 生成管道约束（32 条硬约束） → 见 `.claude/rules/music_generation_pipeline_rule.md`

---

## 版本信息
- **当前版本:** 1.34.0
- **最后更新:** 2026-04-02

<details>
<summary>更新日志（点击展开）</summary>

- `v1.34.0`: **生成管道 Rule 全面合规 — S-2/T-3/D-4/T-4 违规清零。**
  1. **S-2 GlobalContext 解耦（完成）**: 移除了 `/src/core/generation/` 中所有 `GlobalContext` 的导入、读取和写入。上下文现在通过 `MusicContext` 返回值、`TextureRenderContext` 参数、`BassIdiomContext` 字段和方法参数链显式传递。从 MelodyEngine、ToplineEngine 和 Orchestrator 中移除了 `initializeNewEra()` 和 `updateCurrentSlice()` 调用。
  2. **Bass Idiom S-2 合规**: 向 `BassIdiomContext` 添加了 `beatsPerBar`、`activeSection`、`keyOffset`、`grooveDNA`。将 `isGrooveHit`/`isLayeringHit`/`isInterleavingHit` 提取为 `BaseBassIdiom` 上的纯静态方法，替代 GlobalContext 单例调用。
  3. **HarmonyCore S-2 合规**: 向 `generateHarmonyTimeline`、`generateDynamicProgression`、`generateFromFunction` 和 `applyStyleSpices` 添加了 `tonality` 和 `keyOffset` 参数。替换了内部 14 处 `GlobalContext.currentTonality`/`currentKeyOffset` 读取。
  4. **T-3 `any` 类型消除**: 在 `types.ts` 中定义了 `IdiomPreferences` 和 `RuntimeIdiomPreferences` 接口。替换了所有 Performance Idioms、Bass/Drum Idiom 上下文和 `InstrumentIdiom` 调度器中约 30 处 `idiomPreferences?: any`。
  5. **D-4 浮点 Epsilon 合规**: 将 drum/bass/piano/vocal/transition idioms 中约 22 处浮点 `===` 比较替换为 `Math.abs(x - target) < 1e-6`。
  6. **T-4 类型断言清理**: 移除了已类型化 `idiomPreferences` 上的冗余 `as` 强转，将 `passingType as any` 收窄为具体联合类型并附加安全注释。
- `v1.33.0`: **全局冲刺回顾与次世代打磨。**
  1. 动机发展：`ToplineEngine.ts` 添加高级动机变换（`_split`、`_merge`、`_shift`）。
  2. 经过和弦与声部规避：`TextureMapper.ts` 添加 `truncateToChordEnd`。
  3. 动态鼓过门：`TransitionEngine.ts` 使用 `energyDelta` 动态缩放过门复杂度。
- `v1.32.3`: **关键 Bug 修复：反转的关系小调逻辑与双重降号。**
  1. 修复 `HarmonyCore.generateHarmonyTimeline` 中 `isRelativeMinor` 计算反向。
  2. 修复 `HarmonyCore.parseRomanNumeral` 中小调显式变音记号被双重降号。
- `v1.32.2`: **关键 Bug 修复：双重移调与小调根音计算。**
  1. 撤销 v1.32.1 向 `getSafeScalePitches` 传递 keyOffset（导致双重移调）。
  2. 修复小调中 `root += 3` 被错误应用于所有和弦。
- `v1.32.1`: **Bug 修复：音阶冲突、网格塌陷和和弦垫音泄漏。**
  1. 修复 `getSafeScalePitches` 未接收 keyOffset 导致默认 C 大调。
  2. 添加强制网格对齐（`Math.round(val / 0.25) * 0.25`）。
  3. 移除 Orchestrator 中错误的"动态 F-M-B 角色交换"逻辑。
- `v1.32.0`: **动态乐句结构生成（情绪驱动）。** MoodConfig.phraseActionBias 驱动乐句标签概率性生成。
- `v1.31.0`: **情感偏向自适应引擎。** 引入 MoodId/MoodConfig 解耦 BPM/密度/能量上限。动态 Idiom 路由。
- `v1.30.5`: 修复未定义变量与 Linter 错误。
- `v1.30.4`: **Idiom 重构（基于特征的命名）。** PopBassIdiom→SteadyBassIdiom 等。
- `v1.30.3`: 修复构建错误与清理未使用风格。
- `v1.30.2`: 回退旋律与跨界功能。
- `v1.30.1`: 旋律生成精细化（轮廓与解决）。
- `v1.30.0`: 织体分配与融合凝聚。
- `v1.29.0`: 律动参数整合（grooveDensity/grooveSyncopation 注入 Idiom 上下文）。
- `v1.28.2`: 调试模式：移除所有音效。
- `v1.28.1`: 调试模式：禁用 Intro 段落。
- `v1.28.0`: Ritardando 渐慢算法 + Trading Fours 呼应状态机。
- `v1.27.0`: Outro 生成大修（主题回声、Jazz 签名结尾、EDM Drop 结尾）。
- `v1.26.0`: Intro 生成大修（声学三角、主题伏笔、签名 Riff、EDM 滤波扫频）。
- `v1.25.0`: Lo-Fi 美学与 DSP 链。
- `v1.24.0`: 100% Idiom 提取完成（CounterMelody/Riff/VocalHarmony）。
- `v1.23.0`: Piano Idiom 解耦。
- `v1.22.0`: Grammar 委托（旋律与和声规则外部化到 StyleConfig）。
- `v1.21.0`: Drum Idiom 解耦。
- `v1.20.0`: 风格纯净化重构（消除 StyleFlags，纯数据驱动）。
- `v1.19.3`: 精细化 Eurodance/EDM 律动生成。
- `v1.19.2`: 精细化旋律引擎（严格节奏量化）。
- `v1.19.1`: 增强 PlaybackEngine 控制台日志。
- `v1.19.0`: "芯片级算法混音规则"（Zone Isolation、Fake Sidechain、Dynamic Panning）。
- `v1.18.0`: PRNG 统一重构（globalPRNG → PRNGManager）。
- `v1.17.0`: StyleId 枚举化 + StyleFlags 位掩码全面替换字符串。
- `v1.16.0`: 旋律引擎大修（Grammar-Based 节奏、微突变算子、5 大旋律原则）。
- `v1.15.3`: 鼓律动精细化 + Bossa Nova/EDM 钢琴伴奏 + Pluck 合成器。
- `v1.15.2`: 扩展乐器惯用法（Jazz Piano、Synth Arp/Pad、Guitar Arpeggio）。
- `v1.15.1`: 修复音高钳位 Bug（A8/C#17 溢出）。
- `v1.15.0`: 分层风格感知编配系统。
- `v1.14.0`: 系统性和声问题修复（Jazz/Neo-Soul 悬挂经过和弦、Turnaround）。
- `v1.13.0`: 和声不稳定性修复（调性校验、Cadence 感知、EDM 风格隔离）。
- `v1.12.0`: 新增 Eurodance/Trance/Synthwave 风格。
- `v1.11.0`: 风格精细化 Phase 1-3（Rock/Pop 围栏、Jazz Swing 鼓、平滑声部进行）。
- `v1.10.0`: 调号偏移逻辑精细化 + Bossa Nova/Jazz 风格。
- `v1.9.x`: Aura Bar 卡片轮播 UI + 响应式布局。
- `v1.8.x`: 器乐旋律精细化 + 和声色彩增强（Modal Interchange、Secondary Dominants）。
- `v1.7.x`: ToplineEngine 高级技法（Detonator、Switcheroo、R&B Phonetic Rhythm）。
- `v1.6.0`: Neo-Soul 特性（五声音阶移位、八度旋律贝斯）。
- `v1.5.0`: 声乐乐器更换（Solo_Vox → Marimba）。
- `v1.4.0`: 移除 Meowsynth.sf2，统一 GM128 音色。
- `v1.3.0`: 完全移除 Tone.js。
- `v1.2.0`: 引入 MidiScheduler（模拟 FreeRTOS 定时器）。
- `v1.1.0`: AI 辅助移植指南。
- `v1.0.1`: Math.random() → globalPRNG.next()。
- `v1.0.0`: 初始架构文档。

</details>

---

## ESP32-S3 移植指南

### 硬件抽象层（HAL）映射

移植到 ESP32-S3 时，`/src/core/hal/IHardware.ts` 中的 TypeScript 接口直接映射到 ESP-IDF 驱动：

| TS 接口 | 模拟器实现 | ESP32-S3 实现 (C/C++) |
| :--- | :--- | :--- |
| `ILedMatrix` | React State + CSS Grid | **SPI / RMT** (WS2812B / APA102 驱动) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (例如 CST816S) 或原生 Touch Pad |
| `IAudioOut` | SpessaSynth (SF2) + MidiScheduler | **I2S** (例如 MAX98357A) + FluidSynth/TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

### HAL 接口详细说明

- **`IAudioOut`**:
  - *Web*: 由 `AudioEngine` 处理（SpessaSynth + Web Audio API）。
  - *ESP32*: 必须使用 I2S DMA 实现。`playNote` 和 `stopNote` 方法应将 MIDI 事件推送到 FluidSynth/TinySoundFont 引擎。
- **`ILedMatrix`**:
  - *Web*: 通过 React 状态模拟（`LedMatrix.tsx`）。
  - *ESP32*: 使用 SPI 或 RMT 实现。`setPixel` 写入帧缓冲区，`update` 通过 DMA 刷新到 LED。
- **`ITouchPad`**:
  - *Web*: 通过 DOM 指针事件模拟。
  - *ESP32*: 使用 I2C 从触摸控制器读取。`onPadDown`/`onPadUp` 由硬件中断（ISR）映射到 FreeRTOS 队列触发。
- **`ISystemTimer`**:
  - *Web*: `performance.now()` + `setTimeout`。
  - *ESP32*: `esp_timer_get_time()` 微秒精度 + `vTaskDelay()` 阻塞延迟。

### 代码分离：保留与替换

- **1:1 移植到 C++**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts`。纯算法逻辑，TS 类直接翻译为 C++ 类。
- **替换（硬件特定）**: `/src/core/hal/` 和 `/src/core/audio/`。需编写实现 HAL 接口和 MIDI Scheduler 的 C++ 类。
  - `MidiScheduler` → FreeRTOS 定时器任务（`vTaskDelay`），读取 MIDI 事件队列并推送到 SF2 引擎。

### 内存管理与 C++ 结构体映射

JavaScript 使用垃圾回收。ESP32-S3 在音频循环中动态分配对象会 OOM 崩溃。

- **TS `NoteData`** → 紧凑 C 结构体：
  ```cpp
  struct NoteData {
      uint8_t pitch;       // 0-127 MIDI 音符
      uint8_t velocity;    // 0-127
      float onset;         // 拍位位置
      float duration;      // 拍长
  };
  ```
- **避免 `std::vector` 重新分配**: 预分配数组（例如 `NoteData trackBuffer[1024]`）。参见 `TrackSerializer.ts` 了解 TS 中使用 `Float32Array` 模拟扁平内存布局。

### 音频调用逻辑（MIDI 管道）

1. **事件生成**: `PlaybackEngine` 读取 `ArrangedTrack` → `MidiEvent[]`。
2. **调度**: 事件推送到 `globalMidiScheduler`。
3. **执行**: 调度器 5ms 前瞻轮询（模拟 FreeRTOS 定时器），调用 `spessaSynth` 的 `noteOn`/`noteOff`/`controllerChange`。
4. **混音**: 所有混音通过 MIDI CC 消息（CC7 音量、CC10 声像、CC91 混响），不使用 Web Audio GainNode。

### 验证策略（"黄金种子"测试）

1. **固定种子**: `PRNGManager.setSeed(12345)`
2. **生成与导出**: 运行管道，序列化 `ArrangedTrack` 为 JSON
3. **运行 C++ 移植**: 用相同种子 `12345` 初始化
4. **比较**: 结果**必须**逐字节匹配。任何差异 = 逻辑错误（浮点精度、排序算法或遗漏的 `PRNG.next()` 调用）

---

## 框架对齐状态

> 记录目标接口设计与当前源码的差异。标记 ✅ 表示已对齐。
> **v1.34.0**: 生成管道核心（`/src/core/generation/`）的 GlobalContext 解耦已 100% 完成。

| 项 | 当前源码 | 目标框架 | 状态 |
|---|---|---|---|
| **生成管道（Pipeline Rule 管辖）** | | | |
| styleId 类型 | `StyleId`（enum） | `StyleId`（enum） | ✅ |
| 风格分类 | `StyleFlagTable` 位掩码 | `StyleFlagTable` 位掩码 | ✅ |
| PRNG | `PRNGManager` 模块 | `PRNGManager` 模块 | ✅ |
| 上下文传递 | `MusicContext` 显式传递（零 GlobalContext） | `MusicContext` 显式传递 | ✅ |
| idiomPreferences | `IdiomPreferences` / `RuntimeIdiomPreferences` | 类型化接口 | ✅ |
| 浮点比较 | epsilon 容差 | epsilon 容差 | ✅ |
| 生成引擎签名 | `generateFullSong(styleId): { track, context }` | 同左 | ✅ |
| HarmonyCore | tonality/keyOffset 显式参数 | tonality/keyOffset 显式参数 | ✅ |
| 编配引擎签名 | `arrange(track, styleId, context)` | 同左 | ✅ |
| TextureMapper | `TextureRenderContext` 零 GlobalContext | 显式参数 | ✅ |
| Bass Idiom | `BassIdiomContext` 含完整上下文 | 显式参数 | ✅ |
| Groove 判定 | `BaseBassIdiom.isGrooveHit()` 纯函数 | 纯函数 | ✅ |
| **平台层（不受 Pipeline Rule 管辖）** | | | |
| 风格配置查询 | `getStyleConfig(id)` 哈希表 | `StyleConfigTable[id]` 数组 | 待迁移 |
| 播放引擎终点 | `AudioEngine.playSong()` 内调用 | 独立 `PlaybackEngine.convert()` | 待迁移 |
| 历史栈存储 | `{ track, style: StyleConfig }` | `{ track, styleId, context }` | 待迁移 |
| GlobalContext 平台层 | audio/apps/components 仍引用 | 不受管辖 | N/A |

### 可测试性

按框架实施后，四个黑盒均可独立测试：
- **PRNGManager**: `setSeed()` + 调用序列 → 验证输出数列
- **生成引擎**: `setState(stateA)` + styleId + options → 验证 GeneratedTrack + MusicContext
- **编配引擎**: `setState(stateC)` + 预录 track/styleId/context → 验证 ArrangedTrack
- **MIDI 转换层**: 预录 ArrangedTrack + styleId → 验证 MidiEvent[]（不消耗 PRNG）

### 机械替换兼容性

**全部 7 项替换零差异可行。其中生成管道核心项已于 v1.34.0 完成实施。**
- StyleId enum 替换 string：✅ 已实施
- GlobalContext → MusicContext 显式传递：✅ 已实施
- globalPRNG → PRNGManager：✅ 已实施
- userMotifRoot 类型 enum 化：✅ 零差异
- detectedTonality enum 化：✅ 零差异
- motifExpertise 删除：✅ 零差异
- 返回值 { track, context }：✅ 已实施
