# Q+N 主引擎替换最终审计与后续建议

日期: 2026-07-01  
审计对象: 当前主分支工作树,HEAD `9ffe93b`

## 结论

主引擎替换已完成。正式产品主链路已经由 Q+N 音乐生成引擎接管,没有发现 Q+H 音乐生成、AuraBar、AuraJam/Motif 续写或 Q+T 用户接管回退到旧 mg 主引擎。

当前正式链路:

```text
Q+H 音乐生成 UI
  -> runPipeline
  -> MusicGenerationService
  -> Q+N newEngine
  -> AudioEngine.playMusicGeneration
```

没有主链路替换阻断项。

## 已完成的关键边界

- `App.tsx` 不再挂载 Q+N 独立 `NewEnginePanel`;正式入口收口到 Q+H `PipelineMonitor`。
- `DevDock` 不再暴露 Q+N 第二播放入口;只保留 `音乐生成(Q+H)`、`Motif 沙盒(Q+R)`、`用户接管沙盒(Q+T)`。
- `runPipeline` 只是 Q+N 兼容外观,内部调用 `generateMusicSync`,不再调用旧 mg engine。
- `MusicGenerationService` 是产品到 Q+N 的唯一服务边界;普通生成和 Motif 续写都走 Q+N bundle/render/controller。
- 音频正式播放走 `AudioEngine.playMusicGeneration(result)`,以 `MusicalIR` 为音频合同,不走旧 `playSong`。
- Band Selection 已改为参与乐手/职能选择,不选择 GM program。
- selected 乐手通过 `requiredRoles` 保证出声;不是只作为 `allowedRoles` 被随机 lineup 决定。
- participant 家族通过 `enforceRoleFamilies` 闭环到最终发声音色,不会被器配 orchestration/repair 改出约束。
- drum roster 显示 `Drum Kit`,不再把 ch9 的 program 0 显示成 `Acoustic Grand`。

## 审计验证

静态检查:

```bash
rg "runMgEngine|mgEngine/adapter|MgStyleStore|MgKeyStore|MgSeedStore|BandSelectionStore|MusicianRegistry|forcedGmPrograms|gmOverrides|QnGmOverrides|QnRoleSelection" \
  src/App.tsx src/components src/apps src/core/audio src/core/generation/pipeline src/core/generation/musicGeneration src/state
```

结果: 正式产品路径无旧生成器调用;剩余命中主要为注释或 Q+N 新 store 名称。

播放路径检查:

```bash
rg "AudioEngine\\.playSong|\\.playSong\\(" src --glob '!**/*.test.ts'
```

结果: 正式 app 路径没有调用旧 `playSong`;只剩 `PlaybackEngine` 注释。

生成探针:

```text
seed=7 POP keyboardist+bassist+drummer
  -> roles: bass, comp, drum, lead
  -> drum roster: Drum Kit

seed=7 POP drummer-only
  -> roles: drum, lead
  -> lead is auto-filled

seed=7 POP synthPlayer
  -> roles: lead, pad
  -> pad final family constrained to synth/pad family
```

工程验证:

```bash
npm run lint
npm run build
npm test
```

结果: 全部通过。当前测试规模为 `202` 个 test files / `1544` 个 tests。

## 后续建议

这些建议不是主引擎替换阻断项,而是为了让代码库更干净、边界更少误解。

### 1. 零 dormant UI 清理

`src/core/generation/newEngine/sandbox/NewEnginePanel.tsx` 仍在仓库中,但已经不挂载、不在 DevDock 暴露。  
如果目标是产品入口收口,现在已经完成。  
如果目标是仓库中完全没有第二播放面板,建议后续删除:

- `src/core/generation/newEngine/sandbox/NewEnginePanel.tsx`
- `src/core/generation/newEngine/sandbox/index.ts` 中的 `NewEnginePanel` export
- `src/components/devPanels.ts` 中历史保留的 `newengine` 通道类型
- 相关测试或文档中的 `Q+N 诊断面板` 入口描述

注意: Q+H 已经复用原 Q+N 监控视图,删除 dormant panel 不应删除 `QnGenerationMonitorView`、`traceGeneration`、`pianoRoll`、`PianoRollWindow`。

### 2. legacy audio shell 清理

`AudioEngine.playSong`、`PlaybackEngine`、`MidiConverter`、`AbsoluteTransposer`、旧 `GeneratedTrack/MusicContext` 类型仍作为兼容壳存在。当前没有正式 app 调它们,但它们会让新读代码的人误以为旧生成链路还有效。

建议做一个独立 phase:

- 先用静态搜索确认没有 app 调 `AudioEngine.playSong`。
- 把旧音频壳移动到 `legacy/` 或明确加 `@deprecated` 注释。
- 逐步移除 `runPipeline` 返回的 `{ track, context }` 兼容投影,让新代码只读 `MusicGenerationResult`。
- AuraBar/AuraJam 当前仍用 `GeneratedTrack` 作为 jam 兼容投影,清理时要先替换这层投影合同。

### 3. 历史 provenance 注释/命名清理

Q+N core 内仍有不少 `melodygenerative`、`MG 真源`、`Provenance`、`忠实 port` 注释或 `mg*` 文件名。它们不是运行时依赖,也不是旧主引擎调用。

如果目标是“不要背历史包袱”的代码观感,建议单独做命名/注释清理:

- 把“MG 真源”改成“Q+N lead renderer source contract”等中性术语。
- 把 `mg*` 文件名逐步迁到 Q+N 内部语义名。
- 保留必要算法出处到低噪声 docs,不要散落在产品路径注释里。

这项风险比注释看起来高,因为文件名被大量 import/test 引用。建议机械重命名前先跑 `npm test` golden。

### 4. 保留防回归护栏

建议保留或新增以下测试/检查:

- `seed=7 + keyboardist+bassist+drummer` 必须包含 `drum`。
- `drummer-only` 必须包含 `drum + auto lead`。
- `synthPlayer` 最终 `pad` 音色必须在 pad/synth 家族。
- `keyboardist` 最终 `lead/comp` 必须是 keyboard 家族。
- `drum` roster 必须显示 `Drum Kit`。
- 产品路径 grep 不得出现 `runMgEngine`、`forcedGmPrograms`、`gmOverrides`。
- `src/App.tsx` 不得重新挂载 `NewEnginePanel`。
- app 路径不得调用 `AudioEngine.playSong`。

### 5. 当前非代码注意事项

当前工作树存在一个未跟踪文件:

```text
docs/acg_comp_track_hard_contract_directive.md
```

它和主引擎替换审计无关。提交或删除前应确认它属于哪个任务。

## 不要误做

- 不要把 Band Selection 重新做成 GM program/音色选择器。
- 不要为了“键盘手更丰富”默认把 `pad` 还给 keyboardist;当前语义是用户要 pad 就选 `synthPlayer`。
- 不要把 `traceGeneration` 当音频主链路;它只负责监控显示。正式播放仍是 `MusicGenerationService -> AudioEngine.playMusicGeneration`。
- 不要把 Q+N core 内 ported knowledge 文件误删为“旧引擎残留”;旧 mg engine 已物理删除,这些是 Q+N 当前知识/渲染资产的一部分。

## 最终状态

主引擎替换:完成。  
正式 UI 入口:完成。  
Band Selection 新语义:完成。  
Motif 续写调用 Q+N:完成。  
旧 mg 主引擎物理删除:完成。  
剩余工作:legacy 壳与历史命名/注释清理,非阻断。
