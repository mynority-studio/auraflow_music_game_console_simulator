---
description: 给当前 HEAD 打 annotated tag 并推送（feat 里程碑）
argument-hint: "<version> <description>"
allowed-tools: ["Bash"]
---

为当前 HEAD 创建 annotated tag 作为里程碑，并推送到远程。
适用于完成一个重要 **feat 功能** 后建立可追溯的版本节点。

## Step 1: 参数解析

- `$1` = 版本号
- `$2`+ = 描述（剩余所有 token 作为描述拼接）

若任一为空 → STOP，提示用法：
```
/tag v20260427-141500 "ConductorPlan 初版完成"
/tag v1.2.0 "fix 旋律黑盒+混音补偿"
```

**版本号格式校验**（推荐风格）：
- 语义化：`^v?\d+\.\d+\.\d+(-[a-z0-9]+)?$` 例 `v1.2.3`、`v1.2.3-rc1`
- 时间戳：`^v\d{8}-\d{6}$` 例 `v20260427-141500`
- 项目历史 tag：`AuraFlowV3.5`、`v20260408-211722`

不强制阻止其他格式，但提醒用户。

## Step 2: 工作树状态检查

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ 工作树有未提交修改，请先 /save 或 stash"
  git status --short
  exit 1
fi
```

## Step 3: tag 重名检查

```bash
if git rev-parse --verify "refs/tags/$1" >/dev/null 2>&1; then
  echo "✗ Tag $1 已存在，commit: $(git rev-parse $1)"
  echo "  如需替换，请先：git tag -d $1 && git push --delete origin $1"
  exit 1
fi
```

## Step 4: 创建 annotated tag

```bash
git tag -a "$1" -m "$2"
```

annotated（`-a`）而非 lightweight tag — 保留 tagger 信息和消息，可被 `git describe` 识别。

## Step 5: 推送 tag

```bash
git push origin "$1"
```

push 失败 → 报告原因；本地 tag **保留**（用户可后续手动重推或 `git tag -d` 撤销）。

## Step 6: 报告

输出：
- Tag 名 + 指向的 commit hash + commit subject
- GitHub release 链接（若 remote 是 GitHub）：`https://github.com/<owner>/<repo>/releases/tag/<tag>`
- 提示：可用 `/goto <tag>` 切换到该 tag 浏览历史
