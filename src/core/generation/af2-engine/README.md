# af2-engine — AuraFlow v2 融合引擎

> **Phase 0 占位目录**。骨架已搭好,融合原则待用户输入。
> 任何实装代码暂时不要写进来 —— 等原则确定后统一规划。

## 路线背景

`mg_engine_integration_plan.md` 中的"激进替换"路线(把 MG 整体作为 auraflow 内核)
已废弃(2026-05-21)。当前路线是**三引擎并存 + 融合**:

| 引擎 | 入口 | 状态 |
|------|------|------|
| AF | `pipeline/index.ts:runPipeline` 主路径 | 当前生产路线,完整 Stage 1-5 + Conductor |
| MG | `mg-engine/MgEngineFacade.ts` | 完整移植,钢琴 solo,PRNG 隔离 |
| **AF2** | **`af2-engine/Af2EngineFacade.ts`** | **本目录,Phase 0 stub** |

AF2 取 MG 的**全局和声概念 + 段落和声编配**,接 AF 的**乐手 / 段落骨架 /
5 维气象 / Reconciler** 等系统,目标是融合两者强项。

稳定后 AF2 替代 AF/MG 成为唯一引擎,届时:
- `EngineSelectionStore` 收回为常量(或彻底删除)
- 本目录扁平化为 `generation/` 主管线
- AF/MG 模块删除

## 当前文件

- `Af2EngineFacade.ts` — Phase 0 stub,`generate()` 抛 NOT_IMPLEMENTED

## 与 mg-engine/ 的并列关系

两者都是 `runPipeline` 的可切换分支,但语义不同:
- `mg-engine/` 是 melodygenerative 原版整体移植,PRNG 字符串 fork 隔离,
  验收锚点是"听感 = mg-standalone"
- `af2-engine/` 是**新写的融合代码**,会调 mg-engine 内的和声生成函数
  作为子模块,但渲染层 / 段落系统 / 乐手系统走 AF 现有代码

## 融合原则(2026-05-21 用户表态后固化)

### 绝对原则:mg 核心算法不得被 AF 干预

下列由 mg 计算,AF2 必须 bit-exact 透传,**禁止改写**:
- 和声进行(progression generation)
- 和声编配(voicing / voice leading)
- topline(motif 选择 / 旋律时值)
- chord 演绎(applyTexture 的 chord 部分)
- melody 演绎(generateMelodyPhrase / 各种音符评分)

**验收锚点**:同一种子下,AF2 的 chord / melody 输出必须 **bit-exact = MG 模式输出**。

### AF 能干预的白名单(仅这些,其他皆禁)

1. **段落骨架** — 多少小节 / Intro / Verse / Chorus / Bridge / Outro 标注
2. **能力曲线** — 段落 energyLevel
3. **乐器分配** — 把 mg 算出的音符序列路由给哪个槽位的乐手演奏
   (但**渲染必须忠实 mg** —— 如果分配的是钢琴,声音应与 mg 一致)

### 乐理冲突 → mg 优先

mg 的 `musicTheory.ts`(度量衡 / TSD 函数 / 和弦定义 / 调式)是 AF2 的真理之源。
AF 的 `types.ts` 若与之冲突,AF 让位。

例外:可以"合理丰富 mg 而不让它变糟"的扩展 —— 但默认拒绝,需用户明确确认。

### 左右手 / 钢琴通道映射(Phase 后期细化)

- `mg.chord` (part='chord' / 'bass') ≈ pianoLH
- `mg.melody` (part='melody') ≈ pianoRH

目前 `MgEngineFacade` 把 chord/bass 都合并到 accompaniment 单通道,Phase 后期再分。

### 允许 / 拒绝清单(用于 review)

**✅ 允许**
- AF 段落骨架决定 mg 跑几小节 / 哪段是 chorus / 能量曲线
- AF 把 mg 的 chord/bass/melody output 路由给不同槽位的乐手渲染
- AF2 外层加 6 槽位乐队系统,槽位决定 mg 输出去哪个渲染管道
- mg 内部冗余 / 补丁 / 死代码清理(只要不改输出 bit-exact)

**❌ 拒绝**
- 用 AF 的 Reconciler / Conductor / VoicingProcessor 取代 mg 对应模块
- 在 AF2 内拆 Groove/Topline,放弃 mg 的混合产出(AF 视角强加)
- 加新乐手 persona 注入 mg motif 评分权重 / 改 mg 的概率分布
- 用 AF 的 ChordQuality enum 替代 mg 的字符串 chord type
- 改 mg 的乐理表(TSD 函数 / 音阶定义 / 和弦音程)以对齐 AF

---

## 下一步:mg 内部冗余审计

在动 AF2 实装前,先对 mg 自身做架构清理审计(用户要求):
- 同一概念多处实现的去重机会
- 临时打的 if/else 补丁(规则冲突时的局部修正)
- 死代码 / 被 deprecated 但未删的旧路径
- 逻辑冲突临时加的规则(可能在某处改一次就够,无须散落)

约束:任何清理建议**不得改变 mg 输出 bit-exact**。审计产出报告,不立即重构。
