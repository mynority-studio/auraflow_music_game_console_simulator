# Q+N 主引擎接管二阶段收口指令

> 执行对象：Claude / 自动化开发代理  
> 目标：把 Q+N 沙盒面板中的 seed 随机生成入口迁入正式“音乐生成”主面板；清理旧引擎音乐生成遗留；保留主链路 Band Selection，但语义改为“选择参与乐手/职能”，不允许用户选择 GM 乐器音色。音色必须继续由 Q+N 器配层按 style/seed/音色世界规则随机选择。

## 0. 本指令覆盖旧任务单的部分内容

本指令覆盖 `docs/qn_main_engine_takeover_tasklist.md` 中关于 Band Selection “选择 GM program / gmOverrides” 的旧描述。

新的硬性规则：

- Band Selection 只能选择“什么乐手/职能参与本次编配”。
- Band Selection 不提供 GM program、乐器音色、音色家族、program override 下拉。
- Q+N 的 `InstrumentationPlan` / 器配层仍然是最终音色真源。
- 同一组乐手参与时，不同 seed/style 仍应能产生不同音色世界和随机音色。
- 旧引擎音乐生成代码不能继续影响 Q+N 主链路，也不能作为 Q+N 迁出时的依赖。

## 1. 迁出 Q+N seed / 随机生成入口

### 1.1 当前问题

`src/core/generation/newEngine/sandbox/NewEnginePanel.tsx` 仍保留：

- seed 数字输入
- 随机 seed
- 风格选择
- 生成并播放
- 重播
- MIDI 导出
- 音轨视图
- trace 日志

其中“seed / 随机 seed / 生成并播放”属于正式音乐生成主链路能力，不应被困在 Q+N sandbox panel。

### 1.2 目标

正式“音乐生成”主面板应拥有：

- seed 输入
- 随机 seed 按钮
- 生成并播放按钮
- 停止按钮
- 当前生成状态
- Q+N 生成结果摘要
- Band Selection

`NewEnginePanel` 只能保留为诊断/开发面板，不是产品主入口。

### 1.3 实施要求

- `PipelineMonitor` 或正式音乐生成主面板内保留/整理 seed 控制。
- seed 应进入 `MusicGenerationSeedStore`，再进入 `MusicGenerationService.generateMusic()`。
- 随机 seed 逻辑必须是 Q+N 主链路的一部分，不要依赖 `NewEnginePanel`。
- 如果保留 Q+N 诊断面板，它可以有自己的调试 seed，但不要作为产品入口。
- UI 显示名统一为“音乐生成”，不要把产品入口叫 `newEngine`。

## 2. 清理旧引擎音乐生成遗留

### 2.1 目标

旧引擎音乐生成代码不再参与产品路径，也不再作为 Q+N 迁出的依赖。

### 2.2 生产路径禁止依赖

以下生产路径不得 import 或调用旧生成逻辑：

- `src/App.tsx`
- `src/components/PipelineMonitor.tsx`
- `src/apps/AuraBar`
- `src/apps/AuraJam`
- `src/core/audio`
- `src/core/generation/pipeline`
- `src/core/generation/musicGeneration`
- 未来迁出的 Q+N 包 / Q+N adapter 包

禁止依赖：

- `src/core/generation/mgEngine`
- `src/state/MgStyleStore.ts`
- `src/state/MgKeyStore.ts`
- `src/state/MgSeedStore.ts`
- 旧 `BandSelectionStore` 的 mg 默认乐手语义
- 旧 `MusicianRegistry` 的 mg-only 乐手卡
- 旧 `GeneratedTrack` 作为音频事实来源

### 2.3 建议清理

- 删除或隔离 `PipelineMonitor` 中不再渲染的旧 `BandSelectionPanel`。
- 删除 `PipelineMonitor` 中旧 `BandSelectionStore`、`MusicianRegistry`、`GMSoundMap` 相关 import 和 state。
- 删除 `forcedGmPrograms` 从正式 UI 到 `runPipeline` 的路径。
- 如果 `runPipeline` 暂留，只能是 Q+N facade，不能继续暴露旧乐器 override 语义。
- 变量名中的 `mgStyle`、`mgKey` 等应重命名为 `musicStyle`、`musicKey` 或等价名称。

### 2.4 删除策略

可以分两步：

1. 先从生产路径断开并删除 dead UI/state/import。
2. 再在独立提交中删除旧文件或移动到 archive。

但最终验收时，Q+N 迁出包不能依赖旧引擎目录。

## 3. Band Selection 新语义：选择乐手，不选择音色

### 3.1 用户语义

Band Selection 代表“本次有哪些乐手/职能参与编配”。

示例：

```text
用户选择：键盘手、贝斯手、鼓手
结果：这首歌只能由这些职能共同完成。
      键盘手可承担和声/主奏/铺底中被允许的键盘职能；
      贝斯手负责 bass；
      鼓手负责 drum；
      具体钢琴、电钢、Pad、贝斯音色、鼓组音色由 Q+N 器配层按规则随机决定。
```

### 3.2 UI 禁止项

Band Selection UI 不允许出现：

- GM program 下拉
- 乐器音色下拉
- `Acoustic Grand`、`Pick Bass`、`Warm Pad` 等具体 GM 音色候选
- “Instr. default”
- “program override”
- 每 role 直接选音色的交互

### 3.3 UI 允许项

Band Selection UI 可以出现：

- 乐手职能开关或选择项
- 键盘手
- 贝斯手
- 鼓手
- 吉他手
- 合成器/氛围乐手
- 主奏乐手
- 自动补全/默认乐队
- 禁用某个乐手职能

具体命名按项目大框架 band system 现有术语落地。

## 4. Band Selection 到 Q+N 的映射

### 4.1 不再传 GM override

正式主链路中删除或弃用：

```ts
gmOverrides?: QnGmOverrides;
forcedGmPrograms?: Partial<Record<BandRole, number>>;
{ kind: 'selected'; program: number }
```

如果为了兼容暂时保留类型，也不得由产品 UI 使用。

### 4.2 新合同建议

新增或调整为类似：

```ts
export type BandParticipantRole =
  | 'keyboardist'
  | 'bassist'
  | 'drummer'
  | 'guitarist'
  | 'synthPlayer'
  | 'leadPlayer';

export type BandParticipantState = 'auto' | 'selected' | 'disabled';

export interface BandParticipantSelection {
  role: BandParticipantRole;
  state: BandParticipantState;
  musicianId?: string;
}

export interface MusicGenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number;
  key?: string;
  mode?: string;
  bandParticipants?: BandParticipantSelection[];
}
```

实际命名可按项目风格调整，但必须表达“乐手参与者”，不是“GM program 选择”。

### 4.3 映射原则

Band participant 影响 Q+N 的 lineup / role availability / arrangement ownership：

- `keyboardist` 可承担 `lead`、`comp`、`pad` 中的键盘类职责。
- `bassist` 对应 `bass`。
- `drummer` 对应 `drum`。
- `guitarist` 可承担 `lead` 或 `comp` 中的吉他类职责。
- `synthPlayer` 可承担 `pad`、`lead`、`comp` 中的合成器类职责。
- `leadPlayer` 可承担旋律主奏职责。

具体音色仍由器配层决定。比如选择 `keyboardist` 不等于选择 GM0 Acoustic Grand；它只是告诉 Q+N “这首歌有键盘手可用”。

### 4.4 最小乐队规则

必须定义最小可生成策略：

- 如果用户什么都没选：使用 Q+N 默认完整乐队。
- 如果用户只选 `keyboardist/bassist/drummer`：生成由三位职能参与的完整编配，主奏/和声/铺底中可由键盘手承担的部分归键盘手负责。
- 如果用户禁用了某类职能：对应职责不应由该职能生成。
- 如果用户选择组合无法覆盖必要职责：允许 Q+N 进行“自动补位”，但 UI/日志必须标明 auto-filled participant；或给用户明确错误。不要静默生成一个用户没选的完整乐队。

## 5. 器配层音色随机规则必须保留

### 5.1 目标

Band Selection 只影响“谁参与”，不直接影响“用什么 GM 音色”。

### 5.2 要求

- `InstrumentationPlan.roleProgram` 仍是最终音色真源。
- `programByRoleSection` / `programChanges` 仍由器配层按 style/seed/section/timbre world 决定。
- 同一组选中乐手，在不同 seed 下可以得到不同 GM program。
- 同一 seed/style/乐手选择必须 deterministic。
- 音色世界如 `acousticPianoBand`、`brightPopHybrid` 等仍由 Q+N 规则生成。

### 5.3 禁止

- 禁止 UI 直接写 `TrackIR.program`。
- 禁止在 `MusicGenerationService` 生成后用后处理强行覆盖 program 作为产品逻辑。
- 禁止 Band Selection 变成 GM 音色选择器。

## 6. Q+N seed 面板迁出后的 NewEnginePanel 处理

`NewEnginePanel` 保留时只能用于：

- trace 诊断
- piano roll 调试
- A/B 比较
- MIDI 导出调试
- Q+N 内部开发验证

它不应该承担：

- 产品主入口
- 正式 seed 入口
- 正式随机 seed 入口
- 正式 Band Selection
- 正式播放主路径

`App.tsx` 不应让 `NewEnginePanel` 成为默认产品体验。可通过 DevDock 的“Q+N 诊断”打开。

## 7. 需要改造的重点文件

- `src/components/PipelineMonitor.tsx`
  - 整理为正式“音乐生成”主面板。
  - 保留 seed / random seed / play / stop。
  - 删除旧 BandSelectionPanel 和 GM instrument dropdown。
  - Band Selection 改成乐手/职能选择。

- `src/state/QnBandSelectionStore.ts`
  - 从 role/program 三态改为 participant/member 三态。
  - 不存 GM program。

- `src/core/generation/musicGeneration/types.ts`
  - 移除或弃用 `QnGmOverrides` 和 `{ kind:'selected'; program:number }` 产品语义。
  - 增加 band participant selection 合同。

- `src/core/generation/musicGeneration/MusicGenerationService.ts`
  - 不再后处理覆盖 `TrackIR.program`。
  - 把 band participant 约束传给 Q+N band/instrumentation 层。

- `src/core/generation/newEngine/band/bandEngine.ts`
  - 接收或推导 participant/lineup 约束。
  - 只决定参与职能/lineup，不直接让 UI 指定 GM 音色。

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
  - 保持音色世界和 GM program 随机规则为最终真源。
  - 根据可用参与者限制可用 role/family，但仍由规则选音色。

- `src/core/generation/pipeline/index.ts`
  - 移除 `forcedGmPrograms` 正式路径。
  - 如保留 facade，传 band participants，不传 GM program。

- `src/core/generation/newEngine/sandbox/NewEnginePanel.tsx`
  - 降级为诊断面板。
  - 保留调试 seed 可以，但不要作为产品入口。

## 8. 验收检查

### 8.1 静态搜索

产品路径不应再出现 GM override UI：

```bash
rg "forcedGmPrograms|gmOverrides|QnGmOverrides|program override|Instr\\. default|GM program|Acoustic Grand|Pick Bass" src/components src/apps src/core/generation/musicGeneration src/core/generation/pipeline
```

允许测试或底层器配知识库出现 GM 名称；不允许正式 UI 把它当用户选择项。

旧引擎生产路径不应命中：

```bash
rg "runMgEngine|mgEngine/adapter|MgStyleStore|MgKeyStore|MgSeedStore|MusicianRegistry|BandSelectionStore" src/App.tsx src/components/PipelineMonitor.tsx src/apps src/core/audio src/core/generation/pipeline src/core/generation/musicGeneration
```

### 8.2 行为验收

- 主面板显示“音乐生成”。
- 主面板有 seed 输入和随机 seed。
- 随机 seed 后点击生成，走 Q+N 正式 service。
- Q+N 诊断面板不是产品主入口。
- Band Selection 只能选择乐手/职能，不能选择具体乐器音色。
- 选择 `键盘手 + 贝斯手 + 鼓手` 后，生成结果只由这些职能覆盖的职责参与。
- 具体 GM 音色由 Q+N 器配层随机产生。
- 同一 seed/style/乐手选择结果 deterministic。
- 不同 seed 可能产生不同音色世界或 GM program。
- PipelineMonitor roster 显示“参与乐手/职能 + Q+N 实际随机音色”，但音色显示只读，不可手动选择。

### 8.3 测试建议

新增或更新测试：

- `MusicGenerationService`：band participants 不写 `TrackIR.program` override。
- `bandEngine`：participant selection 能限制 lineup。
- `instrumentalPlanner`：同 participants 不同 seed 仍有音色随机性。
- `PipelineMonitor`：不渲染 GM program dropdown。
- `runPipeline` facade：不接受或不使用 `forcedGmPrograms` 产品路径。

执行：

```bash
npm test
npm run lint
npm run build
```

## 9. 完成定义

本阶段完成条件：

- Q+N seed / random seed / play 入口已经在正式“音乐生成”主面板。
- `NewEnginePanel` 只剩诊断职责。
- 旧引擎音乐生成代码不再影响生产路径。
- Band Selection 语义从“选择音色”改为“选择参与乐手/职能”。
- 用户不能在 Band Selection 中选择 GM 乐器。
- Q+N 器配层仍然按规则随机决定最终音色世界和 GM program。
