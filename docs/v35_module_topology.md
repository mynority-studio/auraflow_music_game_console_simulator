# V3.5 RichIdioms 模块拓扑

> **来源** — 本文件由 `.claude/rules/music_generation_pipeline_rule.md` 附录 B 剥离而来（V1.3 重构）。
> **维护节奏** — V3.x / V4.x 演进每次新增内部子步骤时同步；非 rules-tier 约束。
> **管道根基** — 见 `.claude/rules/music_generation_pipeline_rule.md` §1.1（四模块拓扑：PRNG → MelodyEngine → Orchestrator → MidiConverter）。本文件仅描述各模块**内部**子步骤，不新增管道阶段（§0.3 合规）。
> **Why 拆出来** — 模块拓扑会随每个版本（V3.5 / V3.6 / V4.0）演进，留在 rules-tier 会让 Claude 把过期模块当真。Rules-tier 只保留四模块**接口契约**，本文件承载**内部实现拓扑**。

---

## 当前版本：V3.6（2026-04-17，叠加 V3.5 + MomentumStage）

### MelodyEngine 内部新增步骤（§1.1 step 2 内）

```
generateFullSong() 内部：
  ├─ P5f: tonality vs chord 投票反推（chord 生成后 → ToplineEngine 前）
  ├─ ToplineEngine.generateTrackMelody()
  │     ├─ PhraseContourPlanner.buildForSong()  ← 三层张力曲线（纯函数，不消耗 PRNG）
  │     ├─ AnchorBackbone.buildForSection()     ← 骨架 anchor 生成（不消耗 PRNG）
  │     └─ realizeMotif() 内：Bresenham 插值 + 弧度叠加替代原 contour
  ├─ GlobalReviewer.reviewAndFix() (Phase 1)
  ├─ cleanMelodyPostProcessing()  ← P5a/b/c 大跳/三全音/同音
  ├─ ★ V3.6 MomentumStage.smooth() ★  ← 物理动量与阻尼（Luis #1，零 PRNG）
  │     · 仅主旋律应用（vocal/counter 不动）
  │     · StyleConfig.melody.useMomentum 可关闭（默认 true）
  │     · 详见 docs/momentum_stage_design.md
  └─ AnchorDecisionStage.annotate()  ← 后处理 anchor 标注 + snap
```

### Orchestrator 内部新增步骤（§1.1 step 4 内）

```
arrange() 内部：
  ├─ 鼓组：DrumIdiomRouter.generate(ctx)     ← 6 种 Idiom 评分选择 + 华彩借调
  ├─ 副旋律：CounterMelodyRouter.generate()   ← 3 模式（ParallelHarmony / CallAndResponse）
  ├─ 和弦：PianoIdiomRouter.pickTexture()     ← 5 策略评分选择 texture
  ├─ 贝斯：generateBassLine(subgenre)         ← 4 种 hits pattern
  └─ absoluteClampHigh(melodyIsPlucked ? 79 : 84)  ← 音域按包络分级
```

### Idiom 评分选择模型（通用）

```typescript
// 每个 Idiom 实现 score(ctx): number（0-100）
// Router 在每个 section 入口调所有 idiom 的 score，选最高分
// 切换保护：分差 < 10-15% 时保持上一段 idiom
// 华彩借调：Bridge/PreChorus 30% 概率切第二高分 idiom

interface IDrumIdiom {
    readonly name: string;
    score(ctx: DrumIdiomContext): number;
    generate(ctx: DrumIdiomContext): NoteData[];
}
```

---

## 与其它文档的关系

- `.claude/rules/music_generation_pipeline_rule.md` — 定义四模块管道接口契约（恒定约束）
- `.claude/rules/music_engine_audit_standard.md` §14 — 定义本文件描述的 V3.5 模块的审计维度（24 检查项）
- `docs/main_melody_generation_logic.md` — V3.5 旋律 pipeline 详细 13 阶段说明（含 file:line 索引）
- `docs/audits/current_state.md` — 各模块当前实现成绩单（V1.2 ✅25/⚠️3/❌0）

## 维护提示

- 新增 V3.x idiom（例如 V3.6 加入 LatinPercussionIdiom）时，更新本文件对应模块清单
- 模块路径变动时，同步更新 audit_standard §14 中的 file:line 锚点
- 内部步骤如果**新增** PRNG 消耗或**移动** ACVE 快照点，必须先修改 `.claude/rules/music_generation_pipeline_rule.md` §5（rules-tier）再更新本文件
- 历史版本拓扑应通过 git history 追溯，本文件只保留当前版本
