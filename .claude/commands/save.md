---
description: 敏感扫描→git add .→commit→pull(merge)→push（git flow 一条龙）
argument-hint: "[commit message]"
allowed-tools: ["Bash"]
---

完整提交流程：`git add .` → 审查 → 生成/确认 commit message → commit → pull → push。
本命令**主动 `git add .`** 暂存所有未跟踪与已修改文件，但会在 add 前后做敏感文件扫描。

## Step 1: 敏感文件预扫描（add 前）

在执行 `git add .` 之前，先扫描 working tree 中可能的敏感文件，避免它们被误暂存：

```bash
# 扫描可能漏掉 .gitignore 的敏感模式
SENSITIVE=$(git status --porcelain | awk '{print $2}' | grep -E '(\.env($|\.)|\.envrc$|credentials|\.pem$|\.key$|id_rsa|\.p12$|secrets?\.(json|yaml|yml|toml)$|\.sqlite$)' || true)
if [ -n "$SENSITIVE" ]; then
  echo "⚠️  检测到疑似敏感文件（未在 .gitignore 中）："
  echo "$SENSITIVE"
  echo ""
  echo "请确认是否继续？（y/N）"
  # 等待用户确认；任何非 y 输入 → STOP
fi
```

## Step 2: git add .

```bash
git add .
git status --short
git diff --staged --stat
```

若 `git diff --staged` 无输出（无任何变更） → 提示"无内容可提交"后退出，不创建空 commit。

## Step 3: 生成 commit message

- 若 `$ARGUMENTS` 非空 → 直接作为 commit message 使用
- 若为空 → 阅读 `git diff --staged` 内容，按 Conventional Commits 风格生成：
  - `feat:` 新功能
  - `fix:` bug 修复
  - `refactor:` 重构（行为不变）
  - `docs:` 文档
  - `test:` 测试
  - `chore:` 杂项（依赖、配置、构建）
- 主题行 ≤ 70 字符；body 解释 **why**，不重复 **what**

## Step 4: Commit

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

## Step 5: Pull (merge)

```bash
BRANCH=$(git branch --show-current)
git fetch origin "$BRANCH"

# 检测远程是否被 force-push（本地有但远程没有的 commit）
LOCAL_AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo "0")
REMOTE_AHEAD=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo "0")

if [ "$REMOTE_AHEAD" -gt "0" ]; then
  echo "远程有 $REMOTE_AHEAD 个新 commit，执行 merge..."
  git pull origin "$BRANCH"
fi
```

遇 merge 冲突 → **STOP** 并报告冲突文件，让用户手动解决（不自动 `git checkout --ours/--theirs`）。

合并产生的 merge commit 沿用 git 默认消息，不自定义。

## Step 6: Push

```bash
git push origin "$BRANCH"
```

push 失败（被拒绝 / 网络问题）→ 报告原因，不重试 force push。

## Step 7: 报告

输出：
- Commit hash + subject
- 远程仓库 compare 链接（若 remote 是 GitHub，构造 `https://github.com/<owner>/<repo>/commit/<hash>`）
- 当前分支与 origin 的同步状态
