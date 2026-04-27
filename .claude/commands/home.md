---
description: 快速回到主分支（main）— 配合 /goto 使用，处理 detached HEAD 退出与脏工作树
argument-hint: ""
allowed-tools: ["Bash", "AskUserQuestion"]
---

从任意位置（detached HEAD / feature 分支 / 已在主分支）安全地回到主分支。
是 `/goto` 的伴侣命令：

```
/goto v20260408-211722   →  detached HEAD（看历史）
/home                    →  回到 main
```

---

## Phase 1: 自检测主分支 + 当前位置

```bash
# 自检测项目主分支（origin/HEAD 指向的分支），fallback main
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
DEFAULT_BRANCH=${DEFAULT_BRANCH:-main}

CURRENT_BRANCH=$(git branch --show-current)
```

**1.1 已在主分支 → 不切，仅报告同步状态后退出**

```bash
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
  echo "✓ 已在 $DEFAULT_BRANCH 分支"
  # 跳到 Phase 4 报告（仅展示远程同步状态）
fi
```

**1.2 在其他分支（不是 detached HEAD，也不是主分支）→ 询问确认**

```bash
if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]; then
  echo "⚠️  当前在分支 $CURRENT_BRANCH（不是 detached HEAD）"
  echo "   /home 默认配合 /goto 使用，从历史浏览状态回到主分支"
fi
```

→ 用 **AskUserQuestion** 询问：
- "切到 $DEFAULT_BRANCH（保留 $CURRENT_BRANCH 分支引用）"
- "取消（保持在 $CURRENT_BRANCH）"

用户选取消 → 直接退出。

**1.3 在 detached HEAD（最常见场景）→ 走 Phase 2-4**

无需特殊处理，正常进入下一步。

---

## Phase 2: 工作树状态处理

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  当前工作树有未提交修改"
  git status --short
fi
```

**仅当工作树脏**时，用 **AskUserQuestion** 询问：

| 选项 | 行为 |
|------|------|
| **stash 暂存（推荐）** | `git stash push -u -m "auto-stash before /home $(date +%Y%m%d-%H%M%S)"`；切到主分支后**仅提示** `git stash list / pop`，不自动 pop（detach 时的修改回到主分支后语义可能不同） |
| **丢弃所有修改（不可逆）** | 二次确认后执行 `git restore .` + `git clean -fd`；不可恢复 |
| **取消** | 不切分支，原地退出 |

> 设计原因：自动 pop stash 等于把"detach 时的临时改动"覆盖到主分支当前状态，可能引入意外。让用户回到主分支后再判断要不要 pop 更稳妥。

---

## Phase 3: 切回主分支

```bash
# 捕获 git 关于 orphan commits 的警告（在 detached HEAD 期间 commit 过的内容）
CHECKOUT_OUTPUT=$(git checkout "$DEFAULT_BRANCH" 2>&1)
echo "$CHECKOUT_OUTPUT"

# 检测 orphan commit 警告
if echo "$CHECKOUT_OUTPUT" | grep -q "leaving.*commit.*behind"; then
  echo ""
  echo "⚠️  检测到孤儿 commit（在 detached HEAD 期间提交但未保留到任何分支）"
  echo "   git 会在约 90 天后通过 GC 清理这些 commit"
  echo "   如需保留，立即执行：git branch <新分支名> <孤儿 hash>"
  echo "   查看孤儿 commit：git reflog（前几行）"
fi
```

---

## Phase 4: 报告 + 同步状态

```bash
echo ""
echo "=== 当前状态 ==="
echo "分支:    $DEFAULT_BRANCH"
echo "Commit:  $(git rev-parse --short HEAD)  $(git log -1 --pretty=%s)"

# 远程同步状态
git fetch origin "$DEFAULT_BRANCH" 2>/dev/null
LOCAL_AHEAD=$(git rev-list --count "origin/$DEFAULT_BRANCH..HEAD" 2>/dev/null || echo "0")
REMOTE_AHEAD=$(git rev-list --count "HEAD..origin/$DEFAULT_BRANCH" 2>/dev/null || echo "0")

echo ""
echo "=== 与 origin/$DEFAULT_BRANCH 的关系 ==="
if [ "$LOCAL_AHEAD" -eq 0 ] && [ "$REMOTE_AHEAD" -eq 0 ]; then
  echo "✓ 与远程完全同步"
elif [ "$REMOTE_AHEAD" -gt 0 ]; then
  echo "⚠️  远程领先 $REMOTE_AHEAD 个 commit，建议执行：git pull origin $DEFAULT_BRANCH"
fi
[ "$LOCAL_AHEAD" -gt 0 ] && echo "本地领先 $LOCAL_AHEAD 个 commit（可用 /save 推送）"

# 如果之前 stash 过
if [ -n "$STASHED" ]; then
  echo ""
  echo "=== 注意：之前 stash 的修改尚未 pop ==="
  echo "  查看：git stash list"
  echo "  恢复：git stash pop（确认上下文相关后再 pop，可能与主分支当前状态冲突）"
fi
```

---

## 边界处理

- **不在 git 仓库** → `git rev-parse --git-dir` 失败 → 报错退出
- **主分支不存在**（极少见，如新仓库未推送）→ 报错并提示 `git branch -m <旧名> $DEFAULT_BRANCH`
- **fetch 失败**（无网络）→ 跳过同步状态展示，其他流程不受影响
