---
description: 切到指定 tag（用于溯源/对比历史版本，不修改任何分支）
argument-hint: "[tag]"
allowed-tools: ["Bash"]
---

进入指定 tag 的 detached HEAD 状态，用于浏览历史版本或对比代码。
**不会修改任何分支** — 不做 reset/branch 移动，仅 checkout 到 tag commit。

## Step 1: 参数处理

### 无参数 → 列出最近 20 个 tag

```bash
git tag -l --sort=-creatordate | head -20
```

输出格式（每行附 commit hash 与日期）：
```bash
git for-each-ref --sort=-creatordate --format='%(refname:short)  %(objectname:short)  %(creatordate:short)  %(subject)' refs/tags | head -20
```

让用户从列表中挑一个，再次调用 `/rewind <tag>`。

### 有参数 → 校验 + checkout

```bash
if ! git rev-parse --verify "refs/tags/$1" >/dev/null 2>&1; then
  echo "✗ Tag $1 不存在"
  echo "可用 tag："
  git tag -l --sort=-creatordate | head -10
  exit 1
fi
```

## Step 2: 工作树状态检查

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ 工作树有未提交修改，checkout 会丢失修改"
  echo "  请先 /save 提交或 git stash 暂存"
  git status --short
  exit 1
fi
```

## Step 3: 提示 detached HEAD

明确告知用户接下来进入 detached HEAD 状态，**修改不会保存到任何分支**：

```
⚠️  即将切换到 tag $1（detached HEAD 模式）
   - 这是浏览历史的只读模式，不修改 main 分支
   - 任何修改不属于任何分支，需要新建分支才能保留
   - 浏览完毕用 git checkout main 回到主分支
```

## Step 4: 执行 checkout

```bash
git checkout "$1"
```

## Step 5: 报告

输出：
- 当前 detached HEAD 指向的 commit（hash + subject + date）
- 与 main 的差距：`git rev-list --count $1..main` commits behind
- 退出方式：`git checkout main`
- **不要**自动建议 `git reset --hard <tag>`（破坏性操作，需用户主动决定）
