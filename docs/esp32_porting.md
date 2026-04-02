# ESP32-S3 移植指南

> 架构概述 → 见 `CLAUDE.md`
> 生成管道约束 → 见 `.claude/rules/music_generation_pipeline_rule.md`

---

## 硬件抽象层（HAL）映射

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

---

## 代码分离：保留与替换

- **1:1 移植到 C++**: `/src/core/generation/` 和 `/src/core/utils/PRNG.ts`。纯算法逻辑，TS 类直接翻译为 C++ 类。
- **替换（硬件特定）**: `/src/core/hal/` 和 `/src/core/audio/`。需编写实现 HAL 接口和 MIDI Scheduler 的 C++ 类。
  - `MidiScheduler` → FreeRTOS 定时器任务（`vTaskDelay`），读取 MIDI 事件队列并推送到 SF2 引擎。

---

## 内存管理与 C++ 结构体映射

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

---

## 音频调用逻辑（MIDI 管道）

1. **事件生成**: `PlaybackEngine` 读取 `ArrangedTrack` → `MidiEvent[]`。
2. **调度**: 事件推送到 `globalMidiScheduler`。
3. **执行**: 调度器 5ms 前瞻轮询（模拟 FreeRTOS 定时器），调用 `spessaSynth` 的 `noteOn`/`noteOff`/`controllerChange`。
4. **混音**: 所有混音通过 MIDI CC 消息（CC7 音量、CC10 声像、CC91 混响），不使用 Web Audio GainNode。

---

## 验证策略（"黄金种子"测试）

1. **固定种子**: `PRNGManager.setSeed(12345)`
2. **生成与导出**: 运行管道，序列化 `ArrangedTrack` 为 JSON
3. **运行 C++ 移植**: 用相同种子 `12345` 初始化
4. **比较**: 结果**必须**逐字节匹配。任何差异 = 逻辑错误（浮点精度、排序算法或遗漏的 `PRNG.next()` 调用）
