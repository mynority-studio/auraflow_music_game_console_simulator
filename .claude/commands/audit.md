执行算法编曲引擎全维度审计（按需触发）。

## 触发条件

按 `.claude/rules/music_engine_audit_standard.md` §0.1 定义：
- 涉及 `/src/core/generation/` 子模块职责边界的改动
- 修改 PRNG 消耗序列的改动
- 大型重构（HarmonyCore / Orchestrator / TextureMapper / ToplineEngine）
- 连续 3 个 PR 后的累积复盘
- 版本 Tag 前的 Release Gate

## 执行步骤

### Step 1: 确定审计范围

读取最近的 commit 变更范围，确定涉及的审计维度（§1~§10）。
小型 bugfix 只审计涉及的维度；大型重构执行完整十维审计。

### Step 2: 逐维度检查

按 `.claude/rules/music_engine_audit_standard.md` 的 10 个维度逐项检查：

1. 纵向和声与声部协同（§1）
2. 节奏律动与多层交互（§2）
3. 旋律设计与可歌性（§3）
4. 段落编排与宏观叙事（§4）
5. 配器与音色（§5）
6. 人性化与后处理（§6）
7. 混音参数与频段隔离（§7）
8. ACVE 确定性验证（§8）
9. C 可移植性（§9）
10. 听感主观评价（§10，需用户参与）

每个 ✅ 必须附 file_path:line 或函数名作为证据锚点。

### Step 3: Seed 回归

```bash
npx tsx scripts/golden-seed.ts
```

验证 4 个 golden seed 的确定性（state A/B/C/D 一致 + SHA-256 一致）。

### Step 4: 生成审计报告

输出到 `docs/audits/YYYY-MM-DD_<tag>_audit.md`，使用 §11 的报告模板。

### Step 5: 问题登记

缺失项（❌）和部分实现项（⚠️）登记到 `docs/todo_plan.md` 的 tech debt 区域。
