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

使用 `StyleId` + `StyleConfig`（`config/StyleFlags.ts`），`StyleRegistry`（`config/styles/StyleRegistry.ts`）映射 StyleId → StyleConfig。`config/StyleRegistry.ts` 是兼容适配层，重导出 styles/ 子目录的真实实现。

**Enum 中声明的 StyleId**（3 个）：

| StyleId | 名称 | 状态 |
|---------|------|------|
| ModernPop (0) | 现代华语流行 (Modern C-Pop) | ✅ 已注册（即 `Default` 别名指向 ModernPop） |
| Synthwave (9) | 合成器浪潮 (Synthwave) | ⚠️ enum 占位，未注册 — `getStyleConfig()` 回退到 DefaultStyle |
| LofiChill (17) | 放松低保真 (Lo-Fi Chill) | ⚠️ enum 占位，未注册 — `getStyleConfig()` 回退到 DefaultStyle |

兼容别名：`Default = ModernPop`、`DarkSynthPop = Synthwave`、`LoFiChill = LofiChill`（StyleFlags.ts:6-9）。

**当前唯一注册的 StyleConfig** — DefaultStyle（即 ModernPop），核心参数：
- BPM 80-120
- Tonality pool：Major 30% / Minor 25% / Dorian 15% / Mixolydian 15% / 五声 15%
- densityBase [0.3, 0.85]，使用 Viterbi 和声管线（`useViterbiHarmony: true`）

未来扩展 Synthwave / LofiChill 时，需在 `config/styles/` 下新增独立 StyleConfig 并加入 StyleRegistry 字典。

EndlessRadioManager 每次生成时从 bar 绑定的 `styleIds` 池中 PRNG 随机选择风格 — 当前由于仅 ModernPop 注册，实际所有 seed 都生成同一种风格（不同的 song-level 律动子风格 Pop/Funk/Lo-fi/Latin 由 V3.5 subgenre 池另行抽样）。

### Mood 系统

6 种情绪通过 `MoodRegistry`（`config/MoodFlags.ts`）定义，影响 BPM 乘数、能量上限、旋律/伴奏独立密度、切分概率、呼吸空间、力度/时值后处理。旋律和伴奏密度已解耦（`melodyDensityMultiplier` / `accompanimentDensityMultiplier`）。

### 已完成的架构改进

- 数值枚举 + 查找表（Tonality、ChordQuality、SectionType、InstrumentFlags）
- 全管道浮点 epsilon 比较、Map/Set → 数组、tonality string → 枚举
- 生成管道内部零 GlobalContext 读取（S-2 合规）
- 总混音温暖化（LPF 11kHz、Low Shelf +2dB @200Hz、Peaking -2.5dB @350Hz、High Shelf -1.5dB @6kHz）
- 段落级力度曲线（弱起→正弦波动→渐强/弱收尾）+ PhraseContourPlanner 三层张力曲线增强
- 乐器特征后处理（管乐单声部、弦乐换弓、同音高重叠防护）
- 贝斯能量分层 + 趋近音 + subgenre 4 种 hits pattern

### V3.5 RichIdioms 新增模块（2026-04-17）

> 完整文档见 `docs/main_melody_generation_logic.md`（748 行）

#### 旋律骨架与张力系统

- `/src/core/generation/composing/AnchorDecisionStage.ts` — 关键音/非关键音分化（7 规则 + snap 校验）
- `/src/core/generation/composing/AnchorBackbone.ts` — Bresenham 线性插值 + 弧度叠加骨架优先生成
- `/src/core/generation/composing/PhraseContourPlanner.ts` — 三层张力曲线（song/section/phrase），驱动 velocity 和 timing 精准度

#### 乐器 Idiom 系统（评分选择 + 华彩借调，不强绑风格）

- `/src/core/generation/idioms/drums/` — 6 种 DrumIdiom + DrumIdiomRouter（评分选择，含 melody/bass listening）
- `/src/core/generation/idioms/countermelody/` — CounterMelodyRouter（ParallelHarmony / CallAndResponse 模式）
- `/src/core/generation/idioms/piano/` — PianoIdiomRouter（5 策略评分选择和弦织体）

Idiom 系统的设计原则：**不与 subgenre 强绑定**，而是按 energy / syncopation / swing / sectionType 评分选择最适配的 Idiom。华彩借调在 Bridge / PreChorus 段末 30% 概率切到第二高分 Idiom，带 crash 声明 + fill 过渡。

#### 全链路律动统一

- 每首歌从 4 套 subgenre 池（Pop / Funk / Lo-fi / Latin）抽一个，影响鼓组 / 贝斯 / 和弦 / 旋律的律动基底
- grooveDNA 按 PhraseGroup 级变化（不再段落级固定）
- RhythmCells（`melody/RhythmCells.ts`）30% 概率用风格化节奏细胞替代分形细分

#### 混音修复

- AudioMixer 低频补偿（lowShelf +2dB / peaking 250→350Hz -2.5dB）
- 贝斯声场（reverb 0.20 + chorus 60）
- 主旋律 Plucked 乐器绝对空间音域上限 G5（79），Sustained 可到 C6（84）

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
