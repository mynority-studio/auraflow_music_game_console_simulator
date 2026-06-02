<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AuraFlow Tap! — Web 音乐工作站模拟器

基于 Web 的硬件音乐工作站模拟器，将触觉交互与程序化音乐生成相结合。模拟 5x3 打击垫控制器，内嵌完整的算法音乐引擎。

**本项目是 [AuraFlow 音乐游戏机](https://github.com/mynority-studio/auraflow_music_game_console) ESP32-S3 固件的参考实现。** 算法变更先在 TS 模拟器验证，再 1:1 翻译到 C 固件。

## 运行

**前置条件:** Node.js

1. 安装依赖：`npm install`
2. 在 `.env.local` 中设置 `GEMINI_API_KEY`（参考 `.env.example`）
3. 启动开发服务器：`npm run dev`

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（端口 3000） |
| `npm run build` | 生产构建 |
| `npm run lint` | TypeScript 类型检查 |
| `npm run golden-seed` | 黄金种子测试 — 录制 PRNG 快照 + 输出摘要 |
| `npm run array-stats` | 数组最大长度统计（200 seed，C 移植 buffer 预分配依据） |

## 文档

- `CLAUDE.md` — 项目架构与开发规则
- `.claude/rules/music_generation_pipeline_rule.md` — 生成管道最高约束
- `docs/music_generation_flow.md` — 音乐生成逻辑链路流程图
- `docs/esp32_porting.md` — ESP32 移植指南与卡点决策
- `docs/todo_plan.md` — TS→C 移植计划
- `docs/framework_alignment.md` — 框架对齐状态
