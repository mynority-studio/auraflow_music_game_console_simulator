---
name: Frontend Dev Server Startup Workflow
description: 启动前端 dev server（后台运行）的标准流程：检查依赖 → 清理端口 → nohup 后台启动
type: feedback
originSessionId: 26c11e11-430e-4171-8cb3-1d0f4204907c
---
在本项目中启动前端 dev server（需要后台运行时），按以下顺序执行：

1. **检查依赖**：若 `package.json` 有新增包，先执行 `npm install`
2. **清理端口**：若目标端口（默认 3000，Vite）被占用，先 `kill` 掉占用进程
3. **后台启动**：`nohup npm run dev &`（使用 Bash 工具的 `run_in_background: true` 参数等价实现）

**Why:** 用户明确要求这个流程。跳过依赖检查会遇到模块缺失；不清理端口会导致 Vite 自动跳到下一个端口造成混乱；前台启动会阻塞会话。

**How to apply:** 当用户要求"启动前端"、"跑 dev server"、"npm run dev"、"启动模拟器"等类似指令且需要后台运行时，严格按 1→2→3 顺序执行。前台一次性启动（如只为快速验证构建）不适用本流程。
