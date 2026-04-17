# 算法编曲引擎 — 当前实现状态快照

> **来源** — 本文件由 `.claude/rules/music_engine_audit_standard.md` §12 剥离而来（V1.2 重构）。
> **维护节奏** — 每次大型 PR 合并后由开发者/Reviewer 手工同步；非 rules-tier 约束。
> **审计框架** — 见 `.claude/rules/music_engine_audit_standard.md` §1~§11、§14（恒定不变的检查维度定义）。
> **Why 拆出来** — §12 是会随每次 PR 漂移的"快照"，留在 rules-tier 会让 Claude 把过时的 ✅/⚠️ 当真。剥离后 rules-tier 只保留"违反了一定是 bug"的硬约束。

---

## 当前实现状态快照 (V1.2 基线)

基于 2026-04-17 对代码库的扫描结果(V3.5 RichIdioms 合并后,HEAD `8604c5c`):

| # | 检查项 | 状态 | 证据 / 备注 |
|---|--------|------|-------------|
| 1.1 | 全局和声下发 | ✅ | HarmonyPipeline + Orchestrator.arrange |
| 1.2 | 频段隔离 | ✅ | TextureMapper.clampToRange |
| 1.3 | 节奏互锁 | ✅ | PR#9 全局 DensityTracker (Orchestrator.ts:643) + Call-and-Response |
| 1.4 | Avoid Notes | ✅ | m9 检测已实现(ToplineEngine:2365,2423; V3.5 后行号漂移) |
| 2.1 | 和弦池深度 | ✅ | 28 候选,功能加分 +8 |
| 2.2 | 节奏碎片化 | ⚠️ | RhythmCells 按 styleId 分组 + tag 过滤,无 styleId×energyLevel 交叉 |
| 2.3 | 乐器随机池 | ✅ | EnsembleDrafter 10 slot |
| 2.4 | 人性化微调 | ⚠️ | humanize=0.01,仅 Drums 充分 |
| 3.1 | Motif 生命周期 | ✅ | PR #6 修复 'A'→'M' bug |
| 3.2 | 乐句呼吸 | ✅ | CadenceType + 强制休止 |
| 3.3 | 能量曲线 | ✅ | EnergyThresholds 7 级 |
| 4.1 | Kick+Bass 锁定 | ✅ | V3.5 kickAnchors 显式构建并传入 BassLine (Orchestrator.ts:618-638 → TextureMapper.ts:31,198-202) |
| 4.2 | 切分音收敛 | ✅ | PR#8 capSyncopation() + MAX_CONSECUTIVE_OFFBEAT=2 |
| 5.1 | 公共音保留 | ✅ | ChordMask + Viterbi |
| 5.2 | Top Voice 平滑 | ✅ | ChordScoreTable |
| 5.3 | 平行禁忌 | ✅ | PR#11 GlobalReviewer.reviewParallelMotion (GlobalReviewer.ts:294) |
| 6.1 | 段落边界平滑 | ✅ | CC7 渐变 + entry delay |
| 6.2 | Turnaround/Fill | ✅ | MotifLooper |
| 6.3 | 能量断崖 | ✅ | PR#11 applySectionVelocityCurve ramp(差≥4 时 ±1 拍线性插值) |
| 7.1 | 增益级联 | ✅ | dB 相对缩放,顺序合规(Vocal+3/Melody 0/Drums+1/Bass-2/Chord-4) |
| 7.2 | 伪侧链 | ✅ | PR#8 改为 requireSidechain !== false 默认启用 (PlaybackEngine.ts:502) |
| 7.3 | 动态声场 | ✅ | CC10/CC74/CC91 |
| 8.1 | PRNG 纯洁度 | ✅ | 零 Math.random |
| 8.2 | 零 GC | ⚠️ | PR#11 清理 9 处 spread; 冷路径 .filter()/.map() 仍保留(guideline 级) |
| 8.3 | ACVE 快照 | ✅ | A/B/C/D 已打点 |
| 9.1 | 双空间分离 | ✅ | K-1 契约 |
| 9.2 | 禁止预补偿 | ✅ | K-4 契约 |
| 9.3 | 后处理空间 | ✅ | K-6 契约 |
| 10.x | 听感验证 | ✅ | Seed Lab 工具就绪 |

### 统计

- **总检查项**: 28(含技术检查,不含 §10 主观验证)
- ✅ 已实现: 25
- ⚠️ 部分实现: 3
- ❌ 缺失: 0

> **V1.1 更新**(2026-04-15 基线审计): 1.4 升级 ✅(m9 已实现)、2.2 降级 ⚠️(记账修正)、7.1 保持 ✅(数值备注修正)、7.2 保持 ⚠️(发现硬关闭)。数字持平,但具体项目归类已同步。完整审计报告见 `docs/audits/2026-04-15_pr7_baseline_audit.md`。
>
> **V1.2 更新**(2026-04-17 PR#8/9/11 + V3.5 回写): 7 项升级 ✅ — 1.3(PR#9 DensityTracker)、4.1(V3.5 kickAnchors)、4.2(PR#8 capSyncopation)、5.3(PR#11 reviewParallelMotion)、6.3(PR#11 ramp)、7.2(PR#8 requireSidechain 唤醒)、1.4(行号漂移修正)。8.2 保持 ⚠️(已部分清理,冷路径残留)。原 ❌ 全部清零,统计从 ✅20/⚠️6/❌2 → ✅25/⚠️3/❌0。**同步新增 audit_standard §14 V3.5 RichIdioms 模块审计维度**(7 模块 24 检查项,覆盖 DrumIdiomRouter / CounterMelodyRouter / PianoIdiomRouter / AnchorBackbone / AnchorDecisionStage / PhraseContourPlanner / Subgenre+grooveDNA)。
>
> **V1.3 更新**(2026-04-17 文档治理): §12 状态快照 + tech debt 列表从 `.claude/rules/music_engine_audit_standard.md` 剥离至本文件,同时 pipeline_rule 附录 B(V3.5 模块拓扑)剥离至 `docs/v35_module_topology.md`。Rules-tier 仅保留恒定约束,迭代型快照统一进 docs。

### 主要 tech debt(按优先级)

1. **P2** — 14.7.4 DrumIdiom swing 参数实际消费(6 个 idiom 均未消费 swing,AcousticSwingDrumIdiom 名字误导)
2. **P2** — 2.4 Humanization 扩展到 Melody/Chord(humanize=0.01 仅 Drums 充分)
3. **P2** — 2.2 RhythmCells 增加 styleId×energyLevel 交叉表
4. **P3** — 8.2 Orchestrator 冷路径 spread/.filter()/.map() 进一步清理(C 移植友好)
5. **P3** — 14.2.2 CounterMelody Call-and-Response 主旋律密度互锁定量验证
6. **P3** — 14.3.3 PianoIdiomRouter Pad/Pulsing 在 TextureMapper 端的差异化实现验证
7. **P3** — 14.6.3 PhraseContourPlanner 边界连续性自动化测试
8. **P3** — 14.6.4 velocity/timing 公式实际应用点的执行率审计

> 已完成项(从历史 tech debt 清单移除): 4.2 切分音 cap (PR#8)、7.2 伪侧链 (PR#8)、1.3 DensityTracker (PR#9)、5.3 平行禁忌 (PR#11)、6.3 能量断崖 ramp (PR#11)、4.1 kickAnchors (V3.5)、1.4 m9 检测(已在 PR 早期完成,V1.0 误判为 tech debt)、V3.5 模块审计维度扩充(V1.2 audit_standard §14 已建立 — DrumIdiom / CounterMelody / PianoIdiom / AnchorBackbone / AnchorDecisionStage / PhraseContourPlanner / Subgenre+grooveDNA 7 维度 24 检查项)。

---

## 维护提示

- 任何 PR 涉及 audit_standard §1~§11/§14 任意检查项时,本文件对应行必须同步更新
- 大型重构后(累积 3+ PR),应做完整重扫并发布 Vx.x 更新说明
- 历史快照不可修改 — 新版本只追加 V 更新说明,不重写历史描述
- 与 `.claude/rules/music_engine_audit_standard.md` 的关系:框架在那边(检查维度定义),状态在这边(当前实现成绩单)
