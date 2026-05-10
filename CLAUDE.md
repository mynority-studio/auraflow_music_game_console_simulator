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

## Slash Commands

项目级 slash commands 位于 `.claude/commands/`，封装高频工作流。其中 `/goto` `/home` `/reset-to` 构成 **git 历史导航三件套**（出门看历史 / 回家 / 重置主分支重新出发）：

| Command | 用途 |
|---------|------|
| `/dev` | 启动前端（自动 `pnpm install` + 杀 3000 端口 + 后台挂起，输出 Local + Network 地址） |
| `/save [msg]` | 敏感扫描 → `git add .` → commit → pull(merge) → push 一条龙 |
| `/tag <ver> <desc>` | 给当前 HEAD 打 annotated tag 并推送（里程碑） |
| `/goto [tag]` | 切到指定 tag 的 detached HEAD（溯源历史版本，**只读浏览**） |
| `/home` | 从任意位置（detached HEAD / 其他分支）安全回到主分支，处理脏工作树与孤儿 commit |
| `/reset-to <tag>` | HARD reset 主分支到指定 tag（**仅 main**，强制本地备份，**绝不推送远程**） |
| `/digest <材料>` | 摄取乐理材料 → 原子化 → push back 质疑 → 对账 → 裁决冲突 → 写入 `music_domain_knowledge.md` + 追加 `knowledge_log.md` |
| `/sync-to-c` | TS → C 移植同步工作流（已存在） |

详细流程见各 command 文件。

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

### 风格系统（2026-05 参考架构移植版）

使用 `StyleId` 数值枚举 + `StyleConfig`（`config/StyleFlags.ts`），`StyleRegistry`（`config/styles/StyleRegistry.ts`）映射 StyleId → StyleConfig。3 个风格全部按 `docs/ALL_SOURCE_CODE.md` 参考架构移植：

| StyleId | 显示名 | BPM | tensionLimits | densityBaseline | passingChordProb | anticipationProb | swingRatio |
|---|---|---|---|---|---|---|---|
| ModernPop (0) | Modern Pop | 88-128 | 9 | 0.6 | 0.2 | 0.3 | — |
| ChillJazz (1) | Chill Jazz | 70-105 | 11 | 0.4 | 0.5 | 0.6 | 0.55 |
| NeoSoul (2) | Neo-Soul | 78-100 | 13 | 0.5 | 0.6 | 0.7 | 0.6 |

每个风格的 `harmony.major / minor` 池按段落键（`'intro'/'verse'/'preChorus'/'chorus'/'bridge'/'outro'`）分组，HarmonyCore 按 tonality 选模、按 sec.name 查段。Pop / NeoSoul 共用 `DefaultHarmony`，ChillJazz 走专属 `ChillJazzHarmony`（重 ii7-V7-Imaj7 进行 + VImaj7 借调）。

EndlessRadioManager 每次生成时从 bar 绑定的 `styleIds` 池中 PRNG 随机选择风格。

### Persona 系统（参考架构 4 乐手卡牌池）

| Persona | RoleType | StyleId | InstrumentId | 核心特征 |
|---|---|---|---|---|
| Alex (Pop Piano) | AccompInst | ModernPop | 0 (GrandPiano) | colorBias=0.4 / sparsity=0.5 / sync=0.3 — 标准流行 |
| Dave (Steady Pop) | Drums | ModernPop | 3 (DrumKit) | sparsity=0.6 / sync=0.2 — 干净直拍 |
| Marcus (Neo-Soul Keys) | AccompInst | NeoSoul | 1 (EPiano) | colorBias=0.9 / sparsity=0.8 / sync=0.9 — 极稀疏重切分 |
| Nina (Chill Jazz Piano) | AccompInst | ChillJazz | 0 (GrandPiano) | colorBias=0.8 / sparsity=0.65 / dynamic=[30,75] — 轻触爵士 |

`MusicianPersona` 字段：`colorBias / sparsityTendency / contourPreference / syncopationAssault / dynamicRange / signatureLickProb`。
`MusicianRegistry.assembleActiveIdiom()` 从 Persona 派生 LeadIdiom + CompingIdiom（驱动当前 TextureMapper 兼容层）；Phase 3 BaseAccompIdiom 移植后将直接消费 Persona。

`InstrumentRegistry`（`idioms/InstrumentRegistry.ts`）含 4 个 InstrumentConfig（GrandPiano/EPiano/EBass/DrumKit），每个声明 `minPitch/maxPitch/maxPolyphony/antiMudThreshold/capabilities`，Phase 3 Idiom 引擎按 capability 派发角色。

### Q+H 调试面板（PipelineMonitor）

按 Q+H 唤出。集成功能：
- Seed Lab：手动种子输入 / Play / Stop / Random
- **BandSelection**：5 个 RoleType 下拉（Vocal/MainInst/AccompInst/Bass/Drums），可手选乐手强制 forcedLeadId / forcedCompingId 注入 runPipeline；不选则 PRNG 抽随机
- Stage 01 Meta（BPM/Key/Tonality/StyleName）+ Stage 02 Harmony（窗口和弦）
- Stage 03 Structure（段落能量条）+ Stage 04 Ensemble（乐手花名册 + 乐器音色 + 单轨 Mute）

### 已完成的架构改进

- 数值枚举 + 查找表（Tonality、ChordQuality、SectionType、InstrumentFlags）
- 全管道浮点 epsilon 比较、Map/Set → 数组
- 生成管道内部零 GlobalContext 读取（S-2 合规）
- Pitch Space 契约（K-1~K-7）：Orchestrator.applyOffset 是相对→绝对的唯一转换点
- HarmonyCore 子小节解析（'vi,IV' → 半小节切分）+ 高能段抢拍
- ToplineEngine 16 分 grooveDNA 加权抽样（节奏跟鼓共振）
- Bass 物理音域 fold（[28,43] E1~G2）保 ESP32 端 GM bass 不跑超

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
