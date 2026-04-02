# 待办计划

---

## ✅ DONE：GlobalContext 全局单例消除（TS 侧架构重构）

> **依据** — Music Generation Pipeline Rule 条款 S-2 / L-1 / L-3
> **完成时间** — 2026-04-02

### 结果

生成管道（`/src/core/generation/`）内 GlobalContext **全部消除**：
- 零 `import { GlobalContext }` 
- 零 `GlobalContext.` 方法/属性调用
- 3 处写操作（`initializeNewEra` / `updateCurrentSlice`）已移除
- ~51 处读操作全部替换为显式参数传递
- 采用**显式参数传递**方案（通过 renderCtx / BassIdiomContext / 方法参数链）
- `updateCurrentSlice()` 由 renderCtx + idiomPreferences 注入替代
- tsc 零错误通过

详见 `docs/code_review_pending.md`。

---

# TS→C 移植待办计划

> **目标** — 将 AuraFlow 音乐生成管道从 TypeScript 移植到 ESP32-S3 纯 C 实现，对接 SF2 合成器
> **精度目标** — 同 seed 输出 99% 一致（允许浮点降精度字段的 ε ≤ 1e-6 差异）
> **移植边界** — 生成管道（PRNG → MelodyEngine → Orchestrator → PlaybackEngine → MidiEvent[]），平台层（MIDI 调度 + SF2 合成）另行实现
> **依据** — Music Generation Pipeline Rule（最高约束文档）

---

## Phase 0：前置准备

- [ ] **0.1** 建立 ESP-IDF 工程骨架（CMake + 目录结构）
- [ ] **0.2** 确认硬件规格：ESP32-S3 型号、SRAM/PSRAM 容量、I2S DAC 型号
- [ ] **0.3** 选定 SF2 合成器方案（FluidSynth lite / TinySoundFont / 其他），确认内存占用
- [ ] **0.4** 从 TS 侧统计各数组的实际最大长度（跑 100+ seed），确定预分配上限

---

## Phase 1：PRNG 一致性验证

- [ ] **1.1** 编写 C 侧 PRNG 实现（`uint32_t` LCG，a=1664525, c=1013904223, m=2^32）
- [ ] **1.2** 实现 `setSeed / next / nextInt / nextFloat / getState / setState` 全部 6 个接口
- [ ] **1.3** TS 侧录制 PRNG 验证数据：seed=12345 跑 10000 步，输出每步 state + next() 返回值
- [ ] **1.4** C 侧回放比对：10000 步 state 必须逐个 uint32 完全相同
- [ ] **1.5** 验证 `nextInt / nextFloat` 派生方法与 TS 侧一致

> **门控**：Phase 1 全部通过才进入 Phase 2

---

## Phase 2：类型映射 — TS interface → C struct

- [ ] **2.1** 编写 C 侧浮点精度决策表：

| 字段 | C 类型 | 理由 |
|------|--------|------|
| PRNG state | `uint32_t` | 整数，无精度问题 |
| PRNG next() 返回值 | `double` | 需要完整 53 位做条件判断 |
| onset / duration / startBeat / endBeat | `double` | 累加可达 200+ 拍 |
| velocity / pan / reverb / volume / delay | `float` | 0~1 范围，7 位精度足够 |
| pitch / channel / ticks | `int` 系列 | 整数，必须精确 |

- [ ] **2.2** 逐个翻译核心 struct：
  - [ ] `NoteData`（布尔字段用位标志打包）
  - [ ] `GeneratedChord`
  - [ ] `SectionMetadata`
  - [ ] `GeneratedTrack`
  - [ ] `MusicContext`
  - [ ] `GenerationOptions`
  - [ ] `ArrangedTrack`
  - [ ] `MidiEvent`
  - [ ] `EnsembleDraft` + `MixingConfig`
  - [ ] `SingerPersonaConfig`
  - [ ] `TempoCurve`

- [ ] **2.3** 翻译枚举：
  - [ ] `StyleId`（数值枚举，直接映射 C enum）
  - [ ] `SectionType`（12 种）
  - [ ] `Tonality`（8 种）
  - [ ] `ChordQuality`（17 种）
  - [ ] `StyleFlag` 位掩码 + `StyleFlagTable` 静态数组

- [ ] **2.4** 设计动态数组容器（预分配定长 buffer + count）：
  - [ ] `NoteArray`（MAX_NOTES = 待 Phase 0.4 统计）
  - [ ] `ChordArray`
  - [ ] `SectionArray`
  - [ ] `MidiEventArray`

- [ ] **2.5** 编写内存预算表，确认总占用 < 可用 SRAM/PSRAM

---

## Phase 3：逐模块算法翻译 + 验证

> 每个子阶段：翻译 → 录制 golden data → 比对。不跳步。

### 3.1 风格系统（静态数据层）

- [ ] **3.1.1** 翻译 StyleRegistry 为 C 静态数组
- [ ] **3.1.2** 翻译 StyleFlagTable
- [ ] **3.1.3** 翻译 `selectStyle()` 函数
- [ ] **3.1.4** 验证：多 seed 下 selectStyle 结果与 TS 一致

### 3.2 MelodyEngine（PRNG 消耗 ×N）

- [ ] **3.2.1** 翻译 StructureEngine → `SectionMetadata[]`
- [ ] **3.2.2** 翻译 HarmonyCore → `GeneratedChord[]`
- [ ] **3.2.3** 翻译 EnsembleDrafter → `EnsembleDraft`
- [ ] **3.2.4** 翻译 ToplineEngine → `NoteData[]`（旋律 + GrooveDNA）
- [ ] **3.2.5** 组装 `generateFullSong()` 入口
- [ ] **3.2.6** 验证：`setState(stateB)` → 执行 → 检查 `getState() == stateC` + 输出逐字段比对

### 3.3 Orchestrator（PRNG 消耗 ×M）

- [ ] **3.3.1** 翻译编配逻辑（多轨展开）
- [ ] **3.3.2** 翻译 InstrumentIdiom 调度器 + 各乐器 Idiom
- [ ] **3.3.3** 翻译 SingerPersona 声乐表情
- [ ] **3.3.4** 验证：`setState(stateC)` + 录制输入 → 检查 `getState() == stateD` + 输出比对

### 3.4 PlaybackEngine（PRNG 消耗 ×0）

- [ ] **3.4.1** 翻译 beat → tick 转换（PPQ=480）
- [ ] **3.4.2** 翻译 NoteData → MidiEvent 生成（noteOn/noteOff/cc/programChange/pitchBend）
- [ ] **3.4.3** 验证：录制 ArrangedTrack 输入 → MidiEvent[] 输出逐字段比对

---

## Phase 4：全管道端到端验证

- [ ] **4.1** 编写 Golden Seed 录制脚本（TS 侧，Node.js 环境）
  - 多 seed（至少 12345, 99999, 42, 7777777）
  - 录制四个快照点 stateA/B/C/D
  - 录制各模块中间输出（track/context/arranged）
  - 录制最终 MidiEvent[]
  - 输出 JSON 文件

- [ ] **4.2** 编写 JSON → C 头文件转换工具（Python 脚本）
  - 将 golden JSON 转为 C 可 include 的常量数组

- [ ] **4.3** 编写 C 侧验证框架
  - Level 0：PRNG state 四点精确匹配
  - Level 1：分支一致（音符数量、段落数量相同）
  - Level 2：整数字段精确匹配（pitch/channel/ticks）
  - Level 3：浮点字段 ε ≤ 1e-6

- [ ] **4.4** 全部 seed 通过四级验证

---

## Phase 5：ESP32 平台层集成

> 此阶段不影响算法正确性验证，可与 Phase 3-4 并行

- [ ] **5.1** 实现 MIDI 调度器（类比 TS 的 MidiScheduler，5ms 轮询 → FreeRTOS 定时器）
- [ ] **5.2** 集成 SF2 合成器，加载 GM128 音色文件
- [ ] **5.3** 实现 I2S DAC 音频输出
- [ ] **5.4** 实现播放控制（play/pause/next）
- [ ] **5.5** 端到端听感验证

---

## Phase 6：C 侧编码规范（贯穿全过程）

以下规范在 Phase 1 开始前确定，贯穿所有编码阶段：

- [ ] **6.1** 命名规范：`snake_case` 函数/变量，`PascalCase` struct/enum，`UPPER_CASE` 常量/宏
- [ ] **6.2** 内存规范：禁止 malloc 热路径，预分配 buffer，栈上临时变量
- [ ] **6.3** 错误处理：返回错误码（非 exception），定义 `AuraError` 枚举
- [ ] **6.4** 确定性规范（继承 TS Rule）：
  - 禁止 `rand()` / `srand()`
  - 禁止 `time()` 进入生成逻辑
  - `qsort` 比较函数必须消除所有 tie
  - 浮点比较使用 epsilon
- [ ] **6.5** 可移植性规范：
  - 禁止 GCC 扩展语法
  - 标注字节序假设
  - 整数除法显式 floor/trunc

---

## 依赖关系

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3（逐模块串行）──→ Phase 4
                                          │
Phase 6（贯穿）                           │ 可并行
                                          ▼
                                     Phase 5
```

---

## 验证门控总结

| 门控点 | 条件 | 不通过的后果 |
|--------|------|-------------|
| Phase 1 → 2 | PRNG 10000 步 state 完全一致 | 停止，修复 PRNG |
| Phase 3 各子阶段 | 当前模块 PRNG 消耗一致 + 输出匹配 | 停止，修复当前模块 |
| Phase 3 → 4 | 所有模块独立验证通过 | 停止，定位不一致模块 |
| Phase 4 → 5 | 全管道端到端验证通过 | 停止，检查模块衔接 |
