---
description: 同步 TS 算法变更到 C 移植（ESP32 端）— 变更检测 → 翻译 → 编译 → 测试 → 黄金种子 → 文档同步
argument-hint: ""
allowed-tools: ["Bash", "Read", "Edit", "Grep"]
---

执行 TS → C 同步工作流（按需触发）。

## Phase 1: 变更检测

读取 C 项目的 `.sync_state.json` 获取上次同步的 TS commit hash。
对 TS 侧 `src/core/generation/` 执行 `git diff <last_commit>..HEAD`，按文件映射表分类变更。

文件映射表：
```
types.ts                    → ar4_types.h
config/StyleFlags.ts        → ar4_types.h (StyleId enum)
config/styles/*.ts          → ar4_style_registry.c
config/MoodFlags.ts         → ar4_mood.h
MelodyEngine.ts             → ar4_melody_engine.c
composing/StructureEngine.ts → ar4_structure.c
composing/HarmonyCore.ts    → ar4_harmony.c
composing/ToplineEngine.ts  → ar4_topline.c
composing/GrooveEngine.ts   → ar4_groove.c
arrangement/Orchestrator.ts → ar4_orchestrator.c
arrangement/TextureMapper.ts → ar4_orchestrator.c (内联)
MidiConverter.ts            → ar4_midi_converter.c
```

## Phase 2: 变更分类

将 diff 分为 4 类并输出摘要给用户：
- **A: 数据变更** — 风格参数/Mood 参数调整 → 直接覆盖值
- **B: 接口变更** — NoteData/ArrangedTrack 等字段变更 → 先改 ar4_types.h 再改引用
- **C: 算法变更** — 旋律/和声/编配逻辑 → 逐函数对比翻译
- **D: 架构变更** — 新增模块/接口变更 → 请用户确认方案

## Phase 3: 翻译执行

翻译规则：
- 时间：TS `double` beat → C `uint16_t` tick（beat × 4）
- 浮点：TS 0.0~1.0 → C `uint8_t` 0-100（× 100）
- PRNG：`PRNGManager.next()` → `ar4_prng_next()`，消耗顺序必须严格一致
- 字符串枚举 → C 数值枚举
- 内存：禁止 `malloc` 热路径，使用预分配 buffer + count
- 新增函数以 `ar4_` 前缀命名

C 项目路径：`/home/hsycc/claude/auraflow_music_game_console/main/aura_radio/`

## Phase 3.5: Code Review

翻译完成后、编译前，对变更的 C 文件执行 Pipeline Rule 合规检查：

自动检查：
- D-1: grep `rand()` / `srand()` / `esp_random()`（禁止）
- D-3: grep `qsort` — 确认比较函数消除所有 tie
- P-1: grep `malloc` / `calloc` / `realloc` 在热路径（禁止）
- PRNG 消耗标注（`/* PRNG x1 */`）是否完整

输出给用户审阅：
- PRNG 消耗变更摘要
- 接口变更摘要
- D 类变更影响范围

用户确认后继续。

## Phase 4: 编译验证

用 Docker 编译：
```bash
docker run --rm -v /home/hsycc/claude/auraflow_music_game_console:/src -w /src gcc:12 \
  sh -c "gcc -O2 -I./main/aura_radio -c main/aura_radio/ar4_*.c && echo 'COMPILE OK'"
```

## Phase 5: 测试执行

跑全部 4 个测试套件：
```bash
docker run --rm -v /home/hsycc/claude/auraflow_music_game_console:/src -w /src gcc:12 sh -c "
  gcc -O2 -I./main/aura_radio -o /tmp/t1 tests/test_ar4_prng.c main/aura_radio/ar4_prng.c -lm && /tmp/t1 &&
  gcc -O2 -I./main/aura_radio -o /tmp/t2 tests/test_ar4_style.c main/aura_radio/ar4_prng.c main/aura_radio/ar4_style_registry.c -lm && /tmp/t2 &&
  gcc -O2 -I./main/aura_radio -o /tmp/t3 tests/test_ar4_modules.c main/aura_radio/ar4_*.c -lm && /tmp/t3 &&
  gcc -O2 -I./main/aura_radio -o /tmp/t4 tests/test_ar4_e2e.c main/aura_radio/ar4_*.c -lm && /tmp/t4
"
```

如果有 FAIL：定位 → 修复 → 重跑。

## Phase 6: 黄金种子更新

如果 TS 侧算法变更导致输出变化：
1. `npm run golden-seed`（TS 侧重新录制）
2. `python3 scripts/json2c.py`（转 C 头文件）
3. 更新 C 侧测试的 GOLDEN 期望值

## Phase 7: 文档同步

- `docs/todo_plan.md` — 标记完成项
- Pipeline Rule 变更 → 同步 `.claude/rules/aura_radio_v4_pipeline_rule.md`
- 接口变更 → 更新 `docs/esp32_porting.md`

## Phase 8: 提交

- C 侧: `git commit -m "sync: 同步 TS 变更 (<commit_range>)"`
- TS 侧: 如更新了黄金种子，也提交
- 更新 `.sync_state.json` 为当前 TS HEAD commit
