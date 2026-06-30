# Q+N 主引擎接管任务清单

> 执行对象：Claude / 自动化开发代理  
> 目标：让 Q+N 新引擎正式接管主链路，产品 UI 显示为“音乐生成”，完全放弃 mg/旧主引擎生产路径；保留现有主 UI、3x5 键盘、机器渲染视觉、管道监视、Band Selection；Motif 续写模式作为沙盒入口调用同一套 Q+N 音乐生成逻辑管道。

> 2026-06-30 补充：Band Selection 的语义已更新，详见 `docs/qn_takeover_followup_seed_band_cleanup_directive.md`。后续执行以该补充为准：Band Selection 只能选择参与乐手/职能，不允许用户选择 GM 乐器音色；音色由 Q+N 器配层按规则随机决定。本文件中关于 `gmOverrides` / GM program 下拉的描述视为旧阶段要求，不能继续作为产品 UI 目标。

## 0. 总原则

- Q+N 核心只能作为新主生成核心升格，不能把 `newEngine/sandbox/NewEnginePanel.tsx` 整个搬成产品主 UI。
- Q+N 核心不得 import `mgEngine`、旧 `pipeline`、旧 `GeneratedTrack` 作为内部合同。
- 旧 `GeneratedTrack` 最多作为 UI/Jam/PipelineMonitor 的兼容投影，不允许作为最终音频合同。
- `MusicalIR` 是 Q+N 的正式音乐输出合同。
- `Motif` 沙盒只负责捕获、分析、续写和生成 override；完整成曲必须调用 Q+N 正式生成管道。
- 保留产品壳，不重做 UI 外观：主界面、3x5 键盘、LedMatrix、PipelineMonitor、Band Selection 都应继续存在。

### 0.1 防误解约束

- “完全放弃 mg/旧主引擎”指生产生成链路不再调用 mg；不要求第一轮提交物理删除所有 mg 文件。
- `runPipeline` 如果短期保留，只能是兼容 facade；新代码优先调用 `MusicGenerationService`。
- `NewEnginePanel` 是诊断/沙盒 UI，不是新的产品主入口。
- `traceGeneration` 是诊断追踪，不是生产 API。不要靠解析 trace 文本驱动 UI。
- `MusicalIR -> MIDI` 应形成单一正式实现；sandbox 可以复用或 re-export，但不要维护两份逻辑。
- Q+R/Motif 仍可存在，但它只负责用户动机续写前处理；最终成曲、编曲、播放合同统一交给 Q+N。

## 1. 当前必须保留的产品壳

这些文件或能力应保留，只替换其生成数据来源：

- `src/App.tsx`
  - 保留设备壳、应用挂载、DevDock/PipelineMonitor 的入口位置。
  - 最终用户显示名应偏向“音乐生成”，不要继续强调“新引擎”或 “mg”。
- `src/core/hardware/TapArea.tsx`
  - 保留 3x5 键盘排列与输入交互。
- `src/core/hardware/LedMatrix.tsx`
  - 保留机器渲染视觉。
  - 视觉事件可以从新 Q+N 播放适配层补充，但不要重写 LedMatrix。
- `src/components/PipelineMonitor.tsx`
  - 保留管道监视 UI 结构。
  - 替换内部 `runPipeline`、`Mg*Store`、mg 文案和 mg 状态来源。
- `src/state/BandSelectionStore.ts`
  - 保留用户可选 Band Selection 的 store 模式。
  - 重建默认值和角色语义，使其服务 Q+N。
- `src/core/audio/AudioEngine.ts`
- `src/core/audio/MidiScheduler.ts`
  - 保留全局播放和调度基础设施。
  - 新增 Q+N `MusicalIR` 播放入口，而不是让产品路径继续调用 sandbox 播放函数。

## 2. 必须升格的 Q+N 正式能力

这些是主链路应该使用的 Q+N 能力：

- `src/core/generation/newEngine/generation/GenerationController.ts`
  - 使用 `generateSong(request, budget)` 作为普通音乐生成核心入口。
- `src/core/generation/newEngine/generation/generateSongFromMotif.ts`
  - 使用 `generateSongFromMotif(request, override, budget)` 作为 Motif 续写成曲入口。
- `src/core/generation/newEngine/ir/MusicalIR.ts`
  - 作为正式音频输出合同。
- `src/core/generation/newEngine/sandbox/irToMidi.ts`
  - 将其中 `musicalIRToMidiEvents` 抽取/移动到正式 audio adapter 位置，形成单一实现。
  - 如果 sandbox 仍需要使用，允许从正式位置 re-export 或改 import。
  - 不要把 `audioOut.ts` 的 sandbox UI/试听控制逻辑搬入产品层。
- `src/core/generation/newEngine/knowledge/instruments.ts`
  - 作为 Q+N Band Selection 候选来源之一。
  - 优先从 Q+N 自己的 role/program/catalog 建立乐手/乐器选择，而不是复用旧 mg 乐手卡。

## 3. 必须切断的历史包袱

生产主链路中不应再出现以下依赖：

- `src/core/generation/mgEngine/adapter.ts`
- `src/core/generation/mgEngine/musicEngine.ts`
- `src/core/generation/pipeline/index.ts` 内部对 `runMgEngine` 的调用
- `src/state/MgStyleStore.ts`
- `src/state/MgKeyStore.ts`
- `src/state/MgSeedStore.ts`
- `src/core/generation/idioms/MusicianRegistry.ts` 中 mg-only 的默认双乐手语义
- `src/core/generation/newEngine/sandbox/NewEnginePanel.tsx` 作为产品主 UI
- `src/core/generation/motifSandbox/model/leadOnlyIr.ts` 作为完整成曲路径

允许这些文件短期存在于仓库中，但生产路径不得 import 或调用它们。

## 4. 新建主链路服务层

### 4.1 新建建议文件

建议新增：

- `src/core/generation/musicGeneration/MusicGenerationService.ts`
- `src/core/generation/musicGeneration/types.ts`
- `src/core/generation/musicGeneration/qnUiProjection.ts`
- `src/core/audio/musicalIrToMidi.ts` 或 `src/core/audio/QnPlaybackAdapter.ts`

也可以采用项目现有命名风格，但必须保持以下边界：

- `musicGeneration` 服务层可以 import Q+N。
- `musicGeneration` 服务层可以生成 UI 兼容投影。
- Q+N 核心不能反向 import `musicGeneration`、`AudioEngine` 或旧 pipeline 类型。
- 如果为了少改调用方保留旧类型适配，适配代码必须放在 `musicGeneration` 或专门 adapter 层，不能放回 Q+N 核心目录。

### 4.2 服务层 API

实现类似以下 API：

```ts
export interface MusicGenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number;
  key?: string;
  mode?: string;
  bandSelection?: QnBandSelection;
  gmOverrides?: QnGmOverrides;
}

export interface MusicGenerationResult {
  status: 'ok' | 'failed';
  ir: MusicalIR;
  bpm: number;
  seed: number;
  styleHint: string;
  report?: unknown;
  attempts?: number;
  uiSnapshot: MusicGenerationUiSnapshot;
}

export async function generateMusic(
  request: MusicGenerationRequest,
): Promise<MusicGenerationResult>;

export async function generateMotifMusic(
  request: MusicGenerationRequest,
  override: MotifSongOverride,
): Promise<MusicGenerationResult>;
```

### 4.3 UI 投影要求

`uiSnapshot` 至少要能支撑：

- PipelineMonitor 显示 sections。
- PipelineMonitor 显示 chords/harmony。
- PipelineMonitor 显示 ensemble/roster/palette。
- AuraJam 能读取当前 track/context。
- LedMatrix 或视觉系统能在播放时收到 melody/accomp/bass/drums/pad 等角色事件。

不要通过解析 `traceGeneration` 的字符串日志来生成 UI 状态。需要从 Q+N 的 band、arrangement、harmonic、instrumentation、IR 中构造结构化投影。

如果当前 `generateSong()` 不直接暴露足够的中间结构，优先抽出共享的结构化 bundle 生成函数，再让生产 service 和 trace/诊断共同复用它；不要复制一套平行生成逻辑。

## 5. 改造 AudioEngine 播放入口

### 5.1 目标

产品播放必须从：

```ts
AudioEngine.playSong(track, styleId, context)
```

扩展到支持：

```ts
AudioEngine.playMusicGeneration(result)
```

或：

```ts
AudioEngine.playMusicalIR(ir, playbackContext)
```

### 5.2 要求

- 使用 Q+N `MusicalIR` 直接生成 MIDI events。
- 必须保留：
  - `programChanges`
  - `pedalEvents`
  - `mix`
  - `mixChanges`
  - `ccEvents`
- 播放开始后必须设置：
  - 当前 UI snapshot / current arranged track projection
  - 当前 context
  - 当前 channel/role 映射
- `AudioEngine.getCurrentArrangedTrack()` 和 `AudioEngine.getCurrentContext()` 仍应对 PipelineMonitor/AuraJam 可用。
- 不要让 `AuraBar` 或 `Motif` 产品路径直接调用 `newEngine/sandbox/audioOut.ts`。

### 5.3 角色到 MIDI/可视化映射

建议映射：

- `lead` -> melody visual / MIDI channel 1
- `comp` -> accomp visual / MIDI channel 2
- `bass` -> bass visual / MIDI channel 3
- `pad` -> atmosphere visual / MIDI channel 4
- `drum` -> drums visual / MIDI channel 10

实际 channel 可按现有 `MidiScheduler` 约定实现，但必须稳定并支持 mute/replace。

## 6. 改写 pipeline facade

### 6.1 文件

- `src/core/generation/pipeline/index.ts`

### 6.2 目标

保留 `runPipeline(options)` 作为兼容外观可以接受，但内部必须改为调用 `MusicGenerationService.generateMusic()`。

新开发代码不要继续把 `runPipeline` 当主入口；它只服务尚未迁移完的旧调用方。

### 6.3 禁止

- 禁止再 import `runMgEngine`。
- 禁止再使用 mg-only 的 bass collapse 逻辑。
- 禁止再把 Q+N 强行压扁成旧 `GeneratedTrack` 后作为音频源。

### 6.4 兼容输出

如果旧调用方还期待 `{ track, context }`：

- `track` 应来自 `uiSnapshot`，只作为 UI/Jam 兼容投影。
- 真正播放应优先走 `AudioEngine.playMusicGeneration(result)`。
- 可以扩展返回值包含完整 `MusicGenerationResult`，但不得让旧 `{ track, context }` 再成为音频事实来源。

## 7. 改造 PipelineMonitor

### 7.1 文件

- `src/components/PipelineMonitor.tsx`
- `src/components/devPanels.ts`
- `src/components/DevDock.tsx`

### 7.2 任务

- UI 显示名改为“音乐生成”。
- 移除 mg engine 文案。
- 替换 `MgStyleStore`、`MgKeyStore`、`MgSeedStore`。
- 点击播放时调用新主链路 service。
- 播放时调用 `AudioEngine.playMusicGeneration(result)`。
- 继续展示：
  - seed
  - style
  - key/tonality
  - band selection
  - sections
  - chords
  - current beat/tick
  - active pipeline stages

### 7.3 新 store 建议

新增或重命名为：

- `src/state/MusicGenerationStyleStore.ts`
- `src/state/MusicGenerationKeyStore.ts`
- `src/state/MusicGenerationSeedStore.ts`

可以复用原 store 的状态管理写法，但命名和语义不能继续是 mg。

## 8. 重建 Band Selection

### 8.1 文件

- `src/state/BandSelectionStore.ts`
- `src/core/generation/idioms/MusicianRegistry.ts` 或新建 Q+N registry
- `src/core/generation/newEngine/knowledge/instruments.ts`

### 8.2 角色映射

旧 UI 角色到 Q+N 角色：

- `MainInst` -> `lead`
- `Accomp` -> `comp`
- `Bass` -> `bass`
- `Drums` -> `drum`
- `Atmosphere` -> `pad`
- `Vocal` -> 暂时禁用或隐藏

### 8.3 要求

- Band Selection 仍然开放给用户。
- 默认乐队必须覆盖 Q+N 基础角色，不再只有 `alex_piano` / `chloe_piano`。
- 迁移后默认状态应生成完整 Q+N 乐队，至少覆盖 `lead/comp/bass/drum/pad`。
- 用户选择 GM program 时，应影响最终 `TrackIR.program` 或 `programChanges`。

### 8.4 Band Selection 状态语义

必须明确区分三种状态，避免沿用旧 `null` 默认值导致 Q+N 默认缺声部：

- `auto/default`：用户未指定，使用 Q+N 根据 style/seed 选择的默认乐器。
- `selected`：用户指定 musician/program，覆盖对应 Q+N role。
- `disabled`：用户明确关闭该 role，才允许静音、缺省或不生成。

实现可以继续使用现有 store，但不要把“缺少 selection”误解为“禁用 role”。如需保留 `null`，请在类型注释中写清楚 `null` 到底代表 disabled 还是 empty，并同步更新默认值。

## 9. 改造 AuraBar

### 9.1 文件

- `src/apps/AuraBar/EndlessRadioManager.ts`

### 9.2 当前问题

该文件已经直接使用 Q+N：

- `traceGeneration`
- `playMusicalIR`
- `stopNewEngine`

但它绕过了 `AudioEngine.currentArrangedTrack/currentContext`，导致主系统状态不完整。

### 9.3 任务

- 改为调用 `MusicGenerationService.generateMusic()`。
- 改为调用 `AudioEngine.playMusicGeneration(result)`。
- 不再直接 import `newEngine/sandbox/audioOut.ts`。
- 保证 AuraBar 播放后：
  - PipelineMonitor 有当前 track/context。
  - Jam/可视化能读到当前状态。
  - 停止播放走统一 `AudioEngine.stop()` 或等价正式入口。

## 10. 改造 AuraJam / Motif 续写

### 10.1 文件

- `src/apps/AuraJam/JamSessionManager.ts`
- `src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx`
- `src/core/generation/motifSandbox/bridge/sandboxToOverride.ts`
- `src/core/generation/newEngine/generation/generateSongFromMotif.ts`

### 10.2 目标架构

Motif 续写模式仍是沙盒，但完整成曲流程必须是：

```text
用户 motif 输入
-> Motif sandbox 捕获/分析/续写
-> buildMotifSongOverride
-> MusicGenerationService.generateMotifMusic
-> Q+N generateSongFromMotif
-> AudioEngine.playMusicGeneration
```

### 10.3 禁止

- 禁止用 `leadOnlyIr` 当完整成曲。
- 禁止 Motif 完整成曲直接调用 sandbox `playMusicalIR`。
- 禁止 AuraJam 继续走旧 mg `runPipeline` 作为主生成路径。

## 11. DevDock / 沙盒面板处理

### 11.1 文件

- `src/App.tsx`
- `src/components/devPanels.ts`
- `src/components/DevDock.tsx`
- `src/core/generation/newEngine/sandbox/NewEnginePanel.tsx`

### 11.2 任务

- Q+N 成为正式主链路后，`NewEnginePanel` 应降级为诊断面板。
- 产品主入口显示“音乐生成”。
- `MotifWeaverSandboxPanel` 可继续作为 Motif 续写沙盒入口。
- `App.tsx` 不应无条件把 `NewEnginePanel` 当产品面板渲染；如需保留，放到 DevDock/诊断开关后面。
- DevDock 中可以保留：
  - 音乐生成
  - 管道监视
  - Motif 续写
  - Q+N 诊断
- 不要把诊断面板当成产品主体验。

## 12. 验收检查

完成后执行以下检查。

### 12.1 静态搜索

先执行定位：

```bash
rg "runMgEngine|mgEngine/adapter|MgStyleStore|MgKeyStore|MgSeedStore" src
```

这条搜索不要求全仓零命中，因为旧文件可短期存在。硬性要求是以下生产路径不再 import 或调用它们：

- `src/App.tsx`
- `src/components/PipelineMonitor.tsx`
- `src/apps/AuraBar`
- `src/apps/AuraJam`
- `src/core/audio`
- `src/core/generation/pipeline`
- `src/core/generation/musicGeneration`

检查 sandbox 播放是否只留在 sandbox：

```bash
rg "newEngine/sandbox/audioOut|playMusicalIR|stopNewEngine" src
```

产品路径不应直接调用 sandbox `playMusicalIR`。允许 sandbox、诊断面板或测试文件继续出现。

### 12.2 类型与测试

执行：

```bash
npm test -- src/core/generation/newEngine
npm test
npm run lint
npm run build
```

如果项目没有完整测试或 build 脚本，记录实际可执行命令和失败原因。

### 12.3 手动验收

- 打开应用后主链路显示“音乐生成”。
- 播放普通音乐时，声音来自 Q+N。
- PipelineMonitor 能看到 Q+N 的 sections/chords/band/current beat。
- 3x5 键盘排列仍存在。
- LedMatrix 仍随播放变化。
- Band Selection 可以改变 lead/comp/bass/drum/pad。
- AuraBar 播放后 `AudioEngine.getCurrentArrangedTrack()` 不为空。
- Motif 续写完整成曲调用 Q+N `generateSongFromMotif`。
- 搜索确认生产路径不再调用 mgEngine。

## 13. 推荐执行顺序

1. 新建 `MusicGenerationService` 和类型。
2. 提升 `MusicalIR -> MIDI` 正式适配层。
3. 给 `AudioEngine` 增加 Q+N 播放入口。
4. 用新 service 改写 `pipeline/index.ts`。
5. 改造 PipelineMonitor 和三个 `Mg*Store`。
6. 重建 Band Selection 的 Q+N role/program 映射。
7. 改造 AuraBar，去掉 direct sandbox playback。
8. 改造 AuraJam / Motif 完整成曲路径。
9. 降级 `NewEnginePanel` 为诊断。
10. 跑静态搜索、测试、build、手动验收。

## 14. 最终完成定义

只有同时满足以下条件，才算迁移完成：

- Q+N 是唯一生产音乐生成核心。
- 产品 UI 名称为“音乐生成”。
- mgEngine 不再被主链路调用。
- Q+N `MusicalIR` 是正式音频合同。
- Band Selection 仍开放，并影响 Q+N 乐队/乐器。
- Motif 续写模式仍是沙盒，但完整成曲调用 Q+N 正式管道。
- 主 UI、3x5 键盘、LedMatrix、PipelineMonitor 没有被重做，只是换了生成逻辑管道。
