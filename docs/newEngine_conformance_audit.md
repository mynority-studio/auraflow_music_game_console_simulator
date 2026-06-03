# newEngine 实现 × 架构定稿 — 一致性审计

日期: 2026-06-04
对象: `src/core/generation/newEngine/`(Slice 0–1 实现)× `docs/newEngine_architecture.md`(定稿)
结论: **管线脊柱与全部 23 条铁律已结构性闭环**;161 项 vitest 全绿、`tsc --noEmit` 干净、`generateSong(request)` 端到端 Request→FinalIR。剩余为**按 locked 决策延后**的内容深化(modal / 真 grammar 变体 / dev 面板),非结构缺口。

---

## 1. 管线脊柱(Part 1)

```
generateSong(request)
  → BandSpec(band/bandEngine)
  → ArrangementPlan(arranger:Form/Time/Dynamics/Phrase)
  → HarmonicPlan 🔒(harmony/harmonyEngine,buildHarmonicPlanFromArrangement)
  → InstrumentationPlan(instrumental)
  → [Prepass] MelodyAnchorPlan + MotifStore(render/motifAnchorPrepass,候选池)
  → AccompTracks(让位)+ OccupationMap(render)
  → MelodyTracks(render/melodyRenderer)
  → ResolvedMusicalIR(render/interactionResolver)
  → AuditReport(render/readOnlyHarmonyAuditor)
  → GenerationController(retry/budget/fallback)→ FinalIR
```
全链实测 pass + 确定性(`generation/GenerationController.test`)。

## 2. 23 条铁律 × 实现

| # | 铁律 | 状态 | 落点 |
|---|---|---|---|
| 1 | Arranger 最高权威 | ✅ | arranger/* 产出 ArrangementPlan,下游只读 |
| 2 | Harmony 按目标生成 | ✅ | buildHarmonicPlanFromArrangement 消费 harmonicRhythmTarget |
| 3 | HarmonicPlan 深不可变 | ✅ | `DeepReadonly` + `deepFreeze`(harmony/HarmonicPlan) |
| 4 | accompaniment-first 单路径 | ✅ | renderSongFull 单链,无 melody-first 分支 |
| 5 | melody-aware(伴奏前拿锚点) | ✅ | Prepass 先于 Accompaniment;让位用锚点 |
| 6 | 全管线确定性 | ✅ | RandomContext 命名子流 + Timebase;多处确定性测试 |
| 7 | tonal 严格 | ✅ | 当前唯一 regime |
| 8 | modal 宽松 | ⏸ 延后 | tonalityKind 字段在,逻辑 tonal 先行(locked G3) |
| 9 | 凝聚力=重复 | ✅ | motif 同 repeatGroup 共享(phrasePlanner)+ **进行同 repeatGroup 共享(本轮修)** |
| 10 | 归家=T-S-D | ✅ | chordFunctionTimeline |
| 11 | 动机分层/纯抽象 | ✅ | Motif 无 pitch,rhythmCell>contour>scaleDegree |
| 12 | restatementStrength 连续 | ✅ | requested/effective + 锁档(.34/.67) |
| 13 | Grammar=变体工具 | 🟡 占位 | motif slot 在;真 grammar 变体内容延后 |
| 14 | GuideTone 服务连接/tail | 🟡 占位 | skeletonSource='guidetone' 标记在;tail 成形延后 |
| 15 | 源由角色驱动 | ✅ | hook→grammar / connector→guidetone(Prepass) |
| 16 | 让位按织体分流 | ✅ | textureYieldPolicy:active 瘦身 / floating 不让位 |
| 17 | 撞音 renderer 内预消解 | ✅ | 选音 + voicing shell + Resolver(不改 HarmonicPlan) |
| 18 | 防撞序 | ✅(局部) | Melody snap + Resolver 八度;复现 hook 候选池换 hook 通道在 |
| 19 | Auditor 只读严格无豁免 | ✅ | readOnlyHarmonyAuditor;NoteIR 无 intentional |
| 20 | Resolver best-effort | ✅ | interactionResolver,改不动放过 |
| 21 | tensionModel 三处共用 | ✅ | 选音/Resolver(snap)/Auditor 同 avoidNoteMap |
| 22 | Controller 只 render retry | ✅ | 回卷 IX/MR/AC;碰不到 Harmony/Arranger/Prepass |
| 23 | KB 给候选 engine 绑定 | ✅ | knowledge/* 出候选,engine 按 seed/role 绑定 |

## 3. 数据契约(Part 2)× 实现

全部冻结契约已落地并 deepFreeze 值对象快照:
GenerationRequest · BandSpec · ArrangementPlan(Section/Phrase/MotifBinding)· HarmonicPlan(结构化 RomanChord / Record *Map)· InstrumentationPlan(melodyReservationPlan/textureYieldPolicy)· MelodyAnchorPlan · Motif/MotifStore/候选池/MotifRealization · OccupationMap · MusicalIR/TrackIR/NoteIR · AuditReport · RetryContext。

## 4. 附录 A–H 锁定决策 × 实现

```
A 管线形态     ✅ 单链 + 唯一回边;无 GC→Prepass/harmony retry;状态显式快照
B 权威/不可变   ✅ 深不可变 Record;requested/effective 拆分;Auditor 无豁免
C 确定性底座   ✅ RandomContext/Timebase/DeepReadonly + branded pc/midi/beats/ticks
D Motif 子系统  ✅ 纯抽象/Realization/候选池 overlay/resolveEffectiveCandidate(H2 四边界)/
               referenceBindingId 无环/binding 粒度/global 空交集降级
E 源/让位/撞音  ✅ 角色驱动源/织体分流让位/guideToneShell 瘦身/snap/tensionModel 共用
F 控制环       ✅ 回卷重跑/budget perBinding2·perPhrase3·wholeSong12/fatal→failed report
G 资产策略     ✅ 0 import;乐理 B-port 新文件;tonal 先行
H 实现守门     ✅ DeepReadonly branded leaf 短路;resolveEffectiveCandidate fail-closed + 单测
```

## 5. 按 locked 决策延后(非结构缺口)

| 项 | 现状 | 依据 |
|---|---|---|
| modal regime | 字段在,逻辑 tonal 先行 | locked 0.4 / G3:tonal 先行,脊柱稳后挂 modal |
| 真 grammar 变体(transform/divide/development) | motif 为占位 shape,变体 slot 在 | 13:GrammarLibrary = data-port,内容深化(不影响结构) |
| GuideTone tail 成形(按 cadenceTarget) | source 标记在,tail 仍 scaleDegree | 14:tail 功能化是内容深化 |
| dev 面板 + 音频出声 | 未建 | 验证 harness,非架构层(用户已授权新面板+中立音频层) |
| 进行/voicing 深化(drop2/rootless/借和弦/转调) | 基础 voicing | KB 深化 |

## 6. 测试覆盖

每层/节点均有 vitest 用例(161 项);TDD 贯穿。关键不变量被显式锁:深不可变(改即抛)、确定性(同种子同输出)、fail-closed(越界即抛)、H2 四边界、排比(verse1≡verse2 动机+进行)、让位瘦身、Auditor 全链 pass。

**判定:架构设计结构性闭环。** 下一步出声(dev 面板 + 中立音频层),随后内容深化(grammar / guidetone / modal)。
