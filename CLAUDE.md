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
  → 选风格（PRNG ×1）
  → MelodyEngine.generateFullSong(styleId)       → GeneratedTrack + MusicContext
  → Orchestrator.arrange(track, styleId, ctx)     → ArrangedTrack
  → [平台层] PlaybackEngine.loadSong() 内部转 MidiEvent[]
  → MidiScheduler → SpessaSynth → 音频输出
```

管道约束详见 `.claude/rules/music_generation_pipeline_rule.md`（最高约束文档）。

### 音频播放流水线

```
GeneratedTrack + StyleId + MusicContext
  → AudioEngine.playSong() 内部调用 Orchestrator.arrange() → ArrangedTrack
  → PlaybackEngine.loadSong() 内联转 MidiEvent[]
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
| `AudioEngine` | `core/audio/AudioEngine.ts` | SpessaSynth 生命周期与播放编排（接收 GeneratedTrack + StyleId） |
| `GlobalContext` | `core/generation/GlobalContext.ts` | 平台层使用（audio/apps）；生成管道内部已脱钩（S-2），仅 MelodyEngine 入口写入 |

### 风格系统

使用 `StyleId` + `StyleConfig`（`config/StyleFlags.ts`），`StyleRegistry`（`config/StyleRegistry.ts`）映射 StyleId → StyleConfig。当前已注册 3 种风格：

| StyleId | 名称 | BPM | 特征 |
|---------|------|-----|------|
| Default (0) | 通用流行 | 80-110 | 中等密度，Major 偏好 |
| PowerBallad (1) | 欧美力量大歌 | 60-90 | 极留白，副歌爆发，弦乐铺底 |
| RussianFolkBallad (2) | 俄式民谣 | 62-72 | 100% Minor，五声音阶，木吉他琶音 |

EndlessRadioManager 每次生成时从 bar 绑定的 `styleIds` 池中 PRNG 随机选择风格。

### Mood 系统

6 种情绪通过 `MoodRegistry`（`config/MoodFlags.ts`）定义，影响 BPM 乘数、能量上限、旋律/伴奏独立密度、切分概率、呼吸空间、力度/时值后处理。旋律和伴奏密度已解耦（`melodyDensityMultiplier` / `accompanimentDensityMultiplier`）。

### 已完成的架构改进

- 数值枚举 + 查找表（Tonality、ChordQuality、SectionType、InstrumentFlags）
- 全管道浮点 epsilon 比较、Map/Set → 数组、tonality string → 枚举
- 生成管道内部零 GlobalContext 读取（S-2 合规）
- 总混音温暖化（LPF 12kHz、Low Shelf +1.5dB、High Shelf -1.5dB）
- 段落级力度曲线（弱起→正弦波动→渐强/弱收尾）
- 乐器特征后处理（管乐单声部、弦乐换弓、同音高重叠防护）
- 鼓组 Mood 驱动技巧预算 + 鼓声调色板
- 贝斯能量分层 + 趋近音
- 副旋律三模式交互（Parallel Harmony / Call-and-Response / Pad）

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
