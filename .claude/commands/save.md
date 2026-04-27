---
description: 敏感扫描→git add .→commit→pull(merge)→push（git flow 一条龙）
argument-hint: "[commit message]"
allowed-tools: ["Bash"]
---

完整提交流程：`git add .` → 审查 → 生成/确认 commit message → commit → pull → push。
本命令**主动 `git add .`** 暂存所有未跟踪与已修改文件，但会在 add 前后做敏感文件扫描。

> ⚠️ Claude Code `$1` `$2` 占位符解析不可靠，统一用 `$ARGUMENTS`。

## Phase 0: 前置检查

```bash
git rev-parse --git-dir > /dev/null 2>&1 || { echo "✗ 不在 git 仓库"; exit 1; }
```

## Phase 1: 敏感文件预扫描（add 前）

在执行 `git add .` 之前，先扫描 working tree 中可能的敏感文件，避免它们被误暂存：

```bash
# 扫描可能漏掉 .gitignore 的敏感模式
SENSITIVE=$(git status --porcelain | awk '{print $2}' | grep -E '(\.env($|\.)|\.envrc$|credentials|\.pem$|\.key$|id_rsa|\.p12$|secrets?\.(json|yaml|yml|toml)$|\.sqlite$)' || true)
if [ -n "$SENSITIVE" ]; then
  echo "⚠️  检测到疑似敏感文件（未在 .gitignore 中）："
  echo "$SENSITIVE"
  exit 1   # ← bash 退出，由 AI 用 AskUserQuestion 询问后再继续
fi
```

> **关键**：上面 bash 的 `echo "请确认（y/N）"` 这种伪交互在 AI 执行环境**不会暂停**。
> 若 SENSITIVE 非空 → bash exit → AI **必须用 AskUserQuestion 工具**弹出两选项：
> - "继续提交（已确认是公开材料）"
> - "取消（先把敏感文件加到 .gitignore）"
>
> 仅当用户明确选"继续提交"才进入 Phase 2。

## Phase 2: git add .

```bash
git add .
git status --short
git diff --staged --stat
```

若 `git diff --staged` 无输出（无任何变更） → 提示"无内容可提交"后退出，不创建空 commit。

## Phase 3: 生成 commit message

- 若 `$ARGUMENTS` 非空 → 直接作为 commit message 使用
- 若为空 → 阅读 `git diff --staged` 内容，按 Conventional Commits 风格生成：
  - `feat:` 新功能
  - `fix:` bug 修复
  - `refactor:` 重构（行为不变）
  - `docs:` 文档
  - `test:` 测试
  - `chore:` 杂项（依赖、配置、构建）
- 主题行 ≤ 70 字符；body 解释 **why**，不重复 **what**

## Phase 4: Commit

使用 HEREDOC 保证消息格式正确，附加 Co-Authored-By：

```bash
git commit -m "$(cat <<'EOF'
<subject>

<body>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**安全约束**：禁止 `--no-verify` / `--amend` / `--force`。pre-commit hook 失败时**修复并新建 commit**，不要 amend。

## Phase 5: Pull (merge) + force-push 探测

```bash
BRANCH=$(git branch --show-current)

# fetch 前先记录旧的 remote tip（可能为空 — 新建分支首次推送时）
OLD_REMOTE=$(git rev-parse --quiet --verify "origin/$BRANCH" 2>/dev/null || echo "")
git fetch origin "$BRANCH"
NEW_REMOTE=$(git rev-parse --quiet --verify "origin/$BRANCH" 2>/dev/null || echo "")

# 真 force-push 判定：远程 hash 变了，且新 hash 不是旧 hash 的子节点
# （单纯 push 新 commit 时，新 = 旧的子节点，--is-ancestor 为真）
if [ -n "$OLD_REMOTE" ] && [ -n "$NEW_REMOTE" ] && [ "$OLD_REMOTE" != "$NEW_REMOTE" ]; then
  if ! git merge-base --is-ancestor "$OLD_REMOTE" "$NEW_REMOTE" 2>/dev/null; then
    echo "⚠️  远程历史被改写（疑似 force-push）"
    echo "    旧 remote: $(git rev-parse --short $OLD_REMOTE)"
    echo "    新 remote: $(git rev-parse --short $NEW_REMOTE)"
    exit 1   # ← bash 退出，由 AI 用 AskUserQuestion 询问用户如何处理
  fi
fi

REMOTE_AHEAD=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo "0")
if [ "$REMOTE_AHEAD" -gt "0" ]; then
  echo "远程有 $REMOTE_AHEAD 个新 commit，执行 merge..."
  git pull origin "$BRANCH"
fi
```

> **force-push 处理**：bash exit 后 AI 必须用 AskUserQuestion 弹三选项：
> - "中止保护本地工作（推荐）" — 不 pull、不 push，让用户手动决定（如 `git fetch && git reset --hard origin/<branch>` 或新建分支保留本地）
> - "用 git pull 强制同步远程（会自动 merge 或冲突）" — 若用户确认远程 force-push 合理
> - "继续 push（极少数场景：你就是想覆盖远程）" — 极危险，仅用户明确知道时
>
> 默认不要替用户做选择。

遇 merge 冲突 → **STOP** 并报告冲突文件，让用户手动解决（不自动 `git checkout --ours/--theirs`）。
合并产生的 merge commit 沿用 git 默认消息，不自定义。

## Phase 6: Push

```bash
git push origin "$BRANCH"
```

push 失败（被拒绝 / 网络问题）→ 报告原因，不重试 force push。

## Phase 7: 报告

输出统一格式：

```
=== /save 报告 ===

Commit:  <short-hash> <subject>
变更:    <file count> 个文件，+X / -Y 行
分支:    <branch>
推送:    origin/<branch> ← <short-hash>
同步:    ✓ 与 origin 完全同步
链接:    https://github.com/<owner>/<repo>/commit/<full-hash>
```
