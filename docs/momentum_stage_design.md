# MomentumStage 设计契约

> **状态** — 实施前的设计基线，PR 实装时按本文执行
> **创建日期** — 2026-04-17
> **背景** — Luis 旋律连贯性诊断（4 建议）的 #1 物理动量系统
> **作者** — User + Claude（基于 V3.5 RichIdioms 现状）

---

## 1. 目标

给生成管道注入"音高动量与阻尼"，让非 anchor 的过渡音符遵循人类潜意识的"惯性 + 重力"预期，弥补当前 V3.5 在 anchor 之间过渡音"无运动学状态"的盲区。

**预期效果**（Seed Lab 5 维）：
- Flow 维度 +0.3 ~ +0.5
- Catchy 维度 +0.2
- Balance / Groove / Variety 不下降（≥ -0.1）

## 2. 架构定位

### Pipeline 中的位置

```
MelodyEngine.generateFullSong() 内：
  阶段⑥ ToplineEngine.generateTrackMelody()
  阶段⑦ Reharmonize
  阶段⑧ GlobalReviewer Phase 1
  阶段⑨ cleanMelodyPostProcessing (P5a/b/c)
  ★ 新增 阶段⑨.5 MomentumStage.smooth() ★
  阶段⑩ AnchorDecisionStage.annotate()
  阶段⑪ → Orchestrator.arrange()
```

**为什么放在 ⑨ 与 ⑩ 之间**：
- ⑨ 已清完病理音程（大跳/三全音），输入是干净 melody
- AnchorBackbone 在 ⑥ 内部已写入 `isPreBuiltAnchor=true` —— MomentumStage 可读
- 在 ⑩ 之前：让 AnchorDecisionStage 在已平滑的 melody 上做最终 anchor 标注

**符合 §0.3** 扩展协议：内部子步骤，不新增管道阶段。

## 3. 数据契约

```typescript
// 文件：src/core/generation/composing/MomentumStage.ts
// Pitch Space: RELATIVE（消费 NoteData.pitch 相对值，不读 keyOffset）

interface MomentumState {
    /** 累积动量：signed diatonic step（音阶级，非半音），范围 [-3, +3] */
    M: number;
    /** 大跳后的强制反向债务：必须用反向级进消耗 */
    dampingDebt: number;
    /** 历史步长 ring buffer（最近 3 步符号） */
    recentSteps: Int8Array;
    recentIdx: number;
}

interface MomentumStageContext {
    /** 输入：已清洁的 melody（RELATIVE pitch） */
    notes: NoteData[];
    /** 当前和弦时间轴（RELATIVE） */
    chords: GeneratedChord[];
    /** 调式 */
    tonality: Tonality;
    /** 张力曲线（阶段 B 接入；阶段 A 可省略） */
    tensionEnvelope?: TensionEnvelope;
    /** 段落信息（阶段 B 用于 phrase 边界查询） */
    sections?: SectionMetadata[];
}

class MomentumStage {
    public static smooth(ctx: MomentumStageContext): NoteData[];
}
```

## 4. 算法逻辑

### 4.1 主循环（per note）

```
for i in [1, notes.length):
    prev = notes[i-1]
    curr = notes[i]

    if curr.isPreBuiltAnchor === true: 重置动量, continue
    if curr.isGraceNote === true: continue  (装饰音不动)

    chromaStep = curr.pitch - prev.pitch
    diaStep = chromaToDiatonicStep(chromaStep, tonality)
    updateMomentum(state, diaStep, chromaStep)

    strength = 阶段A: 1.0  /  阶段B: 0.5 + 0.5 × tension
    predictedShift = -sign(M) × min(|M|, 1)

    if predictedShift === 0 && dampingDebt === 0: continue

    targetPitch = dampingDebt > 0
        ? shiftDiatonic(curr.pitch, -sign(M), scaleIntervals)
        : round(curr.pitch + predictedShift × strength)

    snapped = snapToScale(targetPitch, getCurrentChord(ctx, curr.onset).safeScale)

    if |snapped - curr.pitch| > MAX_ADJUSTMENT_DIATONIC (=2): continue

    curr.pitch = snapped
    dampingDebt = max(0, dampingDebt - 1)
```

### 4.2 动量更新

```
function updateMomentum(state, diaStep, chromaStep):
    if |chromaStep| >= 5:  // 大跳
        state.M = -sign(chromaStep) × 2
        state.dampingDebt = 2
        return

    state.M = clip(state.M × 0.7 + diaStep, -3, 3)  // 衰减累积

    // 同向连续 3 步检测 → 加速
    state.recentSteps[state.recentIdx] = sign(diaStep)
    state.recentIdx = (state.recentIdx + 1) % 3
    if 三步同向 && sign != 0:
        state.M = clip(state.M × 1.5, -3, 3)
```

### 4.3 关键常数

| 常数 | 值 | 说明 |
|---|---|---|
| `MAX_ADJUSTMENT_DIATONIC` | 2 | 单音最大调整幅度（diatonic step） |
| `LEAP_THRESHOLD` | 5 半音 | 触发大跳阻尼的阈值 |
| `LEAP_DAMPING_DEBT` | 2 | 大跳后必须用 N 个反向音消耗 |
| `MOMENTUM_DECAY` | 0.7 | 每音衰减系数 |
| `MOMENTUM_MAX` | 3 | 动量值上限 |
| `STREAK_BOOST` | 1.5 | 同向 3 步加速倍数 |

## 5. 已确定的设计决策

| Q | 决策 | 理由 |
|---|---|---|
| Q1 张力耦合公式 | (a) `0.5 + 0.5 × t` 线性 | 简洁可调，避免过早优化 |
| Q2 阻尼债务 | (a) 固定 2 | Luis 原文意图，简单可验证 |
| Q3 适用范围 | (a) 仅主旋律 melody | 副旋律有自己的 ParallelHarmony 约束，注入动量可能冲突 |
| Q4 风格开关 | (b) `StyleConfig.melody.useMomentum: boolean`，默认 true | 符合 memory `feedback_engine_vs_style_layer.md` 的"能力层 vs 调性层"原则 |
| Q5 文档去向 | (b) 落到本文件 | 实施前的契约文档 |

## 6. 约束合规性

| 约束 | 状态 | 说明 |
|---|---|---|
| **D-1** 禁止 Math.random | ✅ | 算法纯确定性，零 PRNG 调用 |
| **D-4** 浮点 epsilon | ✅ | 比较用 `Math.abs(a-b) < 1e-6` |
| **K-1~K-3** Pitch Space RELATIVE | ✅ | 输入/输出都是 RELATIVE pitch，只调用 `shiftDiatonic` / `snapToScale` |
| **K-5** 禁读 currentKeyOffset | ✅ | 不读 GlobalContext |
| **P-1** 禁 Map/Set | ✅ | 用 Int8Array ring buffer |
| **C-1** 浮点不直接 === | ✅ | 见 D-4 |
| **C-3** 热循环禁 spread | ✅ | 原地修改 NoteData.pitch |
| **C-4** 数组无上界 | ✅ | 不创建数组，只修改输入 |
| **S-1~S-7** 纯净性 | ✅ | 无全局状态、同步、可序列化 |
| **ACVE stateC/D** | ✅ | 零 PRNG 消耗 → 现有 stateC/D 快照不需要重新录制 |

## 7. 与现有模块协同

| 模块 | 关系 |
|---|---|
| **AnchorBackbone**（P6a） | MomentumStage 读 `isPreBuiltAnchor` 跳过；anchor 是骨架不可动 |
| **PhraseContourPlanner**（P6b） | MomentumStage 读 `tensionEnvelope.at()` 调节动量强度 |
| **AnchorDecisionStage**（⑩） | 在 MomentumStage 之后跑；momentum 移动 pitch 后，⑩ 仍可重新评估 anchor |
| **GlobalReviewer Phase 1** | 已在 ⑧ 跑过；momentum 修改幅度 ≤ 2 diatonic step，不引入新 m9 vs Bass 冲突；但需 Seed Lab 复测 |
| **HarmonyCore.shiftDiatonic / snapToScale** | 复用，不改 |

## 8. 实装阶段

| 阶段 | 内容 | 预计工时 |
|---|---|---|
| **A** | MomentumStage 骨架 + 单元行为（无张力耦合） | 0.5 天 |
| **B** | 接入 PhraseContourPlanner 的 tensionEnvelope | 0.3 天 |
| **C** | 集成到 MelodyEngine + StyleConfig.melody.useMomentum 开关 | 0.3 天 |
| **D** | ACVE stateC/D 复跑 + Seed Lab 听感 A/B（用户侧） | 0.5 天 |
| **E** | audit_standard 新增 §15 维度 + current_state.md 加项 | 0.4 天 |
| 合计 | | **~2 天** |

## 9. 验证策略

1. **PRNG 一致性**：同 seed 下 stateC / stateD 必须与基线匹配（零消耗）
2. **音域不外溢**：MomentumStage 修改后所有 pitch ∈ 原音域
3. **anchor 不动**：所有 `isPreBuiltAnchor=true` 音符 pitch 严格 === 原值
4. **和弦音保持率**：强拍音（onset 在 chord 起始 ±0.1 拍）chord tone 占比下降不超过 5%
5. **黄金种子 SHA**：4 个种子的 MidiEvent SHA 改变（预期 — 因 pitch 调整），但内部 metric 通过
6. **Seed Lab 5 维**：Flow / Catchy 维度应升 ≥ 0.3，其它不降

## 10. 后续 idea

本设计完成后可探索 Luis 的另外 3 条建议（按优先级）：

| 优先级 | Luis 建议 | 实装思路 |
|---|---|---|
| P1 | #4 Density 张力联动 | PhraseContourPlanner 增加 `densityHint(beat)` → 影响 RhythmCells 池过滤 |
| P2 | #3 Bresenham → Catmull-Rom | AnchorBackbone.pickMidAnchorPitch() 升级 spline |
| P3 | #2 跨段 targetAnchor 注入 | StructureEngine 计算 next-section 首 anchor → 喂给当前 section 末 phrase |

---

**文档结束**。代码实装请严格按本契约，任何偏离需先修订本文件。
