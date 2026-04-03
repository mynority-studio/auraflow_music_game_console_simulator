# 待办计划

---

## ✅ DONE：TS 侧架构重构（Pipeline Rule 合规）

> **完成时间** — 2026-04-03
> **依据** — Music Generation Pipeline Rule 全部条款

### 已完成项

| 项目 | 状态 | 关键文件 |
|------|------|---------|
| GlobalContext 消除 | ✅ 零 import/调用 | 生成管道全目录 |
| MusicContext 显式传递 | ✅ 函数参数链 | MelodyEngine / Orchestrator |
| MidiConverter 独立模块 | ✅ 纯转换层 | `core/generation/MidiConverter.ts` |
| PRNG 快照（getState） | ✅ 模块入口记录 | MelodyEngine / Orchestrator / MidiConverter |
| StyleId 数值枚举 | ✅ | `config/StyleFlags.ts` |
| SectionType 数值枚举 | ✅ 12 种 | `types.ts` |
| Tonality 数值枚举 | ✅ 8 种 | `types.ts` |
| ChordQuality 数值枚举 | ✅ 17 种 | `types.ts` |
| InstrumentId 数值枚举 | ✅ 60 值 | `config/InstrumentFlags.ts` |
| 浮点 epsilon 比较 | ✅ ε=1e-6 | ToplineEngine / Orchestrator 等 |
| D-4/T-1/D-3 违规修复 | ✅ | commit `7f5be87` |
| P-1/D-2/S-6 合规修复 | ✅ | commit `0f1ced3` |
| tsc 零错误 | ✅ | |

### 平台层迁移完成（不受 Pipeline Rule 管辖）

| 项目 | 状态 | commit |
|------|------|--------|
| `StyleRegistry` 哈希表 → 数组直接寻址 | ✅ | `e3b2c37` |
| 播放引擎终点独立化（Orchestrator 移到 App 层） | ✅ | `1ba8c71` |
| 历史栈存储格式 `{ track, styleId, context }` | ✅ | `1ba8c71` |
| PlaybackEngine MIDI 通道回退碰撞修复 | ✅ | `1ba8c71` |

---

# TS→C 移植待办计划

> **目标** — 将 AuraFlow 音乐生成管道从 TypeScript 1:1 翻译到 ESP32-S3 纯 C 实现
> **TS 定位** — 长期维护的参考实现，算法变更先在 TS 验证再同步到 C
> **C 侧现有 V3** — 保留但不再迭代，新翻译代码逐步替换
> **精度目标** — PRNG state 逐位精确，pitch 逐个匹配，时间 beat×4≈tick（±1 tick）
> **移植边界** — 生成管道（PRNG → MelodyEngine → Orchestrator → MidiConverter → MidiEvent[]），平台层复用现有 sf2_synthesizer + aura_radio 播放框架
> **依据** — Music Generation Pipeline Rule + 卡点决策（见 `docs/esp32_porting.md`）

### 移植卡点决策摘要

| 卡点 | 决策 |
|------|------|
| PRNG | 自定义 LCG 替换 `rand()`，`prng_next()` 返回 `double` |
| 两套实现 | 方案 A — 从 TS 1:1 翻译，丢弃 V3 算法 |
| 时间单位 | TS `double` beat / C `uint16_t` tick，`beat×4=tick` |
| 浮点精度 | 仅 PRNG 返回值用 `double`，其余整数/`float` |
| 内存 | 50-80KB Flash + 100-150KB PSRAM，空间充足 |
| NoteData | 复用 `midi_note_t`（6 字节），duration 可能需扩为 `uint16_t` |

---

## Phase 0：前置准备

- [ ] **0.1** 建立 ESP-IDF 工程骨架（CMake + 目录结构）
- [x] **0.2** 确认硬件规格：ESP32-S3-N8R8 或 N16R8（待最终确认），8MB PSRAM，I2S DAC 待定
- [x] **0.3** 选定 SF2 合成器方案：**TinySoundFont**（单头文件 C 库，内存友好）
- [x] **0.4** 数组最大长度统计完成（200 seed，`npm run array-stats`，commit `d900ca0`）

---

## Phase 1：PRNG 一致性验证

- [x] **1.1** C 侧 PRNG 实现完成（`ar4_prng.c/h`）
- [x] **1.2** 6 个接口全部实现（setSeed/next/nextInt/nextFloat/getState/setState）
- [x] **1.3** TS 侧录制 PRNG 验证数据完成（`scripts/prng-verify.ts`，commit `cffed14`）
- [x] **1.4** C 侧回放比对通过（3132 passed, 0 failed）
- [x] **1.5** nextInt/nextFloat 范围验证通过

> **门控**：✅ Phase 1 全部通过

---

## Phase 2：类型映射 — TS interface → C struct

- [x] **2.1** C 侧浮点精度决策表已确认（见 `docs/esp32_porting.md`）
- [x] **2.2** 核心 struct 全部翻译完成（`ar4_types.h`）
- [x] **2.3** 枚举全部翻译（StyleId/SectionType/Tonality/ChordQuality 对齐 TS）
- [x] **2.4** 预分配 buffer + count 模式实现（`ar4_generated_track_t` / `ar4_arranged_track_t`）
- [x] **2.5** 内存预算：代码 50-80KB Flash，数据 100-150KB PSRAM，待 `idf.py size` 验证

---

## Phase 3：逐模块算法翻译 + 验证

> 每个子阶段：翻译 → 录制 golden data → 比对。不跳步。

### 3.1 风格系统 ✅

- [x] **3.1.1-3.1.3** `ar4_style_config.h` + `ar4_style_registry.c`（11 风格静态数据）
- [x] **3.1.4** 验证通过（47 passed, 0 failed）

### 3.2 MelodyEngine ✅

- [x] **3.2.1** StructureEngine（`ar4_structure.c/h` + `ar4_mood.h`）
- [x] **3.2.2** HarmonyCore（`ar4_harmony.c/h`，1635 行）
- [x] **3.2.3** EnsembleDrafter（内联到 `ar4_melody_engine.c`）
- [x] **3.2.4** ToplineEngine（`ar4_topline.c/h`，1787 行）+ GrooveEngine（`ar4_groove.c/h`）
- [x] **3.2.5** `ar4_melody_engine.c/h`（管道入口）

### 3.3 Orchestrator ✅

- [x] **3.3.1** `ar4_orchestrator.c/h`（886 行，多轨编配）
- [x] **3.3.2** 简化 idiom（内联 bass/chord/drums/counter 基础逻辑，后续迭代精细化）
- [x] **3.3.3** SingerPersona 跳过（后续迭代）

### 3.4 MidiConverter ✅

- [x] **3.4.1-3.4.2** `ar4_midi_converter.c/h`（PPQ=480，tick×120 转换）
- [x] **3.4.3** 子模块测试通过（68 passed）

---

## Phase 4：全管道端到端验证

- [x] **4.1** Golden Seed 录制脚本完成（`npm run golden-seed`，commit `94bbd9c`）
  - 4 seed（12345, 99999, 42, 7777777），确定性验证 PASS
  - 录制 stateA/B/C/D + 各模块输出摘要 + MidiEvent SHA-256
  - 输出 `scripts/golden-seed-output.json`

- [x] **4.2** JSON → C 头文件转换工具完成（`python3 scripts/json2c.py`）
  - 输出 `scripts/golden_seed_data.h`：PRNG 快照 + Track 元数据 + Arranged 计数 + MIDI 摘要 + 前 10 事件

- [x] **4.3** C 侧端到端验证通过（`test_ar4_e2e.c`，67 passed, 0 failed）
  - Level 0: PRNG stateA/stateB 逐位精确 ✅
  - Level 1: 段落/和弦/旋律数量合理 ✅
  - Level 2: noteOn == noteOff，事件排序正确 ✅
  - 确定性：同 seed 两次完全一致 ✅

- [x] **4.4** 4 个 seed 全部通过 + 子模块测试 68 passed

---

## Phase 5：ESP32 平台层集成 ✅

- [x] **5.1** 复用现有 `aura_radio.c` 播放器（双缓冲 + tick 驱动 + 无缝续播）
- [x] **5.2** 复用现有 `sf2_synthesizer`（TinySoundFont）
- [x] **5.3** 复用现有 I2S → ES8388 音频输出
- [x] **5.4** `ar4_bridge.c/h` 桥接层 + `USE_AR4_PIPELINE` 编译开关
- [ ] **5.5** 端到端听感验证（待板测）

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
