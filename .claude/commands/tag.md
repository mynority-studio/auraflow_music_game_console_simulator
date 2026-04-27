---
description: 给当前 HEAD 打 annotated tag 并推送（feat 里程碑） — 任一参数缺失时 AI 结合历史与上下文预生成
argument-hint: "[version] [description]   # 可全省 / 只给 version / 都给"
allowed-tools: ["Bash", "AskUserQuestion"]
---

为当前 HEAD 创建 annotated tag 作为里程碑，并推送到远程。
适用于完成一个重要 **feat 功能** 后建立可追溯的版本节点。

**核心理念**：用户不需要每次都自己拼版本号 + 想描述。当任一参数缺失，AI **主动结合 tag 历史（命名约定）+ 对话上下文 + commit log** 预生成提案，再用 AskUserQuestion 让用户确认/修改/取消。

## Phase 0: 前置检查

```bash
git rev-parse --git-dir > /dev/null 2>&1 || { echo "✗ 不在 git 仓库"; exit 1; }
```

## Phase 1: 参数解析

> ⚠️ Claude Code 当前对 `$1` `$2` 位置参数解析不可靠（实测会把第二个引号包裹的 token 错配给 `$1`，且 `$2` 替换为空）。本命令统一从 `$ARGUMENTS` 自行解析，**不要使用 `$1` `$2`**。

从 `$ARGUMENTS` 解析两个值：
- `TAG`：第一个空格之前的部分（版本号）
- `MSG`：第一个空格之后的所有内容（去掉首尾引号）

bash 解析片段：

```bash
ARGS="$ARGUMENTS"
ARGS="${ARGS##[[:space:]]}"           # trim 首空格
ARGS="${ARGS%%[[:space:]]}"           # trim 尾空格
TAG="${ARGS%% *}"
MSG="${ARGS#* }"
[ "$MSG" = "$ARGS" ] && MSG=""        # ARGS 无空格 → MSG 为空
MSG="${MSG#\"}"; MSG="${MSG%\"}"      # 去首尾双引号
MSG="${MSG#\'}"; MSG="${MSG%\'}"      # 去首尾单引号
```

| `$ARGUMENTS` 示例 | `TAG` | `MSG` | 路径 |
|------------------|-------|-------|------|
| `AuraFlowCmdSys-v1 "命令系统 v1.0 完成"` | `AuraFlowCmdSys-v1` | `命令系统 v1.0 完成` | 直接进 Phase 2 |
| `v1.2.0 fix 旋律黑盒` | `v1.2.0` | `fix 旋律黑盒` | 直接进 Phase 2 |
| `v1.2.0` | `v1.2.0` | `` (空) | 走 Phase 1.5（AI 推 MSG） |
| `（无参数）` | `` (空) | `` (空) | 走 Phase 1.5（AI 推 TAG + MSG） |

**版本号格式校验**（推荐风格）：
- 语义化：`^v?\d+\.\d+\.\d+(-[a-z0-9]+)?$` 例 `v1.2.3`、`v1.2.3-rc1`
- 时间戳：`^v\d{8}-\d{6}$` 例 `v20260427-141500`
- 项目历史 tag：`AuraFlowV3.5`、`AuraFlowCmdSys-v1.2`

不强制阻止其他格式，但提醒用户。

---

## Phase 1.5: AI 预生成（仅当 TAG 或 MSG 缺失时）

不再"用户没传就 STOP"。当任一缺失，AI 主动结合 **tag 历史**（命名约定推断）+ **commit log**（自上一个 tag 以来的实际改动）+ **对话上下文**（本轮工作的语义）预生成提案，最后用 AskUserQuestion 让用户裁决。

**1.5.1 收集材料**

```bash
# 最近 10 个 tag — 用于推断命名模式
git tag -l --sort=-creatordate | head -10

# 上一个 tag（最近一个）— 作为 commit 范围起点
PREV_TAG=$(git tag -l --sort=-creatordate | head -1)

# 自上一个 tag 以来的 commits — 决定 MSG 内容范围
git log --oneline --no-decorate "${PREV_TAG}..HEAD"
```

**1.5.2 预生成 TAG**（仅当 TAG 为空）

按以下优先级推断命名约定：

| 优先级 | 检测规则 | 处理 |
|------|---------|------|
| 1 | 最近 tag 形如 `<prefix>-v<major>.<minor>`（如 `AuraFlowCmdSys-v1.2`） | 沿用 prefix；自上一个 tag 以来若全是 `chore`/`docs`/`fix` → minor +0.1；含 `feat`/`refactor` → minor +1；含 breaking change 标识 → major +1 |
| 2 | 最近 tag 形如 `v<major>.<minor>.<patch>`（语义化） | 同上，但 patch 默认 +1 |
| 3 | 最近 tag 形如 `v<YYYYMMDD>-<HHMMSS>`（时间戳） | 用当前时间生成 `v$(date +%Y%m%d-%H%M%S)` |
| 4 | 命名混乱 / 无可识别 pattern | 默认 timestamp，提案中说明"未找到清晰命名约定，回退时间戳" |

**1.5.3 预生成 MSG**（仅当 MSG 为空）

综合两个来源：
- **commit log**（自 PREV_TAG 以来）：是 WHAT
- **对话上下文**（AI 主动回看本轮对话）：是 WHY 与本轮工作的语义核心

格式建议：`<动作/主题> — <一句话总结>` 例：
- `命令系统 v1.2 — 全量 review 后基线（force-push 真检测 / 前置守卫 / 输出格式统一）`
- `MomentumStage 物理动量与阻尼系统`
- `黄金种子重录 + Pipeline Rule 编号扩展`

**长度**：30-80 字，避免堆砌细节（细节留给 commit message）。

**1.5.4 展示提案**

输出 fenced block：

```
=== /tag 提案 ===

上一个 tag:    <PREV_TAG> → <prev short hash>  (<N> commits ago)
本次 commits:  <N> 个（自 <PREV_TAG> 以来）
  - <commit 1 oneline>
  - <commit 2 oneline>
  - ...

命名推断:      <规则描述，如 "沿用 AuraFlowCmdSys-v 前缀，patch +1">
推断 TAG:      <生成的 TAG>
推断 MSG:      <生成的 MSG>
```

**1.5.5 AskUserQuestion 裁决**

弹四选一：

| 选项 | 行为 |
|------|------|
| **接受提案（推荐）** | 使用上面的 TAG + MSG 直接进 Phase 2 |
| 改 TAG 保留 MSG | 退出本次调用，提示用户用 `/tag <新 TAG> "<MSG>"` 重新执行 |
| 改 MSG 保留 TAG | 退出本次调用，提示用户用 `/tag <TAG> "<新 MSG>"` 重新执行 |
| 取消 | 不创建任何 tag，退出 |

> AskUserQuestion 不支持自由文本输入框，所以"改 TAG/改 MSG"实际是 **退出 + 提示用户带参数重调** 的封装。这避免在交互中陷入二次追问而打断流程。

---

## Phase 2: 工作树状态检查

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ 工作树有未提交修改，请先 /save 或 stash"
  git status --short
  exit 1
fi
```

## Phase 3: tag 重名检查

```bash
if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "✗ Tag $TAG 已存在，commit: $(git rev-parse $TAG)"
  echo "  如需替换，请先：git tag -d $TAG && git push --delete origin $TAG"
  exit 1
fi
```

## Phase 4: 创建 annotated tag

```bash
git tag -a "$TAG" -m "$MSG"
```

annotated（`-a`）而非 lightweight tag — 保留 tagger 信息和消息，可被 `git describe` 识别。

## Phase 5: 推送 tag

```bash
git push origin "$TAG"
```

push 失败 → 报告原因；本地 tag **保留**（用户可后续手动重推或 `git tag -d` 撤销）。

**常见 push 失败原因 + 修复**：

| 现象 | 可能原因 | 修复 |
|------|---------|------|
| `! [rejected] tag-name -> tag-name (already exists)` | 远程已有同名 tag（被他人或他设备先推） | `git fetch --tags` 看远程 tag 内容；要么换 tag 名，要么 `git push --delete origin <tag>` 后重推（破坏性，慎用） |
| `Could not resolve host: github.com` | 网络问题 | 检查网络后 `git push origin <tag>` 单独重推 |
| `Permission denied (publickey)` | SSH key 失效或无权限 | 检查 `ssh -T git@github.com` |
| `error: src refspec <tag> does not match any` | 本地 tag 没创建成功 | 重新执行本命令，或 `git tag -l` 验证本地 tag 存在 |

## Phase 6: 报告

输出统一格式：

```
=== /tag 报告 ===

Tag:        <tag>
指向:       <short-hash>
Subject:    <commit subject>
推送:       origin/<tag> ← <short-hash>
Release:    https://github.com/<owner>/<repo>/releases/tag/<tag>
浏览历史:   /goto <tag>
```
