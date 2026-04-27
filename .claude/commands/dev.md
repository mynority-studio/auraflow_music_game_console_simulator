---
description: 启动前端开发服务器（自动处理依赖+端口冲突，后台运行）
argument-hint: ""
allowed-tools: ["Bash"]
---

启动 AuraFlow 前端开发服务器。完整流程包括依赖检查、端口清理、后台挂起。

## Step 1: 依赖检查（pnpm）

比较 `package.json` 与 `node_modules/.modules.yaml`（pnpm 安装标记文件）的修改时间，判断是否需要 `pnpm install`：

```bash
if [ ! -d node_modules ] || [ ! -f node_modules/.modules.yaml ]; then
  echo "node_modules 缺失或非 pnpm 安装，执行 pnpm install"
  pnpm install
elif [ package.json -nt node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  echo "package.json 或 pnpm-lock.yaml 较新，执行 pnpm install"
  pnpm install
else
  echo "依赖已是最新，跳过 pnpm install"
fi
```

> 注：本仓库统一使用 **pnpm** 作为包管理器（与 `pnpm-lock.yaml` 一致）。若 pnpm 未安装，提示用户 `npm i -g pnpm` 后重试。

## Step 2: 端口管理

检查 3000 端口（Vite 配置端口）是否被占用，占用则强制释放：

```bash
PIDS=$(lsof -ti :3000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "端口 3000 被占用 (PID: $PIDS)，正在释放..."
  kill -9 $PIDS
  sleep 1
fi
```

## Step 3: 后台挂起

用 `nohup` 启动 dev 服务器（pnpm），日志重定向到 `/tmp/auraflow-dev.log`：

```bash
nohup pnpm run dev > /tmp/auraflow-dev.log 2>&1 &
DEV_PID=$!
echo "Dev server started: PID=$DEV_PID"
```

## Step 4: 健康检查 + 地址解析

本项目通过 `@vitejs/plugin-basic-ssl` 自签证书启动 **HTTPS**（非 HTTP），健康检查需用 `https://` + `-k` 跳过证书校验。Vite 首次启动若遇 lockfile 变化会触发依赖再优化，等待时间需放宽到 5 秒；并用重试循环兜底慢启动：

```bash
# 重试 6 次 × 1s 间隔，最多等 6 秒
READY=0
for i in 1 2 3 4 5 6; do
  sleep 1
  if curl -skf -o /dev/null https://localhost:3000 2>/dev/null \
     || curl -sf -o /dev/null http://localhost:3000 2>/dev/null; then
    READY=1
    break
  fi
done

if [ "$READY" -eq 0 ]; then
  echo "✗ 启动失败（6 秒未就绪），最近日志："
  tail -40 /tmp/auraflow-dev.log
  exit 1
fi
```

提取 Vite 输出的 **所有** Local + Network 行（Vite 6 会列出 Wi-Fi、Tailscale、虚拟网卡等多个接口）：

```bash
# strip ANSI 颜色码后提取 ➜ Local/Network 行
URLS=$(sed -E 's/\x1b\[[0-9;]*m//g' /tmp/auraflow-dev.log \
       | grep -E '(Local|Network):' \
       | sed 's/^[[:space:]]*//; s/➜[[:space:]]*//')

# 兜底：日志解析不到 Network → 用 ipconfig/hostname 自算 LAN IP（可能用错协议）
if [ -z "$(echo "$URLS" | grep Network)" ]; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$LAN_IP" ] && URLS="$URLS"$'\n'"Network: <unknown-protocol>://${LAN_IP}:3000/"
fi

echo "$URLS"
```

> Vite 启动 `--host=0.0.0.0` 时会暴露所有局域网接口，本项目因含 `basic-ssl` 插件输出形如：
> ```
> ➜  Local:   https://localhost:3000/
> ➜  Network: https://192.168.1.5:3000/
> ➜  Network: https://100.x.x.x:3000/    ← Tailscale
> ➜  Network: https://198.18.0.1:3000/   ← 虚拟网卡
> ```
>
> **注意**：基于自签证书，浏览器首次访问会有"证书不受信任"警告，点 Advanced → Proceed 即可。

## Step 5: 报告

向用户输出：
- **Dev server PID**: `$DEV_PID`
- **Local**: 本机访问地址（通常是 `https://localhost:3000/`）
- **Network**（多个）：局域网/Tailscale 等所有接口地址 — 列出 Vite 输出的全部行；优先选 `192.168.*` 或 `10.*` 给手机扫码
- **日志路径**: `/tmp/auraflow-dev.log`
- **停止方式**: `kill $DEV_PID` 或 `lsof -ti :3000 | xargs kill -9`

**注意**：本命令不会等待用户停止 dev server，启动完成后立即返回。
