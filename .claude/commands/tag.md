---
description: 给当前 HEAD 打 annotated tag 并推送（feat 里程碑）
argument-hint: "<version> <description>"
allowed-tools: ["Bash"]
---

为当前 HEAD 创建 annotated tag 作为里程碑，并推送到远程。
适用于完成一个重要 **feat 功能** 后建立可追溯的版本节点。

## Step 1: 参数解析

> ⚠️ Claude Code 当前对 `$1` `$2` 位置参数解析不可靠（实测会把第二个引号包裹的 token 错配给 `$1`，且 `$2` 替换为空）。本命令统一从 `$ARGUMENTS` 自行解析，**不要使用 `$1` `$2`**。

从 `$ARGUMENTS` 解析两个值：
- `TAG`：第一个空格之前的部分（版本号）
- `MSG`：第一个空格之后的所有内容（去掉首尾引号）

bash 解析片段：

```bash
ARGS="$ARGUMENTS"
TAG="${ARGS%% *}"
MSG="${ARGS#* }"
[ "$MSG" = "$ARGS" ] && MSG=""        # ARGS 无空格 → MSG 为空
MSG="${MSG#\"}"; MSG="${MSG%\"}"      # 去首尾双引号
MSG="${MSG#\'}"; MSG="${MSG%\'}"      # 去首尾单引号
```

| `$ARGUMENTS` 示例 | `TAG` | `MSG` |
|------------------|-------|-------|
| `AuraFlowCmdSys-v1 "命令系统 v1.0 完成"` | `AuraFlowCmdSys-v1` | `命令系统 v1.0 完成` |
| `v1.2.0 fix 旋律黑盒` | `v1.2.0` | `fix 旋律黑盒` |
| `v1.2.0` | `v1.2.0` | `` (空) |

`TAG` 或 `MSG` 任一为空 → STOP，提示用法：

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
if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "✗ Tag $TAG 已存在，commit: $(git rev-parse $TAG)"
  echo "  如需替换，请先：git tag -d $TAG && git push --delete origin $TAG"
  exit 1
fi
```

## Step 4: 创建 annotated tag

```bash
git tag -a "$TAG" -m "$MSG"
```

annotated（`-a`）而非 lightweight tag — 保留 tagger 信息和消息，可被 `git describe` 识别。

## Step 5: 推送 tag

```bash
git push origin "$TAG"
```

push 失败 → 报告原因；本地 tag **保留**（用户可后续手动重推或 `git tag -d` 撤销）。

## Step 6: 报告

输出：
- Tag 名 + 指向的 commit hash + commit subject
- GitHub release 链接（若 remote 是 GitHub）：`https://github.com/<owner>/<repo>/releases/tag/<tag>`
- 提示：可用 `/goto <tag>` 切换到该 tag 浏览历史
