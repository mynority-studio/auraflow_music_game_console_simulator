# Auraflow Music Game — Working Guide

> **2026-05-24 起 AF2 为唯一内核** — AF / MG / mg-engine / 旧 pipeline/primitives/realizers
> 全部物理删除(净 -33,700 行 dead code)。
>
> **2026-05-25 起 7 / 8 层显式 core+plugin 架构**(Conductor / Arranger / Composer /
> MelodyGen / AccompGen / DrumIdiom / Reconciler 全部 plugin 化,plugins/ 45+ 文件)。
>
> **2026-05-25 单规则重写完成** — 原 3 rule 合并为 [`.claude/rules/architecture.md`](.claude/rules/architecture.md)
> (按 8 层架构主轴 + App API 集成,~700 行宪法风)。

## 强制阅读

任一命中,先读 [`.claude/rules/architecture.md`](.claude/rules/architecture.md)(详见该文件 §0 触发条件清单):

- 改 `src/core/generation/af2-engine/` 下任何文件
- 改 IR / enum / PRNG 消耗
- 加新 plugin / musician / mgStyle / SectionType / BandRole
- 改 `runPipeline` / `AudioEngine` 公开方法签名
- 写 App / 嵌入式直接调引擎

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

- [`.claude/rules/architecture.md`](.claude/rules/architecture.md) — AF2 唯一宪法(8 层架构 + plugins/ + 三大不变式 + 单一真理之源 + 跨同步登记 + 工作流速查 + 反模式 + App API)

## AF2 关键文件速查

```
src/core/generation/
├─ af2-engine/                    ← 唯一活引擎
│  ├─ Af2EngineFacade.ts          ← 顶层入口(runPipeline 调)
│  ├─ Conductor.ts                ← 编排决策 core(template + DynamicConductor.dispatch;5 层 filter 2026-05-25 拆到 plugins/conductor/)
│  ├─ plugins/conductor/          ← 5 RoleFilter plugin chain(WakeK / PeakK / Template / Energy / Pref + types + index)
│  ├─ Af2Arranger.ts              ← 进行决策 orchestrator(core 抽进行 + 4 plugin chain;2026-05-25 framework 化)
│  ├─ plugins/arranger/           ← 4 ProgressionPlanner plugin(BorrowChord / Picardy / MinorBorrow / Tonicization)
│  ├─ Af2Composer.ts              ← orchestrator(主循环 + assembleVoicing + placeVoicingMidi)
│  ├─ plugins/composer/           ← DynamicHarmonyDecorator(decoration)+ VoicingSmoother(R+S2 post-pass,2026-05-25)
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
