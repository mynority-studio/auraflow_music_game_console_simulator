---
description: HARD reset 主分支到指定 tag（仅 main，强制本地备份，绝不推送远程）
argument-hint: "<tag>"
allowed-tools: ["Bash", "AskUserQuestion"]
---

把**主分支（main/master）**硬重置到指定 tag，作为新的开发起点。
适用于：发现某条开发线路走错了，想从历史 tag 处重新分叉，并放弃中间的所有 commit。

⚠️ **危险等级**：高 — 这是 destructive 操作，会丢弃从 tag 到当前 HEAD 之间的所有 commit。
🛡️ **安全策略**：
1. **只允许在主分支（main/master）上执行** — 非主分支直接拒绝
2. 强制创建本地备份分支（不可跳过）
3. **绝不推送任何内容到远程** — reset 与备份都仅本地，远程操作完全交给用户手动决定
4. 在 reset 前列出将被销毁的 commits 让用户最终确认

---

## Phase 0: 前置检查

```bash
git rev-parse --git-dir > /dev/null 2>&1 || { echo "✗ 不在 git 仓库"; exit 1; }
```

## Phase 1: 参数与预检

**1.1 参数解析与校验**

> ⚠️ Claude Code `$1` 占位符解析不可靠，统一用 `$ARGUMENTS`。

```bash
TAG="$ARGUMENTS"
TAG="${TAG#\"}"; TAG="${TAG%\"}"      # 去首尾双引号
TAG="${TAG#\'}"; TAG="${TAG%\'}"      # 去首尾单引号
TAG="${TAG##[[:space:]]}"             # trim 首空格
TAG="${TAG%%[[:space:]]}"             # trim 尾空格

if [ -z "$TAG" ]; then
  echo "✗ /reset-to 需要 tag 参数"
  echo "用法：/reset-to <tag>"
  echo "可用 tag："
  git tag -l --sort=-creatordate | head -10
  exit 1
fi
```

**1.2 tag 存在校验**

```bash
if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "✗ Tag $TAG 不存在"
  git tag -l --sort=-creatordate | head -10
  exit 1
fi
```

**1.3 工作树 clean 检查**

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ 工作树有未提交修改。本命令拒绝在脏工作树上执行（避免 stash 自动化掩盖危险）"
  echo "  请先：(a) /save 提交 或 (b) git stash 暂存 或 (c) git restore . 丢弃"
  exit 1
fi
```

**1.4 主分支硬检查（不在主分支直接拒绝）**

自检测项目默认主分支名（兼容 main / master），并要求当前必须在该分支：

```bash
# 自检测默认主分支（origin/HEAD 指向的分支），fallback 到 main
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
DEFAULT_BRANCH=${DEFAULT_BRANCH:-main}

CURRENT_BRANCH=$(git branch --show-current)

if [ -z "$CURRENT_BRANCH" ]; then
  echo "✗ 当前处于 detached HEAD"
  echo "   /reset-to 仅在主分支 ($DEFAULT_BRANCH) 上操作，请先 git checkout $DEFAULT_BRANCH"
  exit 1
fi

if [ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]; then
  echo "✗ 当前分支为 $CURRENT_BRANCH，/reset-to 只在主分支 ($DEFAULT_BRANCH) 上操作"
  echo "   设计原因：reset 主分支是高敏感操作，硬绑主分支防止误用到 feature 分支"
  echo "   解决：先 git checkout $DEFAULT_BRANCH，再执行本命令"
  exit 1
fi

# 此后变量统一用 BRANCH = $DEFAULT_BRANCH（已确认当前分支等于主分支）
BRANCH="$DEFAULT_BRANCH"
```

**1.5 位置关系检查**

```bash
TAG_COMMIT=$(git rev-parse "$TAG")
HEAD_COMMIT=$(git rev-parse HEAD)

if [ "$TAG_COMMIT" = "$HEAD_COMMIT" ]; then
  echo "✓ HEAD 已经在 $TAG，无需 reset。退出。"
  exit 0
fi

# 检查 tag 是否是 HEAD 的祖先（正常 reset 场景）
if ! git merge-base --is-ancestor "$TAG_COMMIT" HEAD; then
  echo "⚠️ Tag $TAG 不是 HEAD 的祖先 — 你想 reset 到一个更新或分叉的位置"
  echo "   这通常不是 reset 的正常用途；如果是 sync 远程，用 git pull/fetch 更合适"
  echo "   仍要继续？请用 AskUserQuestion 确认"
fi
```

**1.6 push 行为声明**

```
本命令绝不向远程推送任何内容：
✗ 不 push 重置后的 $BRANCH
✗ 不 push 备份分支（备份仅在本地保留）

reset 完成后，本地与 origin/$BRANCH 将分叉。是否 push、何时 push、用什么策略 push，
完全由你手动决定。命令仅在最终报告中打印推送命令文本供你复制参考，不会替你执行。

⚠️ 备份仅本地的代价：如果本地仓库损坏（硬盘故障、误删 .git 目录），备份分支会一起丢失。
   如需远程备份，reset 完成后手动执行：git push origin <备份分支名>
```

---

## Phase 2: 影响展示（最后反悔机会）

列出将被销毁的 commits，让用户看清放弃了什么：

```bash
LOST_COUNT=$(git rev-list --count "$TAG..HEAD")
echo ""
echo "=== 将被销毁的 commits ($LOST_COUNT 个) ==="
git log --oneline --no-decorate "$TAG..HEAD"
echo ""
echo "=== 影响范围（文件改动统计）==="
git diff --stat "$TAG..HEAD" | tail -1
```

如果 LOST_COUNT > 20 → 额外警告"丢弃量较大，请仔细复核"。

---

## Phase 3: 强制本地备份（不可跳过，仅本地）

**3.1 生成备份分支名**

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_BRANCH="backup/${BRANCH}-pre-reset-${TS}"
```

**3.2 创建本地备份分支（指向当前 HEAD）**

```bash
git branch "$BACKUP_BRANCH" HEAD
echo "✓ 本地备份: $BACKUP_BRANCH → $(git rev-parse --short HEAD)"
echo "  （远程未同步 — 这是命令的安全策略，避免在 reset 主分支前先污染远程）"
```

**绝不**自动 push 备份到远程。用户如果想让备份也到远程，reset 完成后自行执行 `git push origin "$BACKUP_BRANCH"` 即可（这是单纯 ADD 新分支，不涉及 force）。

---

## Phase 4: 用户裁决

用 **AskUserQuestion** 弹最终确认：

```
question: "确认 HARD reset $BRANCH → $TAG？将销毁 $LOST_COUNT 个 commit"
options:
  - label: "确认重置（仅本地）"
    description: "执行 git reset --hard。备份分支 $BACKUP_BRANCH 已创建，可随时恢复"
  - label: "取消"
    description: "什么都不做。备份分支保留供后续使用，可手动 git branch -d $BACKUP_BRANCH 删除"
```

用户选「取消」→ 报告备份分支位置后退出（**不**删除已创建的备份，万一用户改主意）。

---

## Phase 5: 执行 reset

仅在用户明确确认后执行：

```bash
OLD_HEAD=$(git rev-parse HEAD)
git reset --hard "$TAG"
NEW_HEAD=$(git rev-parse HEAD)

echo "✓ Reset 完成：$BRANCH"
echo "  Before: $(git rev-parse --short $OLD_HEAD)"
echo "  After:  $(git rev-parse --short $NEW_HEAD) ($TAG)"
```

**禁止**附加 `git push --force` / `--force-with-lease` 调用。push 完全交给用户。

---

## Phase 6: 报告 + 恢复指南

输出完整的人类可读总结：

```
=== /reset-to 执行报告 ===

分支:       $BRANCH
旧 HEAD:    $OLD_HEAD ($(git log -1 --pretty=%s $OLD_HEAD))
新 HEAD:    $NEW_HEAD ($TAG)
丢弃 commits: $LOST_COUNT 个

备份:
  本地分支:  $BACKUP_BRANCH（仅本地，未推送远程）

远程状态:
  origin/$BRANCH 仍指向旧 HEAD ($OLD_HEAD)
  本地 $BRANCH    现在指向 $TAG ($NEW_HEAD)
  → 本地与远程已分叉

=== 下一步：完全由你决定 ===

如果想让远程也对齐到 reset 后的状态（force-push 到远程主分支）：

  git push --force-with-lease origin $BRANCH

⚠️  --force-with-lease 比 --force 更安全：如果远程在你最后 fetch 之后又有新 commit，push 会被拒绝。
⚠️  push 之后协作者必须执行 `git fetch && git reset --hard origin/$BRANCH` 同步本地，否则他们的 push 会冲突。
⚠️  如果只想本地探索，**不 push 也完全可行** — 命令不强求你 push。

如果想让备份分支也到远程（推荐，作为额外保险）：

  git push origin $BACKUP_BRANCH

=== 万一搞错了，怎么恢复 ===

  # 方案 A：把主分支恢复到 reset 前的状态
  git reset --hard $BACKUP_BRANCH

  # 方案 B：把备份分支重命名为主分支（更彻底）
  git branch -M $BRANCH ${BRANCH}-discarded
  git branch -M $BACKUP_BRANCH $BRANCH

  # 方案 C：从 reflog 恢复（即使备份被误删也能找回，72 小时内）
  git reflog                          # 找到 reset 前的 HEAD hash
  git reset --hard <旧 HEAD hash>

=== 清理（仅在确认一切正常后，至少 1-2 周后）===

  git branch -D $BACKUP_BRANCH        # 删本地
  # 如果之前 push 过远程备份，再删远程：
  git push origin --delete $BACKUP_BRANCH
```

**绝不**在报告里建议立即删除备份分支 — 留着至少几天作为安全网。
