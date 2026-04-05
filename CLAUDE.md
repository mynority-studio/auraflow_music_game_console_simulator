# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本文件为 Claude Code 在本仓库中工作时提供指引。

## 项目概述

**AuraFlow Tap! Ver.7.6** — 基于 Web 的硬件音乐工作站模拟器，将触觉交互与程序化音乐生成相结合。模拟 5×3 打击垫控制器，内嵌完整的算法音乐引擎（欧几里得律动、马尔可夫旋律链、和声专家系统）。

**最终目标**：将生成管道 1:1 移植到 ESP32-S3 纯 C 固件，Web 版作为开发/验证平台。移植计划详见 `docs/todo_plan.md`，HAL 映射详见 `docs/esp32_porting.md`。

研究/分析文档统一放在 `./docs`。

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器，端口 3000（Vite）
npm run build        # 生产构建
npm run lint         # 仅类型检查（tsc --noEmit）
npm run clean        # 清除 dist/
```

需要在 `.env.local` 中配置 `GEMINI_API_KEY`（参考 `.env.example`）。目前无测试框架（无 vitest/jest），`npm run lint` 仅执行 TypeScript 类型检查。

## 架构

### 双平台设计

代码库严格分离 **核心逻辑**（可移植到 ESP32 C）与 **平台层**（Web 专用）：

- `/src/core/generation/` — 纯音乐理论与生成算法。**必须保持 100% 平台无关**（禁止 React、Web API）。C 移植的直接翻译目标。
- `/src/core/hal/` — 硬件抽象层接口（`ILedMatrix`、`ITouchPad`、`IAudioOut`、`ISystemTimer`）。Web 实现在 `WebSimulatorHAL.ts`；ESP32 需提供 C 实现。
- `/src/core/audio/` — Web 专用音频（SpessaSynth + MidiScheduler）。**ESP32 上由 I2S/FluidSynth 替代。**
- `/src/apps/` — 应用状态机（纯 TS 类，非 React hooks）。负责编排生成管道（generate → arrange → playSong）。
- `/src/components/`、`/src/core/hardware/`、`/src/system/` — Web 模拟器的 React UI。**ESP32 移植时忽略。**

### 音乐生成管道（四模块拓扑，严格线性）

```
PRNGManager.setSeed(seed)
  → PRNGManager.next() ×1（保持 PRNG 序列对齐）
  → MelodyEngine.generateFullSong(params)       → GeneratedTrack + MusicContext
  → Orchestrator.arrange(track, params, ctx)     → ArrangedTrack
  → MidiConverter.convert(arranged, channelMap)  → MidiEvent[]（管道终点）
  → [平台层] MidiScheduler → SpessaSynth → 音频输出
```

管道约束详见 `.claude/rules/music_generation_pipeline_rule.md`（最高约束文档）。

### 音频播放流水线

```
ArrangedTrack → App 层调用 Orchestrator.arrange()
  → AudioEngine.playSong(arrangedSong)
  → PlaybackEngine.loadSong() → MidiConverter.convert() → MidiEvent[]
  → MidiScheduler（5ms 轮询）→ SpessaSynth（SF2 合成）
  → AudioMixer（压缩器 + 补偿增益）→ 扬声器
  → VisualEvent → LedMatrix（LED 可视化）
```

所有混音使用 MIDI CC 消息（CC7=音量、CC10=声像、CC91=混响），不使用 Web Audio GainNode 做分轨混音。

### 关键单例

| 单例 | 文件 | 用途 |
|---|---|---|
| `PRNGManager` | `core/utils/PRNG.ts` | 确定性 LCG 随机数 — 禁止使用 `Math.random()` |
| `globalMidiScheduler` | `core/audio/MidiScheduler.ts` | MIDI 事件调度（5ms 轮询，模拟 FreeRTOS 定时器） |
| `AudioEngine` | `core/audio/AudioEngine.ts` | SpessaSynth 生命周期与播放编排（接收 ArrangedTrack） |
| `GlobalContext` | `core/GlobalContext.ts` | **仅平台层使用**（audio/apps/components），生成管道内已消除 |

### 参数系统

核心引擎通过 `GenerationParams` 接口完全参数化，所有参数均有默认值（`getDefaultParams()`）。当前无风格预设文件（preset/idiom 系统已移除以排查同质化问题）。伴奏织体（Block/Arpeggio/Pad）直接内联在 `TextureMapper.generateChordTexture()` 中。如需恢复风格系统，在 `/src/core/generation/presets/` 下新增 `Partial<GenerationParams>` 文件并通过 `mergeParams()` 合并。

## 关键开发规则

1. **`/src/core/generation/` 禁止 React** — 核心生成必须是纯 TS 类/函数，禁止 `useState`、`useEffect`、JSX。
2. **禁止 `Math.random()`** — 必须使用 `PRNGManager.next()`。相同种子在 Web 和 ESP32 上必须产生完全相同的输出。
3. **禁止 Tone.js** — 所有音频通过 `MidiScheduler` + SpessaSynth 处理，混音仅用 MIDI CC。
4. **核心代码注意内存** — 避免在紧密循环中创建对象，优先使用预分配数组 / TypedArray。`TrackSerializer` 展示了适配 C 的扁平内存模式。
5. **纯数据输出** — `ArrangedTrack` 必须可 JSON 序列化，生成输出中禁止函数或类实例。
6. **所有乐器共享和声** — 每个乐器读取 `HarmonyCore` 生成的同一份 `HarmonyState`，乐器不得自行生成和弦进行。
7. **浮点比较用 epsilon** — 禁止 `===` 比较浮点值（beat、onset、duration 等），必须使用 `Math.abs(a - b) < 1e-6`。
8. **MusicContext 显式传递** — 生成管道内零 GlobalContext 依赖，上下文通过函数参数链传递。

## 验证：黄金种子测试

验证 C 移植一致性：通过 `PRNGManager.setSeed(12345)` 固定种子，生成并序列化输出，与 C 输出逐字节比对。任何偏差都表示逻辑错误（浮点精度、排序算法或遗漏的 PRNG 调用）。四个快照点（stateA/B/C/D）用于模块级隔离验证。

## 技术栈

- **框架**: React 19 + TypeScript 5.8 + Vite 6
- **样式**: Tailwind CSS 4（通过 `@tailwindcss/vite`）
- **音频**: SpessaSynth（SF2 Web 合成器）+ Web Audio API
- **音色库**: `public/GM128_3MB.sf2`（General MIDI 128 种乐器）
- **动画**: Motion（Framer Motion 后继）
- **AI**: Google Gemini API（`@google/genai`）
- **路径别名**: `@/` 映射到项目根目录（非 `/src/`，因此引用如 `@/src/core/...`）
- **TypeScript**: `experimentalDecorators: true`、`target: ES2022`
- **目标硬件**: ESP32-S3-N8R8/N16R8（512KB SRAM + 8MB PSRAM），TinySoundFont（SF2 合成），I2S DAC，FreeRTOS
