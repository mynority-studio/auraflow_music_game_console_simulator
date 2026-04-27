---
description: 回看本次对话提炼乐理讨论 → 原子化 → 对账 → 裁决冲突 → 写入 music_domain_knowledge.md + knowledge_log.md
argument-hint: "[focus 主题 — 可选，缩小回看范围；不传则扫整段对话]"
allowed-tools: ["Read", "Edit", "Write", "Bash", "AskUserQuestion"]
---

**这是知识摄取（knowledge ingestion）命令**，不是"代码改了同步文档"命令。
**总结是 AI 的活，不是用户的活** — 本命令由 AI 主动回看本次对话上下文中所有乐理/编曲/和声/律动/混音相关讨论，自动提炼后续：原子化 → 质疑可疑 → 与现有文档对账 → 用户裁决冲突 → 增量写入 → 追加日志。

**唯一会被修改的文件**：
- `.claude/rules/music_domain_knowledge.md`（领域知识库）
- `.claude/rules/knowledge_log.md`（摄取日志，首次运行时由本命令创建）

**绝不动**：`pipeline_rule.md` / `CLAUDE.md` / `docs/*` —— 仅在最终报告中标注"建议人工 review"。

---

## Phase 1: 回看对话上下文

**核心原则**：用户调用 `/digest` 时，**禁止**反过来要求用户"粘贴材料"。AI 必须**自己回看本次对话上下文**，从中提炼乐理讨论。用户的活只有两件：(a) 决定是否带 focus 参数；(b) 在 Phase 1.5 勾选哪些话题进入摄取。

**1.1 解析 focus 参数**

```bash
FOCUS="$ARGUMENTS"
FOCUS="${FOCUS#\"}"; FOCUS="${FOCUS%\"}"
FOCUS="${FOCUS#\'}"; FOCUS="${FOCUS%\'}"
FOCUS="${FOCUS##[[:space:]]}"
FOCUS="${FOCUS%%[[:space:]]}"
```

- `FOCUS` 为空 → 扫整段对话上下文
- `FOCUS` 非空 → 仅保留与该主题相关的讨论片段（如 `旋律` / `三全音` / `Pad 音域`），其他主题忽略

**1.2 扫描范围（AI 内部回看，不调用任何工具）**

回看本次对话中所有涉及以下领域的讨论：
- 和声与和弦进行（功能和声、调式互换、副属、三全音替代、声部连接）
- 旋律与动机生成（级进/跳进、解决、乐句结构、变奏）
- 节奏与律动设计（GrooveDNA、density、syncopation、强弱拍）
- 编配与织体（层次 FG/MG/BG、能量曲线、副旋律模式）
- 乐器演奏逻辑（音域、idiom、惯用法）
- 混音约束（CC7/CC10/CC91、增益级联、频段隔离、伪侧链）

**收纳标准**（必须满足全部）：
- 是**结论性陈述**，不是中途的探讨/假设/被推翻的方案
- 用户**主动表态**或**最终接受**的（如"对"、"同意"、"按这个改"，或代码已落实）
- 与代码或决策有结合点，不是抽象闲聊

**反例**（必须排除）：
- AI 自己在对话中假设但被用户否定的内容
- 在 plan 或讨论阶段被来回修改、最终未达成共识的方案
- 仅讨论代码命名/UI/工程结构的部分（OUT_OF_SCOPE）

**1.3 输出话题清单**

向用户输出：

```
=== 本次对话识别到的乐理讨论话题 ===
（focus: <FOCUS 内容>，无 focus 则写"无（扫整段对话）"）

[T1] <话题简述，一句话>
     涉及决策：<例：用户确认 X 规则成立>
     位置：<例：对话第 N 轮，与代码 src/.../X.ts 关联>

[T2] ...

[T3] ...
```

> 若 FOCUS 非空但**未识别到任何匹配话题**：直接告诉用户「在 focus=`<FOCUS>` 范围内未识别到乐理讨论结论」并退出，不写任何文件。
> 若 FOCUS 为空且**整段对话未识别到任何乐理讨论**：直接告诉用户「本次对话未识别到可固化的乐理讨论」并退出。

---

## Phase 1.5: 用户勾选要摄取的话题

**核心安全门**：避免 AI 把对话中的临时探讨、推翻的方案误当结论写入。

**有 FOCUS** → 跳过本 Phase（焦点已明确，全部话题进入 Phase 2）。

**无 FOCUS** → 用 **AskUserQuestion** 多选（`multiSelect: true`）让用户勾选哪些话题进入下一步：

```
question: "勾选要摄取入 music_domain_knowledge.md 的话题（可多选）"
options:
  - label: "T1: <话题简述>"
    description: "<涉及决策的一句话>"
  - label: "T2: <话题简述>"
    description: ...
  - label: "T3: <话题简述>"
    description: ...
```

用户**未勾选**的话题不进入后续 Phase（也不记入 knowledge_log）。
用户**全部不勾选** → 退出，不修改任何文件。

---

## Phase 2: 解析与原子化

**入场预热**：先用 Bash 提取当前已注册的 StyleId 集合（运行时活数据，避免命令文件 hardcode 过期）：

```bash
rg -n '^\s*[A-Z][a-zA-Z]+\s*=\s*\d' src/core/generation/config/StyleFlags.ts | awk -F'=' '{print $1}' | tr -d ' '
```

记下结果作为本轮的 **REGISTERED_STYLES** 集合，供 Phase 2 标签校验、Phase 3 push back 使用。若该文件不存在或 grep 无命中 → 警告用户「StyleRegistry 路径已变化」并提示更新本命令文件，本轮放弃 styleId 校验。

通读输入材料，提取**独立的知识颗粒**（atomic claims）。每颗颗粒满足：
- 1-2 句话可完整表达
- 可被读者复述而不丢失关键信息
- 与其他颗粒可独立校验（不依赖前一句的上下文）

每颗颗粒打三类标签：

| 标签维度 | 取值 |
|---------|------|
| **类型** | `规则` / `模式` / `偏好` / `事实` / `反例` |
| **范围** | `通用` / `风格({styleId})` / `乐器({name})` / `情境({context})` |
| **抽象度** | `原子`（已最小） / `复合`（含子条款，需进一步拆） |

**复合知识必须递归拆分到原子**才进入 Phase 3。例如：
> 输入："Bossa Nova 鼓组用 brush，bass 走根音五音半步装饰，Piano 用 6/9 和弦反拍"

→ 拆为 3 颗原子：
- [模式·风格(BossaNova)·乐器(Drums)] Bossa Nova 鼓组使用 brush
- [模式·风格(BossaNova)·乐器(Bass)] Bossa Nova 贝斯走根音 + 五度音 + 半步装饰
- [模式·风格(BossaNova)·乐器(Piano)] Bossa Nova 钢琴使用 6/9 和弦在反拍上

**例外：小型聚合表格不强行拆碎**

若一组紧密关联的事实需要表格表达且 **≤ 5 行**（如调式色彩对照、力度档位映射、和弦音程偏移表），可作为**单颗复合原子**整体保留。判定依据：**拆开后单行失去意义**（如"Lydian 是大三 + #11"单独存在缺少对照价值）。

例：

| 调式 | 主和弦色彩 | 典型情绪 |
|------|-----------|---------|
| Lydian | 大三 + #11 | 梦幻、悬浮 |
| Phrygian | 小三 + b9 | 紧张、东方 |
| Mixolydian | 属七 | 蓝调、摇摆 |

→ 作为 **1 颗** `[事实·通用·复合]` 原子保留，归宿 § 和声与和弦进行；写入 music_domain_knowledge.md 时也保留表格形态。

> 表格 > 5 行仍需拆 — 否则一颗原子的信息密度过高，未来 EXPAND/CONFLICT 对账精度下降。

**标签校验（StyleId）**

每颗原子若 `范围` 含 `风格({styleId})`，必须校验 `{styleId}` 是否在 Phase 2 入场预热得到的 **REGISTERED_STYLES** 集合中。**未命中 → 不要静默接受**，挂一个标记 `风格({styleId}·未注册)` 进入 Phase 3，由 push back 触发器统一处理。

输出 Phase 2 结果时给用户**编号**：`#1, #2, ...`，方便后续讨论。

---

## Phase 3: Push Back 质量闸门

**核心设计**：宁可阻塞一次询问，也不让错误知识污染文档。

针对每颗原子知识，逐一检查以下触发条件，**命中任一则停下问用户**：

| 触发条件 | 例子 | 处理 |
|---------|------|------|
| 与基础乐理矛盾 | "C 大调 V 级是小三和弦" | 用 AskUserQuestion 列：原文 vs 通行说法，让用户裁决 |
| 数值越界 | "BPM 600"、"力度 1.5" | 询问是否笔误 |
| 通用化谬误 | 单首歌的分析被陈述为"所有 Pop 都..." | 询问是否降级为风格特例或单曲分析 |
| 内部矛盾 | 同一段材料前后说法冲突 | 列出矛盾点，让用户重新陈述 |
| 措辞过于模糊 | "音乐应该有感情"、"和弦要走得自然" | 询问能否给出可落地的判定（音域？节奏型？力度？） |
| 风格越界 | "三全音替代是 Pop 通用规则"（实际是 Jazz 专属） | 询问适用范围 |
| **StyleId 未注册** | 知识标记 `风格(BossaNova·未注册)` 但 BossaNova 不在 StyleFlags.ts | 用 AskUserQuestion 列三选一：(a) 先在 StyleFlags.ts 注册新 StyleId 再回来摄取；(b) 改标签为更宽泛分类（如 `通用`、或现有相近风格）；(c) 仅写 knowledge_log（不进 domain_knowledge），等风格注册后再二次摄取 |

**不触发 push back** 的情况：
- 个人偏好（"我喜欢副歌力度爆发"）→ 直接归为 `偏好` 类型
- 引用来源（"《和声学》第 X 章说..."）→ 摄取并附来源
- 不熟悉但内部一致的概念 → 假设合理，标注"待考"

整段材料完全 OUT_OF_SCOPE（如纯讨论代码命名、UI 配色）→ 直接告诉用户"未识别出乐理知识颗粒"并退出，不写任何文件。

---

## Phase 4: 与现有文档对账

通过 push back 闸门后，读 `.claude/rules/music_domain_knowledge.md` **全文**（仅 ~50 行，足够一次读完）。
对每颗原子知识做**对账分类**：

| 分类 | 定义 | 后续动作 |
|------|------|---------|
| `NEW` | 现有文档无相关条款 | 拟新增至对应章节末 |
| `EXPAND` | 与某条已有规则相关，可补充细节/例外/数值 | 拟编辑该行 |
| `CONFLICT` | 与某条已有规则**矛盾** | **必须用户裁决**（Phase 5） |
| `DUPLICATE` | 已被现有条款完整覆盖 | 跳过，但仍记入日志 |
| `OUT_OF_SCOPE` | 不属于乐理领域知识（混入了代码/工程/历史轶事等） | 跳过，记入日志 |

**章节归宿**（music_domain_knowledge.md 现有结构）：

| 节名 | 涵盖范围 |
|------|---------|
| `§ 和声与和弦进行` | T-S-D 功能、调式互换、副属、三全音替代、声部连接、终止式 |
| `§ 旋律与动机生成` | 级进/跳进、解决、乐句结构、变奏、动机发展、Intro-Verse-Chorus 段落 |
| `§ 节奏与律动设计` | GrooveDNA、density、syncopation、强弱拍、DJ/采样/Beat 设计 |
| `§ 编配与织体` | 层次（FG/MG/BG）、能量曲线、副旋律三模式、规则池、状态机 |
| `§ 乐器演奏逻辑` | 钢琴/吉他/贝斯/鼓/弦乐/管乐/合成器的音域、惯用法、idiom |
| `§ 混音约束（MIDI CC 驱动，无 DSP）` | CC7/CC10/CC91、增益级联、频段隔离、伪侧链 |
| `§ 回答原则` | 不放具体乐理 — 这是 meta 节，跳过 |

**输出对账决策表**给用户审阅（**不直接 Edit**）：

```
对账结果（共 N 颗）：

#1 [NEW]      [规则·通用]      Phrygian 调式起音的张力效应
              → 拟入 § 和声与和弦进行 节末

#2 [EXPAND]   [模式·乐器(Bass)] Walking Bass 在 Jazz 中三度间穿插半音过渡
              → 拟编辑现有 L34 的 Walking Bass 行（追加半音过渡说明）

#3 [CONFLICT] [规则·通用]      副属和弦解决方向应反向
              → ❗ 与 § 和声与和弦进行 现有"副属和弦"条款矛盾
              → 需 Phase 5 裁决

#4 [DUPLICATE] [规则·通用]     旋律级进为主跳进解决
              → 已在 § 旋律与动机生成 L17 完整记录，跳过

#5 [OUT_OF_SCOPE] [事实]       Bossa Nova 起源于 1958 年巴西
              → 历史背景非生成规则，跳过
```

---

## Phase 5: 用户裁决（仅当存在 CONFLICT 时触发）

对每个 `CONFLICT` 条目，用 **AskUserQuestion** 弹对比面板：

```
question: "#3 冲突如何处理？"
options:
  - label: "保留旧的（拒绝新输入）"
    description: "原文档：<现有条款原文>"
  - label: "采用新的（覆盖旧）"
    description: "新输入：<新知识原文>"
  - label: "合并（场景化）"
    description: "拟改为：「场景 A → 旧规则；场景 B → 新规则」（用户后续给场景区分依据）"
  - label: "搁置不写入"
    description: "本次不更新文档，留待后续验证"
```

合并选项需要二次追问"如何区分场景"。
搁置的条目仅记入 knowledge_log.md，不动 music_domain_knowledge.md。

裁决完成后，对 `EXPAND` 条目主动展示拟改 diff（旧行 → 新行）让用户预览；用户可逐条 reject。
对 `NEW` 条目展示插入位置和原文，等待用户批量确认（"全部 OK" / "排除 #5")。

---

## Phase 6: 应用变更

仅在用户**明确确认**后才执行：

1. **Edit** `.claude/rules/music_domain_knowledge.md`：
   - `NEW` → 用 Edit 工具在对应节末追加（不要改章节标题，不要重排已有条款）
   - `EXPAND` → 用 Edit 工具替换该行
   - `CONFLICT` 中"采用新的" → 用 Edit 工具替换原行
   - `CONFLICT` 中"合并" → 用 Edit 工具改为分场景语气
   - 其他类别 → 不动 music_domain_knowledge.md

2. 不要批量 Write 整个文件（保护现有结构）；每条变更一次 Edit 调用。

3. 写入语气保持**和现有文档同款**：精炼、动词起头、不写多余形容词。例：
   - ✅ "Phrygian 起音通过降二度强张力，常用于 Drop 段落或恐怖配乐"
   - ❌ "我们应该认识到 Phrygian 调式具有非常独特的紧张感，这种感觉..."

---

## Phase 7: 追加知识日志

### 7.1 首次运行（文件不存在时）

```bash
test -f .claude/rules/knowledge_log.md
```

若返回非零 → 用 **Write** 工具创建，初始内容：

```markdown
# 乐理知识摄取日志

> Append-only 日志，记录 /digest 每次摄取的对话片段来源与归宿。
> 当 music_domain_knowledge.md 中某条规则被质疑时，回查本日志可追溯原始对话引用与关联 commit。
> 禁止删除历史条目，只允许在末尾追加；如需勘误，新增"勘误"条目，不删旧条目。

---
```

### 7.2 每次摄取追加新条目

用 **Edit** 工具在文件末尾追加（用 `git rev-parse HEAD` 取当前 commit 关联）：

```markdown
## YYYY-MM-DD HH:MM — <一句话摘要>

**关联 commit**: `<short-hash>`（pre-edit HEAD）
**focus**: <FOCUS 内容，无则写"无（扫整段对话）">
**勾选话题数**: X / Y（用户勾选 / Phase 1 识别总数）
**摄取摘要**:

| # | 分类 | 类型/范围 | 一句话 | 归宿 |
|---|------|-----------|--------|------|
| 1 | NEW | 规则·通用 | Phrygian 起音的张力效应 | § 和声与和弦进行 |
| 2 | EXPAND | 模式·乐器(Bass) | Walking Bass 半音过渡 | § 乐器演奏逻辑 L34 |
| 3 | CONFLICT→新 | 规则·通用 | 副属和弦解决方向 | § 和声与和弦进行 替换 L8 |
| 4 | DUPLICATE | 规则·通用 | 旋律级进为主 | 已存在，跳过 |
| 5 | OUT_OF_SCOPE | 事实 | Bossa Nova 起源 | 历史背景，跳过 |

**未变更文档**: pipeline_rule.md, CLAUDE.md, docs/*
**建议人工 review**: <若有，列出文件 + 原因；否则写"无">

**对话片段溯源**（折叠）：
<details>
<summary>展开对话引用</summary>

每颗摄取的话题，附 1-3 行**关键对话引用**（用户表态 + AI 落地的关键句），不要粘整段对话。
格式：

> [T1] 旋律级进规则
> 用户："级进为主，跳进必须解决到和弦音"
> AI 落地：在 src/.../MelodyEngine.ts 实现了 `resolveJump()` 函数

> [T2] ...

</details>

---
```

日期用 `date "+%Y-%m-%d %H:%M"` 自动生成。

---

## Phase 8: 报告

输出给用户：

```
=== 知识摄取报告 ===

focus: <FOCUS 内容，无则写"无（扫整段对话）">
Phase 1 识别话题: Y 个
用户勾选话题:    X 个（无 focus 时；有 focus 默认全部进入）
解析得原子知识:   N 颗
质量闸门:        M 颗触发 push back（已裁决）

应用结果:
  NEW         X 颗 → § 和声与和弦进行(2), § 编配与织体(1)
  EXPAND      Y 颗 → 修改 3 行
  CONFLICT    Z 颗 → 已裁决（W 采用新, V 合并, U 搁置）
  DUPLICATE   _ 颗 → 跳过（已存在）
  OUT_OF_SCOPE _ 颗 → 跳过（非乐理）

文档变更:
  .claude/rules/music_domain_knowledge.md  | +X / ~Y / -Z 行
  .claude/rules/knowledge_log.md           | +N 行（追加摄取日志）

建议人工 review (本命令未自动改):
  - <若 NEW/EXPAND 中含硬约束特征（确定性/可移植性）→ 提示 pipeline_rule.md>
  - <若涉及 ESP32 移植差异 → 提示 docs/esp32_porting.md>
  - <若不涉及 → 无>

下一步:
  /save "docs(rules): 摄取乐理 — <一句话>"
```

**不自动 commit**。等用户复核后用 `/save` 提交。

---

## 边界与失败处理

- 若 Phase 1 扫整段对话**未识别到任何乐理讨论结论** → 报告"本次对话未识别到可固化的乐理讨论"后退出，不改任何文件
- 若 Phase 1 在 focus=`<FOCUS>` 范围内**未识别到匹配话题** → 提示用户调整 focus 关键词或不传参数，退出不改文件
- 若 Phase 1.5 用户**全部不勾选** → 退出不改文件
- 若 Phase 2 通过原子化但全部命中 OUT_OF_SCOPE → 报告"勾选的话题均不属于乐理领域知识"后退出
- 若 Phase 3 push back 被用户多次拒绝（>3 次）→ 询问是否搁置该原子，或退回 Phase 1 重新选题
- 若 Phase 5 用户全部选"搁置"→ 仅写 knowledge_log.md（记录搁置原因），不改 music_domain_knowledge.md
- 若 Edit 报错（行内容变化导致 old_string 不唯一）→ 重新 Read 文档定位，不要改用 Write 整体覆盖
