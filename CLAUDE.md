# Auraflow Music Game — Working Guide

> **2026-05-24 起 AF2 为唯一内核** — AF / MG / mg-engine / 旧 pipeline/primitives/realizers
> 全部物理删除(净 -33,700 行 dead code)。所有规则文件已同步更新。

## 强制阅读(按工作类型,任一命中先读对应规则)

### 改引擎内部 → `.claude/rules/engine_architecture_rule.md`

涵盖:AF2 8 层架构数据流(BandEngine/Conductor/Arranger/Composer/Dispatcher/乐手 idiom/
Reconciler/GM128)、单一真理之源表(改 X 去哪个文件)、命名约定、三大不变式
(Pitch Space K-2 / PRNG D-5 / 数据契约)、改动前决策树、模块依赖规则、反模式禁区、
**§8 乐器修改速查(钢琴 / 贝斯 / 鼓 / 氛围 4 乐器对照表)**。

**特别提示**:当用户提出"我想优化 X 乐器的 Y 方面",**优先查 §8**,按场景对照表找到
主要文件,避免"同一件事多处打补丁"的旧坑。

**触发条件(任一命中即读)**:

- 改 `src/core/generation/af2-engine/` 下任何文件
- 新增 / 重命名 / 删除引擎模块
- 调整任何模块的 PRNG 消耗
- 改 IR 类型(`types.ts` / `ir/index.ts` / `af2-engine/types/ChordDef.ts`)
- 改 Conductor template / Arranger 进行池 / Composer voicing 流
- 改 musician 卡 `af2Overrides` 字段
- 新增 musician / 新增 mgStyle / 新增 SectionType

### 写 App / 嵌入式集成 → `.claude/rules/app_integration_rule.md`

涵盖:三大公开入口(setSeed / runPipeline / playSong)、调用时序、
`PipelineRunOptions` 字段详解、返回值结构(GeneratedTrack / MusicContext)、
`AudioEngine` API 速查、错误处理、可视化层订阅、嵌入式 C 端 IR 契约、
禁止事项、完整 React 调用示例。

**重要更新(2026-05-24)**:
- AudioEngine.playSong 签名删 `generator` 参数(MelodyEngine wrapper 已删)
- runPipeline 始终路由 Af2EngineFacade(EngineSelectionStore 路由已收回)
- AF/MG 路径下的所有 musician 卡逻辑迁到 AF2

**触发条件(任一命中即读)**:

- 写 React 组件直接调用引擎生成或播放
- 写嵌入式 C 端,需要对接 IR 数据结构
- 改 `AudioEngine` / `MidiConverter` / `PlaybackEngine` 公开方法签名
- 加新 MIDI Mixer / 通道控制 / Visual 订阅
- 实现"运行时改 MIDI 事件"功能

### 跨端/跨模块同步 → `.claude/rules/cross_sync_rule.md`

涵盖:已登记的 13 个 AF2 关联变更组——改 A 必须同时改 B/C/D 的清单
(PipelineRunOptions↔3 app / Score↔MusicianPlanInput / SectionType↔Conductor template
+ Arranger 池 + Pad slice + Accomp pool / ChordQuality↔Composer interval /
MgStyle↔Arranger+Composer+Conductor+Drum-grid / BandRole↔Roster +
SlotRouter+MidiConverter / WalkPatternId↔swing / Af2MusicianOverrides↔3 idiom /
Conductor 5 层决策↔persona / PRNG 消耗↔deterministic hash / GM Drum Map↔Channel 9 /
BandSelectionStore↔跨 app / Dispatcher 顺序↔peers 可见性);改动前/中/后的对账流程;
新关联组追加机制(§3)。

**与 engine_architecture_rule 的区别**:engine_architecture_rule §2/§8
回答"改 X 去哪改"(纵向找主改文件);本规则回答"改 X 后还必须同时改哪些"
(横向找关联同步点)。两者互补,做完前者再过本规则。

**触发条件(任一命中即读)**:

- 改任何 IR 字段(`types.ts` / `ir/index.ts` / `af2-engine/types/*`)
- 改任何 enum 的数值或顺序(尤其 SectionType / ChordQuality / BandRole / MgStyle /
  InstrumentFamily / WalkPatternId)
- 改任何函数的 PRNG 消耗
- 加新 BandRole / Musician / mgStyle / SectionType / WalkPattern
- 改 `PipelineRunOptions` / `AudioEngine` 公开方法签名
- 改 `Score` / `MusicianPlanInput` / `SectionAssignment` 接口
- 改 musician `af2Overrides` 字段集
- 重命名跨 src 引用 ≥ 5 处的模块/类/接口

---

读完对应规则后再动手。偏离规则的改动,听感大概率挂 / API 契约大概率破 /
关联模块大概率不同步。

## 验证 SOP

每次 commit 前:

```bash
npm run lint           # tsc --noEmit 必过
```

听感测试:Pop / Jazz / NeoSoul / Blues 各 seed 至少一遍。
原 golden seed 系统(`npm run golden-seed`)随 mg-engine 一起删,如需 bit-exact
对账请自行决定新 baseline 方案。

## 历史里程碑

- `v1.37.0-refactor-foundations`(historical)— IR / VoicingProcessor / CastingEngine / Realizer 四件套
- `v1.38.0-reconciler-online`(historical)— Reconciler 上线
- **2026-05-24 — AF2 唯一内核里程碑**:删 AF/MG + mg-engine 全部,净 -33,700 行 dead code
  - 41+ commits 单日
  - 5 Steps 完成:runPipeline 锁 AF2 / mg-engine 内化+删 / 旧 pipeline+primitives+realizers 删 / 小清理
  - 规则文件全部重写

## 规则文件登记

- `.claude/rules/engine_architecture_rule.md` — AF2 唯一内核宪法(改引擎内部前必读;§2 单一真理之源 + §8 乐器速查)
- `.claude/rules/app_integration_rule.md`     — App / 嵌入式集成 API 契约(写 App 或嵌入式前必读)
- `.claude/rules/cross_sync_rule.md`          — 跨端/跨模块同步规则(改 X 必须同时改 Y/Z 的关联变更登记表)
- (未来:其他领域规则放 `.claude/rules/` 下,本文件登记入口)

## AF2 关键文件速查

```
src/core/generation/
├─ af2-engine/                    ← 唯一活引擎
│  ├─ Af2EngineFacade.ts          ← 顶层入口(runPipeline 调)
│  ├─ Conductor.ts                ← 编排决策 core(template + DynamicConductor.dispatch;5 层 filter 2026-05-25 拆到 plugins/conductor/)
│  ├─ plugins/conductor/          ← 5 RoleFilter plugin chain(WakeK / PeakK / Template / Energy / Pref + types + index)
│  ├─ Af2Arranger.ts              ← 进行决策(section-aware + ii-V/Sub-V/iv 注入)
│  ├─ Af2Composer.ts              ← orchestrator(主循环 + assembleVoicing + placeVoicingMidi + voicing smoother)
│  ├─ plugins/composer/           ← DynamicHarmonyDecorator(decoration 2026-05-25 拆 plugin)
│  ├─ Dispatcher.ts               ← 调用顺序 bass→accomp→drums→melody→pad
│  ├─ Af2MelodyGen.ts             ← melody orchestrator core(2026-05-25 拆:role gate + chord-tone cycle + placeNearAnchor)
│  ├─ plugins/melody/             ← 6 plugin(RhythmPattern / PhraseContour / PassingTone / PhraseEnding / Sparsity / Velocity)
│  ├─ Af2AccompGen.ts             ← accomp orchestrator core(pickTextureType + family dispatch + velocity persona)
│  ├─ plugins/accomp/             ← 3 post-pass plugin(MelodyDensityDucker / SwingApplier / MicroTimingHumanizer)
│  ├─ plugins/reconciler/         ← velocity plugin chain(2026-05-25 拆:EnergyHumanizer / CollisionDamper / DropBuildupDynamics + types.ts)
│  ├─ instruments/
│  │  ├─ PianoIdiom.ts            ← 钢琴 idiom 入口(调 Af2MelodyGen/AccompGen)
│  │  ├─ BassIdiom.ts             ← Bass walking(swing + accents)
│  │  ├─ DrumIdiom.ts             ← orchestrator(主循环 + PRNG 3 gate + role gate;2026-05-25 拆 plugin)
│  │  ├─ ../plugins/drum/         ← 3 Modifier + 5 Override(PersonaSparsity / CrossTrack / Sync ; Break / Crash / Fill / Ride / OpenHihat)
│  │  ├─ PadIdiom.ts              ← Pad voicing slice + attack pre-roll
│  │  └─ drum-grid/               ← per-mgStyle drum grid
│  ├─ music-theory/               ← 12 主题文件(midi/scale/chord-types/voicing/spell/...)
│  ├─ utils/                      ← Random / TopologyMutator
│  └─ types/                      ← ChordDef
├─ pipeline/
│  ├─ index.ts                    ← runPipeline thin shim(始终 Af2EngineFacade)
│  └─ AbsoluteTransposer.ts       ← K-2 唯一加 keyOffset 点
├─ idioms/MusicianRegistry.ts     ← 9 张 musician 卡(4 钢琴 + 2 贝斯 + 2 鼓 + 1 氛围)
├─ data/                          ← BassWalkPatterns / GMSoundMap(剩余 2 个)
├─ config/                        ← StyleFlags / StyleRegistry(stub)/ styles(stub)
├─ ir/index.ts                    ← GeneratedChord + 相关 IR
├─ types.ts                       ← 共享 types(BandRole / ChordQuality / SectionType / etc.)
└─ GlobalContext.ts               ← 简化为 currentTimeSignature 单字段
```
