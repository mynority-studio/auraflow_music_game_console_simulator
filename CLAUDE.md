# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 项目概述

**AuraFlow Tap! Ver.7.6** — 基于 Web 的硬件音乐工作站模拟器，将触觉交互与程序化音乐生成相结合。模拟 5×3 打击垫控制器，内嵌完整的算法音乐引擎（欧几里得律动、马尔可夫旋律链、和声专家系统）。架构目标是 1:1 移植到 ESP32-S3 固件。

研究/分析文档统一放在 `./docs`。

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器，端口 3000（Vite）
npm run build        # 生产构建
npm run lint         # 仅类型检查（tsc --noEmit）
npm run clean        # 清除 dist/
```

需要在 `.env.local` 中配置 `GEMINI_API_KEY`（参考 `.env.example`）。

## 架构

### 双平台设计

代码库严格分离 **核心逻辑**（可移植到 ESP32 C++）与 **平台层**（Web 专用）：

- `/src/core/generation/` — 纯音乐理论与生成算法。**必须保持 100% 平台无关**（禁止 React、Web API）。C++ 移植的直接翻译目标。
- `/src/core/hal/` — 硬件抽象层接口（`ILedMatrix`、`ITouchPad`、`IAudioOut`、`ISystemTimer`）。Web 实现在 `WebSimulatorHAL.ts`；ESP32 需提供 C++ 实现。
- `/src/core/audio/` — Web 专用音频（SpessaSynth + MidiScheduler）。**ESP32 上由 I2S/FluidSynth 替代。**
- `/src/apps/` — 应用状态机（纯 TS 类，非 React hooks）。
- `/src/components/`、`/src/core/hardware/`、`/src/system/` — Web 模拟器的 React UI。**ESP32 移植时忽略。**

### 音乐生成流水线（严格顺序执行）

```
MelodyEngine.generateFullSong(styleId, options)
  → StructureEngine     → SectionMetadata[]（Intro/Verse/Chorus/Bridge/Outro）
  → HarmonyCore         → GeneratedChord[]（和弦进行 + 声部进行）
  → EnsembleDrafter     → EnsembleDraft（乐器编制选择）
  → ToplineEngine       → NoteData[]（旋律 + GrooveDNA 节奏指纹）
  → Orchestrator        → ArrangedTrack（钢琴左右手、贝斯、鼓、副旋律）
  → InstrumentIdiom     → 人性化的乐器演奏处理
  → SingerPersona       → 声乐表情（装饰音、弯音、气口）
```

生成输出为纯数据（`ArrangedTrack`）— 生成阶段不涉及音频播放。

### 音频播放流水线

```
ArrangedTrack → PlaybackEngine → MidiEvent[] → MidiScheduler（5ms 轮询）
  → SpessaSynth（SF2 合成）→ AudioMixer（压缩器 + 补偿增益）→ 扬声器
  → VisualEvent → LedMatrix（LED 可视化）
```

所有混音使用 MIDI CC 消息（CC7=音量、CC10=声像、CC91=混响），不使用 Web Audio GainNode 做分轨混音。

### 关键单例

| 单例 | 文件 | 用途 |
|---|---|---|
| `globalPRNG` | `core/utils/PRNG.ts` | 确定性 LCG 随机数 — 禁止使用 `Math.random()` |
| `globalMidiScheduler` | `core/audio/MidiScheduler.ts` | MIDI 事件调度（5ms 轮询，模拟 FreeRTOS 定时器） |
| `AudioEngine` | `core/audio/AudioEngine.ts` | SpessaSynth 生命周期与播放编排 |
| `GlobalContext` | `core/generation/GlobalContext.ts` | 共享音乐状态（BPM、调性、拍号） |

### 风格系统

13 个风格配置位于 `/src/core/generation/config/styles/`（ClassicJPop、LofiHipHop、Synthwave、GhibliOrchestral 等）。每个风格定义和弦池、节奏参数、旋律约束、编配方案和允许的歌手人格。新增风格只需添加一个文件，无需修改核心代码。

### 乐器惯用法系统（Idiom）

乐器专用渲染器位于 `/src/core/generation/performance/idioms/`（Piano、Guitar、String、Drum、Bass、Wind、SynthVoice）。每个 Idiom 接收共享的 `HarmonyState`，输出符合该乐器特性的 `NoteData`。`InstrumentIdiom` 调度器按乐器名称路由。

## 关键开发规则

1. **`/src/core/` 禁止 React** — 核心生成必须是纯 TS 类/函数，禁止 `useState`、`useEffect`、JSX。
2. **禁止 `Math.random()`** — 必须使用 `globalPRNG.next()`。相同种子在 Web 和 ESP32 上必须产生完全相同的输出。
3. **禁止 Tone.js** — 所有音频通过 `MidiScheduler` + SpessaSynth 处理，混音仅用 MIDI CC。
4. **核心代码注意内存** — 避免在紧密循环中创建对象，优先使用预分配数组 / TypedArray。`TrackSerializer` 展示了适配 C++ 的扁平内存模式。
5. **纯数据输出** — `ArrangedTrack` 必须可 JSON 序列化，生成输出中禁止函数或类实例。
6. **所有乐器共享和声** — 每个乐器读取 `HarmonyCore` 生成的同一份 `HarmonyState`，乐器不得自行生成和弦进行。

## 验证：黄金种子测试

验证 C++ 移植一致性：通过 `globalPRNG.setSeed(12345)` 固定种子，生成并序列化输出，与 C++ 输出逐字节比对。任何偏差都表示逻辑错误（浮点精度、排序算法或遗漏的 PRNG 调用）。

## 技术栈

- **框架**: React 19 + TypeScript 5.8 + Vite 6
- **样式**: Tailwind CSS 4（通过 `@tailwindcss/vite`）
- **音频**: SpessaSynth（SF2 Web 合成器）+ Web Audio API
- **音色库**: `public/GM128_3MB.sf2`（General MIDI 128 种乐器）
- **动画**: Motion（Framer Motion 后继）
- **AI**: Google Gemini API（`@google/genai`）
- **路径别名**: `@/` 映射到项目根目录
