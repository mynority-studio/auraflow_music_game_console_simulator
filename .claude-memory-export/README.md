# Claude Code Memory 迁移指南

## 这是什么

Claude Code 的 memory 系统是**文件级持久化记忆**，存储在 `~/.claude/projects/<project-path>/memory/` 目录下。每次对话时 Claude 会自动读取这些记忆，了解用户偏好、项目状态、历史决策等上下文。

当你换设备时，这些记忆文件**不会**跟随 git 仓库迁移（因为它们存在用户 home 目录下，不在工程里）。所以需要手动导出到工程目录，再在新设备上恢复。

## 文件清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `MEMORY.md` | 索引 | 所有记忆文件的一行摘要索引 |
| `project_v35_richidioms_status.md` | project | **🌟 核心交接文档**：V3.5 完整项目状态、架构变更、已修 bug、待办清单 |
| `project_core_engine_stable.md` | project | 核心引擎稳定状态（2026-04-08 起进入增强阶段） |
| `feedback_melody_sound_preferences.md` | feedback | 主旋律只用键盘/敲击类；禁吹奏/弦乐；Plucked 上限 G5 |
| `feedback_idiom_not_style_bound.md` | feedback | Idiom 按需求评分选择，不强绑 subgenre；华彩借调 30% |
| `feedback_melody_blackbox_diagnosis.md` | feedback | 旋律"黑盒"根因 + Luis 4 建议 + 已实施/待做方向 |
| `feedback_mixing_bass_low_freq.md` | feedback | AudioMixer 低频补偿经验（lowShelf/peaking/reverb） |
| `feedback_core_engine_purity.md` | feedback | 核心引擎只做纯音乐计算，风格/idiom 分离后叠加 |
| `feedback_engine_vs_style_layer.md` | feedback | 引擎=能力层，style=调性层；听感无聊先查 style 配置 |
| `feedback_pitch_space_contract.md` | feedback | 生成管道双空间契约（相对/绝对，applyOffset 唯一转换点） |
| `feedback_frontend_dev_startup.md` | feedback | 后台启动前端的标准流程 |

## 新设备恢复步骤

### 方式一：自动路径（推荐）

```bash
# 1. 先 clone 仓库到新设备
git clone <repo-url>
cd auraflow_music_game_console_simulator

# 2. 用 Claude Code 打开项目，让它自动创建 project memory 目录
# （首次运行 claude 命令时会自动创建）
claude

# 3. 退出后手动复制 memory 文件
PROJECT_PATH=$(pwd | tr '/' '-' | sed 's/^-//')
mkdir -p ~/.claude/projects/$PROJECT_PATH/memory
cp .claude-memory-export/*.md ~/.claude/projects/$PROJECT_PATH/memory/

# 4. 验证
ls ~/.claude/projects/$PROJECT_PATH/memory/
```

### 方式二：手动指定路径

```bash
# 如果自动路径不对（不同 OS 的路径分隔符可能不同），
# 先找到 Claude Code 实际使用的 project path：
ls ~/.claude/projects/

# 找到对应本项目的目录名（通常是完整路径用 - 连接），然后：
cp .claude-memory-export/*.md ~/.claude/projects/<找到的目录名>/memory/
```

### 验证恢复成功

在新设备上启动 Claude Code，输入：

```
你还记得这个项目的当前版本和待办事项吗？
```

如果 Claude 能回答出 "V3.5 RichIdioms" 和待办清单，说明恢复成功。

## 注意事项

- Memory 文件是**时间快照**，不是实时状态。代码变更后记忆可能过时，Claude 会在读取时自动验证
- `MEMORY.md` 是索引文件，Claude 每次对话都会加载它来决定读哪些具体记忆
- 不要删除 `MEMORY.md`，否则 Claude 找不到其他记忆文件
- 如果需要更新记忆，直接编辑对应的 `.md` 文件即可，或让 Claude 帮你更新
