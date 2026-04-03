# ESP32-S3 移植指南

> 架构概述 → 见 `CLAUDE.md`
> 生成管道约束 → 见 `.claude/rules/music_generation_pipeline_rule.md`
> 移植计划 → 见 `docs/todo_plan.md`

---

## 硬件规格

| 项目 | 规格 |
|------|------|
| MCU | ESP32-S3-N8R8 或 N16R8（待最终确认） |
| Flash | 8MB 或 16MB（Quad SPI） |
| PSRAM | 8MB（Octal SPI） |
| SRAM | 512KB |
| SF2 合成器 | TinySoundFont（单头文件 C 库） |
| 音色库 | `GM128_3MB.sf2`（3MB，存放于 Flash/PSRAM） |
| I2S DAC | 待确认（如 MAX98357A / PCM5102A） |

---

## 硬件抽象层（HAL）映射

移植到 ESP32-S3 时，`/src/core/hal/IHardware.ts` 中的 TypeScript 接口直接映射到 ESP-IDF 驱动：

| TS 接口 | 模拟器实现 | ESP32-S3 实现 (C) |
| :--- | :--- | :--- |
| `ILedMatrix` | React State + CSS Grid | **SPI / RMT** (WS2812B / APA102 驱动) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (例如 CST816S) 或原生 Touch Pad |
| `IAudioOut` | SpessaSynth (SF2) + MidiScheduler | **I2S DMA** + TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

### HAL 接口详细说明

- **`IAudioOut`**:
  - *Web*: 由 `AudioEngine` 处理（SpessaSynth + Web Audio API）。
  - *ESP32*: I2S DMA 输出。TinySoundFont 加载 SF2 到 PSRAM，`tsf_note_on`/`tsf_note_off` 处理 MIDI 事件，`tsf_render_short` 渲染音频帧到 I2S DMA buffer。
- **`ILedMatrix`**:
  - *Web*: 通过 React 状态模拟（`LedMatrix.tsx`）。
  - *ESP32*: 使用 SPI 或 RMT 实现。`setPixel` 写入帧缓冲区，`update` 通过 DMA 刷新到 LED。
- **`ITouchPad`**:
  - *Web*: 通过 DOM 指针事件模拟。
  - *ESP32*: 使用 I2C 从触摸控制器读取。`onPadDown`/`onPadUp` 由硬件中断（ISR）映射到 FreeRTOS 队列触发。
- **`ISystemTimer`**:
  - *Web*: `performance.now()` + `setTimeout`。
  - *ESP32*: `esp_timer_get_time()` 微秒精度 + `vTaskDelay()` 阻塞延迟。

---

## 代码分离：保留与替换

- **1:1 移植到 C++**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts`。纯算法逻辑，TS 类直接翻译为 C++ 类。
- **替换（硬件特定）**: `/src/core/hal/` 和 `/src/core/audio/`。需编写实现 HAL 接口和 MIDI Scheduler 的 C++ 类。
  - `MidiScheduler` → FreeRTOS 定时器任务（`vTaskDelay`），读取 MIDI 事件队列并推送到 SF2 引擎。

---

## 内存管理与 C++ 结构体映射

JavaScript 使用垃圾回收。ESP32-S3 在音频循环中动态分配对象会 OOM 崩溃。

- **TS `NoteData`** → 紧凑 C 结构体：
  ```c
  typedef struct {
      uint8_t pitch;       // 0-127 MIDI 音符
      uint8_t velocity;    // 0-127 (TS 侧 0.0~1.0 × 127)
      double onset;        // 拍位位置（需 double 精度，累加可达 200+ 拍）
      double duration;     // 拍长
  } NoteData;
  ```
- **预分配 buffer**（基于 200 seed 统计，`npm run array-stats`）：
  ```c
  #define MAX_MELODY_NOTES       2304
  #define MAX_PIANO_LH_NOTES     1984
  #define MAX_PIANO_RH_NOTES     2432
  #define MAX_DRUM_NOTES         3712
  #define MAX_COUNTER_MELODY_NOTES 2624
  #define MAX_CHORDS             256
  #define MAX_SECTIONS           64
  #define MAX_MIDI_EVENTS        28224
  ```
- 禁止 `malloc` 热路径，所有数组静态预分配或从 PSRAM 分配。

---

## 音频调用逻辑（MIDI 管道）

1. **事件生成**: `MidiConverter.convert(arranged, channelMap)` → `MidiEvent[]`。
2. **调度**: 事件推送到 MIDI 调度器（Web: `globalMidiScheduler` 5ms 轮询；ESP32: FreeRTOS 定时器任务）。
3. **执行**: 调度器调用合成器 API（Web: `spessaSynth`；ESP32: `tsf_note_on`/`tsf_note_off`/`tsf_channel_set_xxx`）。
4. **渲染**: ESP32 上 TinySoundFont `tsf_render_short()` 输出 PCM 帧到 I2S DMA buffer。
5. **混音**: 所有混音通过 MIDI CC 消息（CC7 音量、CC10 声像、CC91 混响），不使用 DSP 效果器。

---

## 验证策略（"黄金种子"测试）

TS 侧已实现录制脚本（`npm run golden-seed`），输出四个快照点 + 各模块输出摘要 + MidiEvent SHA-256。

1. **固定种子**: `PRNGManager.setSeed(12345)`（另有 99999, 42, 7777777）
2. **TS 侧录制**: `scripts/golden-seed.ts` 输出 `golden-seed-output.json`
3. **C 侧回放**: 同 seed 初始化，逐模块执行，比对四个快照点 stateA/B/C/D
4. **验证四级**:
   - Level 0: PRNG state 四点精确匹配（uint32）
   - Level 1: 分支一致（音符数量、段落数量相同）
   - Level 2: 整数字段精确匹配（pitch/channel/ticks）
   - Level 3: 浮点字段 ε ≤ 1e-6

数组长度统计（`npm run array-stats`）提供 C 侧预分配 buffer 上限。
