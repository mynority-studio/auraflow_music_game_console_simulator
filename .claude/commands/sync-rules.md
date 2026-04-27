---
description: 同步音乐理论修订到 .claude/rules/ + docs/（保证 AI 上下文一致）
argument-hint: "<变更摘要>"
allowed-tools: ["Read", "Edit", "Grep", "Bash"]
---

当代码引入新的乐理概念或修改了和声/旋律/编配规则时，必须**同步更新规则文档**，避免 AI 上下文与实际代码脱节。
本命令负责定位关联文档、增量更新、记录变更日志。

## Step 1: 收集变更摘要

- 若 `$ARGUMENTS` 非空 → 作为本次变更的摘要描述
- 若为空 → 询问用户：本次修改了哪些乐理规则？例如：
  - "新增三全音替代规则到 ii-V-I 注入策略"
  - "调整副旋律 Pad 模式音域上限到 G5"
  - "Mood Energetic 切分概率从 0.3 提升到 0.5"

变更摘要将贯穿后续所有步骤，作为日志条目和检索关键词。

## Step 2: 定位关联文档

按以下优先级用 Grep 查找现有相关条款。提取关键词（如 "三全音"、"切分"、"Pad"），在每个文件中检索：

| 文档 | 用途 | 何时更新 |
|------|------|---------|
| `.claude/rules/music_domain_knowledge.md` | 通用乐理领域知识 | 涉及和声学/对位法/编曲常识 |
| `.claude/rules/music_generation_pipeline_rule.md` | 管道最高约束（K/D/T/S/C 编号体系） | 涉及确定性/可移植性/Pitch Space |
| `docs/esp32_porting.md` | ESP32 移植映射 | 涉及 C 端实现差异 |
| `docs/music_engine_audit_standard.md` | 引擎审计标准 | 涉及质量基线/检测条款 |
| `docs/framework_alignment.md` | 框架对齐说明 | 涉及多模块协作 |
| `CLAUDE.md` | 项目级规约 | 涉及"关键开发规则" |

输出每个文件的命中行号和上下文，让用户判断哪些需要更新。

## Step 3: 增量更新（Edit，不 Write）

**严格使用 Edit 而非 Write** — 保持文档原结构，只修改/新增条款。

新增条款时遵循既有编号规范：
- `music_generation_pipeline_rule.md` 的约束编号有八类（L/D/P/T/S/C/K/M），新增必须落入其中一类，编号顺延（如 `K-7` 后是 `K-8`）
- `music_domain_knowledge.md` 按音乐主题分节（和声/旋律/律动/编配/演奏/混音），新增放对应节末
- `CLAUDE.md` 的"关键开发规则"列表顺延序号

修改同时检查：
- `music_generation_pipeline_rule.md` 文档头声明的 **「最高约束」** 地位不被覆盖
- 跨文档术语一致性（同一概念不要在 A 文档叫"切分概率"，B 文档叫"反拍率"）

## Step 4: 代码引用核对

```bash
# 查找代码注释中引用了旧规则的地方
rg -n "K-[0-9]+|D-[0-9]+|S-[0-9]+|C-[0-9]+|T-[0-9]+|L-[0-9]+|P-[0-9]+|M-[0-9]+" src/core/ --type ts
```

若代码注释中引用的条款编号因本次更新发生变化（极少数情况） → 一并 Edit 修正。

## Step 5: 变更日志

在 **每个被修改文件** 顶部 frontmatter 之后追加（或更新已有的 changelog 区域）：

```markdown
> **2026-04-27** — <变更摘要>
```

日期使用 `date +%Y-%m-%d` 自动注入。

## Step 6: 报告

输出：
- 被修改文件列表 + 每个文件的简短 diff 摘要（用 `git diff --stat`）
- 提示用户：可运行 `/save "docs: 同步乐理规则 — <摘要>"` 提交本次变更
- **不自动 commit** — 用户应先复核 diff 再决定是否提交
