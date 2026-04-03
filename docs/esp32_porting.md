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
| 音频输出 | I2S → ES8388 DAC @16kHz |

---

## 移植策略（卡点决策）

### 双端定位

- **TS 模拟器**：长期维护的参考实现，算法变更先在 TS 验证再同步到 C
- **ESP32 C 侧**：量产固件，从 TS 1:1 翻译（方案 A），现有 V3 引擎保留但不再迭代

### PRNG

- C 侧替换 `rand()` 为自定义 LCG（与 TS 完全一致）：`state = state * 1664525 + 1013904223`
- `prng_next()` 返回值必须用 `double`（避免 modulo bias，确保 `Math.floor(next() * N)` 等价）
- 仅 PRNG 返回值用 `double`，管道其余逻辑用整数/`float`
- 性能影响：每首歌几千次软件 `double` 除法，总计 < 1ms

### 时间单位

| 端 | 类型 | 示例 |
|----|------|------|
| TS | `double` beat | onset = 3.75 |
| C | `uint16_t` tick | tick = 15（16 分音符分辨率） |

换算：`tick = (uint16_t)(beat × 4)`，验证允许 ±1 tick 舍入误差。

### 数据映射（TS NoteData → C midi_note_t）

C 侧已有 `midi_note_t`（`midi_score.h`，6 字节/note）：

```c
typedef struct {
    uint16_t tick;       // onset × 4
    uint8_t  channel;    // MidiConverter 阶段分配
    uint8_t  key;        // pitch (0-127)
    uint8_t  velocity;   // velocity × 127
    uint8_t  duration;   // duration × 4 (⚠️ max 255 tick，长音可能需改为 uint16_t)
} midi_note_t;
```

---

## 硬件抽象层（HAL）映射

| TS 接口 | 模拟器实现 | ESP32-S3 实现 (C) |
| :--- | :--- | :--- |
| `ILedMatrix` | React State + CSS Grid | **SPI / RMT** (WS2812B / APA102 驱动) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (CST816S) 或原生 Touch Pad |
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

- **1:1 翻译到 C**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts`。纯算法逻辑，TS 类翻译为 C 函数 + 结构体。
- **替换（硬件特定）**: `/src/core/hal/` 和 `/src/core/audio/`。ESP32 侧使用现有 `sf2_synthesizer` + `aura_radio` 播放框架。
  - `MidiScheduler` → 现有 `aura_radio.c` 非阻塞 tick 播放器（双缓冲 + 提前调度）。

---

## 内存管理

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
- 预估：代码段 50-80KB Flash，数据段 100-150KB PSRAM。

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
C 头文件转换工具（`python3 scripts/json2c.py`）生成 `golden_seed_data.h`。

**四级验证**:

| Level | 内容 | 精度要求 |
|-------|------|---------|
| 0 | PRNG state 四点 | `uint32_t` 逐位精确 |
| 1 | 分支一致 | 同 seed → 同风格、同段落数、同和弦数 |
| 2 | 音高精确 | pitch 逐个匹配 |
| 3 | 时间近似 | `beat × 4 ≈ tick`（允许 ±1 tick 舍入误差） |
