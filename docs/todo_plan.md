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

- [x] **0.1** ESP-IDF 工程已有（auraflow_music_game_console），V4 代码在 `main/aura_radio/ar4_*.c/h`
- [x] **0.2** 确认硬件规格：ESP32-S3-N8R8 或 N16R8（待最终确认），8MB PSRAM，I2S DAC 待定
- [x] **0.3** 选定 SF2 合成器方案：**TinySoundFont**（单头文件 C 库，内存友好）
- [x] **0.4** 数组最大长度统计完成（200 seed，`npm run array-stats`，commit `d900ca0`）

---

## Phase 1：PRNG 一致性验证 ✅

- [x] **1.1-1.2** `ar4_prng.c/h`（uint64_t 中间运算，与 TS 逐位一致）
- [x] **1.3** `scripts/prng-verify.ts`（10000 步录制）
- [x] **1.4-1.5** `tests/test_ar4_prng.c` — **3132 passed, 0 failed**

> **门控**：✅ 通过

---

## Phase 2：类型映射 ✅

- [x] **2.1-2.5** `ar4_types.h`（307 行）— 全部 struct/enum/buffer 定义完成
  - ar4_note_t(8B) / ar4_chord_t(8B) / ar4_section_t(10B) / ar4_ensemble_t(7B)
  - ar4_generated_track_t / ar4_arranged_track_t（指针+count 模式）
  - ar4_midi_event_t / ar4_channel_map_t / ar4_music_context_t
  - StyleId/SectionType/Tonality/ChordQuality 枚举对齐 TS
  - Buffer #define 来自 array-stats 统计

---

## Phase 3：逐模块算法翻译 ✅

### 3.1 风格系统 ✅
- [x] `ar4_style_config.h`（262 行）+ `ar4_style_registry.c`（1448 行）— 11 风格静态数据
- [x] `ar4_mood.h` — 6 种 Mood
- [x] `tests/test_ar4_style.c` — **47 passed, 0 failed**

### 3.2 MelodyEngine ✅
- [x] `ar4_structure.c/h` — 曲式模板（4 个基础模板 + Outro）
- [x] `ar4_harmony.c/h`（1635 行）— 和弦生成 + 声部连接 + Viterbi 重配和声
- [x] `ar4_groove.c/h` — 律动指纹 + 互补律动
- [x] `ar4_topline.c/h`（1787 行）— 旋律生成（轮廓/吸附/装饰音/Meyer 规则）
- [x] `ar4_melody_engine.c/h` — 管道入口

### 3.3 Orchestrator ✅
- [x] `ar4_orchestrator.c/h`（962 行）— 多轨编配（Bass/Chords/Drums/CounterMelody）
- [ ] InstrumentIdiom 调度器（简化版内联，后续迭代）
- [ ] SingerPersona 声乐表情（后续迭代）

### 3.4 MidiConverter ✅
- [x] `ar4_midi_converter.c/h`（299 行）— 纯数据转换 + 动态混音 CC + Fake Sidechain
- [x] `tests/test_ar4_modules.c` — **68 passed, 0 failed**

---

## Phase 4：全管道端到端验证

- [x] **4.1** Golden Seed 录制脚本完成（`npm run golden-seed`，commit `94bbd9c`）
  - 4 seed（12345, 99999, 42, 7777777），确定性验证 PASS
  - 录制 stateA/B/C/D + 各模块输出摘要 + MidiEvent SHA-256
  - 输出 `scripts/golden-seed-output.json`

- [x] **4.2** JSON → C 头文件转换工具完成（`python3 scripts/json2c.py`）
  - 输出 `scripts/golden_seed_data.h`：PRNG 快照 + Track 元数据 + Arranged 计数 + MIDI 摘要 + 前 10 事件

- [x] **4.3** C 侧验证框架完成 — `tests/test_ar4_e2e.c` + `tests/test_ar4_modules.c`
  - Level 0: PRNG stateA/stateB 逐位精确 ✅
  - Level 1: 段落/和弦/旋律数量合理性 ✅
  - Level 2: noteOn == noteOff、排序正确、通道分配 ✅
  - Level 3: 确定性（同 seed 两次完全一致）✅

- [x] **4.4** 4 个黄金种子全部通过 — **67 passed, 0 failed**

---

## Phase 5：ESP32 平台层集成 ✅

- [x] **5.1-5.4** 复用现有 `aura_radio.c` 播放框架（tick 驱动 + 双缓冲 + sf2_synthesizer）
- [x] `ar4_bridge.c/h` — V4 管道 ↔ 播放器桥接（PSRAM buffer + midi_note_t 转换）
- [x] `aura_radio.c` — `USE_AR4_PIPELINE` 编译开关（0=V3, 1=V4）
- [ ] **5.5** 端到端听感验证（待板测）

---

## Phase 6：C 侧编码规范 ✅

- [x] **6.1-6.5** 编码规范定义在 `.claude/rules/aura_radio_v4_pipeline_rule.md`
  - `ar4_` 前缀、snake_case、UPPER_CASE 常量
  - 禁止 malloc 热路径、禁止 rand()/srand()
  - qsort 确定性比较、返回错误码

---

## 同步工作流

TS 侧快速迭代时，执行 `/sync-to-c` 命令触发自动同步：
变更检测 → 分类（A:数据/B:接口/C:算法/D:架构）→ 翻译 → Code Review → 编译 → 测试 → 黄金种子更新 → 文档 → 提交

同步状态追踪：C 项目 `.sync_state.json`

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
