# Auraflow Music Game — Working Guide

## 强制阅读(按工作类型,任一命中先读对应规则)

### 改引擎内部 → `.claude/rules/engine_architecture_rule.md`

涵盖:架构数据流、单一真理之源(每件事去哪个模块改)、命名约定、三大不变式
(Pitch Space / PRNG 序列 / 数据契约)、改动前决策树、改动后验证清单、抽取/
重命名 SOP、反模式禁区、Reconciler v1→v2 升级条件、模块依赖规则、
**§11 乐器修改速查(按乐器反查文件,钢琴为第一个范例,未来其他乐器照模板补)**。

**特别提示**:当用户提出"我想优化 X 乐器的 Y 方面"等具体需求,**优先查 §11**,
按场景对照表找到主要文件 + 次要文件,避免"同一件事多处打补丁"的旧坑。

**触发条件(任一命中即读)**:

- 改 `src/core/generation/` 下任何文件
- 新增 / 重命名 / 删除引擎模块
- 调整任何模块的 PRNG 消耗
- 改 IR 类型(`ir/` 下任何 interface)
- 改风格配置中映射到管线决策的字段(`config/styles/*.ts`)
- 改 Conductor / AbsoluteTransposer / Reconciler 调用顺序

### 写 App / 嵌入式集成 → `.claude/rules/app_integration_rule.md`

涵盖:三大公开入口(setSeed / runPipeline / playSong)、调用时序、
`PipelineRunOptions` 字段详解、返回值结构(GeneratedTrack / MusicContext)、
`AudioEngine` API 速查、错误处理、可视化层订阅、嵌入式 C 端 IR / PRNG / 黄金种子
对账契约、禁止事项、完整 React 调用示例。

**触发条件(任一命中即读)**:

- 写 React 组件直接调用引擎生成或播放
- 写嵌入式 C 端,需要对接 IR 数据结构或黄金种子 baseline
- 改 `AudioEngine` / `MidiConverter` / `PlaybackEngine` 公开方法签名
- 加新的 MIDI Mixer / 通道控制 / Visual 订阅
- 实现"运行时改 MIDI 事件"功能

### 跨端/跨模块同步 → `.claude/rules/cross_sync_rule.md`

涵盖:已登记的 10 个"关联变更组"——改 A 必须同时改 B/C/D 的清单
(IR↔C 端 / VoiceRole↔VoicingMask 位偏移 / SectionType↔Conductor /
ChordQuality↔CHORD_INTERVALS / BandRole↔roster / StyleId↔Golden seed /
InstrumentFamily↔channel / RenderContext↔4 Idiom Inputs / GM Drum Map /
PipelineRunOptions↔app_integration);改动前/中/后的对账流程;
新关联组追加机制(§3);C 端 sync gap 当前状态与"完全重建"决策(§4)。

**与 engine_architecture_rule 的区别**:engine_architecture_rule §2/§11
回答"改 X 去哪改"(纵向找主改文件);本规则回答"改 X 后还必须同时改哪些"
(横向找关联同步点)。两者互补,做完前者再过本规则。

**触发条件(任一命中即读)**:

- 改任何 IR 字段(`ir/` 下 interface / enum)
- 改任何 enum 的数值或顺序(尤其 SectionType / VoiceRole / ChordQuality /
  BandRole / StyleId / InstrumentFamily)
- 改任何函数的 PRNG 消耗
- 加新 BandRole / Musician / Style / SectionType / InstrumentFamily
- 改 `PipelineRunOptions` / `AudioEngine` 公开方法签名
- 重命名跨 src 引用 ≥ 5 处的模块/类/接口
- 准备执行 `/sync-to-c`
- 发现新的"改 A 忘改 B"踩坑(需登记到本规则 §3)

---

读完对应规则后再动手。偏离规则的改动,golden seed 大概率挂 / API 契约大概率破 /
关联模块大概率不同步。

## 验证 SOP

每次 commit 前:

```bash
npm run lint           # tsc --noEmit 必过
npm run golden-seed    # 输出 7 个 seed 的 sha256
```

**算法不变的重构** → sha 必须 bit-exact 一致(参照上次 commit message 里的 sha 值)
**算法变更的 PR** → sha 必然变化,commit message 必须列新旧 sha 对照

详见 `engine_architecture_rule.md` §6。

## 历史里程碑 tag

- `v1.37.0-refactor-foundations` — IR / VoicingProcessor / CastingEngine / Realizer 四件套
- `v1.38.0-reconciler-online` — Reconciler 上线 + Conductor 重命名

## 规则文件登记

- `.claude/rules/engine_architecture_rule.md` — 引擎修改宪法(改引擎内部前必读;§2 单一真理之源 + §11 乐器修改速查)
- `.claude/rules/app_integration_rule.md`     — App / 嵌入式集成 API 契约(写 App 或嵌入式前必读)
- `.claude/rules/cross_sync_rule.md`          — 跨端/跨模块同步规则(改 X 必须同时改 Y/Z 的关联变更登记表 + C 端 sync gap 状态)
- (未来:其他领域规则放 `.claude/rules/` 下,本文件登记入口)
