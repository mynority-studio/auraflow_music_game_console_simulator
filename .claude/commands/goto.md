---
description: 切到指定 tag（用于溯源/对比历史版本，不修改任何分支）
argument-hint: "[tag]"
allowed-tools: ["Bash"]
---

进入指定 tag 的 detached HEAD 状态，用于浏览历史版本或对比代码。
**不会修改任何分支** — 不做 reset/branch 移动，仅 checkout 到 tag commit。

## Phase 0: 前置检查

```bash
git rev-parse --git-dir > /dev/null 2>&1 || { echo "✗ 不在 git 仓库"; exit 1; }
```

## Phase 1: 参数处理

### 无参数 → 列出最近 20 个 tag

```bash
git tag -l --sort=-creatordate | head -20
```

输出格式（每行附 commit hash 与日期）：
```bash
git for-each-ref --sort=-creatordate --format='%(refname:short)  %(objectname:short)  %(creatordate:short)  %(subject)' refs/tags | head -20
```

让用户从列表中挑一个，再次调用 `/goto <tag>`。

### 有参数 → 校验 + checkout

> ⚠️ Claude Code `$1` 占位符解析不可靠，统一用 `$ARGUMENTS`。Phase 开头先 trim 引号与首尾空格：
>
> ```bash
> TAG="$ARGUMENTS"
> TAG="${TAG#\"}"; TAG="${TAG%\"}"
> TAG="${TAG#\'}"; TAG="${TAG%\'}"
> # trim 首尾空格
> TAG="${TAG##[[:space:]]}"
> TAG="${TAG%%[[:space:]]}"
> ```

```bash
if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "✗ Tag $TAG 不存在"
  echo "可用 tag："
  git tag -l --sort=-creatordate | head -10
  exit 1
fi
```

## Phase 2: 工作树状态检查

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ 工作树有未提交修改，checkout 会丢失修改"
  echo "  请先 /save 提交或 git stash 暂存"
  git status --short
  exit 1
fi
```

## Phase 3: 提示 detached HEAD

明确告知用户接下来进入 detached HEAD 状态，**修改不会保存到任何分支**：

```
⚠️  即将切换到 tag $TAG（detached HEAD 模式）
   - 这是浏览历史的只读模式，不修改 main 分支
   - 任何修改不属于任何分支，需要新建分支才能保留
   - 浏览完毕用 git checkout main 回到主分支
```

## Phase 4: 执行 checkout

```bash
git checkout "$TAG"
```

## Phase 5: 报告

输出统一格式：

```
=== /goto 报告 ===

Tag:        <tag>
Commit:     <short-hash> <subject>
Date:       <commit date>
与 main:    main 领先 <N> 个 commit
退出:       git switch -        ← 回到刚才所在分支（最快）
            git checkout main   ← 显式切回 main
            /home               ← 走完整安全检查（脏工作树 / 孤儿 commit 处理）
```

**不要**自动建议 `git reset --hard <tag>`（破坏性操作，需用户主动决定，使用 `/reset-to`）。
